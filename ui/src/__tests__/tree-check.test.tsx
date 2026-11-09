import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block, CoreRequest } from "../contract/contract";
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

function setup(ui: Block, state: AppDefinition["state"] = {}, blocks = 55) {
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks, modules: {} }, permissions: [], state, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...state };
  const transport = createFakeTransport(seed);
  const originalCall = transport.call.bind(transport);
  const gates: Array<{ entered: () => void; wait: Promise<void> }> = [];
  const calls = vi.spyOn(transport, "call").mockImplementation(async (request: CoreRequest) => {
    if (request.op === "data.act") {
      const gate = gates.shift();
      if (gate) { gate.entered(); await gate.wait; }
    }
    return originalCall(request as never) as never;
  });
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  const hold = () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const hit = new Promise<void>((resolve) => { entered = resolve; });
    gates.push({ entered, wait });
    return { hit, release };
  };
  return { calls, transport, hold };
}

const actCalls = (calls: { mock: { calls: unknown[][] } }, pointer: string) =>
  calls.mock.calls.map((call) => call[0] as CoreRequest).filter((request) => request.op === "data.act" && request.pointer === pointer);

it("확인 상자를 누르면 새 값으로 on_check를 한 번 부르고 행을 선택하지 않는다", async () => {
  const item = { key: "todo", title: "장보기", checked: false };
  const { calls } = setup({
    type: "tree",
    items: [item],
    selected: { state: "picked" },
    on_select: { set_state: "picked" },
    on_check: [{ set_state: "last" }, { set_state: "last_key", value: { expr: "$item.key" } }],
  } as unknown as Block, { picked: null, last: null, last_key: null });
  const row = await screen.findByRole("treeitem", { name: "장보기" });
  expect(row.getAttribute("aria-checked")).toBe("false");
  const box = row.querySelector("[data-tree-check]");
  expect(box).toBeTruthy();

  row.focus();
  fireEvent.click(box!);
  expect(row.getAttribute("aria-checked")).toBe("true");
  await waitFor(() => expect(actCalls(calls, "/ui/on_check")).toEqual([expect.objectContaining({ event: true, item })]));
  expect(actCalls(calls, "/ui/on_check")).toHaveLength(1);
  expect(actCalls(calls, "/ui/on_select")).toHaveLength(0);
  expect(row.getAttribute("aria-selected")).toBe("false");
  expect(document.activeElement).toBe(row);

  await waitFor(() => expect(row.getAttribute("aria-checked")).toBe("false"));
});

it("동작이 끝나기 전에도 확인 상자를 새 값으로 그린다", async () => {
  const item = { key: "todo", title: "장보기", checked: false };
  const { hold } = setup({
    type: "tree",
    items: [item],
    on_check: [{ set_state: "last" }],
  } as unknown as Block, { last: null });
  const row = await screen.findByRole("treeitem", { name: "장보기" });
  const gate = hold();
  fireEvent.click(row.querySelector("[data-tree-check]")!);
  expect(row.getAttribute("aria-checked")).toBe("true");
  await gate.hit;
  expect(row.getAttribute("aria-checked")).toBe("true");
  gate.release();
  await waitFor(() => expect(row.getAttribute("aria-checked")).toBe("false"));
});

it("확인 상자가 있는 행은 Space로 확인을 뒤집고 Enter로 선택한다", async () => {
  const item = { key: "todo", title: "장보기", checked: true };
  const { calls } = setup({
    type: "tree",
    items: [item],
    selected: { state: "picked" },
    on_select: { set_state: "picked" },
    on_check: [{ set_state: "last" }],
  } as unknown as Block, { picked: null, last: null });
  const row = await screen.findByRole("treeitem", { name: "장보기" });
  row.focus();

  fireEvent.keyDown(row, { key: " " });
  await waitFor(() => expect(actCalls(calls, "/ui/on_check")).toEqual([expect.objectContaining({ event: false, item })]));
  expect(actCalls(calls, "/ui/on_select")).toHaveLength(0);

  fireEvent.keyDown(row, { key: "Enter" });
  await waitFor(() => expect(actCalls(calls, "/ui/on_select")).toEqual([expect.objectContaining({ event: "todo", item })]));
  expect(actCalls(calls, "/ui/on_check")).toHaveLength(1);
});

