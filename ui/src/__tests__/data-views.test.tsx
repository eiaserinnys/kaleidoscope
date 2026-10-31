import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { mockVirtualLayout } from "./virtual-layout";
import { makeTestSeed, mdViewerDefinition } from "./fixtures";

beforeEach(mockVirtualLayout);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup(ui: Block, state: AppDefinition["state"] = {}) {
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 4, modules: {} }, permissions: [], state, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...state };
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  return { calls, transport };
}
it("moves through grouped list entries and selects the focused item", async () => {
  const { calls } = setup({ type: "list", grouped: true, items: [{ title: "묶음", items: [{ key: "a", title: "하나" }, { key: "b", title: "둘" }] }], on_select: { set_state: "choice" } }, { choice: null });
  const first = await screen.findByRole("option", { name: "하나" });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement?.textContent).toContain("둘");
  fireEvent.keyDown(document.activeElement!, { key: "Enter" });
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/on_select", event: "b", item: { key: "b", title: "둘" } })));
});
it("cycles table sort and exposes its direction", async () => {
  setup({ type: "table", rows: [{ key: "a", n: 2 }, { key: "b", n: 1 }], columns: [{ field: "n", label: "숫자", format: "number" }] });
  const header = await screen.findByRole("columnheader");
  const button = within(header).getByRole("button");
  fireEvent.click(button);
  expect(header.getAttribute("aria-sort")).toBe("ascending");
  fireEvent.click(button);
  expect(header.getAttribute("aria-sort")).toBe("descending");
  fireEvent.click(button);
  expect(header.getAttribute("aria-sort")).toBe("none");
});
it("omits empty properties and renders formatted values", async () => {
  setup({ type: "properties", fields: [{ label: "빈 값", value: null }, { label: "코드", value: "hello", format: "code" }, { label: "배지", value: "진행", format: "badge" }] });
  expect(await screen.findByText("hello")).toBeTruthy();
  expect(screen.getByText("진행")).toBeTruthy();
  expect(screen.queryByText("빈 값")).toBeNull();
});
it("builds a path tree, opens its selected ancestors and supports keys", async () => {
  const { calls } = setup({ type: "tree", by: "path", items: [{ key: "a", path: "폴더/하나" }, { key: "b", path: "폴더/둘" }], selected: { state: "choice" }, on_select: { set_state: "choice" } }, { choice: "a" });
  const folder = await screen.findByRole("treeitem", { name: /폴더/ });
  expect(folder.getAttribute("aria-expanded")).toBe("true");
  const first = screen.getByRole("treeitem", { name: "둘" });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement?.textContent).toContain("하나");
  fireEvent.keyDown(document.activeElement!, { key: "Enter" });
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", event: "a" })));
});
it("preserves feed text selection without selecting an entry", async () => {
  const { calls } = setup({ type: "feed", entries: [{ key: "a", name: "이름", body: ["첫 줄", "둘째 줄"] }], on_select: { set_state: "choice" } }, { choice: null });
  const text = await screen.findByText("첫 줄");
  vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "첫" } as Selection);
  fireEvent.click(text);
  expect(calls.mock.calls.some(([request]) => request.op === "data.act")).toBe(false);
  vi.mocked(window.getSelection).mockReturnValue(null);
  fireEvent.click(text);
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", event: "a" })));
});

it("enables feed columns only when requested", async () => {
  setup({ type: "feed", columns: true, entries: [{ key: "a", body: ["첫째", "둘째"] }] } as unknown as Block);
  const body = (await screen.findByText("첫째")).closest(".ks-feed-body")!;
  expect(body.classList.contains("is-columns")).toBe(true);

  cleanup();
  setup({ type: "feed", entries: [{ key: "a", body: ["셋째", "넷째"] }] });
  const plainBody = (await screen.findByText("셋째")).closest(".ks-feed-body")!;
  expect(plainBody.classList.contains("is-columns")).toBe(false);
});

