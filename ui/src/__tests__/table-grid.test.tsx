import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { TableGrid } from "../blocks/data-table-grid";
import { mockVirtualLayout } from "./virtual-layout";
import { makeTestSeed, mdViewerDefinition } from "./fixtures";

beforeEach(mockVirtualLayout);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(ui: Block, state: AppDefinition["state"]) {
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 24, modules: {} }, permissions: [], state, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...state };
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  return { calls, transport };
}

it("초점 행이 지워지면 같은 자리의 이웃 칸에 선택 호출 없이 초점을 돌린다", async () => {
  const rows = [{ key: "a", label: "기획", mon: "회의" }, { key: "b", label: "제작", mon: "검토" }, { key: "c", label: "배포", mon: "공개" }];
  const choose = vi.fn();
  const props = { rows, columns: [{ field: "label", label: "항목" }, { field: "mon", label: "월요일" }], selected: null, rowHeader: "label", onChoose: choose, onChooseCell: choose };
  const { rerender } = render(<TableGrid {...props} />);
  const first = await screen.findByRole("gridcell", { name: "기획, 월요일, 회의" });
  first.focus(); fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement?.getAttribute("aria-label")).toBe("제작, 월요일, 검토");
  rerender(<TableGrid {...props} rows={[rows[0], rows[2]]} />);
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("배포, 월요일, 공개"));
  expect(choose).not.toHaveBeenCalled();
});

it("방향키가 초점과 선택을 함께 옮기고 그 칸으로 on_select를 한 번 부른다", async () => {
  const row = { key: "a", label: "제작", mon: { title: "첫 검토", subtitle: "본문", badges: ["확인"] }, tue: null };
  const ui = { type: "table", rows: [row], columns: [
    { field: "label", label: "항목" }, { field: "mon", label: "월요일", format: "content" },
    { field: "tue", label: "화요일", format: "content" },
  ], selection: "cell", row_header: "label", selected: { state: "chosen" }, on_select: { set_state: "chosen" } } as unknown as Block;
  const { calls } = setup(ui, { chosen: null });
  const acts = () => calls.mock.calls.filter(([request]) => request.op === "data.act").map(([request]) => request);
  const first = await screen.findByRole("gridcell", { name: /제작.*월요일.*첫 검토/ });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowRight" });
  fireEvent.keyUp(document.activeElement!, { key: "ArrowRight" });
  const moved = document.activeElement!;
  expect(moved.getAttribute("aria-label")).toMatch(/제작.*화요일.*빈 칸/);
  expect(moved.getAttribute("aria-selected")).toBe("true");
  await waitFor(() => expect(acts()).toHaveLength(1));
  expect(acts()[0]).toMatchObject({ op: "data.act", event: { row: "a", column: "tue" }, item: row });
  fireEvent.keyDown(moved, { key: "Enter" });
  await waitFor(() => expect(acts()).toHaveLength(2));
  expect(acts()[1]).toMatchObject({ op: "data.act", event: { row: "a", column: "tue" }, item: row });
});

it("앱이 고른 칸에서 초점을 시작한다", async () => {
  const rows = [{ key: "a", label: "기획", mon: "회의", tue: "초안" }, { key: "b", label: "제작", mon: "검토", tue: "완료" }];
  const ui = { type: "table", rows, columns: [{ field: "label", label: "항목" }, { field: "mon", label: "월요일" }, { field: "tue", label: "화요일" }], selection: "cell", row_header: "label", selected: { state: "chosen" }, on_select: { set_state: "chosen" } } as unknown as Block;
  setup(ui, { chosen: { row: "b", column: "tue" } });
  const chosen = await screen.findByRole("gridcell", { selected: true });
  expect(chosen.getAttribute("aria-label")).toBe("제작, 화요일, 완료");
  expect(chosen.getAttribute("tabindex")).toBe("0");
});