it("on_check가 없으면 확인 상자는 보이기만 하고 상태를 바꾸지 않는다", async () => {
  const item = { key: "todo", title: "장보기", checked: false };
  const { calls } = setup({
    type: "tree",
    items: [item],
  } as unknown as Block);
  const row = await screen.findByRole("treeitem", { name: "장보기" });
  expect(row.getAttribute("aria-checked")).toBe("false");
  expect(row.getAttribute("aria-disabled")).toBe("true");
  expect(row.querySelector("[data-tree-check]")).toBeTruthy();

  row.focus();
  fireEvent.click(row.querySelector("[data-tree-check]")!);
  fireEvent.keyDown(row, { key: " " });
  await act(async () => { await Promise.resolve(); });
  expect(calls.mock.calls.some(([request]) => (request as CoreRequest).op === "data.act")).toBe(false);
  expect(row.getAttribute("aria-checked")).toBe("false");
});

it("default_expanded는 처음부터 펼치고 사용자가 접은 행은 접힌 채로 두며 새 행은 펼친다", async () => {
  const items = [
    { key: "p", title: "상위", children: [{ key: "c", title: "하위" }] },
  ];
  const { transport } = setup({
    type: "tree",
    default_expanded: true,
    items: { state: "items" },
  } as unknown as Block, { items }, 55);
  const parent = await screen.findByRole("treeitem", { name: "상위" });
  expect(parent.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("treeitem", { name: "하위" })).toBeTruthy();

  fireEvent.click(parent);
  expect(parent.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("treeitem", { name: "하위" })).toBeNull();

  await act(async () => {
    await transport.call({
      op: "window.patch_state",
      window_id: "viewer-window",
      patch: { items: [...items, { key: "q", title: "새 상위", children: [{ key: "q1", title: "새 아이" }] }] },
    });
  });
  expect(await screen.findByRole("treeitem", { name: "새 아이" })).toBeTruthy();
  expect(screen.queryByRole("treeitem", { name: "하위" })).toBeNull();
  expect(parent.getAttribute("aria-expanded")).toBe("false");
});

const parentItems = [
  { key: "p", title: "상위", checked: false, children: [
    { key: "c1", title: "아이 하나", checked: false },
    { key: "c2", title: "아이 둘", checked: true },
  ] },
];
const parentBlock = {
  type: "tree",
  default_expanded: true,
  items: { state: "items" },
  selected: { state: "picked" },
  on_select: { set_state: "picked" },
  on_check: [{ set_state: "last" }],
} as unknown as Block;

