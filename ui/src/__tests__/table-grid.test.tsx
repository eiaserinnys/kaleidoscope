import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { mockVirtualLayout } from "./virtual-layout";
import { makeTestSeed, mdViewerDefinition } from "./fixtures";

beforeEach(mockVirtualLayout);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(ui: Block, state: AppDefinition["state"]) {
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 23, modules: {} }, permissions: [], state, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...state };
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  return { calls, transport };
}

it("빈 칸으로 이동할 때는 초점만 바꾸고 Enter로 주소와 행을 고른다", async () => {
  const row = { key: "a", label: "제작", mon: { title: "첫 검토", subtitle: "본문", badges: ["확인"] }, tue: null };
  const ui = { type: "table", rows: [row], columns: [
    { field: "label", label: "항목" }, { field: "mon", label: "월요일", format: "content" },
    { field: "tue", label: "화요일", format: "content" },
  ], selection: "cell", row_header: "label", selected: { state: "chosen" }, on_select: { set_state: "chosen" } } as unknown as Block;
  const { calls } = setup(ui, { chosen: null });
  const first = await screen.findByRole("gridcell", { name: /제작.*월요일.*첫 검토/ });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowRight" });
  expect(document.activeElement?.getAttribute("aria-label")).toMatch(/제작.*화요일.*빈 칸/);
  expect(calls.mock.calls.some(([request]) => request.op === "data.act")).toBe(false);
  fireEvent.keyDown(document.activeElement!, { key: "Enter" });
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", event: { row: "a", column: "tue" }, item: row })));
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

it("칸의 색, 제목, 본문과 단일 배지를 표시하고 잘못된 칸만 오류로 둔다", async () => {
  const ui = { type: "table", rows: [{ key: "a", label: "기획", good: { title: "첫 회의", subtitle: "의제를 확인한다", color: "#abc", badges: "확인" }, bad: ["잘못된 값"] }], columns: [{ field: "label", label: "항목" }, { field: "good", label: "월요일", format: "content", max_lines: 2 }, { field: "bad", label: "화요일", format: "content" }], selection: "cell", row_header: "label", selected: { state: "chosen" }, on_select: { set_state: "chosen" } } as unknown as Block;
  setup(ui, { chosen: null });
  expect(await screen.findByText("첫 회의")).toBeTruthy();
  expect(screen.getByText("의제를 확인한다")).toBeTruthy();
  expect(screen.getByText("확인")).toBeTruthy();
  expect(screen.getByText("SHELL_TABLE_CELL_CONTENT_INVALID")).toBeTruthy();
});
