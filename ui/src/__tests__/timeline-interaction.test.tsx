import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TimelineBlock } from "../blocks/timeline";

const runtime = vi.hoisted(() => ({ act: vi.fn().mockResolvedValue(true) }));
vi.mock("../data/window-data", () => ({
  useWindowData: () => runtime,
  useBinding: (_pointer: string, value: unknown) => ({ status: "ready", value }),
}));
vi.mock("../share/visible", () => ({ useShareDescriber: () => {} }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); runtime.act.mockClear(); });

const block = {
  type: "timeline" as const, duration: 10, position: 0,
  tracks: [{ id: "track", label: "가사", items: [{ id: "line", label: "첫 줄", start: 1, end: 3, movable: true, resizable: true }] }],
  on_edit: { client: "edit" }, on_select: { client: "select" }, on_seek: { client: "seek" },
};

it("드래그 중 재렌더 뒤에도 프레임 단위 미리보기를 전달한다", () => {
  let next = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++next, fn); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => {} });
  render(<TimelineBlock block={block} pointer="/ui" />);
  const item = screen.getByText("첫 줄").parentElement!;
  fireEvent.pointerDown(item, { clientX: 10 });
  fireEvent.pointerMove(item, { clientX: 20 });
  act(() => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0); } });
  expect(runtime.act).toHaveBeenCalledWith("/ui/on_edit", expect.objectContaining({ phase: "preview", id: "line" }));
});

it("시간축과 구간을 키보드로 탐색하고 편집한다", () => {
  render(<TimelineBlock block={block} pointer="/ui" />);
  fireEvent.keyDown(screen.getByRole("slider", { name: "재생 위치" }), { key: "ArrowRight" });
  expect(runtime.act).toHaveBeenCalledWith("/ui/on_seek", expect.any(Number));
  const item = screen.getByText("첫 줄").parentElement!;
  expect(item.tabIndex).toBe(0);
  fireEvent.keyDown(item, { key: "ArrowRight" });
  expect(runtime.act).toHaveBeenCalledWith("/ui/on_edit", expect.objectContaining({ phase: "commit", kind: "move" }));
});
