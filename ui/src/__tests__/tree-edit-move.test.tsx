import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block, CoreReply, CoreRequest } from "../contract/contract";
import { ContextMenuHost } from "../components/context-menu";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed, mdViewerDefinition } from "./fixtures";
import { mockVirtualLayout } from "./virtual-layout";

beforeEach(mockVirtualLayout);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(ui: Block, state: AppDefinition["state"] = {}, blocks = 60) {
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks, modules: {} }, permissions: [], state, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...state };
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  return { calls, transport };
}

const actCalls = (calls: { mock: { calls: unknown[][] } }, pointer: string) =>
  calls.mock.calls.map((call) => call[0] as CoreRequest).filter((request) => request.op === "data.act" && request.pointer === pointer);

const editBlock = (item: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: "tree",
  items: [item],
  on_edit: [{ set_state: "last", value: { expr: "$event" } }],
  on_edit_cancel: [{ set_state: "cancelled" }],
  ...extra,
} as unknown as Block);

it("바로 입력 행은 초점을 받고 Enter로 앞뒤 공백을 뺀 글을 on_edit에 한 번 보내며 확정 뒤 친 글을 그린다", async () => {
  const item = { key: "a", title: "처음", editing: true };
  const { calls } = setup(editBlock(item), { last: null, cancelled: null });
  const input = await screen.findByRole("textbox", { name: "항목 이름" }) as HTMLInputElement;
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("처음");

  fireEvent.change(input, { target: { value: "  새 이름  " } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: "Enter" });

  await waitFor(() => expect(actCalls(calls, "/ui/on_edit")).toEqual([expect.objectContaining({ event: "새 이름", item })]));
  expect(actCalls(calls, "/ui/on_edit")).toHaveLength(1);
  expect(actCalls(calls, "/ui/on_edit_cancel")).toHaveLength(0);
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "항목 이름" })).toBeNull());
  expect(screen.getByRole("treeitem", { name: "새 이름" })).toBeTruthy();
});

it("바로 입력 행은 Escape로 취소를 한 번 보내고 빈 글 Enter도 취소다", async () => {
  const item = { key: "a", title: "처음", editing: true };
  const { calls } = setup(editBlock(item), { last: null, cancelled: null });
  const input = await screen.findByRole("textbox", { name: "항목 이름" });
  fireEvent.change(input, { target: { value: "버릴 글" } });
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => expect(actCalls(calls, "/ui/on_edit_cancel")).toEqual([expect.objectContaining({ event: null, item })]));
  expect(actCalls(calls, "/ui/on_edit")).toHaveLength(0);

  cleanup();
  const empty = { key: "b", title: "둘", editing: true };
  const second = setup(editBlock(empty), { last: null, cancelled: null });
  const emptyInput = await screen.findByRole("textbox", { name: "항목 이름" });
  fireEvent.change(emptyInput, { target: { value: "   " } });
  fireEvent.keyDown(emptyInput, { key: "Enter" });
  await waitFor(() => expect(actCalls(second.calls, "/ui/on_edit_cancel")).toEqual([expect.objectContaining({ event: null, item: empty })]));
  expect(actCalls(second.calls, "/ui/on_edit")).toHaveLength(0);
});

it("바로 입력 행은 초점을 잃으면 글이 있을 때 확정하고 비었을 때 취소한다", async () => {
  const item = { key: "a", title: "처음", editing: true };
  const { calls } = setup(editBlock(item), { last: null, cancelled: null });
  const input = await screen.findByRole("textbox", { name: "항목 이름" });
  fireEvent.change(input, { target: { value: "새 이름" } });
  fireEvent.blur(input);
  await waitFor(() => expect(actCalls(calls, "/ui/on_edit")).toEqual([expect.objectContaining({ event: "새 이름", item })]));

  cleanup();
  const empty = { key: "b", title: "둘", editing: true };
  const second = setup(editBlock(empty), { last: null, cancelled: null });
  const emptyInput = await screen.findByRole("textbox", { name: "항목 이름" });
  fireEvent.change(emptyInput, { target: { value: "" } });
  fireEvent.blur(emptyInput);
  await waitFor(() => expect(actCalls(second.calls, "/ui/on_edit_cancel")).toEqual([expect.objectContaining({ event: null, item: empty })]));
  expect(actCalls(second.calls, "/ui/on_edit")).toHaveLength(0);
});