it("renders nested feed replies with depth, badges, and collapsible descendants", async () => {
  setup({
    type: "feed", collapsible: true, entries: [{
      key: "root", name: "작성자", badges: [{ text: "인기", color: "#4c8bf5" }], body: "부모 본문",
      children: [{ key: "reply", name: "답글 작성자", body: "자식 본문", children: [{ key: "deep", body: "깊은 답글" }] }],
    }],
  } as unknown as Block);
  const reply = await screen.findByText("자식 본문");
  const root = screen.getByText("부모 본문").closest("article")!;
  expect(root.getAttribute("data-depth")).toBe("0");
  expect(reply.closest("article")?.getAttribute("data-depth")).toBe("1");
  expect(screen.getByText("인기")).not.toBeNull();
  fireEvent.click(within(root).getByRole("button", { name: "답글 2개 접기" }));
  expect(screen.queryByText("자식 본문")).toBeNull();
  expect(screen.queryByText("깊은 답글")).toBeNull();
  fireEvent.click(within(root).getByRole("button", { name: "답글 2개 펴기" }));
  expect(await screen.findByText("깊은 답글")).not.toBeNull();
});

it("collapses and expands a grouped feed from its heading", async () => {
  setup({
    type: "feed", grouped: true, collapsible: true, entries: [{ title: "오늘", items: [{ key: "story", body: "오늘의 댓글" }] }],
  } as unknown as Block);
  const title = await screen.findByText("오늘");
  const heading = () => screen.getByRole("button", { name: "오늘" });
  expect(heading().getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(title);
  expect(screen.queryByText("오늘의 댓글")).toBeNull();
  expect(heading().getAttribute("aria-expanded")).toBe("false");
  fireEvent.keyDown(heading(), { key: "Enter" });
  expect(await screen.findByText("오늘의 댓글")).not.toBeNull();
});

it("copies feed metadata and each original body paragraph without selecting the entry", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const { calls } = setup({
    type: "feed",
    copy: true,
    entries: [{ key: "a", meta: "id-1", body: ["첫 줄\n둘째 줄", "다른 문단"] }],
    on_select: { set_state: "choice" },
  } as unknown as Block, { choice: null });
  try {
    const buttons = await screen.findAllByRole("button", { name: "복사" });
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    fireEvent.click(buttons[2]);
    await waitFor(() => expect(writeText.mock.calls).toEqual([["id-1"], ["첫 줄\n둘째 줄"], ["다른 문단"]]));
    expect(calls.mock.calls.some(([request]) => request.op === "data.act")).toBe(false);
  } finally {
    Reflect.deleteProperty(navigator, "clipboard");
  }
});

it("keeps feed copy feedback with its entry when entries reorder", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    const entries = [
      { key: "first", meta: "id-1", body: "첫 내용" },
      { key: "second", meta: "id-2", body: "둘째 내용" },
    ];
    const { transport } = setup({ type: "feed", copy: true, entries: { expr: "$state.entries" } } as unknown as Block, { entries });
    const second = (await screen.findByText("둘째 내용")).closest("article")!;
    fireEvent.click(second.querySelector(".ks-feed-meta-copy button")!);
    await waitFor(() => expect(second.querySelector(".ks-feed-meta-copy .ks-feed-copy-control")?.classList.contains("is-feedback")).toBe(true));

    act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/entries": { status: "ready", value: [entries[1], entries[0]] } } } }));

    const movedSecond = screen.getByText("둘째 내용").closest("article")!;
    const movedFirst = screen.getByText("첫 내용").closest("article")!;
    expect(movedSecond.querySelector(".ks-feed-meta-copy .ks-feed-copy-control")?.classList.contains("is-feedback")).toBe(true);
    expect(movedFirst.querySelector(".ks-feed-meta-copy .ks-feed-copy-control")?.classList.contains("is-feedback")).toBe(false);
  } finally {
    Reflect.deleteProperty(navigator, "clipboard");
  }
});

it("does not add feed copy controls when copy is off", async () => {
  setup({ type: "feed", entries: [{ key: "a", meta: "id-1", body: "본문" }] });
  await screen.findByText("본문");
  expect(screen.queryByRole("button", { name: "복사" })).toBeNull();
  expect(document.querySelector(".ks-feed-copy-cell")).toBeNull();
});

