import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { mockVirtualLayout } from "./virtual-layout";
import { makeTestSeed } from "./fixtures";

// 가상 목록은 줄 자리 번호를 줄 키에 넣으므로 위에 행이 끼면 아래 행이 새로 그려진다.
// 초점을 쥔 행이 같은 키로 다시 그려지면 그 행에 남고, 찾기 칸이나 대화상자 단추로 가지 않는다.
beforeEach(mockVirtualLayout);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const before = [{ key: "a", title: "Alpha" }, { key: "b", title: "Beta" }];
const after = [{ key: "n", title: "New" }, ...before];

function setup(inDialog: boolean) {
  const list = { type: "list", items: { state: "items" }, on_select: { set_state: "chosen" } };
  const search = { type: "input", label: "찾기", value: { state: "query" }, on_change: { set_state: "query" } };
  const ui = (inDialog
    ? { type: "stack", direction: "column", children: [search, { type: "dialog", open: true, title: "고르기", close_label: "닫기", child: list, on_close: { set_state: "chosen" } }] }
    : { type: "stack", direction: "column", children: [search, list] }) as unknown as Block;
  const definition: AppDefinition = { id: "row-redraw", name: "행 다시 그림", requires: { blocks: 20, modules: {} }, permissions: [], state: { items: before, query: "", chosen: null }, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = definition.state ?? {};
  const store = createShellStore(createFakeTransport(seed));
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  return store;
}

for (const inDialog of [false, true]) {
  it(`초점 쥔 행 위에 행이 끼면 다시 그려진 같은 행에 남는다: ${inDialog ? "대화상자 안 목록" : "본문 목록"}`, async () => {
    const store = setup(inDialog);
    const scope = inDialog ? within(await screen.findByRole("dialog")) : screen;
    const beta = await scope.findByRole("option", { name: "Beta" });
    beta.focus();
    await act(async () => { await store.call({ op: "window.set_state", window_id: "viewer-window", state: { items: after, query: "", chosen: null } }); });
    await waitFor(() => expect(scope.getByRole("option", { name: "New" })).toBeTruthy());
    // 바뀐 자리의 행은 새 요소다. 같은 요소가 남았다면 이 시험은 아무것도 재지 않는다.
    expect(beta.isConnected).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(scope.getByRole("option", { name: "Beta" })));
  });
}
