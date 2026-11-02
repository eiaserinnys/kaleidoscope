import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TimelineBlock } from "../blocks/timeline";

const runtime = vi.hoisted(() => ({ act: vi.fn().mockResolvedValue(true), bindings: {} as Record<string, unknown> }));
vi.mock("../data/window-data", () => ({
  useWindowData: () => runtime,
  useBinding: (pointer: string, value: unknown) => ({ status: "ready", value: runtime.bindings[pointer] ?? value }),
}));
vi.mock("../share/visible", () => ({ useShareDescriber: () => {} }));
vi.mock("../data/window-state", () => ({ useWindowVisible: () => true }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); runtime.act.mockClear(); runtime.bindings = {}; });

const block = {
  type: "timeline" as const, duration: 10, position: 0,
  tracks: [{ id: "track", label: "가사", items: [{ id: "line", label: "첫 줄", start: 1, end: 3, movable: true, resizable: true }] }],
  on_edit: { client: "edit" }, on_select: { client: "select" }, on_seek: { client: "seek" },
};
const viewportBlock = {
  ...block, duration: 100, viewport: { start: 10, end: 50 }, controls: true, on_viewport: { client: "viewport" },
};
const context = { store: {} as never, window: { id: "window-1", app_id: "app", app_version: 1, desktop_id: "desktop" }, definition: {} as never };

it("드래그 중 재렌더 뒤에도 프레임 단위 미리보기를 전달한다", () => {
  let next = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++next, fn); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => {} });
  render(<TimelineBlock block={block} pointer="/ui" context={context} />);
  const item = screen.getByText("첫 줄").parentElement!;
  fireEvent.pointerDown(item, { clientX: 10 });
  fireEvent.pointerMove(item, { clientX: 20, shiftKey: true });
  act(() => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0); } });
  expect(runtime.act).toHaveBeenCalledWith("/ui/on_edit", expect.objectContaining({ phase: "preview", id: "line" }), undefined, { shift: true, alt: false, ctrl: false, meta: false });
  fireEvent.keyDown(document, { key: "Escape", shiftKey: true });
  expect(runtime.act).toHaveBeenCalledWith("/ui/on_edit", expect.objectContaining({ phase: "cancel", id: "line" }), undefined, { shift: true, alt: false, ctrl: false, meta: false });
});

it("시간축과 구간을 키보드로 탐색하고 편집한다", () => {
  render(<TimelineBlock block={block} pointer="/ui" context={context} />);
  fireEvent.keyDown(screen.getByRole("slider", { name: "재생 위치" }), { key: "ArrowRight" });
  expect(runtime.act).toHaveBeenCalledWith("/ui/on_seek", expect.any(Number));
  const item = screen.getByText("첫 줄").parentElement!;
  expect(item.tabIndex).toBe(0);
  fireEvent.keyDown(item, { key: "ArrowRight", shiftKey: true });
  expect(runtime.act).toHaveBeenCalledWith("/ui/on_edit", expect.objectContaining({ phase: "commit", kind: "move" }), undefined, { shift: true, alt: false, ctrl: false, meta: false });
});

it("오른쪽 끝에 있는 눈금만 끝 맞춤한다", () => {
  const view = render(<TimelineBlock block={{ ...block, duration: 14.02 }} pointer="/ui" context={context} />);
  expect(screen.getByText("00:10.0").className).not.toContain("is-end");
  view.rerender(<TimelineBlock block={{ ...block, duration: 10 }} pointer="/ui" context={context} />);
  expect(screen.getByText("00:10.0").className).toContain("is-end");
});

