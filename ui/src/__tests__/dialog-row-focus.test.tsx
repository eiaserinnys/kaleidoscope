import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { ContextMenuHost } from "../components/context-menu";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { mockVirtualLayout } from "./virtual-layout";
import { makeTestSeed, mdViewerDefinition } from "./fixtures";

// 행 메뉴가 앱의 대화상자 블록을 열고, 그 확정 동작이 행을 지우는 경우의 초점(행 메뉴의 confirm과 같은 규칙).
beforeEach(mockVirtualLayout);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const rows = ["가", "나", "다"].map((title) => ({ key: title, title }));

function setup(onConfirm: unknown) {
  const ui = { type: "stack", direction: "column", children: [
    { type: "input", kind: "search", label: "찾기", value: { state: "query" }, on_change: { set_state: "query" } },
    { type: "button", label: "열기", on_click: [{ set_state: "open", value: true }] },
    { type: "list", items: { state: "rows" }, item_menu: [{ label: "지우기", on_select: [{ set_state: "target", value: { expr: "$event" } }, { set_state: "open", value: true }] }] },
    { type: "dialog", open: { state: "open" }, title: "지울까요?", close_label: "지우기", child: { type: "text", value: "되돌릴 수 없습니다" },
      on_close: [{ set_state: "open", value: false }], on_confirm: onConfirm },
  ] } as unknown as Block;
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 20, modules: {} }, permissions: [], state: { query: "", open: false, target: null, rows }, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = definition.state ?? {};
  render(<><ContextMenuHost /><AppWindowContent store={createShellStore(createFakeTransport(seed))} windowId="viewer-window" /></>);
}

async function confirmFromRow(name: string) {
  fireEvent.contextMenu(await screen.findByRole("option", { name }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "지우기" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "지우기" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

it("확정 동작과 함께 행이 지워지면 같은 자리 행, 마지막이면 앞 행으로 돌아간다", async () => {
  setup([{ set_state: "rows", value: { expr: "[$state.rows[key != $state.target]]" } }, { set_state: "open", value: false }]);
  for (const [target, next] of [["나", "다"], ["다", "가"]]) {
    await confirmFromRow(target);
    await waitFor(() => expect(screen.queryByRole("option", { name: target })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("option", { name: next })));
  }
  expect(document.activeElement).not.toBe(screen.getByRole("textbox", { name: "찾기" }));
});

for (const mode of ["복구", "사용자 초점"] as const) {
  it(`확인창이 닫힌 뒤 늦게 사라지는 행: ${mode}`, async () => {
    // 앱이 확인창을 먼저 닫고 행은 다음 상태 이벤트에서 지우는 경우다.
    setup([{ set_state: "open", value: false }]);
    await confirmFromRow("나");
    const target = screen.getByRole("option", { name: "나" });
    const next = screen.getByRole("option", { name: "다" });
    await waitFor(() => expect(document.activeElement).toBe(target));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const search = screen.getByRole("textbox", { name: "찾기" });
    if (mode === "사용자 초점") search.focus();
    next.dataset.focusIndex = "1";
    target.remove();
    if (mode === "복구") await waitFor(() => expect(document.activeElement).toBe(next));
    else {
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(document.activeElement).toBe(search);
    }
  });
}

it("행이 아닌 단추에서 연 확인창은 확정 뒤 그 단추로 돌아가고 그대로 머문다", async () => {
  setup([{ set_state: "open", value: false }]);
  const opener = await screen.findByRole("button", { name: "열기" });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "지우기" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(opener));
  screen.getByRole("option", { name: "나" }).remove();
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(document.activeElement).toBe(opener);
});
