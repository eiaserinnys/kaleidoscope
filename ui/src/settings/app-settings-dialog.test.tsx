import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { Dialog } from "../components/dialog";
import type { AppDefinition } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import * as renderer from "../render/render-block";
import { makeTestSeed } from "../__tests__/fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// 가짜 코어는 설정 트리의 동작을 실행하지 않아, 실제 Dialog를 렌더하는 설정 트리로 대체한다.
function SettingsFixture() {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const host = root.current?.closest<HTMLElement>(".ks-data-window");
  return <div ref={root}>
    <button onClick={() => setOpen(true)}>설정 변경</button>
    {open && host ? <Dialog host={host} ownerAnchor={root.current} title="변경 확인" body="바꿀까요?" ok="바꾸기" onCancel={() => setOpen(false)} onConfirm={() => setOpen(false)} /> : null}
  </div>;
}

async function setup() {
  const definition: AppDefinition = {
    id: "settings-dialog", name: "설정 확인", requires: { blocks: 19, modules: {} }, permissions: [],
    state: { open: false }, ui: { type: "text", value: "본문" },
    settings: { ui: { type: "stack", direction: "column", children: [
      { type: "button", label: "설정 변경", on_click: [{ set_state: "open", value: true }] },
      { type: "dialog", open: { state: "open" }, title: "변경 확인", close_label: "바꾸기", child: { type: "text", value: "바꿀까요?" },
        on_confirm: [{ set_state: "open", value: false }], on_close: [{ set_state: "open", value: false }] },
    ] } },
  };
  const renderBlock = renderer.renderBlock;
  vi.spyOn(renderer, "renderBlock").mockImplementation((block, context, pointer) =>
    pointer === "/settings/ui" ? <SettingsFixture /> : renderBlock(block, context, pointer));
  const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
  const onSettingsClose = vi.fn();
  render(<AppWindowContent store={store} windowId="viewer-window" settingsOpen settingsVisited onSettingsClose={onSettingsClose} />);
  const opener = await screen.findByRole("button", { name: "설정 변경" });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole("dialog", { name: "변경 확인" });
  return { store, onSettingsClose, opener, dialog };
}

it("설정의 확인창에서 Esc는 확인창만 닫고 연 단추로 초점을 돌린다", async () => {
  const view = await setup();
  fireEvent.keyDown(within(view.dialog).getByRole("button", { name: "취소" }), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "변경 확인" })).toBeNull());
  expect(view.onSettingsClose).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(view.opener));
  fireEvent.keyDown(view.opener, { key: "Escape" });
  expect(view.onSettingsClose).toHaveBeenCalledTimes(1);
  view.store.dispose();
});

it("설정의 확인창에서 Enter로 취소하면 연 단추로 초점을 돌린다", async () => {
  const user = userEvent.setup();
  const view = await setup();
  expect(document.activeElement).toBe(within(view.dialog).getByRole("button", { name: "취소" }));
  await user.keyboard("{Enter}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "변경 확인" })).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(view.opener));
  expect(view.onSettingsClose).not.toHaveBeenCalled();
  view.store.dispose();
});
