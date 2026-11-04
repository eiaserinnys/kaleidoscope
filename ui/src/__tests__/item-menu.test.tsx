import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { ContextMenuHost } from "../components/context-menu";
import { TableView, type Row } from "../blocks/data-table";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { mockVirtualLayout } from "./virtual-layout";
import { makeTestSeed, mdViewerDefinition } from "./fixtures";
import profiler from "../../../apps/profiler.json";

beforeEach(mockVirtualLayout);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(ui: Block, state: AppDefinition["state"] = {}) {
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 20, modules: {} }, permissions: [], state: { choice: null, ...state }, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = definition.state ?? {};
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  render(<><ContextMenuHost /><AppWindowContent store={createShellStore(transport)} windowId="viewer-window" /></>);
  return calls;
}

const menu = [{ label: "고르기", on_select: { set_state: "choice" } }];
it.each([true, false])("첫 앱 메뉴 위험 여부 %s에 따라 복사와 첫 초점의 순서를 정한다", async (danger) => {
  setup({ type: "list", items: [{ key: "a", title: "목록" }], item_menu: [{ label: "동작", danger, on_select: { set_state: "choice" } }] });
  const row = await screen.findByRole("option", { name: "목록" });
  row.focus();
  fireEvent.keyDown(row, { key: "F10", shiftKey: true });
  const items = await screen.findAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toEqual(danger ? ["제목 복사", "동작"] : ["동작", "제목 복사"]);
  expect(document.activeElement).toBe(items[0]);
});
for (const confirm of [false, true]) {
  for (const last of [false, true]) {
    it(`table 삭제 초점: 확인 ${confirm ? "있음" : "없음"}, ${last ? "마지막 하나" : "가운데"} 삭제 뒤 강조 단추를 거치지 않는다`, async () => {
      setup({ type: "stack", direction: "column", children: [
        { type: "table", rows: { state: "rows" }, columns: [{ field: "title", label: "이름" }], item_menu: [{
          label: "지우기", ...(confirm ? { confirm: { title: "지울까요?" } } : {}),
          on_select: [{ set_state: "rows", value: { expr: "[$state.rows[key != $event]]" } }],
        }] },
        { type: "button", label: "올리기", variant: "primary", on_click: [{ set_state: "choice", value: "올림" }] },
      ] }, { rows: (last ? ["나"] : ["가", "나", "다", "라"]).map((title) => ({ key: title, title })) });
      const target = await screen.findByRole("row", { name: "나" });
      const emphasis = screen.getByRole("button", { name: "올리기" });
      target.focus();
      fireEvent.keyDown(target, { key: "F10", shiftKey: true });
      const focused: EventTarget[] = [];
      const record = (event: FocusEvent) => { if (event.target) focused.push(event.target); };
      document.addEventListener("focusin", record);
      try {
        fireEvent.click(await screen.findByRole("menuitem", { name: "지우기" }));
        if (confirm) fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "지우기" }));
        await waitFor(() => expect(screen.queryByRole("row", { name: "나" })).toBeNull());
        const next = last ? screen.getByRole("button", { name: "이름" }) : screen.getByRole("row", { name: "다" });
        await waitFor(() => expect(document.activeElement).toBe(next));
        expect(focused).not.toContain(emphasis);
      } finally {
        document.removeEventListener("focusin", record);
      }
    });
  }
}

