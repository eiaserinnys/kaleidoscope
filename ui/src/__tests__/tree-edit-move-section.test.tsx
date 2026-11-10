import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block, CoreRequest } from "../contract/contract";
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

function setup(ui: Block, state: AppDefinition["state"] = {}) {
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 60, modules: {} }, permissions: [], state, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...state };
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  render(<><ContextMenuHost /><AppWindowContent store={createShellStore(transport)} windowId="viewer-window" /></>);
  return { calls };
}

const actCalls = (calls: { mock: { calls: unknown[][] } }, pointer: string) =>
  calls.mock.calls.map((call) => call[0] as CoreRequest).filter((request) => request.op === "data.act" && request.pointer === pointer);

const treeRename = {
  type: "tree",
  items: { state: "items" },
  item_menu: [{ label: "이름 바꾸기", on_select: [{ set_state: "items", value: { expr: '[{"key":"a","title":"처음","editing":true}]' } }] }],
  on_edit: [{ set_state: "last", value: { expr: "$event" } }],
  on_edit_cancel: [{ set_state: "cancelled" }],
} as unknown as Block;

const treeState = { items: [{ key: "a", title: "처음" }], last: null, cancelled: null };

async function openTreeRename() {
  const row = await screen.findByRole("treeitem", { name: "처음" });
  fireEvent.contextMenu(row);
  fireEvent.click(await screen.findByRole("menuitem", { name: "이름 바꾸기" }));
  return await screen.findByRole("textbox", { name: "항목 이름" }) as HTMLInputElement;
}

it("트리 행 메뉴의 이름 바꾸기는 글 전체를 고른 글칸을 초점과 함께 열고 확정하면 on_edit을 한 번 부른다", async () => {
  const { calls } = setup(treeRename, treeState);
  const row = await screen.findByRole("treeitem", { name: "처음" });
  fireEvent.contextMenu(row);
  const items = await screen.findAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toEqual(["이름 바꾸기", "제목 복사"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "이름 바꾸기" }));

  const input = await screen.findByRole("textbox", { name: "항목 이름" }) as HTMLInputElement;
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(screen.queryByRole("menu")).toBeNull();
  expect(input.value).toBe("처음");
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(2);

  fireEvent.change(input, { target: { value: "  새 이름  " } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(actCalls(calls, "/ui/on_edit")).toEqual([
    expect.objectContaining({ event: "새 이름", item: expect.objectContaining({ key: "a" }) }),
  ]));
  expect(actCalls(calls, "/ui/on_edit")).toHaveLength(1);
  expect(actCalls(calls, "/ui/on_edit_cancel")).toHaveLength(0);
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "항목 이름" })).toBeNull());
  expect(screen.getByRole("treeitem", { name: "새 이름" })).toBeTruthy();
});

it("트리 이름 바꾸기는 처음 값과 같은 글을 확정하면 Enter와 초점 잃기 모두 on_edit_cancel만 부른다", async () => {
  const first = setup(treeRename, treeState);
  fireEvent.keyDown(await openTreeRename(), { key: "Enter" });
  await waitFor(() => expect(actCalls(first.calls, "/ui/on_edit_cancel")).toEqual([
    expect.objectContaining({ event: null, item: expect.objectContaining({ key: "a" }) }),
  ]));
  expect(actCalls(first.calls, "/ui/on_edit")).toHaveLength(0);

  cleanup();
  const second = setup(treeRename, treeState);
  const input = await openTreeRename();
  fireEvent.change(input, { target: { value: " 처음 " } });
  fireEvent.blur(input);
  await waitFor(() => expect(actCalls(second.calls, "/ui/on_edit_cancel")).toHaveLength(1));
  expect(actCalls(second.calls, "/ui/on_edit")).toHaveLength(0);
});

const sectionBlock = (extra: Record<string, unknown> = {}) => ({
  type: "section",
  collapsible: true,
  title: { state: "sectionTitle" },
  menu: [{ label: "이름 바꾸기", on_select: [{ set_state: "sectionEditing", value: true }] }],
  editing: { state: "sectionEditing" },
  on_edit: [{ set_state: "last", value: { expr: "$event" } }],
  on_edit_cancel: [{ set_state: "cancelled" }],
  actions: [{ type: "button", label: "추가", on_click: [{ set_state: "pressed" }] }],
  child: { type: "text", value: "안쪽 글" },
  ...extra,
} as unknown as Block);

const sectionState = { sectionTitle: "첫째 구역", sectionEditing: false, last: null, cancelled: null, pressed: null };

async function openSectionRename() {
  const toggle = await screen.findByRole("button", { name: "첫째 구역" });
  fireEvent.contextMenu(toggle);
  fireEvent.click(await screen.findByRole("menuitem", { name: "이름 바꾸기" }));
  return await screen.findByRole("textbox", { name: "구역 이름" }) as HTMLInputElement;
}