it("does not select a feed entry with Enter while its text is selected", async () => {
  const { calls } = setup({ type: "feed", entries: [{ key: "a", name: "이름", body: "첫 줄" }], on_select: { set_state: "choice" } }, { choice: null });
  const text = await screen.findByText("첫 줄");
  const entry = text.closest("article")!;
  entry.focus();
  vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "첫" } as Selection);
  fireEvent.keyDown(entry, { key: "Enter" });
  expect(calls.mock.calls.some(([request]) => request.op === "data.act")).toBe(false);
  vi.mocked(window.getSelection).mockReturnValue(null);
  fireEvent.keyDown(entry, { key: "Enter" });
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", event: "a" })));
});
it("moves through grouped selectable feed entries with Tab and selects with Enter", async () => {
  const user = userEvent.setup();
  const { calls } = setup({ type: "feed", grouped: true, entries: [
    { title: "첫 묶음", items: [{ key: "a", body: "첫 내용" }] },
    { title: "다음 묶음", items: [{ key: "b", body: "둘째 내용" }] },
  ], selected: { state: "choice" }, on_select: { set_state: "choice" } }, { choice: "a" });
  const first = (await screen.findByText("첫 내용")).closest("article")!;
  const second = screen.getByText("둘째 내용").closest("article")!;
  const feed = first.closest(".ks-feed")!;
  expect(feed.getAttribute("role")).toBe("feed");
  expect(first.getAttribute("aria-current")).toBe("true");
  expect(feed.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  await user.tab();
  expect(document.activeElement).toBe(first);
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(second);
  await user.keyboard("{ArrowUp}");
  expect(document.activeElement).toBe(first);
  await user.keyboard("{ArrowDown}{Enter}");
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/on_select", event: "b", item: { key: "b", body: "둘째 내용" } })));
  const count = calls.mock.calls.filter(([request]) => request.op === "data.act").length;
  expect(fireEvent.keyDown(second, { key: " " })).toBe(true);
  expect(calls.mock.calls.filter(([request]) => request.op === "data.act")).toHaveLength(count);
});

it("keeps one feed keyboard entry point after a focused entry disappears", async () => {
  const entries = [{ key: "a", body: "첫 내용" }, { key: "b", body: "둘째 내용" }, { key: "c", body: "셋째 내용" }];
  const { transport } = setup({ type: "feed", entries: { expr: "$state.entries" }, selected: { state: "choice" }, on_select: { set_state: "choice" } }, { entries, choice: "c" });
  const second = (await screen.findByText("둘째 내용")).closest("article")!;
  const feed = second.closest(".ks-feed")!;
  second.focus();
  act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/entries": { status: "ready", value: [entries[2], entries[0], entries[1]] } } } }));
  expect(feed.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  expect(feed.querySelector('[tabindex="0"]')?.textContent).toContain("둘째 내용");
  act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/entries": { status: "ready", value: [entries[0], entries[2]] } } } }));
  expect(feed.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  expect(feed.querySelector('[tabindex="0"]')?.textContent).toContain("셋째 내용");
  act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/entries": { status: "ready", value: [entries[0]] } } } }));
  expect(feed.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  expect(feed.querySelector('[tabindex="0"]')?.textContent).toContain("첫 내용");
});

it("does not add tab stops to a feed without selection", async () => {
  setup({ type: "feed", entries: [{ key: "a", body: "읽기 전용" }] });
  const entry = (await screen.findByText("읽기 전용")).closest("article")!;
  expect(entry.hasAttribute("tabindex")).toBe(false);
});

it("shows each property binding status and its recovery action", async () => {
  const { transport, calls } = setup({ type: "properties", fields: [
    { label: "값", value: { expr: "$state.field" } },
  ] }, { field: "준비됨" });
  await screen.findByText("준비됨");
  act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: {
    sources: {}, values: { "/ui/fields/0/value": { status: "loading" } },
  } }));
  expect(screen.getByRole("status", { name: "불러오는 중" })).toBeTruthy();
  act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: {
    sources: {}, values: { "/ui/fields/0/value": { status: "failed", message: "불러오기 실패", retry: ["sample"] } },
  } }));
  fireEvent.click(screen.getByRole("button", { name: "다시 받기" }));
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.refresh", sources: ["sample"] })));
  act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: {
    sources: {}, values: { "/ui/fields/0/value": { status: "login_required", permission: "sample" } },
  } }));
  expect(screen.getByText("로그인이 필요합니다")).toBeTruthy();
  expect(screen.getByRole("button", { name: "로그인" })).toBeTruthy();
});

