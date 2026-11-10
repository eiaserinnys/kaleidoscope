import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block, CoreReply, CoreRequest } from "../contract/contract";
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
