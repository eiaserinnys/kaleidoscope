import { act, cleanup, render } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ShellStore } from "../core/shell-store";
import { flushShareViews, prepareShareForSend, useShareView } from "../share/share-view";
import { registerWebSurface } from "../blocks/web-surface-layer";
import * as visible from "../share/visible";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("계속 바뀌는 샌드박스 화면도 정기적으로 코어에 전달한다", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  let text = "처음";
  vi.spyOn(visible, "describeVisible").mockImplementation(() => ({ text, visual: true }));
  const rect = { left: 0, top: 0, right: 100, bottom: 100, x: 0, y: 0, width: 100, height: 100, toJSON() {} };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  const call = vi.fn().mockResolvedValue({ op: "share.view" });
  const store = { call } as unknown as ShellStore;
  function Probe() { const root = useRef<HTMLDivElement>(null); useShareView({ windowId: "window", root, enabled: true, store }); return <div ref={root} />; }
  const { container } = render(<Probe />);
  await act(async () => {});
  for (let i = 1; i <= 4; i++) {
    text = `화면 ${i}`;
    await act(async () => { container.firstElementChild!.setAttribute("data-share-seq", String(i)); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  }
  expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "share.view", view: expect.objectContaining({ text: expect.stringContaining("화면") }) }));
});

it("시간축 재생 중에도 클라이언트의 같이 보기 설명을 갱신한다", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  let text = "처음";
  vi.spyOn(visible, "describeVisible").mockImplementation(() => ({ text, visual: false }));
  const rect = { left: 0, top: 0, right: 100, bottom: 100, x: 0, y: 0, width: 100, height: 100, toJSON() {} };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  const call = vi.fn().mockResolvedValue({ op: "share.view" });
  const store = { call } as unknown as ShellStore;
  function Probe() {
    const root = useRef<HTMLDivElement>(null);
    useShareView({ windowId: "window", root, enabled: true, store });
    return <div ref={root}><span data-share-seq="0" /><div className="ks-timeline-scroll"><div className="ks-timeline-playhead" /><div className="ks-timeline-ruler" aria-valuenow={0} /></div></div>;
  }
  const { container } = render(<Probe />);
  await act(async () => {});
  text = "바뀐 설명";
  await act(async () => { container.querySelector("[data-share-seq]")!.setAttribute("data-share-seq", "1"); });
  for (let i = 1; i <= 10; i++) {
    await act(async () => {
      (container.querySelector(".ks-timeline-playhead") as HTMLElement).style.left = `${i}%`;
      container.querySelector(".ks-timeline-ruler")!.setAttribute("aria-valuenow", String(i));
      container.querySelector(".ks-timeline-scroll")!.dispatchEvent(new Event("scroll"));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  }
  expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "share.view", view: expect.objectContaining({ text: "바뀐 설명" }) }));
});

it("최소화한 창의 글도 갱신해 코어에 전달한다", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  let text = "처음 내용";
  vi.spyOn(visible, "describeVisible").mockImplementation(() => ({ text, visual: true }));
  const rect = { left: 0, top: 0, right: 100, bottom: 80, x: 0, y: 0, width: 100, height: 80, toJSON() {} };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1, item: () => rect } as unknown as DOMRectList);
  const call = vi.fn().mockResolvedValue({ op: "share.view" });
  const store = { call } as unknown as ShellStore;
  function Probe() {
    const root = useRef<HTMLDivElement>(null);
    useShareView({ windowId: "minimized", root, enabled: true, store });
    return <section className="ks-window" data-minimized="true"><div ref={root} /></section>;
  }
  render(<Probe />);
  await act(async () => {});
  expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "share.view", view: expect.objectContaining({ text: "처음 내용", occluded: true }) }));
  text = "최소화 뒤 갱신된 내용";
  await act(async () => { await flushShareViews(); });
  expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "share.view", view: expect.objectContaining({ text, occluded: true }) }));
});