it("방향키를 반복해도 고른 칸은 바로 바뀌고 보내기는 합쳐 마지막 칸을 보낸다", async () => {
  const columns = [{ field: "label", label: "항목" }, ...Array.from({ length: 11 }, (_, index) => ({ field: `c${index + 1}`, label: `${index + 1}열` }))];
  const row = { key: "a", label: "기획", ...Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`c${index + 1}`, `값 ${index + 1}`])) };
  const ui = { type: "table", rows: [row], columns, selection: "cell", row_header: "label", selected: { state: "chosen" }, on_select: { set_state: "chosen" } } as unknown as Block;
  const { calls } = setup(ui, { chosen: null });
  const acts = () => calls.mock.calls.filter(([request]) => request.op === "data.act").map(([request]) => request);
  const first = await screen.findByRole("gridcell", { name: "기획, 1열, 값 1" });
  first.focus();
  for (let step = 1; step <= 10; step += 1) {
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(`기획, ${step + 1}열, 값 ${step + 1}`);
    expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
  }
  fireEvent.keyUp(document.activeElement!, { key: "ArrowRight" });
  await waitFor(() => expect(acts().at(-1)).toMatchObject({ op: "data.act", event: { row: "a", column: "c11" } }));
  expect(acts().length).toBeLessThanOrEqual(3);
});

it("Home과 End는 열의 처음과 끝, Ctrl과 함께면 행의 처음과 끝으로 간다", async () => {
  const rows = [{ key: "a", label: "기획", mon: "회의", tue: "초안" }, { key: "b", label: "제작", mon: "검토", tue: "완료" }];
  const ui = { type: "table", rows, columns: [{ field: "label", label: "항목" }, { field: "mon", label: "월요일" }, { field: "tue", label: "화요일" }], selection: "cell", row_header: "label", selected: { state: "chosen" }, on_select: { set_state: "chosen" } } as unknown as Block;
  const { calls } = setup(ui, { chosen: null });
  const acts = () => calls.mock.calls.filter(([request]) => request.op === "data.act").map(([request]) => request);
  const first = await screen.findByRole("gridcell", { name: "기획, 월요일, 회의" });
  first.focus();
  const press = (key: string, ctrlKey = false) => {
    fireEvent.keyDown(document.activeElement!, { key, ctrlKey });
    fireEvent.keyUp(document.activeElement!, { key, ctrlKey });
    expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
    return document.activeElement?.getAttribute("aria-label");
  };
  expect(press("End")).toBe("기획, 화요일, 초안");
  expect(press("End", true)).toBe("제작, 화요일, 완료");
  expect(press("Home")).toBe("제작, 월요일, 검토");
  expect(press("Home", true)).toBe("기획, 월요일, 회의");
  await waitFor(() => expect(acts().at(-1)).toMatchObject({ op: "data.act", event: { row: "a", column: "mon" } }));
  const sent = acts().length;
  expect(sent).toBeLessThanOrEqual(4);
  press("Home", true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(acts()).toHaveLength(sent);
});

it("행 고르기 표는 방향키로 on_select를 부르지 않는다", async () => {
  const rows = [{ key: "a", label: "기획", mon: "회의" }, { key: "b", label: "제작", mon: "검토" }];
  const ui = { type: "table", rows, columns: [{ field: "label", label: "항목" }, { field: "mon", label: "월요일" }], selected: { state: "chosen" }, on_select: { set_state: "chosen" } } as unknown as Block;
  const { calls } = setup(ui, { chosen: null });
  const first = (await screen.findByText("기획")).closest<HTMLElement>('[role="row"]')!;
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.activeElement?.getAttribute("data-row-key")).toBe("b");
  expect(calls.mock.calls.some(([request]) => request.op === "data.act")).toBe(false);
});