it("on_edit이 없으면 editing은 무시하고 보통 행으로 그린다", async () => {
  setup({ type: "tree", items: [{ key: "a", title: "처음", editing: true }] } as unknown as Block);
  expect(await screen.findByRole("treeitem", { name: "처음" })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "항목 이름" })).toBeNull();
});

it("바로 입력 행은 확인 상자가 있으면 누를 수 없는 상자를 표식 열에 두고 두 열을 유지한다", async () => {
  const item = { key: "a", title: "처음", checked: false, editing: true };
  const { calls } = setup(editBlock(item, { on_check: [{ set_state: "checked" }] }), { last: null, cancelled: null, checked: null });
  const input = await screen.findByRole("textbox", { name: "항목 이름" });
  const row = input.closest(".ks-file-tree-create-row")!;
  const columns = Array.from(row.querySelectorAll(":scope > .ks-file-tree-icon"));
  expect(columns).toHaveLength(2);
  const box = row.querySelector("[data-tree-check]");
  expect(box).toBeTruthy();
  fireEvent.click(box!);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(actCalls(calls, "/ui/on_check")).toHaveLength(0);
});

function transfer() {
  const values = new Map<string, string>();
  return {
    values,
    setData: (type: string, data: string) => values.set(type, data),
    getData: (type: string) => values.get(type) ?? "",
    effectAllowed: "",
    dropEffect: "",
  };
}

function drag(type: string, target: Element, dataTransfer: object, clientY = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  fireEvent(target, event);
}

function rowRect(row: Element) {
  Object.defineProperty(row, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top: 0, bottom: 40, height: 40, left: 0, right: 800, width: 800, x: 0, y: 0,
      toJSON: () => ({}),
    }) as DOMRect,
  });
}

const moveItems = [{ key: "a", title: "가" }, { key: "b", title: "나" }];
const moveBlock = { type: "tree", items: moveItems, on_move: [{ set_state: "moved", value: { expr: "$event" } }] } as unknown as Block;

it("끌어 놓기는 before, after, inside, end 위치를 표시하고 on_move를 위치마다 한 번 보낸다", async () => {
  const { calls } = setup(moveBlock, { moved: null });
  const a = await screen.findByRole("treeitem", { name: "가" });
  const b = screen.getByRole("treeitem", { name: "나" });
  const tree = screen.getByRole("tree");
  expect(a.getAttribute("draggable")).toBe("true");

  const before = transfer();
  drag("dragstart", a, before);
  expect(before.values.get("application/x-kaleidoscope-tree-item")).toBe(JSON.stringify({ window: "viewer-window", key: "a" }));
  rowRect(b);
  drag("dragover", b, before, 5);
  expect(b.getAttribute("data-drop-position")).toBe("before");
  expect(b.hasAttribute("data-drop-state")).toBe(false);
  drag("drop", b, before, 5);
  await waitFor(() => expect(actCalls(calls, "/ui/on_move")).toEqual([
    expect.objectContaining({ event: { key: "a", target: "b", position: "before" }, item: moveItems[1] }),
  ]));

  const after = transfer();
  drag("dragstart", a, after);
  drag("dragover", b, after, 35);
  expect(b.getAttribute("data-drop-position")).toBe("after");
  drag("drop", b, after, 35);
  await waitFor(() => expect(actCalls(calls, "/ui/on_move")).toHaveLength(2));
  expect(actCalls(calls, "/ui/on_move")[1]).toEqual(expect.objectContaining({ event: { key: "a", target: "b", position: "after" }, item: moveItems[1] }));

  const inside = transfer();
  drag("dragstart", a, inside);
  drag("dragover", b, inside, 20);
  expect(b.getAttribute("data-drop-position")).toBeNull();
  expect(b.getAttribute("data-drop-state")).toBe("valid");
  drag("drop", b, inside, 20);
  await waitFor(() => expect(actCalls(calls, "/ui/on_move")).toHaveLength(3));
  expect(actCalls(calls, "/ui/on_move")[2]).toEqual(expect.objectContaining({ event: { key: "a", target: "b", position: "inside" }, item: moveItems[1] }));

  const end = transfer();
  drag("dragstart", a, end);
  drag("dragover", tree, end);
  expect(tree.getAttribute("data-drop-state")).toBe("valid");
  drag("drop", tree, end);
  await waitFor(() => expect(actCalls(calls, "/ui/on_move")).toHaveLength(4));
  expect(actCalls(calls, "/ui/on_move")[3]).toEqual(expect.objectContaining({ event: { key: "a", target: null, position: "end" }, item: null }));
});

