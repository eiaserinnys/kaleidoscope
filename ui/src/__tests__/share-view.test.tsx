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
      return registerWebSurface(root.current, "target", store, () => undefined);
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
  await act(async () => { await prepareShareForSend(store); });
  expect(call.mock.calls.map(([request]) => request.op)).toEqual(["share.view"]);
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