it("표 폭이 줄어 고른 칸이 화면 밖으로 나가면 스크롤로 그 칸을 보이게 하고, 사용자가 스크롤해 보낸 칸은 그대로 둔다", async () => {
  const callbacks: ResizeObserverCallback[] = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { callbacks.push(callback); }
    observe() {} unobserve() {} disconnect() {}
  });
  const size = { width: 500 };
  const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) { return this.classList.contains("ks-table-scroll") ? size.width : widthDescriptor?.get?.call(this) ?? 0; },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) { return this.classList.contains("ks-table-scroll") ? 200 : heightDescriptor?.get?.call(this) ?? 0; },
  });
  try {
    const rows = [{ key: "a", label: "기획", mon: "회의", tue: "초안" }, { key: "b", label: "제작", mon: "검토", tue: "완료" }];
    const props = { rows, columns: [{ field: "label", label: "항목" }, { field: "mon", label: "월요일" }, { field: "tue", label: "화요일" }], selected: null, rowHeader: "label", onChoose: () => {}, onChooseCell: () => {} };
    const { container } = render(<TableGrid {...props} />);
    const grid = container.querySelector<HTMLElement>('[role="grid"]')!;
    const cell = container.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')!;
    Object.defineProperty(grid, "getBoundingClientRect", { configurable: true, value: () => ({ x: 0, y: 0, left: 0, top: 0, right: size.width, bottom: 200, width: size.width, height: 200, toJSON() {} }) });
    let cellRect = { left: 300, right: 480 };
    Object.defineProperty(cell, "getBoundingClientRect", { configurable: true, value: () => ({ x: cellRect.left, y: 0, left: cellRect.left, top: 0, right: cellRect.right, bottom: 32, width: cellRect.right - cellRect.left, height: 32, toJSON() {} }) });
    const resize = () => act(() => callbacks.forEach((callback) => callback([], {} as ResizeObserver)));
    // 폭이 500에서 400으로 줄어, 보이던 고른 칸(오른쪽 끝 480)이 보이는 영역 밖으로 나간다.
    size.width = 400;
    resize();
    expect(grid.scrollLeft).toBe(80);
    // 고른 칸이 이미 보이면 스크롤하지 않는다.
    grid.scrollLeft = 0;
    cellRect = { left: 100, right: 200 };
    fireEvent.scroll(grid);
    size.width = 300;
    resize();
    expect(grid.scrollLeft).toBe(0);
    // 사용자가 직접 스크롤해 고른 칸을 밖으로 보낸 뒤에는 폭이 줄어도 끌어오지 않는다.
    grid.scrollLeft = 80;
    cellRect = { left: 600, right: 800 };
    fireEvent.scroll(grid);
    size.width = 200;
    resize();
    expect(grid.scrollLeft).toBe(80);
  } finally {
    if (widthDescriptor) Object.defineProperty(HTMLElement.prototype, "clientWidth", widthDescriptor);
    if (heightDescriptor) Object.defineProperty(HTMLElement.prototype, "clientHeight", heightDescriptor);
    vi.unstubAllGlobals();
  }
});

it("행 머리가 없어도 첫 열의 아래쪽 칸을 고른 뒤 높이가 줄면 그 칸이 보이게 스크롤한다", async () => {
  const callbacks: ResizeObserverCallback[] = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { callbacks.push(callback); }
    observe() {} unobserve() {} disconnect() {}
  });
  const original = window.getComputedStyle.bind(window);
  // 첫 열 칸은 테두리 폭만큼 왼쪽으로 삐져나와 붙어 있다. 행 머리가 없으니 그 왼쪽에 칸 간격은 없다.
  vi.stubGlobal("getComputedStyle", (element: Element) => element instanceof HTMLElement && element.getAttribute("role") === "gridcell"
    ? { getPropertyValue: (name: string) => name === "--ks-focus-width" ? "2" : "" }
    : original(element));
  const size = { width: 500, height: 500 };
  const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) { return this.classList.contains("ks-table-scroll") ? size.width : widthDescriptor?.get?.call(this) ?? 0; },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) { return this.classList.contains("ks-table-scroll") ? size.height : heightDescriptor?.get?.call(this) ?? 0; },
  });
  try {
    const rows = [{ key: "a", mon: "회의" }, { key: "b", mon: "검토" }, { key: "c", mon: "공개" }];
    const props = { rows, columns: [{ field: "mon", label: "월요일" }], selected: null, selectedCell: { row: "c", column: "mon" }, onChoose: () => {}, onChooseCell: () => {} };
    const { container } = render(<TableGrid {...props} />);
    const grid = container.querySelector<HTMLElement>('[role="grid"]')!;
    const cell = container.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')!;
    expect(cell.getAttribute("aria-selected")).toBe("true");
    Object.defineProperty(grid, "getBoundingClientRect", { configurable: true, value: () => ({ x: 0, y: 0, left: 0, top: 0, right: size.width, bottom: size.height, width: size.width, height: size.height, toJSON() {} }) });
    Object.defineProperty(cell, "getBoundingClientRect", { configurable: true, value: () => ({ x: 1, y: 400, left: 1, top: 400, right: 121, bottom: 432, width: 120, height: 32, toJSON() {} }) });
    // 높이가 줄기 전에는 고른 칸이 보인다. 첫 열이라 왼쪽에 칸 간격이 없어도 보이는 칸이다.
    fireEvent.scroll(grid);
    // 높이가 500에서 300으로 줄어 칸(아래 끝 432)이 보이는 영역 밖으로 나간다.
    size.height = 300;
    act(() => callbacks.forEach((callback) => callback([], {} as ResizeObserver)));
    expect(grid.scrollTop).toBe(134);
  } finally {
    if (widthDescriptor) Object.defineProperty(HTMLElement.prototype, "clientWidth", widthDescriptor);
    if (heightDescriptor) Object.defineProperty(HTMLElement.prototype, "clientHeight", heightDescriptor);
    vi.unstubAllGlobals();
  }
});