it("구역 머리 메뉴로 이름 바꾸기를 고르면 초점 받은 글칸이 열리고 Enter 확정 뒤 pending 제목과 함께 접기 단추로 초점이 돌아온다", async () => {
  const { calls } = setup(sectionBlock(), sectionState);
  const toggle = await screen.findByRole("button", { name: "첫째 구역" });
  fireEvent.contextMenu(toggle);
  const items = await screen.findAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toEqual(["이름 바꾸기", "제목 복사"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "이름 바꾸기" }));
  await waitFor(() => expect(actCalls(calls, "/ui/menu/0/on_select")).toEqual([expect.objectContaining({ event: null })]));

  const input = await screen.findByRole("textbox", { name: "구역 이름" }) as HTMLInputElement;
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(input.value).toBe("첫째 구역");
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe("첫째 구역".length);
  expect(screen.getByRole("button", { name: "추가" })).toBeTruthy();
  expect(screen.getByText("안쪽 글")).toBeTruthy();

  fireEvent.change(input, { target: { value: "  새 구역  " } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(actCalls(calls, "/ui/on_edit")).toEqual([expect.objectContaining({ event: "새 구역" })]));
  expect(actCalls(calls, "/ui/on_edit")).toHaveLength(1);
  expect(actCalls(calls, "/ui/on_edit_cancel")).toHaveLength(0);
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "구역 이름" })).toBeNull());
  expect(screen.getByText("새 구역")).toBeTruthy();
  expect(screen.queryByText("첫째 구역")).toBeNull();
  const toggleAfter = screen.getByRole("button", { name: "새 구역" });
  await waitFor(() => expect(document.activeElement).toBe(toggleAfter));
});

it("구역 이름 바꾸기는 Escape, 빈 글 Enter, 비운 글의 초점 잃기를 on_edit_cancel로 끝낸다", async () => {
  const escape = setup(sectionBlock(), sectionState);
  const escapeInput = await openSectionRename();
  fireEvent.change(escapeInput, { target: { value: "버릴 글" } });
  fireEvent.keyDown(escapeInput, { key: "Escape" });
  await waitFor(() => expect(actCalls(escape.calls, "/ui/on_edit_cancel")).toEqual([expect.objectContaining({ event: null })]));
  expect(actCalls(escape.calls, "/ui/on_edit")).toHaveLength(0);
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "구역 이름" })).toBeNull());
  expect(screen.getByText("첫째 구역")).toBeTruthy();

  cleanup();
  const empty = setup(sectionBlock(), sectionState);
  const emptyInput = await openSectionRename();
  fireEvent.change(emptyInput, { target: { value: "   " } });
  fireEvent.keyDown(emptyInput, { key: "Enter" });
  await waitFor(() => expect(actCalls(empty.calls, "/ui/on_edit_cancel")).toHaveLength(1));
  expect(actCalls(empty.calls, "/ui/on_edit")).toHaveLength(0);

  cleanup();
  const committed = setup(sectionBlock(), sectionState);
  const committedInput = await openSectionRename();
  fireEvent.change(committedInput, { target: { value: " 새 구역 " } });
  fireEvent.blur(committedInput);
  await waitFor(() => expect(actCalls(committed.calls, "/ui/on_edit")).toEqual([expect.objectContaining({ event: "새 구역" })]));
  expect(actCalls(committed.calls, "/ui/on_edit_cancel")).toHaveLength(0);

  cleanup();
  const blurred = setup(sectionBlock(), sectionState);
  const blurredInput = await openSectionRename();
  fireEvent.change(blurredInput, { target: { value: "" } });
  fireEvent.blur(blurredInput);
  await waitFor(() => expect(actCalls(blurred.calls, "/ui/on_edit_cancel")).toHaveLength(1));
  expect(actCalls(blurred.calls, "/ui/on_edit")).toHaveLength(0);
});

it("구역 접기 단추에 초점이 있을 때 Shift+F10으로 같은 메뉴를 연다", async () => {
  setup(sectionBlock(), sectionState);
  const toggle = await screen.findByRole("button", { name: "첫째 구역" });
  toggle.focus();
  fireEvent.keyDown(toggle, { key: "F10", shiftKey: true });
  const items = await screen.findAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toEqual(["이름 바꾸기", "제목 복사"]);
});

it("repeat 안 구역 메뉴 동작은 그 반복 항목을 $item으로 받는다", async () => {
  const sections = [{ id: "s1", title: "첫째 구역" }, { id: "s2", title: "둘째 구역" }];
  const definition: AppDefinition = {
    ...mdViewerDefinition, requires: { blocks: 60, modules: {} }, permissions: [], state: {},
    ui: { type: "repeat", items: { state: "sections" }, key: "id", template: {
      type: "section", collapsible: true, title: { item: "title" },
      menu: [{ label: "이름 바꾸기", on_select: [{ set_state: "renamed", value: { expr: "$item.id" } }] }],
      child: { type: "text", value: "안쪽" },
    } } as unknown as Block,
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { sections };
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  render(<><ContextMenuHost /><AppWindowContent store={createShellStore(transport)} windowId="viewer-window" /></>);

  fireEvent.contextMenu(await screen.findByRole("button", { name: "둘째 구역" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "이름 바꾸기" }));
  await waitFor(() => expect(actCalls(calls, "/ui/template/menu/0/on_select")).toEqual([
    expect.objectContaining({ event: null, item: expect.objectContaining({ id: "s2", title: "둘째 구역" }) }),
  ]));
});

it("menu가 없는 구역 머리 우클릭은 메뉴를 열지 않는다", async () => {
  setup(sectionBlock({ menu: undefined }), sectionState);
  const toggle = await screen.findByRole("button", { name: "첫째 구역" });
  fireEvent.contextMenu(toggle);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByRole("menuitem")).toBeNull();
});

it("on_edit이 없는 구역은 editing이 참이어도 제목을 그대로 그린다", async () => {
  setup(sectionBlock({ on_edit: undefined }), { ...sectionState, sectionEditing: true });
  expect(await screen.findByRole("button", { name: "첫째 구역" })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "구역 이름" })).toBeNull();
});