it("자기 자신과 자손 위에는 놓을 수 없고 놓아도 on_move를 부르지 않는다", async () => {
  const items = [{ key: "p", title: "부모", children: [{ key: "c", title: "아이" }] }];
  const { calls } = setup({ type: "tree", default_expanded: true, items, on_move: [{ set_state: "moved" }] } as unknown as Block, { moved: null });
  const parent = await screen.findByRole("treeitem", { name: "부모" });
  const child = screen.getByRole("treeitem", { name: "아이" });
  rowRect(parent);
  rowRect(child);

  const self = transfer();
  drag("dragstart", parent, self);
  drag("dragover", parent, self, 20);
  expect(parent.getAttribute("data-drop-state")).toBe("invalid");
  expect(parent.hasAttribute("data-drop-position")).toBe(false);
  drag("drop", parent, self, 20);

  const descendant = transfer();
  drag("dragstart", parent, descendant);
  drag("dragover", child, descendant, 20);
  expect(child.getAttribute("data-drop-state")).toBe("invalid");
  drag("drop", child, descendant, 20);

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(actCalls(calls, "/ui/on_move")).toHaveLength(0);
});

const sections = [
  { id: "s1", title: "첫째 구역", rows: [{ key: "a", title: "첫째 항목" }] },
  { id: "s2", title: "둘째 구역", rows: [{ key: "b", title: "둘째 항목" }] },
];

it("같은 창의 다른 데이터 트리에 놓으면 그 트리의 parent_item과 함께 on_move를 부른다", async () => {
  const definition: AppDefinition = {
    ...mdViewerDefinition, id: "tree-move-repeat", requires: { blocks: 60, modules: { client: 1, assets: 1 } },
    permissions: [], state: {}, assets: [{ id: "script", version: 1 }],
    client: { runtime: "javascript", entry: { id: "script", version: 1 }, inputs: {}, outputs: {}, actions: ["move"], commands: {}, state_keys: [], storage_entries: [] },
    ui: { type: "repeat", items: { state: "sections" }, key: "id", template: { type: "tree", items: { item: "rows" }, on_move: { client: "move" } } } as unknown as Block,
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { sections };
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  const call = store.call.bind(store);
  vi.spyOn(store, "call").mockImplementation(async (request) => request.op === "data.media"
    ? { op: "data.media", media: { mime: "text/javascript", data_base64: btoa(""), width: null, height: null } } as CoreReply
    : call(request));
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  await waitFor(() => expect(document.querySelector(".ks-client-frames iframe")).toBeTruthy());
  const post = vi.spyOn((document.querySelector(".ks-client-frames iframe") as HTMLIFrameElement).contentWindow!, "postMessage");

  const source = await screen.findByRole("treeitem", { name: "첫째 항목" });
  const target = screen.getByRole("treeitem", { name: "둘째 항목" });
  rowRect(target);
  const inside = transfer();
  drag("dragstart", source, inside);
  drag("dragover", target, inside, 20);
  drag("drop", target, inside, 20);
  await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({
    type: "ks-client-action", name: "move",
    context: expect.objectContaining({
      event: { key: "a", target: "b", position: "inside" },
      item: sections[1].rows[0], key: "b", parent_item: sections[1],
    }),
  }), "*"));

  const trees = screen.getAllByRole("tree");
  const end = transfer();
  drag("dragstart", source, end);
  drag("dragover", trees[1], end);
  drag("drop", trees[1], end);
  await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({
    type: "ks-client-action", name: "move",
    context: expect.objectContaining({ event: { key: "a", target: null, position: "end" }, item: null, parent_item: sections[1] }),
  }), "*"));
  store.dispose();
});

it("제목이 없는 바로 입력 항목도 빈 글칸 행으로 그린다", async () => {
  setup(editBlock({ key: "new", editing: true }), { last: null, cancelled: null });
  expect(await screen.findByRole("textbox", { name: "항목 이름" })).toBeTruthy();
});