function layout() {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  const rect = { left: 0, top: 0, right: 100, bottom: 80, x: 0, y: 0, width: 100, height: 80, toJSON() {} };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1, item: () => rect } as unknown as DOMRectList);
}

it("가린 창만 고정 중 드러내 캡처하고 캡처 실패에도 해제한다", async () => {
  layout();
  vi.spyOn(visible, "describeVisible").mockReturnValue({ text: "가린 창", visual: true });
  const operations: Array<{ op: string; window_id?: string; bounds?: unknown }> = [];
  const call = vi.fn(async (request: { op: string; window_id?: string; bounds?: unknown }) => {
    operations.push(request);
    if (request.op === "share.freeze") return { op: "share.freeze", frozen: true } as const;
    if (request.op === "share.capture") {
      expect(document.documentElement.dataset.shareIsolating).toBe("true");
      expect(document.querySelector<HTMLElement>(".ks-window")?.dataset.shareTarget).toBe("true");
      throw new Error("capture failed");
    }
    if (request.op === "web.place") return { op: "web.place" } as const;
    if (request.op === "share.unfreeze") return { op: "share.unfreeze" } as const;
    return { op: "share.view" } as const;
  });
  const store = { call } as unknown as ShellStore;
  function Probe() {
    const root = useRef<HTMLDivElement>(null);
    useShareView({ windowId: "target", root, enabled: true, store });
    useEffect(() => {
      if (!root.current) return;
      const registration = registerWebSurface(root.current, "target", store, () => undefined);
      return () => registration.unregister();
    }, []);
    return <div className="ks-desktop-canvas">
      <section className="ks-window" data-minimized="true" style={{ zIndex: 1 }}><div ref={root} /></section>
      <section className="ks-window" style={{ zIndex: 2 }} />
    </div>;
  }

  render(<Probe />);
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 10)); });
  operations.length = 0;
  await act(async () => { await prepareShareForSend(store); });
  expect(operations.map(({ op }) => op)).toEqual([
    "share.freeze", "web.place", "share.capture", "web.place", "share.unfreeze",
  ]);
  expect(operations[1].bounds).toEqual({ x: 0, y: 0, width: 100, height: 80 });
  expect(operations[3].bounds).toBeNull();
  expect(document.documentElement.dataset.shareIsolating).toBeUndefined();
  expect(document.querySelector("[data-share-target]")).toBeNull();
});

it("보이는 대상이 없으면 고정과 추가 캡처를 생략한다", async () => {
  layout();
  vi.spyOn(visible, "describeVisible").mockReturnValue({ text: "보이는 창", visual: true });
  const call = vi.fn(async (request: { op: string }) => ({ op: request.op } as never));
  const store = { call } as unknown as ShellStore;
  function Probe() {
    const root = useRef<HTMLDivElement>(null);
    useShareView({ windowId: "visible", root, enabled: true, store });
    return <section className="ks-window"><div ref={root} /></section>;
  }
  render(<Probe />);
  await act(async () => {});
  const requestFrame = vi.fn((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  await act(async () => { await prepareShareForSend(store); });
  expect(call.mock.calls.map(([request]) => request.op)).toEqual(["share.view"]);
  expect(requestFrame).not.toHaveBeenCalled();
});

it("가린 대상이 있으면 두 프레임을 기다린 뒤 화면을 고정한다", async () => {
  layout();
  vi.spyOn(visible, "describeVisible").mockReturnValue({ text: "가린 창", visual: true });
  const timeline: string[] = [];
  const call = vi.fn(async (request: { op: string }) => {
    timeline.push(request.op);
    return request.op === "share.freeze"
      ? { op: "share.freeze", frozen: true } as const
      : { op: request.op } as never;
  });
  const store = { call } as unknown as ShellStore;
  function Probe() {
    const root = useRef<HTMLDivElement>(null);
    useShareView({ windowId: "target", root, enabled: true, store });
    return <section className="ks-window" data-minimized="true"><div ref={root} /></section>;
  }

  render(<Probe />);
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 10)); });
  timeline.length = 0;

  const frames: FrameRequestCallback[] = [];
  let requestedFrames = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    requestedFrames += 1;
    if (requestedFrames <= 2) frames.push(callback);
    else queueMicrotask(() => callback(performance.now()));
    return requestedFrames;
  });

  const pending = prepareShareForSend(store);
  await vi.waitFor(() => expect(frames).toHaveLength(1));
  expect(call).not.toHaveBeenCalledWith({ op: "share.freeze" });
  timeline.push("frame-1");
  frames.shift()!(performance.now());

  await vi.waitFor(() => expect(frames).toHaveLength(1));
  expect(call).not.toHaveBeenCalledWith({ op: "share.freeze" });
  timeline.push("frame-2");
  frames.shift()!(performance.now());

  await pending;
  expect(timeline.indexOf("frame-1")).toBeLessThan(timeline.indexOf("frame-2"));
  expect(timeline.indexOf("frame-2")).toBeLessThan(timeline.indexOf("share.freeze"));
});

