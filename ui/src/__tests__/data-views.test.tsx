import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block, Column } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { TableView } from "../blocks/data-table";
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
function setup(ui: Block, state: AppDefinition["state"] = {}, blocks = 4, media?: Record<string, string>) {
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks, modules: {} }, permissions: [], state, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...state };
  const transport = createFakeTransport({ ...seed, media });
  const calls = vi.spyOn(transport, "call");
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  return { calls, transport };
}
it.each(["rows", "grid", "icons"] as const)("%s의 SVG는 아이콘 배치에서만 테마색으로 칠한다", async (layout) => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 32, 32));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor"><path d="M0 0h24"/></svg>';
  setup({ type: "list", layout, items: [{ key: "a", title: "단색 앱", image: { asset: "logo" } }] }, {}, 30,
    { logo: `data:image/svg+xml;base64,${btoa(svg)}` });
  const row = await screen.findByRole("option", { name: "단색 앱" });
  await waitFor(() => expect(row.querySelector(layout === "icons" ? "span.ks-app-icon" : "img")).not.toBeNull());
  if (layout === "icons") expect((row.querySelector(".ks-app-icon") as HTMLElement).style.mask).toContain("data:image/svg+xml");
});
it.each(["list", "grid"] as const)("%s 목록은 배지와 날짜의 순서를 유지한다", async (layout) => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  setup({ type: "list", ...(layout === "grid" ? { layout } : {}), items: [{ key: "a", title: "항목", meta: "날짜", badges: [{ text: "표식" }] }] });
  const row = await screen.findByRole("option", { name: "항목" });
  const text = row.textContent ?? "";
  expect(text.indexOf("표식") < text.indexOf("날짜")).toBe(layout === "list");
  vi.unstubAllGlobals();
});
it("아이콘 목록은 이름만 보이고 선택할 때 원래 항목을 보낸다", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const item = { key: "a", title: "계산기 플러스", subtitle: "설명", meta: "날짜", color: "#abcdef", badges: [{ text: "표식" }] };
  const { calls } = setup({ type: "list", layout: "icons", items: [item], on_select: { set_state: "choice" } } as unknown as Block, { choice: null });
  const tile = await screen.findByRole("option", { name: item.title });
  expect(tile.classList.contains("ks-icon-tile")).toBe(true);
  expect(tile.querySelector(".lucide-layout-grid")).not.toBeNull();
  expect(tile.textContent).toBe(item.title);
  fireEvent.click(tile);
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", event: "a", item })));
  vi.unstubAllGlobals();
});
it.each([[360, 6], [1000, 18]])("%i 폭의 초기 아이콘 뼈대는 두 줄과 한 줄 이름을 쓴다", async (width, count) => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  const { transport } = setup({ type: "list", layout: "icons", items: { expr: "[]" } });
  await screen.findByText("없음", { exact: true });
  await act(async () => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/items": { status: "loading" } } } }));
  const loading = await screen.findByRole("status", { name: "불러오는 중" });
  expect(loading.querySelectorAll(".ks-icon-tile-skeleton")).toHaveLength(count);
  for (const name of loading.querySelectorAll(".ks-icon-skeleton-name")) expect(name.children).toHaveLength(1);
  vi.unstubAllGlobals();
});
it("moves through grouped list entries and selects the focused item", async () => {
  const { calls } = setup({ type: "list", grouped: true, items: [{ title: "묶음", items: [{ key: "a", title: "하나" }, { key: "b", title: "둘" }] }], on_select: { set_state: "choice" } }, { choice: null });
  const first = await screen.findByRole("option", { name: "하나" });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement?.textContent).toContain("둘");
  fireEvent.keyDown(document.activeElement!, { key: "Enter" });
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/on_select", event: "b", item: { key: "b", title: "둘" } })));
});
it.each(["rows", "icons"] as const)("%s 묶음은 상태와 선언된 동작을 항목 사이에 보인다", async (layout) => {
  const failed = { key: "second", title: "둘째", items: [], status: { state: "error", message: "자료에 닿을 수 없습니다", code: "SOURCE_FAILED" }, action: "retry", address: "local" };
  const { calls } = setup({ type: "list", layout, grouped: true, items: [
    { key: "first", title: "첫째", items: [{ key: "one", title: "항목" }] }, failed,
    { key: "third", title: "셋째", items: [], status: { state: "empty", message: "비어 있습니다" } },
  ], group_actions: [{ key: "retry", label: "다시 받기", on_click: [{ set_state: "choice", value: { expr: "$item.address" } }] }] } as unknown as Block, { choice: null }, 43);
  expect(await screen.findByText("자료에 닿을 수 없습니다")).toBeTruthy();
  expect(screen.getByText("SOURCE_FAILED")).toBeTruthy();
  expect(screen.getByText("비어 있습니다")).toBeTruthy();
  const button = screen.getByRole("button", { name: "다시 받기" });
  expect(button.tabIndex).toBe(0);
  fireEvent.click(button);
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/group_actions/0/on_click", event: "retry", item: failed })));
});
it("항목이 없는 상태 묶음은 남고 알 수 없는 동작은 실행되지 않는다", async () => {
  setup({ type: "list", grouped: true, items: [{ title: "이전 빈 묶음", items: [] }, { title: "빈 묶음", items: [], status: { state: "empty", message: "자료 없음" }, action: "unknown" }], group_actions: [] } as unknown as Block, {}, 43);
  expect(await screen.findByText("빈 묶음")).toBeTruthy();
  expect(screen.queryByText("이전 빈 묶음")).toBeNull();
  expect(screen.getByText("자료 없음")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
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
it("sizes narrow numeric and fill columns to their content", async () => {
  setup({
    type: "table",
    rows: [{ key: "short", comments: 3, title: "짧은 이야기" }, { key: "long", comments: 12345678, title: "긴 이야기" }],
    columns: [
      { field: "comments", label: "댓글", width: "narrow", format: "number" },
      { field: "title", label: "이야기" },
    ],
  });
  const table = await screen.findByRole("table");
  const columns = table.style.getPropertyValue("--ks-table-columns");
  const longestValue = Array.from(new Intl.NumberFormat().format(12345678)).length;
  expect(columns).toContain(`calc(${longestValue} * var(--ks-type-body) * 0.6 + 2 * var(--ks-space-2))`);
  expect(columns).toContain("calc(2 * var(--ks-type-body) + 2 * var(--ks-space-2))");
  expect(columns).toContain("minmax(calc(var(--ks-space-6) * 2), 1fr)");
});
it("does not measure column widths again when the same rows are rendered", () => {
  let reads = 0;
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    key: String(i),
    get count() { if (i === 999) reads += 1; return i; },
  }));
  const columns: Column[] = [{ field: "count", label: "개수", format: "number", width: "narrow" }];
  const choose = () => {};
  const { rerender } = render(<TableView columns={columns} rows={rows} selected={null} onChoose={choose} />);
  expect(reads).toBeGreaterThan(0);
  const initialReads = reads;
  rerender(<TableView columns={columns} rows={rows} selected="0" onChoose={choose} />);
  expect(reads).toBe(initialReads);
});
it("omits empty properties and renders formatted values", async () => {
  setup({ type: "properties", fields: [{ label: "빈 값", value: null }, { label: "코드", value: "hello", format: "code" }, { label: "배지", value: "진행", format: "badge" }] });
  expect(await screen.findByText("hello")).toBeTruthy();
  expect(screen.getByText("진행")).toBeTruthy();
  expect(screen.queryByText("빈 값")).toBeNull();
});
it("resolves property label bindings and shows valid color swatches in rows", async () => {
  setup({ type: "properties", layout: "rows", fields: [
    { label: { state: "palette_label" }, value: { state: "colors" }, format: "swatches" },
  ] }, { palette_label: "팔레트", colors: ["#abc", "#123456", "red", 3] }, 19);
  const label = await screen.findByText("팔레트");
  const properties = label.closest("dl")!;
  expect(properties.classList.contains("is-rows")).toBe(true);
  expect(within(properties).getAllByRole("img")).toHaveLength(2);
  expect(within(properties).getByRole("img", { name: "#abc" }).getAttribute("title")).toBe("#abc");
  expect(within(properties).getByRole("img", { name: "#123456" }).getAttribute("title")).toBe("#123456");
  expect(within(properties).queryByText("red")).toBeNull();
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
it("selects data parents while toggling their children", async () => {
  const parent = { key: "parent", title: "상위", children: [{ key: "child", title: "하위" }] };
  const { calls } = setup({ type: "tree", by: "children", items: [parent], selected: { state: "choice" }, on_select: { set_state: "choice" } }, { choice: "parent" });
  const row = await screen.findByRole("treeitem", { name: "상위" });
  expect(row.getAttribute("aria-selected")).toBe("true");
  expect(row.classList.contains("is-selected")).toBe(true);

  fireEvent.click(row);
  expect(row.getAttribute("aria-expanded")).toBe("true");
  expect(await screen.findByRole("treeitem", { name: "하위" })).toBeTruthy();
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/on_select", event: "parent", item: parent })));

  fireEvent.click(row);
  expect(row.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("treeitem", { name: "하위" })).toBeNull();
  expect(row.getAttribute("aria-selected")).toBe("true");
});
it("opens ancestors when the selected data tree item changes", async () => {
  const { transport } = setup({ type: "tree", by: "children", items: [{ key: "parent", title: "상위", children: [{ key: "child", title: "하위" }] }], selected: { state: "choice" } }, { choice: null });
  expect(await screen.findByRole("treeitem", { name: "상위" })).toBeTruthy();
  await act(async () => { await transport.call({ op: "window.set_state", window_id: "viewer-window", state: { choice: "child" } }); });
  const child = await screen.findByRole("treeitem", { name: "하위" });
  expect(child).toBeTruthy();
});
it("only toggles virtual path folders without selecting them", async () => {
  const { calls } = setup({ type: "tree", by: "path", items: [{ key: "item", path: "폴더/항목" }], selected: { state: "choice" }, on_select: { set_state: "choice" } }, { choice: null });
  const folder = await screen.findByRole("treeitem", { name: "폴더" });
  fireEvent.click(folder);
  expect(folder.getAttribute("aria-expanded")).toBe("true");
  expect(folder.classList.contains("is-selected")).toBe(false);
  expect(await screen.findByRole("treeitem", { name: "항목" })).toBeTruthy();
  expect(calls.mock.calls.some(([request]) => request.op === "data.act")).toBe(false);
  fireEvent.click(folder);
  expect(folder.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("treeitem", { name: "항목" })).toBeNull();
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
    type: "feed", collapsible: true, copy: true, entries: [{
      key: "root", name: "작성자", meta: "시각", badges: [{ text: "인기", color: "#4c8bf5" }], body: "부모 본문",
      children: [{ key: "reply", name: "답글 작성자", body: "자식 본문", children: [{ key: "deep", body: "깊은 답글" }] }],
    }],
  } as unknown as Block);
  const reply = await screen.findByText("자식 본문");
  const root = screen.getByText("부모 본문").closest("article")!;
  expect(root.getAttribute("data-depth")).toBe("0");
  expect(reply.closest("article")?.getAttribute("data-depth")).toBe("1");
  expect(screen.getByText("인기")).not.toBeNull();
  expect(within(root).getByText("답글 2")).not.toBeNull();
  expect(within(root).getAllByRole("button", { name: "복사" })).toHaveLength(2);
  fireEvent.click(within(root).getByRole("button", { name: "답글 2개 접기" }));
  expect(root.classList.contains("is-collapsed")).toBe(true);
  expect(within(root).getByText("답글 2개 접힘")).not.toBeNull();
  expect(within(root).queryByRole("button", { name: "복사" })).toBeNull();
  expect(screen.queryByText("자식 본문")).toBeNull();
  expect(screen.queryByText("깊은 답글")).toBeNull();
  fireEvent.click(within(root).getByRole("button", { name: "답글 2개 펴기" }));
  expect(await screen.findByText("깊은 답글")).not.toBeNull();
});