it("같은 창의 다른 트리 위에서 Escape로 끄면 그 트리의 놓을 자리 표시도 지운다", async () => {
  setup({ type: "repeat", items: { state: "sections" }, key: "id", template: {
    type: "tree", items: { item: "rows" }, on_move: [{ set_state: "moved", value: { expr: "$event" } }],
  } } as unknown as Block, { sections, moved: null });
  const source = await screen.findByRole("treeitem", { name: "첫째 항목" });
  const target = screen.getByRole("treeitem", { name: "둘째 항목" });
  rowRect(target);
  const transferValue = transfer();
  drag("dragstart", source, transferValue);
  drag("dragover", target, transferValue, 20);
  expect(target.getAttribute("data-drop-state")).toBe("valid");
  fireEvent.keyDown(document, { key: "Escape" });
  drag("dragend", source, transferValue);
  expect(target.getAttribute("data-drop-state")).toBeNull();
});

it("포인터가 트리 밖으로 나가면 놓을 자리 표시를 지운다", async () => {
  setup(moveBlock, { moved: null });
  const source = await screen.findByRole("treeitem", { name: "가" });
  const target = screen.getByRole("treeitem", { name: "나" });
  rowRect(target);
  const transferValue = transfer();
  drag("dragstart", source, transferValue);
  drag("dragover", target, transferValue, 20);
  expect(target.getAttribute("data-drop-state")).toBe("valid");
  fireEvent.dragLeave(screen.getByRole("tree"), { relatedTarget: document.body });
  expect(target.getAttribute("data-drop-state")).toBeNull();
});

it("긴 목록 끝 바로 입력은 Enter 확정 뒤 그 행이 초점을 받고 첫 행으로 돌아가지 않는다", async () => {
  const items = [
    { key: "a", title: "첫째", editing: false },
    { key: "b", title: "둘째", editing: false },
    { key: "c", title: "새 항목", editing: true },
  ];
  setup({ type: "tree", items: { state: "items" }, on_edit: [{ set_state: "last", value: { expr: "$event" } }] } as unknown as Block, { items, last: null });
  const input = await screen.findByRole("textbox", { name: "항목 이름" });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: "끝 항목" } });
  fireEvent.keyDown(input, { key: "Enter" });

  const row = await screen.findByRole("treeitem", { name: "끝 항목" });
  await waitFor(() => expect(document.activeElement).toBe(row));
  expect(row.getAttribute("tabindex")).toBe("0");
  expect(document.activeElement).not.toBe(screen.getByRole("treeitem", { name: "첫째" }));
});

it("바로 입력 Escape는 메뉴를 연 행으로 초점을 돌려준다", async () => {
  const items = [{ key: "a", title: "첫째" }, { key: "b", title: "둘째" }];
  const state = { items, last: null, cancelled: null };
  const definition: AppDefinition = {
    ...mdViewerDefinition, requires: { blocks: 60, modules: {} }, permissions: [], state,
    ui: {
      type: "tree", items: { state: "items" },
      item_menu: [{ label: "이름 바꾸기", on_select: [{ set_state: "items", value: { expr: '$map($state.items, function($v) { $v.key = $item.key ? $merge([$v, {"editing": true}]) : $v })' } }] }],
      on_edit: [{ set_state: "last", value: { expr: "$event" } }],
      on_edit_cancel: [{ set_state: "cancelled" }],
    } as unknown as Block,
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...state };
  const transport = createFakeTransport(seed);
  render(<><ContextMenuHost /><AppWindowContent store={createShellStore(transport)} windowId="viewer-window" /></>);
  const row = await screen.findByRole("treeitem", { name: "둘째" });
  fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
  fireEvent.click(await screen.findByRole("menuitem", { name: "이름 바꾸기" }));
  const input = await screen.findByRole("textbox", { name: "항목 이름" });
  await waitFor(() => expect(document.activeElement).toBe(input));
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "둘째" })));
});

it("바로 입력 Escape는 연 자리인 구역 머리 + 단추로 초점을 돌려준다", async () => {
  const items = [{ key: "a", title: "첫째" }];
  setup({
    type: "stack", direction: "column", children: [{
      type: "section", collapsible: true, title: "구역",
      actions: [{ type: "button", label: "+", on_click: [{ set_state: "items", value: { expr: '$append($state.items, [{"key":"new","title":"","editing":true}])' } }] }],
      child: { type: "tree", items: { state: "items" }, on_edit: [{ set_state: "last", value: { expr: "$event" } }], on_edit_cancel: [{ set_state: "cancelled" }] },
    }],
  } as unknown as Block, { items, last: null, cancelled: null });
  const button = await screen.findByRole("button", { name: "+" });
  button.focus();
  fireEvent.click(button);
  const input = await screen.findByRole("textbox", { name: "항목 이름" });
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(button));
});