it("화면 고정에 실패하면 숨김 상태를 만들지 않는다", async () => {
  layout();
  vi.spyOn(visible, "describeVisible").mockReturnValue({ text: "가린 창", visual: true });
  const call = vi.fn(async (request: { op: string }) => request.op === "share.freeze"
    ? { op: "share.freeze", frozen: false } as const
    : { op: request.op } as never);
  const store = { call } as unknown as ShellStore;
  function Probe() {
    const root = useRef<HTMLDivElement>(null);
    useShareView({ windowId: "target", root, enabled: true, store });
    return <div><section className="ks-window" style={{ zIndex: 1 }}><div ref={root} /></section><section className="ks-window" style={{ zIndex: 2 }} /></div>;
  }
  render(<Probe />);
  await act(async () => {});
  await act(async () => { await prepareShareForSend(store); });
  expect(call.mock.calls.map(([request]) => request.op)).toEqual(["share.view", "share.freeze"]);
  expect(document.documentElement.dataset.shareIsolating).toBeUndefined();
});

it("동시에 보낸 준비는 앞의 해제가 끝난 뒤 다음 고정을 시작한다", async () => {
  layout();
  vi.spyOn(visible, "describeVisible").mockReturnValue({ text: "가린 창", visual: true });
  const operations: string[] = [];
  const call = vi.fn(async (request: { op: string }) => {
    operations.push(request.op);
    return request.op === "share.freeze"
      ? { op: "share.freeze", frozen: true } as const
      : { op: request.op } as never;
  });
  const store = { call } as unknown as ShellStore;
  function Probe() {
    const root = useRef<HTMLDivElement>(null);
    useShareView({ windowId: "target", root, enabled: true, store });
    return <section className="ks-window" data-minimized="true"><div ref={root} /></section>;
  }
  render(<Probe />);
  await act(async () => {});
  operations.length = 0;
  await act(async () => { await Promise.all([prepareShareForSend(store), prepareShareForSend(store)]); });
  const gates = operations.filter((op) => op === "share.freeze" || op === "share.unfreeze");
  expect(gates).toEqual(["share.freeze", "share.unfreeze", "share.freeze", "share.unfreeze"]);
});

