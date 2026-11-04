import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TimelineBlock } from "../blocks/timeline";

const runtime = vi.hoisted(() => ({ act: vi.fn().mockResolvedValue(true), holdInput: () => () => {} }));
vi.mock("../data/window-data", () => ({ useWindowData: () => runtime, useBinding: (_: string, value: unknown) => ({ status: "ready", value }) }));
vi.mock("../share/visible", () => ({ useShareDescriber: () => {} }));
vi.mock("../data/window-state", () => ({ useWindowVisible: () => true, useWindowGrants: () => [], useWindowStateValue: () => null }));
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("ks-dates-corner")) return { left: 0, top: 0, width: 128, height: 96 } as DOMRect;
    if (this.classList.contains("ks-dates-row-measure")) return { left: 0, top: 0, width: 0, height: 40 } as DOMRect;
    if (this.parentElement?.classList.contains("ks-dates-measure")) return { left: 0, top: 0, width: 12, height: 16 } as DOMRect;
    return { left: 0, top: 0, width: 600, height: 300 } as DOMRect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); runtime.act.mockClear(); });

const context = { store: {} as never, window: { id: "window-1", app_id: "app", app_version: 1, desktop_id: "desktop" }, definition: {} as never };
const block = { type: "timeline" as const, scale: "dates" as const, today: false,
  tracks: [{ id: "track", label: "한 줄", items: [{ id: "item", label: "작업", start: "2026-11-10", end: "2026-11-12", movable: true }] }],
  on_edit: { client: "edit" }, on_select: { client: "select" } };

it("움직이지 않은 누름은 고르기만 하고 끌기는 날짜로 한 번 저장한다", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => {} });
  render(<TimelineBlock block={block} pointer="/ui" context={context} />);
  const item = screen.getByRole("button", { name: /작업/ });
  fireEvent.pointerDown(item, { clientX: 100 });
  fireEvent.pointerUp(item, { clientX: 100 });
  expect(runtime.act).toHaveBeenCalledWith("/ui/on_select", { ids: ["item"] });
  expect(runtime.act.mock.calls.filter(([path, value]) => path === "/ui/on_edit" && value.phase === "commit")).toHaveLength(0);
  fireEvent.pointerDown(item, { clientX: 100 });
  fireEvent.pointerMove(item, { clientX: 180 });
  fireEvent.pointerUp(item, { clientX: 180 });
  const commits = runtime.act.mock.calls.filter(([path, value]) => path === "/ui/on_edit" && value.phase === "commit");
  expect(commits).toHaveLength(1);
  expect(commits[0][1]).toEqual(expect.objectContaining({ id: "item", start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), end: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
});

it("많은 트랙은 보이는 막대만 그린다", () => {
  const tracks = Array.from({ length: 300 }, (_, i) => ({ id: `track-${i}`, items: Array.from({ length: 3 }, (_, j) => ({ id: `item-${i}-${j}`, start: "2026-11-10", end: "2026-11-12" })) }));
  const view = render(<TimelineBlock block={{ ...block, tracks }} pointer="/ui" context={context} />);
  expect(view.container.querySelectorAll(".ks-timeline-item").length).toBeLessThan(100);
  expect(view.container.querySelectorAll(".ks-timeline-item").length).toBeGreaterThan(0);
});

it("일반 휠은 확대하지 않고 Ctrl 휠은 확대한다", () => {
  const view = render(<TimelineBlock block={block} pointer="/ui" context={context} />);
  const scroll = view.container.querySelector(".ks-dates-scroll")!;
  const axis = view.container.querySelector<HTMLElement>(".ks-dates-axis")!;
  const width = parseFloat(axis.style.width);
  fireEvent.wheel(scroll, { deltaY: -100, clientX: 300 });
  expect(parseFloat(axis.style.width)).toBe(width);
  fireEvent.wheel(scroll, { deltaY: -100, clientX: 300, ctrlKey: true });
  expect(parseFloat(axis.style.width)).toBeGreaterThan(width);
  expect(runtime.act).not.toHaveBeenCalled();
});