function setupWithMenu(ui: Block, state: AppDefinition["state"]) {
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 60, modules: {} }, permissions: [], state, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...state };
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  render(<><ContextMenuHost /><AppWindowContent store={createShellStore(transport)} windowId="viewer-window" /></>);
  return { calls };
}

it("접힌 부모 안에 바로 입력 항목이 새로 생기면 그 조상을 펼친다", async () => {
  const addChild = '$map($state.items, function($i){ $i.key = "p" ? $merge([$i, {"children": $append($i.children, [{"key": "n", "title": "", "editing": true}])}]) : $i })';
  const reveal = (defaultExpanded: boolean) => ({
    type: "stack", direction: "column", children: [
      {
        type: "tree", items: { state: "items" }, default_expanded: defaultExpanded,
        on_edit: [{ set_state: "last", value: { expr: "$event" } }], on_edit_cancel: [{ set_state: "cancelled" }],
      },
      { type: "button", label: "하위 추가", on_click: [{ set_state: "items", value: { expr: addChild } }] },
    ],
  } as unknown as Block);
  const state = () => ({ items: [{ key: "p", title: "부모", children: [{ key: "c", title: "아이" }] }], last: null, cancelled: null });

  setup(reveal(false), state());
  expect(await screen.findByRole("treeitem", { name: "부모" })).toBeTruthy();
  expect(screen.queryByRole("treeitem", { name: "아이" }), "부모가 접혀 있다").toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "하위 추가" }));
  expect(await screen.findByRole("textbox", { name: "항목 이름" })).toBeTruthy();
  expect(screen.getByRole("treeitem", { name: "아이" })).toBeTruthy();
  expect(screen.getByRole("treeitem", { name: "부모" }).getAttribute("aria-expanded")).toBe("true");

  cleanup();
  setup(reveal(true), state());
  const parent = await screen.findByRole("treeitem", { name: "부모" });
  expect(parent.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(parent.querySelector(".ks-tree-chevron-trigger")!);
  expect(screen.queryByRole("treeitem", { name: "아이" }), "사용자가 부모를 접었다").toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "하위 추가" }));
  expect(await screen.findByRole("textbox", { name: "항목 이름" })).toBeTruthy();
  expect(screen.getByRole("treeitem", { name: "아이" })).toBeTruthy();
});

it("접힌 구역의 머리 동작 단추를 누르면 구역을 먼저 펼치고 새 글칸이 초점을 받는다", async () => {
  const ui = {
    type: "section", collapsible: true, title: { state: "sectionTitle" }, editing: { state: "sectionEditing" },
    actions: [{
      type: "button", label: "추가",
      on_click: [{ set_state: "rows", value: [{ key: "new", title: "", editing: true }] }],
    }],
    child: {
      type: "tree", items: { state: "rows" },
      on_edit: [{ set_state: "last", value: { expr: "$event" } }],
      on_edit_cancel: [{ set_state: "rows", value: [] }],
    },
  } as unknown as Block;
  const state = { sectionTitle: "구역", sectionEditing: false, rows: [], last: null };

  setup(ui, state);
  const toggle = await screen.findByRole("button", { name: "구역" });
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("없음"), "접힌 구역 안은 그리지 않는다").toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  const input = await screen.findByRole("textbox", { name: "항목 이름" });
  expect(screen.getByRole("button", { name: "구역" }).getAttribute("aria-expanded")).toBe("true");
  await waitFor(() => expect(document.activeElement).toBe(input));

  cleanup();
  setup(ui, state);
  fireEvent.click(await screen.findByRole("button", { name: "구역" }));
  const button = screen.getByRole("button", { name: "추가" });
  button.focus();
  await userEvent.keyboard("{Enter}");
  expect(await screen.findByRole("textbox", { name: "항목 이름" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "구역" }).getAttribute("aria-expanded")).toBe("true");
});