it("shows singleton objects in lists and select options", async () => {
  setup({ type: "stack", direction: "column", children: [
    { type: "list", items: { key: "one", title: "한 항목" } },
    { type: "select", options: { value: "one", label: "한 선택지" }, value: { state: "choice" }, on_change: { set_state: "choice" } },
  ] }, { choice: "one" });
  expect(await screen.findByRole("option", { name: "한 항목" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "한 선택지" })).toBeTruthy();
});

it("accepts singleton groups, rows, children, feed entries and badges", async () => {
  setup({ type: "stack", direction: "column", children: [
    { type: "list", grouped: true, items: { title: "작은 묶음", items: { key: "l", title: "목록 항목", badges: { text: "표식" } } } },
    { type: "table", columns: [{ field: "name", label: "표 제목" }], rows: { key: "r", name: "표 항목" } },
    { type: "tree", items: { key: "p", title: "상위", children: { key: "c", title: "하위" } } },
    { type: "feed", entries: { key: "f", body: "흐름 본문" } },
  ] });
  expect(await screen.findByText("목록 항목")).toBeTruthy();
  expect(screen.getByText("표식")).toBeTruthy();
  expect(screen.getByText("표 항목")).toBeTruthy();
  expect(screen.getByText("흐름 본문")).toBeTruthy();
  fireEvent.click(screen.getByRole("treeitem", { name: "상위" }));
  expect(screen.getByRole("treeitem", { name: "하위" })).toBeTruthy();
});

it.each(["list", "table", "tree"] as const)("keeps one keyboard entry point after a focused %s item disappears", async (type) => {
  const items = [{ key: "a", title: "첫째" }, { key: "b", title: "둘째" }, { key: "c", title: "셋째" }];
  const block: Block = type === "table"
    ? { type, rows: { expr: "$state.items" }, columns: [{ field: "title", label: "이름" }], selected: { state: "choice" } }
    : { type, items: { expr: "$state.items" }, selected: { state: "choice" } };
  const { transport } = setup(block, { items, choice: "c" });
  const role = type === "list" ? "option" : type === "table" ? "row" : "treeitem";
  const second = await screen.findByRole(role, { name: "둘째" });
  second.focus();
  const pointer = type === "table" ? "/ui/rows" : "/ui/items";
  const container = type === "tree" ? screen.getByRole("tree") : type === "table" ? screen.getByRole("table") : screen.getByRole("listbox");
  act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { [pointer]: { status: "ready", value: [items[2], items[0], items[1]] } } } }));
  expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  expect(container.querySelector('[tabindex="0"]')?.textContent).toContain("둘째");
  act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { [pointer]: { status: "ready", value: [items[0], items[2]] } } } }));
  const tabbable = container.querySelectorAll('[tabindex="0"]');
  expect(tabbable).toHaveLength(1);
  expect(tabbable[0].textContent).toContain("셋째");
  act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { [pointer]: { status: "ready", value: [items[0]] } } } }));
  const fallback = container.querySelectorAll('[tabindex="0"]');
  expect(fallback).toHaveLength(1);
  expect(fallback[0].textContent).toContain("첫째");
});

it.each(["path", "children"] as const)("skips malformed tree items in %s mode", async (by) => {
  const entries: JsonValue[] = [
    { key: "good", title: "정상", path: "정상" },
    { key: "bad-path", path: 123 },
    { key: "bad-title", path: "가짜", title: {} },
    { key: "bad-meta", path: "숨김", title: "잘못된 메타", meta: {} },
    { key: "bad-children", path: "숨김2", title: "잘못된 자식", children: 42 },
    { key: "bad-badge", path: "숨김3", title: "잘못된 배지", badges: { text: "표식", color: 12 } },
  ];
  setup({ type: "tree", by, items: entries });
  expect(await screen.findByRole("treeitem", { name: "정상" })).toBeTruthy();
  expect(screen.getAllByRole("treeitem")).toHaveLength(1);
});

it("uses a selected child as the tree entry point when items arrive later", async () => {
  const { transport } = setup({ type: "tree", items: { expr: "$state.items" }, selected: { state: "choice" } }, { items: [], choice: "child" });
  await screen.findByText("없음");
  act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: {
    "/ui/items": { status: "ready", value: [{ key: "parent", title: "상위", children: [{ key: "child", title: "선택한 하위" }] }] },
  } } }));
  const selected = await screen.findByRole("treeitem", { name: "선택한 하위" });
  expect(selected.tabIndex).toBe(0);
});