async function isolateUntilCapture() {
  layout();
  vi.spyOn(visible, "describeVisible").mockReturnValue({ text: "가린 창", visual: true });
  const operations: string[] = [];
  const frames: FrameRequestCallback[] = [];
  let manualFrames = false;
  let captured!: () => void;
  const capture = new Promise<void>((resolve) => { captured = resolve; });
  const call = vi.fn(async (request: { op: string }) => {
    operations.push(request.op);
    if (request.op === "share.capture") {
      // 캡처 뒤의 프레임과 시간은 시험이 직접 돌린다.
      manualFrames = true;
      // 프레임은 시험이 돌리므로 requestAnimationFrame은 가짜 시계에 맡기지 않는다.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      captured();
    }
    return request.op === "share.freeze"
      ? { op: "share.freeze", frozen: true } as const
      : { op: request.op } as never;
  });
  const store = { call } as unknown as ShellStore;
  function Probe() {
    const root = useRef<HTMLDivElement>(null);
    useShareView({ windowId: "target", root, enabled: true, store });
    return <section className="ks-window" data-minimized="true"><div ref={root} /></section>;
  }
  render(<Probe />);
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 10)); });
  operations.length = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    if (manualFrames) frames.push(callback);
    else window.setTimeout(() => callback(performance.now()), 0);
    return frames.length;
  });
  const pending = prepareShareForSend(store);
  await capture;
  await vi.advanceTimersByTimeAsync(0);
  return { operations, frames, pending };
}

it("고정을 풀기 전에 격리를 푼 배치의 실제 프레임 세 번을 기다린다", async () => {
  const { operations, frames, pending } = await isolateUntilCapture();
  expect(document.documentElement.dataset.shareIsolating).toBeUndefined();
  // 프레임마다 100ms 시한으로 넘어가던 옛 대기는 여기서 덮개를 걷었다.
  await vi.advanceTimersByTimeAsync(300);
  expect(operations).not.toContain("share.unfreeze");
  for (let frame = 1; frame <= 3; frame++) {
    expect(frames).toHaveLength(1);
    expect(operations).not.toContain("share.unfreeze");
    frames.shift()!(performance.now());
    await vi.advanceTimersByTimeAsync(0);
  }
  await pending;
  expect(operations.at(-1)).toBe("share.unfreeze");
});

it("프레임이 오지 않으면 1초 상한에서 고정을 푼다", async () => {
  const { operations, pending } = await isolateUntilCapture();
  await vi.advanceTimersByTimeAsync(999);
  expect(operations).not.toContain("share.unfreeze");
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(operations.at(-1)).toBe("share.unfreeze");
});

it("Element Timing이 있으면 복원 표식 항목이 온 뒤에 고정을 푼다", async () => {
  const observers: Array<{ callback: PerformanceObserverCallback; disconnected: boolean }> = [];
  class FakeObserver {
    static supportedEntryTypes = ["element"];
    private readonly entry: { callback: PerformanceObserverCallback; disconnected: boolean };
    constructor(callback: PerformanceObserverCallback) { this.entry = { callback, disconnected: false }; observers.push(this.entry); }
    observe() {}
    disconnect() { this.entry.disconnected = true; }
  }
  vi.stubGlobal("PerformanceObserver", FakeObserver);
  const { operations, frames, pending } = await isolateUntilCapture();
  const marker = document.querySelector<HTMLElement>("[elementtiming^='ks-share-restore-']");
  expect(marker?.textContent).toBe(".");
  // 프레임 콜백이 몇 번 돌아도 표시 항목 전에는 풀지 않는다.
  for (let frame = 0; frame < 5; frame++) {
    frames.shift()?.(performance.now());
    await vi.advanceTimersByTimeAsync(16);
  }
  const deliver = (identifier: string) => observers.at(-1)!.callback(
    { getEntries: () => [{ identifier } as unknown as PerformanceEntry] } as PerformanceObserverEntryList,
    {} as PerformanceObserver,
  );
  deliver("other-element");
  await vi.advanceTimersByTimeAsync(0);
  expect(operations).not.toContain("share.unfreeze");
  deliver(marker!.getAttribute("elementtiming")!);
  await pending;
  expect(operations.at(-1)).toBe("share.unfreeze");
  expect(document.querySelector("[elementtiming^='ks-share-restore-']")).toBeNull();
  expect(observers.at(-1)!.disconnected).toBe(true);
});