it("앱이 받아들이지 않은 구역 이름은 머리에 남지 않고 원래 이름으로 돌아간다", async () => {
  const ui = {
    type: "section", collapsible: true, title: { state: "sectionTitle" }, editing: { state: "sectionEditing" },
    menu: [{ label: "이름 바꾸기", on_select: [{ set_state: "sectionEditing", value: true }] }],
    on_edit: [{ set_state: "sectionEditing", value: false }],
    on_edit_cancel: [{ set_state: "sectionEditing", value: false }],
    child: { type: "text", value: "안쪽" },
  } as unknown as Block;
  const state = { sectionTitle: "첫째 구역", sectionEditing: false };
  setupWithMenu(ui, state);
  fireEvent.contextMenu(await screen.findByRole("button", { name: "첫째 구역" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "이름 바꾸기" }));
  const input = await screen.findByRole("textbox", { name: "구역 이름" });
  fireEvent.change(input, { target: { value: "다른 이름" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByText("다른 이름"), "확정 직후에는 친 이름을 보인다").toBeTruthy();
  await waitFor(() => expect(screen.getByText("첫째 구역"), "거절되면 원래 이름으로 돌아간다").toBeTruthy());
  expect(screen.queryByText("다른 이름")).toBeNull();
  expect(screen.queryByRole("textbox", { name: "구역 이름" })).toBeNull();
});

it("앱이 받아들이지 않은 항목 제목은 친 제목을 거두고 원래 제목을 보인다", async () => {
  const ui = {
    type: "tree", items: { state: "items" },
    item_menu: [{ label: "이름 바꾸기", on_select: [{ set_state: "items", value: { expr: '$map($state.items, function($i){ $merge([$i, {"editing": $i.key = "a"}]) })' } }] }],
    on_edit: [{ set_state: "items", value: { expr: '$map($state.items, function($i){ $i.key = "a" ? $merge([$i, {"editing": false}]) : $i })' } }],
    on_edit_cancel: [{ set_state: "items", value: { expr: '$map($state.items, function($i){ $merge([$i, {"editing": false}]) })' } }],
  } as unknown as Block;
  const state = { items: [{ key: "a", title: "처음" }] };
  setupWithMenu(ui, state);
  fireEvent.contextMenu(await screen.findByRole("treeitem", { name: "처음" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "이름 바꾸기" }));
  const input = await screen.findByRole("textbox", { name: "항목 이름" });
  fireEvent.change(input, { target: { value: "새 이름" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByRole("treeitem", { name: "새 이름" }), "확정 직후에는 친 제목을 보인다").toBeTruthy();
  await waitFor(() => expect(screen.getByRole("treeitem", { name: "처음" }), "거절되면 원래 제목으로 돌아간다").toBeTruthy());
  expect(screen.queryByRole("treeitem", { name: "새 이름" })).toBeNull();
});

it("바로 더하기로 확정한 새 항목은 앱이 같은 키로 실제 항목을 넣어도 친 이름이 깜박이지 않는다", async () => {
  const ui = {
    type: "tree", items: { state: "items" },
    on_edit: [{ set_state: "items", value: { expr: '[{"key": "new", "title": $event, "editing": false}]' } }],
    on_edit_cancel: [{ set_state: "items", value: [] }],
  } as unknown as Block;
  setup(ui, { items: [{ key: "new", title: "", editing: true }] });
  const input = await screen.findByRole("textbox", { name: "항목 이름" });
  fireEvent.change(input, { target: { value: "새 항목" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByRole("treeitem", { name: "새 항목" }), "확정 직후 친 이름을 보인다").toBeTruthy();
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "항목 이름" })).toBeNull());
  expect(screen.getByRole("treeitem", { name: "새 항목" }), "앱 갱신 뒤에도 같은 이름을 보인다").toBeTruthy();
});

it("끌던 원본 트리가 사라지면 다른 트리의 놓을 자리 표시도 지운다", async () => {
  const sections = [
    { id: "s1", title: "첫째 구역", rows: [{ key: "a", title: "첫째 항목" }] },
    { id: "s2", title: "둘째 구역", rows: [{ key: "b", title: "둘째 항목" }] },
  ];
  const definition: AppDefinition = {
    ...mdViewerDefinition, requires: { blocks: 60, modules: {} }, permissions: [], state: { sections: [], moved: null },
    ui: { type: "stack", direction: "column", children: [
      { type: "repeat", items: { state: "sections" }, key: "id", layout: "column", template: {
        type: "section", title: { item: "title" },
        child: { type: "tree", items: { item: "rows" }, on_move: [{ set_state: "moved", value: { expr: "$event" } }] },
      } },
      { type: "button", label: "첫 구역 지우기", on_click: [{ set_state: "sections", value: { expr: '$filter($state.sections, function($s){ $s.id != "s1" })' } }] },
    ] } as unknown as Block,
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { sections };
  const transport = createFakeTransport(seed);
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);

  const source = await screen.findByRole("treeitem", { name: "첫째 항목" });
  const target = screen.getByRole("treeitem", { name: "둘째 항목" });
  rowRect(target);
  const value = transfer();
  drag("dragstart", source, value);
  drag("dragover", target, value, 20);
  expect(target.getAttribute("data-drop-state")).toBe("valid");
  fireEvent.click(screen.getByRole("button", { name: "첫 구역 지우기" }));
  await waitFor(() => expect(screen.queryByRole("treeitem", { name: "첫째 항목" })).toBeNull());
  await waitFor(() => expect(screen.getByRole("treeitem", { name: "둘째 항목" }).getAttribute("data-drop-state")).toBeNull());
});

it("on_move가 있는 트리는 항목이 없어도 빈 상태를 놓을 자리로 받고 end로 on_move를 부른다", async () => {
  const twoTrees = {
    type: "stack", direction: "column", children: [
      { type: "tree", items: { state: "left" }, on_move: [{ set_state: "moved", value: { expr: "$event" } }] },
      { type: "tree", items: { state: "right" }, on_move: [{ set_state: "moved", value: { expr: "$event" } }] },
    ],
  } as unknown as Block;
  const state = () => ({ left: [{ key: "a", title: "가" }], right: [], moved: null });

  const { calls } = setup(twoTrees, state());
  const source = await screen.findByRole("treeitem", { name: "가" });
  const trees = screen.getAllByRole("tree");
  expect(trees, "빈 트리도 항목이 없을 때 그대로 트리로 선다").toHaveLength(2);
  const empty = trees[1];
  const value = transfer();
  drag("dragstart", source, value);
  drag("dragover", empty, value);
  expect(empty.getAttribute("data-drop-state")).toBe("valid");
  expect(document.querySelectorAll("[data-drop-state]"), "놓을 자리 표시는 한 곳뿐").toHaveLength(1);
  drag("drop", empty, value);
  await waitFor(() => expect(actCalls(calls, "/ui/children/1/on_move")).toEqual([
    expect.objectContaining({ event: { key: "a", target: null, position: "end" }, item: null }),
  ]));

  cleanup();
  setup(twoTrees, state());
  const sourceAgain = await screen.findByRole("treeitem", { name: "가" });
  const emptyAgain = screen.getAllByRole("tree")[1];
  const leaving = transfer();
  drag("dragstart", sourceAgain, leaving);
  drag("dragover", emptyAgain, leaving);
  expect(emptyAgain.getAttribute("data-drop-state")).toBe("valid");
  fireEvent.dragLeave(emptyAgain, { relatedTarget: document.body });
  expect(emptyAgain.getAttribute("data-drop-state"), "트리 밖으로 나가면 지운다").toBeNull();

  cleanup();
  setup({ type: "tree", items: { state: "right" } } as unknown as Block, { right: [] });
  expect(await screen.findByText("없음")).toBeTruthy();
  expect(screen.queryByRole("tree"), "on_move가 없는 빈 트리는 지금 그대로다").toBeNull();
});

it("empty_text가 있으면 빈 트리는 아이콘 없는 한 줄을 메타 글자로 그린다", async () => {
  setup({ type: "tree", items: [], empty_text: "아직 항목이 없습니다" } as unknown as Block, {});
  const line = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(".ks-data-tree .ks-tree-empty");
    expect(found).toBeTruthy();
    return found!;
  });
  expect(line.classList.contains("ks-row"), "트리 행의 높이와 여백을 그대로 쓴다").toBe(true);
  expect(line.querySelectorAll("svg"), "아이콘을 그리지 않는다").toHaveLength(0);
  expect(line.querySelector("[data-tree-check]")).toBeNull();
  expect(line.querySelectorAll(".ks-file-tree-icon")).toHaveLength(1);
  const text = line.querySelector(".ks-view-meta");
  expect(text?.textContent).toBe("아직 항목이 없습니다");
  expect(screen.queryByText("없음")).toBeNull();
});