for (const confirm of [false, true]) {
  for (const removed of ["나", "라"]) {
    it(`행 순번 유지: 확인 ${confirm ? "있음" : "없음"}, ${removed} 삭제 뒤 다에 초점과 tabindex를 둔다`, async () => {
      setup({ type: "list", items: { state: "rows" }, item_menu: [{
        label: "지우기", ...(confirm ? { confirm: { title: "지울까요?" } } : {}),
        on_select: [{ set_state: "rows", value: { expr: "[$state.rows[key != $event]]" } }],
      }] }, { rows: ["가", "나", "다", "라"].map((title) => ({ key: title, title })) });
      const first = await screen.findByRole("option", { name: "가" });
      const target = screen.getByRole("option", { name: removed });
      target.focus();
      fireEvent.keyDown(target, { key: "F10", shiftKey: true });
      const focused: EventTarget[] = [];
      const record = (event: FocusEvent) => { if (event.target) focused.push(event.target); };
      document.addEventListener("focusin", record);
      try {
        fireEvent.click(await screen.findByRole("menuitem", { name: "지우기" }));
        if (confirm) fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "지우기" }));
        await waitFor(() => expect(screen.queryByRole("option", { name: removed })).toBeNull());
        const next = screen.getByRole("option", { name: "다" });
        await waitFor(() => expect(document.activeElement).toBe(next));
        expect(next.tabIndex).toBe(0);
        expect(first.tabIndex).toBe(-1);
        expect(focused).not.toContain(first);
      } finally {
        document.removeEventListener("focusin", record);
      }
    });
  }
}

for (const mode of ["복구", "사용자 초점", "만료"] as const) {
  it(`늦게 사라지는 행의 관찰: ${mode}`, async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
    setup({ type: "list", items: [{ key: "a", title: "하나" }, { key: "b", title: "둘" }, { key: "c", title: "셋" }], item_menu: [{ label: "지우기", confirm: { title: "지울까요?" }, on_select: { copy_text: "시험" } }] });
    const target = await screen.findByRole("option", { name: "둘" });
    const next = screen.getByRole("option", { name: "셋" });
    fireEvent.contextMenu(target);
    fireEvent.click(await screen.findByRole("menuitem", { name: "지우기" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "지우기" }));
    await waitFor(() => expect(write).toHaveBeenCalled());
    // Promise와 다음 프레임이 지난 뒤에 상태 이벤트가 도착하는 상황이다.
    await new Promise((resolve) => setTimeout(resolve, mode === "만료" ? 3200 : 80));
    const other = screen.getByRole("option", { name: "하나" });
    if (mode === "사용자 초점") other.focus();
    next.dataset.focusIndex = "1";
    target.remove();
    if (mode === "복구") await waitFor(() => expect(document.activeElement).toBe(next));
    else {
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(document.activeElement).not.toBe(next);
      if (mode === "사용자 초점") expect(document.activeElement).toBe(other);
    }
  });
}
it("확정 동작이 행을 지우면 다음 행, 마지막이면 앞 행으로 초점을 돌린다", async () => {
  setup({ type: "list", items: { state: "rows" }, item_menu: [{ label: "지우기", danger: true, confirm: { title: "지울까요?" }, on_select: [{ set_state: "rows", value: { expr: "[$state.rows[key != $event]]" } }] }] },
    { rows: [{ key: "a", title: "하나" }, { key: "b", title: "둘" }, { key: "c", title: "셋" }] });
  for (const [target, next] of [["둘", "셋"], ["셋", "하나"]]) {
    fireEvent.contextMenu(await screen.findByRole("option", { name: target }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "지우기" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "지우기" }));
    await waitFor(() => expect(screen.queryByRole("option", { name: target })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("option", { name: next })));
  }
});
const cases: Array<{ block: Block; role: string; name: string; copy: string; expected: string }> = [
  { block: { type: "list", items: [{ key: "a", title: "목록" }], item_menu: menu }, role: "option", name: "목록", copy: "제목 복사", expected: "목록" },
  { block: { type: "table", rows: [{ key: "a", title: "표", count: 1234 }], columns: [{ field: "title", label: "이름" }, { field: "count", label: "수", format: "number" }], item_menu: menu }, role: "row", name: "표 1,234", copy: "행 복사", expected: "표\t1,234" },
  { block: { type: "tree", items: [{ key: "a", title: "트리" }], item_menu: menu }, role: "treeitem", name: "트리", copy: "제목 복사", expected: "트리" },
  { block: { type: "feed", entries: [{ key: "a", body: ["피드", "둘째"] }], item_menu: menu }, role: "article", name: "", copy: "본문 복사", expected: "피드\n\n둘째" },
];

