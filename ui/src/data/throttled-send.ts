export interface ThrottledSend<T> {
  send(value: T): void;
  flush(): void;
}

export function createSerialSend<T>(send: (value: T) => Promise<unknown> | unknown): ((value: T, options: { coalesce: boolean }) => Promise<void>) & { idle(): Promise<void> | null } {
  let active = false;
  const pending: Array<{ value: T; coalesce: boolean; done: Array<() => void> }> = [];
  const waiters: Array<() => void> = [];

  const drain = () => {
    if (active) return;
    if (pending.length === 0) { for (const resolve of waiters.splice(0)) resolve(); return; }
    const { value, done } = pending.shift()!;
    active = true;
    let result: Promise<unknown> | unknown;
    try {
      result = send(value);
    } catch {
      done.forEach((resolve) => resolve());
      active = false;
      drain();
      return;
    }
    void Promise.resolve(result).catch(() => undefined).then(() => {
      done.forEach((resolve) => resolve());
      active = false;
      drain();
    });
  };

  const enqueue = (value: T, { coalesce }: { coalesce: boolean }) => new Promise<void>((resolve) => {
    const last = pending.at(-1);
    if (coalesce && last?.coalesce) { last.value = value; last.done.push(resolve); }
    else pending.push({ value, coalesce, done: [resolve] });
    drain();
  });
  enqueue.idle = () => active || pending.length ? new Promise<void>((resolve) => waiters.push(resolve)) : null;
  return enqueue;
}

export function createThrottledSend<T>(send: (value: T) => void, intervalMs: number): ThrottledSend<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hasPending = false;
  let pending!: T;

  const startCooldown = () => {
    timer = setTimeout(() => {
      if (!hasPending) { timer = null; return; }
      hasPending = false;
      send(pending);
      startCooldown();
    }, intervalMs);
  };

  const flush = () => {
    if (!hasPending) return;
    if (timer !== null) clearTimeout(timer);
    hasPending = false;
    send(pending);
    startCooldown();
  };

  return {
    send(value) {
      if (timer === null) {
        send(value);
        startCooldown();
      } else {
        pending = value;
        hasPending = true;
      }
    },
    flush,
  };
}