it("상태에 연결된 동적 열과 선택 주소를 그리고 빈 칸 클릭을 전달한다", async () => {
  const row = { key: "a", label: "기획", mon: null };
  const ui = { type: "table", rows: [row], columns: { state: "columns" }, selection: "cell", row_header: "label", selected: { state: "chosen" }, on_select: { set_state: "chosen" } } as unknown as Block;
  const { calls } = setup(ui, { columns: [{ field: "label", label: "항목" }, { field: "mon", label: "월요일", format: "content" }], chosen: { row: "a", column: "mon" } });
  const cell = await screen.findByRole("gridcell", { name: /기획.*월요일.*빈 칸/ });
  expect(cell.getAttribute("aria-selected")).toBe("true");
  fireEvent.click(cell);
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", event: { row: "a", column: "mon" }, item: row })));
});

it("잘못된 동적 열은 오류 코드로 표시하고 null 열은 빈 상태로 표시한다", async () => {
  const ui = { type: "table", rows: [], columns: { state: "columns" } } as unknown as Block;
  setup(ui, { columns: [{ field: "a", label: "하나" }, { field: "a", label: "둘" }] });
  expect(await screen.findByText("SHELL_TABLE_COLUMNS_FIELD_DUPLICATE")).toBeTruthy();
  cleanup();
  setup(ui, { columns: null });
  expect(await screen.findByText("없음")).toBeTruthy();
});

it("동적 열의 너비와 형식은 문자열이어야 한다", async () => {
  const ui = { type: "table", rows: [], columns: { state: "columns" } } as unknown as Block;
  const invalid: JsonValue[] = [
    { field: "a", label: "하나", width: ["wide"] },
    { field: "a", label: "하나", format: ["content"] },
  ];
  for (const column of invalid) {
    setup(ui, { columns: [column] });
    expect(await screen.findByText("SHELL_TABLE_COLUMNS_VALUE_INVALID")).toBeTruthy();
    cleanup();
  }
});

it("칸의 색, 제목, 본문과 단일 배지를 표시하고 잘못된 칸만 오류로 둔다", async () => {
  const ui = { type: "table", rows: [{ key: "a", label: "기획", good: { title: "첫 회의", subtitle: "의제를 확인한다", color: "#abc", badges: "확인" }, bad: ["잘못된 값"] }], columns: [{ field: "label", label: "항목" }, { field: "good", label: "월요일", format: "content", max_lines: 2 }, { field: "bad", label: "화요일", format: "content" }], selection: "cell", row_header: "label", selected: { state: "chosen" }, on_select: { set_state: "chosen" } } as unknown as Block;
  setup(ui, { chosen: null });
  expect(await screen.findByText("첫 회의")).toBeTruthy();
  expect(screen.getByText("의제를 확인한다")).toBeTruthy();
  expect(screen.getByText("확인")).toBeTruthy();
  expect(screen.getByText("SHELL_TABLE_CELL_CONTENT_INVALID")).toBeTruthy();
  const errorCell = screen.getByRole("gridcell", { name: "기획, 화요일, 오류: 표의 bad 칸 내용을 읽지 못했습니다. 앱의 칸 출력을 고치세요., SHELL_TABLE_CELL_CONTENT_INVALID" });
  expect(errorCell.querySelector("[title]")?.getAttribute("title")).toBe("표의 bad 칸 내용을 읽지 못했습니다. 앱의 칸 출력을 고치세요. SHELL_TABLE_CELL_CONTENT_INVALID");
});