it("확대 단추와 휠은 포인터 아래 시각을 유지하고 축소·맞춤 단추가 동작한다", () => {
  let next = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++next, fn); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
  const view = render(<TimelineBlock block={viewportBlock} pointer="/ui" context={context} />);
  const scroll = view.container.querySelector(".ks-timeline-scroll")!;
  fireEvent.wheel(scroll, { deltaY: -100, clientX: 25 });
  act(() => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0); } });
  const zoomed = runtime.act.mock.calls.at(-1)?.[1] as { start: number; end: number };
  expect(zoomed.start + (zoomed.end - zoomed.start) * 0.25).toBeCloseTo(20);
  expect(zoomed.end - zoomed.start).toBeCloseTo(40 / Math.exp(0.25));

  view.unmount();
  runtime.act.mockClear();
  const zoomOutView = render(<TimelineBlock block={viewportBlock} pointer="/ui" context={context} />);
  fireEvent.click(screen.getByRole("button", { name: "축소" }));
  act(() => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0); } });
  const zoomedOut = runtime.act.mock.calls.at(-1)?.[1] as { start: number; end: number };
  expect(zoomedOut.end - zoomedOut.start).toBeCloseTo(40 * 1.6);

  zoomOutView.unmount();
  runtime.act.mockClear();
  render(<TimelineBlock block={viewportBlock} pointer="/ui" context={context} />);
  fireEvent.click(screen.getByRole("button", { name: "전체 맞춤" }));
  act(() => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0); } });
  expect(runtime.act).toHaveBeenLastCalledWith("/ui/on_viewport", { start: 0, end: 100 });
});

it("Shift 휠은 구간 길이를 유지하며 가로로 이동한다", () => {
  let next = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++next, fn); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
  const view = render(<TimelineBlock block={viewportBlock} pointer="/ui" context={context} />);
  fireEvent.wheel(view.container.querySelector(".ks-timeline-scroll")!, { deltaY: 10, shiftKey: true });
  act(() => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0); } });
  expect(runtime.act).toHaveBeenLastCalledWith("/ui/on_viewport", { start: 14, end: 54 });
});

it("드래그는 놓는 순간 최종 commit 한 번만 보내고 Shift 중에는 snap하지 않는다", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => {} });
  const editable = { ...block, snap: { step: 1 } };
  const view = render(<TimelineBlock block={editable} pointer="/ui" context={context} />);
  const item = view.container.querySelector(".ks-timeline-item")!;
  fireEvent.pointerDown(item, { pointerId: 1, clientX: 10 });
  fireEvent.pointerMove(item, { pointerId: 1, clientX: 36, shiftKey: true });
  fireEvent.pointerUp(item, { pointerId: 1, clientX: 36, shiftKey: true });
  const commits = runtime.act.mock.calls.filter(([pointer, value]) => pointer === "/ui/on_edit" && (value as { phase?: string }).phase === "commit");
  expect(commits).toHaveLength(1);
  expect(commits[0][1]).toMatchObject({ start: 3.6, end: 5.6 });
  expect(commits[0][3]).toMatchObject({ shift: true });
});

it("항목 시작 손잡이만 보이고 움직일 수 없는 항목은 통째로 끌리지 않는다", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => {} });
  const lockedItem = { id: "fixed", start: 1, end: 3, resizable: true, resize_start_only: true };
  const view = render(<TimelineBlock block={{ ...block, tracks: [{ id: "track", items: [lockedItem] }] }} pointer="/ui" context={context} />);
  expect(view.container.querySelector(".ks-timeline-handle.is-start")).not.toBeNull();
  expect(view.container.querySelector(".ks-timeline-handle.is-end")).toBeNull();
  fireEvent.pointerDown(view.container.querySelector(".ks-timeline-item")!, { pointerId: 1, clientX: 10 });
  fireEvent.pointerMove(view.container.querySelector(".ks-timeline-item")!, { pointerId: 1, clientX: 20 });
  fireEvent.pointerUp(view.container.querySelector(".ks-timeline-item")!, { pointerId: 1, clientX: 20 });
  expect(runtime.act.mock.calls.filter(([pointer]) => pointer === "/ui/on_edit")).toHaveLength(0);
});
