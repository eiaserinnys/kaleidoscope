import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed } from "./fixtures";

afterEach(cleanup);

function dialogApp(child: Block): AppDefinition {
  return {
    id: "dialog-picker", name: "대화상자 고르기", requires: { blocks: 30, modules: {} }, permissions: [], state: {},
    ui: { type: "stack", direction: "column", children: [
      { type: "dialog", open: true, title: "고르기", on_close: [], child },
    ] },
  };
}

async function overlayFor(child: Block) {
  const transport = createFakeTransport(makeTestSeed({ definitions: [dialogApp(child)] }));
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  await screen.findByRole("dialog");
  const overlay = document.querySelector(".ks-dialog-overlay");
  return { overlay, store };
}

const rowList: Block = { type: "list", layout: "rows", items: [{ key: "a", title: "첫 줄" }, { key: "b", title: "둘째 줄" }] };

it("쌓기의 fill 칸에 둔 줄 목록 대화상자는 창을 채운다", async () => {
  const view = await overlayFor({ type: "stack", direction: "column", fill: 1, children: [{ type: "text", value: "머리" }, rowList] });
  expect(view.overlay?.classList.contains("is-picker")).toBe(true);
  expect(screen.getByText("첫 줄")).toBeTruthy();
  view.store.dispose();
});

it("fill을 생략한 쌓기의 마지막 줄 목록도 채움 칸으로 본다", async () => {
  const view = await overlayFor({ type: "stack", direction: "column", children: [{ type: "toolbar", start: [] }, rowList] });
  expect(view.overlay?.classList.contains("is-picker")).toBe(true);
  view.store.dispose();
});

it("fill이 아닌 줄 목록 대화상자는 내용 크기를 지킨다", async () => {
  const view = await overlayFor({ type: "stack", direction: "column", children: [rowList, { type: "button", label: "닫기", on_click: [] }] });
  expect(view.overlay?.classList.contains("is-picker")).toBe(false);
  view.store.dispose();
});