it("empty_text가 빈 문자열이거나 계산값이 문자열이 아니면 글 없는 한 줄이다", async () => {
  setup({ type: "tree", items: [], empty_text: "" } as unknown as Block, {});
  const line = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(".ks-data-tree .ks-tree-empty");
    expect(found).toBeTruthy();
    return found!;
  });
  expect(line.textContent).toBe("");
  expect(screen.queryByText("없음")).toBeNull();

  cleanup();
  setup({ type: "tree", items: [], empty_text: { state: "note" } } as unknown as Block, { note: null });
  const computed = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(".ks-data-tree .ks-tree-empty");
    expect(found).toBeTruthy();
    return found!;
  });
  expect(computed.textContent).toBe("");
});

it("확인 상자를 그리는 트리는 empty_text 한 줄에도 빈 열을 둘 그린다", async () => {
  setup({
    type: "tree", items: [], empty_text: "비었습니다",
    on_check: [{ set_state: "checked" }],
  } as unknown as Block, { checked: null });
  const line = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(".ks-data-tree .ks-tree-empty");
    expect(found).toBeTruthy();
    return found!;
  });
  expect(line.querySelectorAll(".ks-file-tree-icon")).toHaveLength(2);
  expect(line.querySelectorAll("svg")).toHaveLength(0);
  expect(line.querySelector(".ks-view-meta")?.textContent).toBe("비었습니다");
});

