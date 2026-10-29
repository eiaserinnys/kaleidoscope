import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
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