it("확인 모드의 부모 행은 화살표 다음 열에 확인 상자를 두고 잎 행과 같은 열마다 그린다", async () => {
  setup(parentBlock, { items: parentItems, picked: null, last: null });
  const parent = await screen.findByRole("treeitem", { name: "상위" });
  const [expand, mark] = Array.from(parent.querySelectorAll(":scope > .ks-file-tree-icon"));
  expect(expand.querySelector(".ks-chevron")).toBeTruthy();
  expect(expand.querySelector("[data-tree-check]")).toBeNull();
  expect(mark.querySelector("[data-tree-check]")).toBeTruthy();
  expect(expand.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(parent.getAttribute("aria-checked")).toBe("false");

  const leaf = screen.getByRole("treeitem", { name: "아이 하나" });
  const [leafExpand, leafMark] = Array.from(leaf.querySelectorAll(":scope > .ks-file-tree-icon"));
  expect(leafExpand.querySelector(".ks-chevron")).toBeNull();
  expect(leafMark.querySelector("[data-tree-check]")).toBeTruthy();
  expect(leaf.querySelector(":scope > .ks-file-tree-name")?.textContent).toBe("아이 하나");
});

it("확인 모드에서 부모 행 본문을 누르면 고르기만 하고 접히지 않는다", async () => {
  const { calls } = setup(parentBlock, { items: parentItems, picked: null, last: null });
  const parent = await screen.findByRole("treeitem", { name: "상위" });
  fireEvent.click(parent);
  expect(parent.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("treeitem", { name: "아이 하나" })).toBeTruthy();
  await waitFor(() => expect(actCalls(calls, "/ui/on_select")).toEqual([expect.objectContaining({ event: "p", item: parentItems[0] })]));
  expect(actCalls(calls, "/ui/on_check")).toHaveLength(0);
});

it("확인 모드에서 펼침 화살표를 누르면 펼침만 바뀐다", async () => {
  const { calls } = setup(parentBlock, { items: parentItems, picked: null, last: null });
  const parent = await screen.findByRole("treeitem", { name: "상위" });
  fireEvent.click(parent.querySelector(".ks-chevron")!);
  expect(parent.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("treeitem", { name: "아이 하나" })).toBeNull();
  await act(async () => { await Promise.resolve(); });
  expect(calls.mock.calls.some(([request]) => (request as CoreRequest).op === "data.act")).toBe(false);

  fireEvent.click(parent.querySelector(".ks-chevron")!);
  expect(parent.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("treeitem", { name: "아이 하나" })).toBeTruthy();
});

it("확인 모드에서 부모 확인 상자를 누르면 on_check만 실행한다", async () => {
  const { calls } = setup(parentBlock, { items: parentItems, picked: null, last: null });
  const parent = await screen.findByRole("treeitem", { name: "상위" });
  fireEvent.click(parent.querySelector("[data-tree-check]")!);
  await waitFor(() => expect(actCalls(calls, "/ui/on_check")).toEqual([expect.objectContaining({ event: true, item: parentItems[0] })]));
  expect(actCalls(calls, "/ui/on_select")).toHaveLength(0);
  expect(parent.getAttribute("aria-expanded")).toBe("true");
});

it("확인 모드 부모 행에서 화살표는 펼침, Space는 확인, Enter는 고르기만 한다", async () => {
  const { calls } = setup(parentBlock, { items: parentItems, picked: null, last: null });
  const parent = await screen.findByRole("treeitem", { name: "상위" });
  parent.focus();
  fireEvent.keyDown(parent, { key: "ArrowLeft" });
  expect(parent.getAttribute("aria-expanded")).toBe("false");
  fireEvent.keyDown(parent, { key: "ArrowRight" });
  expect(parent.getAttribute("aria-expanded")).toBe("true");

  fireEvent.keyDown(parent, { key: " " });
  await waitFor(() => expect(actCalls(calls, "/ui/on_check")).toEqual([expect.objectContaining({ event: true, item: parentItems[0] })]));
  fireEvent.keyDown(parent, { key: "Enter" });
  await waitFor(() => expect(actCalls(calls, "/ui/on_select")).toEqual([expect.objectContaining({ event: "p", item: parentItems[0] })]));
  expect(parent.getAttribute("aria-expanded")).toBe("true");
});

it("확인 모드에서 checked가 없는 부모 행은 확인 열 없이 한 열만 두고 본문 클릭과 Enter로 접고 펼치며 on_select도 부른다", async () => {
  const items = [
    { key: "g", title: "묶음", children: [
      { key: "g1", title: "아이", checked: false },
    ] },
  ];
  const { calls } = setup({
    type: "tree",
    default_expanded: true,
    items: { state: "items" },
    selected: { state: "picked" },
    on_select: { set_state: "picked" },
    on_check: [{ set_state: "last" }],
  } as unknown as Block, { items, picked: null, last: null });
  const parent = await screen.findByRole("treeitem", { name: "묶음" });
  expect(parent.querySelector("[data-tree-check]")).toBeNull();
  const cols = Array.from(parent.querySelectorAll(":scope > .ks-file-tree-icon"));
  expect(cols).toHaveLength(1);
  expect(cols[0].querySelector(".ks-chevron")).toBeTruthy();
  expect(parent.querySelector(":scope > .ks-file-tree-name")?.textContent).toBe("묶음");

  fireEvent.click(parent);
  expect(parent.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("treeitem", { name: "아이" })).toBeNull();
  await waitFor(() => expect(actCalls(calls, "/ui/on_select")).toEqual([expect.objectContaining({ event: "g", item: items[0] })]));
  expect(actCalls(calls, "/ui/on_check")).toHaveLength(0);

  parent.focus();
  fireEvent.keyDown(parent, { key: "Enter" });
  expect(parent.getAttribute("aria-expanded")).toBe("true");
  await waitFor(() => expect(actCalls(calls, "/ui/on_select")).toHaveLength(2));
  expect(actCalls(calls, "/ui/on_check")).toHaveLength(0);
});

it("확인 모드에서 checked가 없는 부모 행은 본문 클릭과 Enter로 펼침을 바꾸고 on_select를 부른다", async () => {
  const items = [
    { key: "g", title: "묶음", children: [
      { key: "g1", title: "아이", checked: false },
    ] },
  ];
  const { calls } = setup({
    type: "tree",
    default_expanded: true,
    items: { state: "items" },
    selected: { state: "picked" },
    on_select: { set_state: "picked" },
    on_check: [{ set_state: "last" }],
  } as unknown as Block, { items, picked: null, last: null });
  const parent = await screen.findByRole("treeitem", { name: "묶음" });

  fireEvent.click(parent);
  expect(parent.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("treeitem", { name: "아이" })).toBeNull();
  await waitFor(() => expect(actCalls(calls, "/ui/on_select")).toEqual([expect.objectContaining({ event: "g", item: items[0] })]));
  expect(actCalls(calls, "/ui/on_check")).toHaveLength(0);

  parent.focus();
  fireEvent.keyDown(parent, { key: "Enter" });
  expect(parent.getAttribute("aria-expanded")).toBe("true");
  await waitFor(() => expect(actCalls(calls, "/ui/on_select")).toHaveLength(2));
  expect(actCalls(calls, "/ui/on_check")).toHaveLength(0);
});

it("확인 모드에서 checked가 없는 잎 행은 지금처럼 두 열을 유지한다", async () => {
  const items = [
    { key: "p", title: "상위", checked: false, children: [
      { key: "q", title: "확인 없는 아이" },
    ] },
  ];
  setup(parentBlock, { items, picked: null, last: null });
  const leaf = await screen.findByRole("treeitem", { name: "확인 없는 아이" });
  expect(leaf.querySelector("[data-tree-check]")).toBeNull();
  expect(leaf.querySelectorAll(":scope > .ks-file-tree-icon")).toHaveLength(2);
});

it("확인 모드의 path 가상 폴더는 본문 클릭과 Enter로 여전히 펼치고 접는다", async () => {
  const items = [
    { key: "a", title: "보고서", path: "분기/보고서", checked: false },
    { key: "b", title: "자료", path: "분기/자료", checked: true },
  ];
  const { calls } = setup({
    type: "tree",
    by: "path",
    items: { state: "items" },
    on_select: { set_state: "picked" },
    on_check: [{ set_state: "last" }],
  } as unknown as Block, { items, picked: null, last: null });
  const folder = await screen.findByRole("treeitem", { name: "분기" });
  expect(folder.querySelector("[data-tree-check]")).toBeNull();
  expect(folder.querySelectorAll(":scope > .ks-file-tree-icon")).toHaveLength(1);

  fireEvent.click(folder);
  expect(folder.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("treeitem", { name: "보고서" })).toBeTruthy();

  folder.focus();
  fireEvent.keyDown(folder, { key: "Enter" });
  expect(folder.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("treeitem", { name: "보고서" })).toBeNull();

  await act(async () => { await Promise.resolve(); });
  expect(calls.mock.calls.some(([request]) => (request as CoreRequest).op === "data.act")).toBe(false);
});

it("확인 모드가 아닌 데이터 트리는 부모 행에 화살표 한 열만 두고 본문 클릭이 펼침을 바꾼다", async () => {
  setup({ type: "tree", default_expanded: true, items: { state: "items" } } as unknown as Block, { items: parentItems });
  const parent = await screen.findByRole("treeitem", { name: "상위" });
  expect(parent.querySelectorAll(":scope > .ks-file-tree-icon")).toHaveLength(1);
  fireEvent.click(parent);
  expect(parent.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("treeitem", { name: "아이 하나" })).toBeNull();
});

it("확인 상자가 없는 트리는 상자와 aria-checked 없이 그대로 동작한다", async () => {
  const { calls } = setup({ type: "tree", items: [{ key: "a", title: "하나" }] } as unknown as Block);
  const row = await screen.findByRole("treeitem", { name: "하나" });
  expect(row.hasAttribute("aria-checked")).toBe(false);
  expect(row.hasAttribute("aria-disabled")).toBe(false);
  expect(row.querySelector("[data-tree-check]")).toBeNull();

  row.focus();
  fireEvent.keyDown(row, { key: " " });
  await act(async () => { await Promise.resolve(); });
  expect(calls.mock.calls.some(([request]) => (request as CoreRequest).op === "data.act")).toBe(false);
});
