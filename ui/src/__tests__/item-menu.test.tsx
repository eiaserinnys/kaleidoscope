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

beforeEach(mockVirtualLayout);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(ui: Block) {
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 19, modules: {} }, permissions: [], state: { choice: null }, ui };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const calls = vi.spyOn(transport, "call");
  render(<><ContextMenuHost /><AppWindowContent store={createShellStore(transport)} windowId="viewer-window" /></>);
  return calls;
}

const menu = [{ label: "고르기", on_select: { set_state: "choice" } }];
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