it("counts descendants across flat feed entries that carry depth", async () => {
  setup({
    type: "feed", entries: [
      { key: "flat-root", depth: 0, body: "평탄한 부모" },
      { key: "flat-reply", depth: 1, body: "평탄한 답글" },
      { key: "flat-deep", depth: 2, body: "평탄한 깊은 답글" },
    ],
  } as unknown as Block);
  const root = await screen.findByText("평탄한 부모");
  const article = root.closest("article")!;
  expect(within(article).getByRole("button", { name: "답글 2개 접기" })).not.toBeNull();
  fireEvent.click(within(article).getByRole("button", { name: "답글 2개 접기" }));
  expect(screen.queryByText("평탄한 답글")).toBeNull();
  expect(screen.queryByText("평탄한 깊은 답글")).toBeNull();
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

it("allows the keyboard to reach a feed without selection for its item menu", async () => {
  setup({ type: "feed", entries: [{ key: "a", body: "읽기 전용" }] });
  const entry = (await screen.findByText("읽기 전용")).closest("article")!;
  expect(entry.getAttribute("tabindex")).toBe("0");
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

it("속성 배지는 잘린 동안만 초점을 받고 묶음의 폭 변화로 다시 판단한다", async () => {
  let width = 100;
  let resize = () => {};
  let groups = 0;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("ks-badge") ? width : 600;
  });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.textContent === "짧은 권한" ? 60 : 160;
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: () => void) {}
    observe(element: HTMLElement) { if (element.classList.contains("ks-view-badges")) { groups++; resize = this.callback; } }
    unobserve() {}
    disconnect() {}
  });
  try {
    setup({ type: "properties", fields: [{ label: "권한", format: "badge", value: ["짧은 권한", "긴 권한 전체 이름"] }] });
    const short = await screen.findByText("짧은 권한");
    const long = screen.getByText("긴 권한 전체 이름");
    expect(short.hasAttribute("tabindex")).toBe(false);
    expect(long.getAttribute("tabindex")).toBe("0");
    expect(groups).toBe(1);
    width = 200;
    act(() => resize());
    expect(screen.getByText("긴 권한 전체 이름").hasAttribute("tabindex")).toBe(false);
    width = 100;
    act(() => resize());
    expect(screen.getByText("긴 권한 전체 이름").getAttribute("tabindex")).toBe("0");
    expect(groups).toBe(1);
  } finally { vi.unstubAllGlobals(); }
});