it("on_move가 있는 빈 트리는 empty_text 한 줄 위에서 놓을 자리를 표시하고 end로 보낸다", async () => {
  const twoTrees = {
    type: "stack", direction: "column", children: [
      { type: "tree", items: { state: "left" }, on_move: [{ set_state: "moved", value: { expr: "$event" } }] },
      { type: "tree", items: { state: "right" }, empty_text: "여기에 놓으세요", on_move: [{ set_state: "moved", value: { expr: "$event" } }] },
    ],
  } as unknown as Block;
  const { calls } = setup(twoTrees, { left: [{ key: "a", title: "가" }], right: [], moved: null });
  const source = await screen.findByRole("treeitem", { name: "가" });
  const line = document.querySelector<HTMLElement>(".ks-data-tree .ks-tree-empty")!;
  const tree = line.closest(".ks-data-tree")!;
  const value = transfer();
  drag("dragstart", source, value);
  drag("dragover", line, value);
  expect(line.getAttribute("data-drop-state")).toBe("valid");
  expect(tree.getAttribute("data-drop-state"), "놓을 자리 표시는 그 한 줄에만 선다").toBeNull();
  expect(document.querySelectorAll("[data-drop-state]"), "놓을 자리 표시는 한 곳뿐").toHaveLength(1);
  drag("drop", line, value);
  await waitFor(() => expect(actCalls(calls, "/ui/children/1/on_move")).toEqual([
    expect.objectContaining({ event: { key: "a", target: null, position: "end" }, item: null }),
  ]));
  expect(document.querySelectorAll("[data-drop-state]"), "끌기가 끝나면 표시가 남지 않는다").toHaveLength(0);
});

it("이름 바꾸는 부모 행의 화살표는 그 행의 펼침 상태를 따른다", async () => {
  const parentEditing = (defaultExpanded: boolean) => ({
    type: "tree",
    items: [{ key: "p", title: "부모", editing: true, children: [{ key: "c", title: "아이" }] }],
    default_expanded: defaultExpanded,
    on_edit: [{ set_state: "last", value: { expr: "$event" } }],
  } as unknown as Block);
  setup(parentEditing(true), { last: null });
  const input = await screen.findByRole("textbox", { name: "항목 이름" });
  const openRow = input.closest(".ks-file-tree-create-row")!;
  expect(openRow.querySelector(".ks-chevron")?.classList.contains("is-expanded"), "펼친 부모").toBe(true);
  expect(screen.getByRole("treeitem", { name: "아이" })).toBeTruthy();

  cleanup();
  setup(parentEditing(false), { last: null });
  const collapsedInput = await screen.findByRole("textbox", { name: "항목 이름" });
  const collapsedRow = collapsedInput.closest(".ks-file-tree-create-row")!;
  expect(collapsedRow.querySelector(".ks-chevron")).toBeTruthy();
  expect(collapsedRow.querySelector(".ks-chevron")?.classList.contains("is-expanded"), "접힌 부모").toBe(false);
  expect(screen.queryByRole("treeitem", { name: "아이" })).toBeNull();
});