for (const { block, role, name, copy, expected } of cases) {
  it(`${block.type} 행 메뉴는 선택하지 않고 해당 항목 동작과 복사를 제공한다`, async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
    const calls = setup(block);
    const row = await screen.findByRole(role, name ? { name } : undefined);
    fireEvent.contextMenu(row);
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["고르기", copy]);
    expect(calls.mock.calls.filter(([request]) => request.op === "data.act")).toHaveLength(0);
    fireEvent.click(screen.getByRole("menuitem", { name: "고르기" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/item_menu/0/on_select", event: "a", item: expect.objectContaining({ key: "a" }) })));
    row.focus();
    fireEvent.keyDown(row, { key: "F10", shiftKey: true });
    fireEvent.click(await screen.findByRole("menuitem", { name: copy }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(expected));
    row.focus();
    fireEvent.keyDown(row, { key: "ContextMenu" });
    expect(await screen.findByRole("menuitem", { name: copy })).toBeTruthy();
  });
}

it("확인 메뉴는 승인할 때만 실행한다", async () => {
  const calls = setup({ type: "list", items: [{ key: "a", title: "목록" }], item_menu: [{ label: "보관", danger: true, confirm: { title: "보관할까요?", ok: "보관", body: { item: "title" } }, on_select: { set_state: "choice" } }] });
  const row = await screen.findByRole("option", { name: "목록" });
  fireEvent.contextMenu(row);
  fireEvent.click(await screen.findByRole("menuitem", { name: "보관" }));
  const dialog = await screen.findByRole("dialog", { name: "보관할까요?" });
  expect(within(dialog).getByText("목록")).toBeTruthy();
  expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "취소" }));
  expect(calls.mock.calls.filter(([request]) => request.op === "data.act")).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole("button", { name: "보관" }));
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", event: "a" })));
  await waitFor(() => expect(document.activeElement).toBe(row));
});

it("확인 메뉴 취소와 Escape는 행으로 초점을 돌린다", async () => {
  setup({ type: "list", items: [{ key: "a", title: "목록" }], item_menu: [{ label: "보관", danger: true, confirm: { title: "보관할까요?" }, on_select: { set_state: "choice" } }] });
  const row = await screen.findByRole("option", { name: "목록" });
  for (const action of ["cancel", "escape"]) {
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: "보관" }));
    if (action === "cancel") fireEvent.click(await screen.findByRole("button", { name: "취소" }));
    else fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(row));
  }
});

it("메뉴 copy_text는 우클릭한 행의 항목 값을 쓴다", async () => {
  const write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
  setup({ type: "list", items: [{ key: "a", title: "하나", url: "one" }, { key: "b", title: "둘", url: "two" }], item_menu: [{ label: "주소 복사", on_select: { copy_text: { item: "url" } } }] });
  fireEvent.contextMenu(await screen.findByRole("option", { name: "둘" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "주소 복사" }));
  await waitFor(() => expect(write).toHaveBeenCalledWith("two"));
});

const profilerTabs = profiler.ui.children[2].tabs!;
const builtinTables = [
  { name: "대상", block: profilerTabs[1].child.children![1].children![1], field: "target", label: "대상 복사" },
  { name: "느린 구간", block: profilerTabs[3].child, field: "target", label: "대상 복사" },
  { name: "느린 식", block: profilerTabs[4].child, field: "expr", label: "식 복사" },
  { name: "최근 구간", block: profilerTabs[5].child, field: "target", label: "대상 복사" },
];

for (const { name, block, field, label } of builtinTables) {
  it(`기본 앱 ${name} 표 메뉴는 우클릭한 행의 값을 복사한다`, async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
    const table = block as unknown as Extract<Block, { type: "table" }>;
    setup({ ...table, rows: [{ key: "first", [field]: "첫 값" }, { key: "second", [field]: "둘째 값" }] });
    const rows = await screen.findAllByRole("row");
    fireEvent.contextMenu(rows[2]);
    fireEvent.click(await screen.findByRole("menuitem", { name: label }));
    await waitFor(() => expect(write).toHaveBeenCalledWith("둘째 값"));
  });
}

