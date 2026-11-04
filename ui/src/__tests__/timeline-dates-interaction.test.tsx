import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TimelineBlock } from "../blocks/timeline";

const runtime = vi.hoisted(() => ({ act: vi.fn().mockResolvedValue(true), holdInput: () => () => {}, describe: null as null | (() => { text: string }) }));
vi.mock("../data/window-data", () => ({ useWindowData: () => runtime, useBinding: (_: string, value: unknown) => ({ status: "ready", value }) }));
vi.mock("../share/visible", () => ({ useShareDescriber: (_root: unknown, describe: () => { text: string }) => { runtime.describe = describe; } }));
vi.mock("../data/window-state", () => ({ useWindowVisible: () => true, useWindowGrants: () => [], useWindowStateValue: () => "ko-KR" }));
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("ks-dates-period-text")) return { width: 180, height: 16 } as DOMRect;
    if (this.classList.contains("ks-dates-name-measure")) return { width: this.textContent === "짧음" ? 12 : 100, height: 16 } as DOMRect;
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

it.each(["Escape", "pointercancel"])("%s 취소는 옮기기 전 날짜를 전달한다", (kind) => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => {} });
  render(<TimelineBlock block={block} pointer="/ui" context={context} />);
  const item = screen.getByRole("button", { name: /작업/ });
  fireEvent.pointerDown(item, { clientX: 100 });
  fireEvent.pointerMove(item, { clientX: 180 });
  if (kind === "Escape") fireEvent.keyDown(document, { key: "Escape" });
  else fireEvent.pointerCancel(item);
  expect(runtime.act.mock.calls.find(([, value]) => value.phase === "cancel")?.[1]).toEqual(expect.objectContaining({ start: "2026-11-10", end: "2026-11-12" }));
});

it("같이 보기는 300트랙의 실제 보이는 줄만 담는다", () => {
  const tracks = Array.from({ length: 300 }, (_, i) => ({ id: `track-${i}`, label: `행${i}`, items: [{ id: `item-${i}`, label: `항목${i}`, start: "2026-11-10", end: "2026-11-12" }] }));
  const view = render(<TimelineBlock block={{ ...block, tracks }} pointer="/ui" context={context} />);
  const scroll = view.container.querySelector(".ks-dates-scroll")!;
  scroll.scrollTop = 400; fireEvent.scroll(scroll);
  const text = runtime.describe!().text;
  expect(text).toContain("행10:");
  expect(text).not.toContain("행9:");
  expect(text).not.toContain("행299:");
});

it("범위 시작 변경은 보던 첫날을 유지하고 끝만 바뀌면 이동하지 않는다", () => {
  const view = render(<TimelineBlock block={block} pointer="/ui" context={context} />);
  const scroll = view.container.querySelector<HTMLElement>(".ks-dates-scroll")!;
  const axis = view.container.querySelector<HTMLElement>(".ks-dates-axis")!;
  const beforeWidth = parseFloat(axis.style.width);
  scroll.scrollLeft = 100; fireEvent.scroll(scroll);
  const tracks = [{ ...block.tracks[0], items: [...block.tracks[0].items, { id: "earlier", label: "이전", start: "2026-11-03", end: "2026-11-04", movable: false }] }];
  view.rerender(<TimelineBlock block={{ ...block, tracks }} pointer="/ui" context={context} />);
  expect(scroll.scrollLeft).toBeCloseTo(100 + parseFloat(axis.style.width) - beforeWidth);
  const left = scroll.scrollLeft;
  view.rerender(<TimelineBlock block={{ ...block, tracks: [{ ...tracks[0], items: [...tracks[0].items, { id: "later", label: "이후", start: "2026-12-10", end: "2026-12-12", movable: false }] }] }} pointer="/ui" context={context} />);
  expect(scroll.scrollLeft).toBe(left);
});

it("전체 맞춤은 스크롤을 처음으로 옮긴다", () => {
  const view = render(<TimelineBlock block={{ ...block, controls: true }} pointer="/ui" context={context} />);
  const scroll = view.container.querySelector<HTMLElement>(".ks-dates-scroll")!;
  scroll.scrollLeft = 100; fireEvent.scroll(scroll);
  fireEvent.click(screen.getByRole("button", { name: "전체 맞춤" }));
  expect(scroll.scrollLeft).toBe(0);
});

it("ko-KR 일 눈금은 접미사 없는 날짜 숫자만 보인다", () => {
  const view = render(<TimelineBlock block={block} pointer="/ui" context={context} />);
  const ticks = [...view.container.querySelectorAll(".ks-dates-ticks > span")];
  expect(ticks.length).toBeGreaterThan(0);
  expect(ticks.every((tick) => /^\d+$/.test(tick.textContent!))).toBe(true);
});

it("짧게 걸친 해 이름은 숨기고 가운데 해는 온전히 보인다", () => {
  render(<TimelineBlock block={{ ...block, controls: true, tracks: [{ id: "year", items: [{ id: "year-item", start: "2026-01-05", end: "2026-12-18" }] }] }} pointer="/ui" context={context} />);
  fireEvent.click(screen.getByRole("button", { name: "전체 맞춤" }));
  expect(getComputedStyle(screen.getByText("2025년", { exact: true })).visibility).toBe("hidden");
  expect(getComputedStyle(screen.getByText("2027년", { exact: true })).visibility).toBe("hidden");
  expect(getComputedStyle(screen.getByText("2026년", { exact: true })).visibility).toBe("visible");
});

it.each([["each", "긴 이름 전체", true], ["each", "짧음", false], ["pack", "긴 이름 전체", false]] as const)("%s 줄의 %s 이름은 필요할 때만 전체를 밖에 둔다", (lanes, label, outside) => {
  const view = render(<TimelineBlock block={{ ...block, lanes, tracks: [{ id: "track", items: [{ ...block.tracks[0].items[0], label }] }] }} pointer="/ui" context={context} />);
  const name = view.container.querySelector(".ks-timeline-label")!;
  expect(name.textContent).toBe(label);
  expect(name.classList.contains("is-outside")).toBe(outside);
});
