// 프레임 브리지(sandboxSource, clientSource가 만드는 스크립트)는 원래 격리 프레임 안에서 돌고 프레임과 함께 사라진다.
// 시험은 이 스크립트를 공용 jsdom 창에서 돌리므로 브리지가 건 관찰자, 수신기, 타이머가 시험이 끝난 뒤에도 남는다.
// 관찰자 콜백은 시험 끝의 vi.useRealTimers 뒤 마이크로태스크에서 돌아 진짜 타이머를 걸고, 그 타이머가 환경을 걷은 뒤
// 깨어나 document를 읽으면 「document is not defined」로 전체 실행이 실패한다.
// runFrameScript로 돌리고 afterEach(cleanupFrameScripts)로 시험마다 프레임을 닫듯 걷는다.
type TimerId = ReturnType<typeof setTimeout>;
type Listener = { target: Window | Document; type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions };
const cleanups: Array<() => void> = [];

export function runFrameScript(code: string): void {
  const timers = new Map<TimerId, (id: TimerId) => void>();
  const observers: MutationObserver[] = [];
  const listeners: Listener[] = [];
  // 거는 그 순간의 시계(가짜 또는 진짜)로 걸고, 건 시계로 푼다.
  const set = (kind: "timeout" | "interval") => (handler: TimerHandler, delay?: number, ...args: unknown[]): TimerId => {
    const start = kind === "timeout" ? globalThis.setTimeout : globalThis.setInterval;
    const clear = kind === "timeout" ? globalThis.clearTimeout : globalThis.clearInterval;
    const id = start(handler as () => void, delay, ...args) as unknown as TimerId;
    timers.set(id, clear as (id: TimerId) => void);
    return id;
  };
  const clear = (id: TimerId | undefined) => {
    if (id === undefined) return;
    timers.get(id)?.(id);
    timers.delete(id);
  };
  const Base = globalThis.MutationObserver; // frame-context-request는 vi.stubGlobal로 바꿔 둔다
  class TrackedObserver extends Base {
    constructor(callback: MutationCallback) { super(callback); observers.push(this); }
  }
  const targets: Array<Window | Document> = [window, document];
  const own = targets.map((target) => Object.getOwnPropertyDescriptor(target, "addEventListener"));
  for (const target of targets) {
    const add = target.addEventListener;
    target.addEventListener = function (this: Window | Document, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      if (listener) listeners.push({ target, type, listener, options });
      return add.call(this, type, listener as EventListenerOrEventListenerObject, options);
    } as typeof target.addEventListener;
  }
  try {
    new Function("setTimeout", "setInterval", "clearTimeout", "clearInterval", "MutationObserver", code)(set("timeout"), set("interval"), clear, clear, TrackedObserver);
  } finally {
    targets.forEach((target, index) => {
      const descriptor = own[index];
      if (descriptor) Object.defineProperty(target, "addEventListener", descriptor);
      else delete (target as { addEventListener?: unknown }).addEventListener;
    });
  }
  cleanups.push(() => {
    for (const observer of observers) observer.disconnect();
    for (const { target, type, listener, options } of listeners) target.removeEventListener(type, listener, options);
    for (const [id, stop] of timers) stop(id);
    timers.clear();
  });
}

export function cleanupFrameScripts(): void {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
}