it("피드 중첩 답글 메뉴는 답글의 항목을 전달한다", async () => {
  const calls = setup({ type: "feed", entries: [{ key: "parent", body: "원글", children: [{ key: "reply", body: "답글" }] }], item_menu: menu });
  const reply = (await screen.findByText("답글")).closest("article")!;
  fireEvent.contextMenu(reply);
  fireEvent.click(await screen.findByRole("menuitem", { name: "고르기" }));
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", event: "reply", item: expect.objectContaining({ key: "reply", body: "답글" }) })));
});

for (const block of [
  { type: "list", items: [{ key: "a", title: "안쪽" }] },
  { type: "table", rows: [{ key: "a", title: "안쪽" }], columns: [{ field: "title", label: "제목" }] },
  { type: "feed", entries: [{ key: "a", body: "안쪽" }] },
] as Block[]) {
  it(`${block.type} 행은 안쪽이 처리한 우클릭을 가로채지 않는다`, async () => {
    setup(block);
    const inner = await screen.findByText("안쪽");
    inner.addEventListener("contextmenu", (event) => event.preventDefault(), { once: true });
    fireEvent.contextMenu(inner);
    expect(screen.queryByRole("menu")).toBeNull();
  });
}

it("표의 다른 행 메뉴를 열 때 무관한 행은 다시 그리지 않는다", async () => {
  const rows = [{ key: "a", title: "하나" }, { key: "b", title: "둘" }, { key: "c", title: "셋" }];
  const columns = [{ field: "title", label: "제목" }];
  const renderCell = vi.fn((row: Row) => String(row.title));
  render(<TableView rows={rows} columns={columns} selected={null} onChoose={() => {}} onContextMenu={(_row, anchor) => anchor.focus()} renderCell={renderCell} />);
  const second = (await screen.findByText("둘")).closest<HTMLElement>('[role="row"]')!;
  renderCell.mockClear();
  fireEvent.contextMenu(second);
  expect(renderCell.mock.calls.some(([row]) => row.key === "c")).toBe(false);
});

it("칸 우클릭 메뉴는 칸을 고르지 않고 행과 행 키를 전달한다", async () => {
  const row = { key: "a", label: "제작", period: { title: "검토" } };
  const calls = setup({ type: "table", rows: [row], columns: [{ field: "label", label: "항목" }, { field: "period", label: "월요일", format: "content" }], selection: "cell", row_header: "label", selected: { state: "chosen" }, on_select: { set_state: "chosen" }, item_menu: menu }, { chosen: null });
  const cell = await screen.findByRole("gridcell", { name: /제작.*월요일.*검토/ });
  fireEvent.contextMenu(cell);
  expect(calls.mock.calls.some(([request]) => request.op === "data.act" && request.pointer === "/ui/on_select")).toBe(false);
  fireEvent.click(await screen.findByRole("menuitem", { name: "고르기" }));
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/item_menu/0/on_select", event: "a", item: row })));
});

it("칸 행 메뉴 취소와 확인 삭제 뒤 초점을 인접 칸에 둔다", async () => {
  const rows = [{ key: "a", label: "기획", day: "첫째" }, { key: "b", label: "제작", day: "둘째" }];
  setup({ type: "table", rows: { state: "rows" }, columns: [{ field: "label", label: "항목" }, { field: "day", label: "요일" }], selection: "cell", row_header: "label", selected: { state: "chosen" }, on_select: { set_state: "chosen" }, item_menu: [{ label: "지우기", confirm: { title: "지울까요?" }, on_select: [{ set_state: "rows", value: { expr: "[$state.rows[key != $event]]" } }] }] }, { rows, chosen: null });
  const first = await screen.findByRole("gridcell", { name: /기획.*요일.*첫째/ });
  first.focus();
  fireEvent.keyDown(first, { key: "F10", shiftKey: true });
  await screen.findByRole("menuitem", { name: "지우기" });
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(first));
  fireEvent.keyDown(first, { key: "F10", shiftKey: true });
  fireEvent.click(await screen.findByRole("menuitem", { name: "지우기" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "지우기" }));
  const next = await screen.findByRole("gridcell", { name: /제작.*요일.*둘째/ });
  await waitFor(() => expect(screen.queryByRole("gridcell", { name: /기획.*요일.*첫째/ })).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(next));
});
