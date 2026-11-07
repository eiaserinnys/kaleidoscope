import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, CoreRequest } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function progressDefinition(): AppDefinition {
  return {
    id: "dialog-progress", name: "대화상자 진행", requires: { blocks: 19, modules: {} }, permissions: [],
    state: { open: false, draft: "보존" },
    ui: { type: "stack", direction: "column", children: [
      { type: "button", label: "열기", on_click: [{ set_state: "open", value: true }] },
      {
        type: "dialog", open: { state: "open" }, title: "저장 확인", close_label: "저장", cancel_label: "취소",
        child: { type: "input", value: { state: "draft" }, on_change: { set_state: "draft" } },
        on_confirm: [{ set_state: "open", value: false }],
        on_close: [{ set_state: "open", value: false }],
      },
    ] },
  };
}

const sleep = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

async function openDialog(confirm: (request: CoreRequest & { op: "data.act" }) => Promise<unknown>) {
  const transport = createFakeTransport(makeTestSeed({ definitions: [progressDefinition()] }));
  const original = transport.call.bind(transport);
  const calls: string[] = [];
  vi.spyOn(transport, "call").mockImplementation((async (request: CoreRequest) => {
    calls.push(request.op);
    if (request.op === "data.act" && request.pointer.endsWith("/on_confirm")) return await confirm(request as CoreRequest & { op: "data.act" }) as never;
    return original(request as never) as never;
  }) as typeof transport.call);
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  const opener = await screen.findByRole("button", { name: "열기" });
  fireEvent.click(opener);
  const dialog = await screen.findByRole("dialog");
  const confirmButton = within(dialog).getByRole("button", { name: "저장" });
  const cancelButton = within(dialog).getByRole("button", { name: "취소" });
  return { transport, store, dialog, confirmButton, cancelButton, calls };
}

it("빠른 확정 응답에는 진행 표시가 뜨지 않는다", async () => {
  const view = await openDialog(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { op: "data.act", sequence: 1 };
  });
  fireEvent.click(view.confirmButton);
  await sleep(150);
  expect(view.confirmButton.getAttribute("aria-busy")).toBeNull();
  expect(view.confirmButton.querySelector(".ks-button-progress")).toBeNull();
  expect(view.cancelButton.hasAttribute("disabled")).toBe(false);
  await sleep(200);
  expect(view.confirmButton.getAttribute("aria-busy")).toBeNull();
  expect(view.confirmButton.querySelector(".ks-button-progress")).toBeNull();
  view.store.dispose();
});

it("지난 실패를 다시 보내면 250ms를 기다리지 않고 바로 진행을 보이고 400ms 넘게 유지한다", async () => {
  let confirms = 0;
  const view = await openDialog(async () => {
    confirms += 1;
    await new Promise((resolve) => setTimeout(resolve, 60));
    throw new Error("저장하지 못했습니다");
  });
  view.confirmButton.focus();
  fireEvent.click(view.confirmButton);
  await sleep(120);
  // 첫 실패는 빠르게 끝나므로 재시도가 아니면 진행을 보이지 않는다.
  expect(view.confirmButton.getAttribute("aria-busy")).toBeNull();
  await screen.findByText(/저장하지 못했습니다/);
  await waitFor(() => expect(view.confirmButton.getAttribute("aria-disabled")).toBeNull(), { timeout: 3000 });
  expect(confirms).toBe(1);

  const started = Date.now();
  fireEvent.click(view.confirmButton);
  // 다시 보내는 순간 화면을 바꾸지 않고 바로 진행을 보인다.
  expect(view.confirmButton.getAttribute("aria-busy")).toBe("true");
  expect(view.confirmButton.getAttribute("aria-disabled")).toBe("true");
  expect(view.confirmButton.querySelector(".ks-button-progress")).not.toBeNull();
  expect(document.activeElement).toBe(view.confirmButton);
  await sleep(250);
  expect(view.confirmButton.getAttribute("aria-busy")).toBe("true");
  await waitFor(() => expect(view.confirmButton.getAttribute("aria-busy")).toBeNull(), { timeout: 3000 });
  expect(Date.now() - started).toBeGreaterThanOrEqual(390);
  expect(confirms).toBe(2);
  expect(screen.getByRole("dialog")).toBe(view.dialog);
  view.store.dispose();
});

it("느린 확정 응답은 250ms 뒤에 진행을 보이고 400ms 넘게 보이며 그동안 Escape로 닫히지 않는다", async () => {
  const view = await openDialog(async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    return { op: "data.act", sequence: 1 };
  });
  fireEvent.click(view.confirmButton);
  await sleep(120);
  expect(view.confirmButton.getAttribute("aria-busy")).toBeNull();
  await sleep(230);
  expect(view.confirmButton.getAttribute("aria-busy")).toBe("true");
  expect(view.confirmButton.querySelector(".ks-button-progress")).not.toBeNull();
  expect(view.cancelButton.getAttribute("aria-disabled")).toBe("true");
  expect(view.confirmButton.getAttribute("aria-disabled")).toBe("true");
  expect(view.cancelButton.hasAttribute("disabled")).toBe(false);
  expect(view.confirmButton.hasAttribute("disabled")).toBe(false);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBe(view.dialog);
  await sleep(250);
  expect(view.confirmButton.getAttribute("aria-busy")).toBe("true");
  await sleep(200);
  expect(view.confirmButton.getAttribute("aria-busy")).toBeNull();
  expect(view.confirmButton.querySelector(".ks-button-progress")).toBeNull();
  expect(view.cancelButton.hasAttribute("disabled")).toBe(false);
  view.store.dispose();
});

it("대화상자를 먼저 닫으면 다음에 열 때 진행 표시가 남지 않는다", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const view = await openDialog(async () => { await gate; return { op: "data.act", sequence: 1 }; });
  fireEvent.click(view.confirmButton);
  await sleep(60);
  expect(view.cancelButton.hasAttribute("disabled")).toBe(false);
  fireEvent.click(view.cancelButton);
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "열기" }));
  const reopened = await screen.findByRole("dialog");
  const confirm = within(reopened).getByRole("button", { name: "저장" });
  await sleep(320);
  expect(confirm.getAttribute("aria-busy")).toBeNull();
  expect(confirm.querySelector(".ks-button-progress")).toBeNull();
  release();
  await sleep(120);
  expect(screen.getByRole("dialog")).toBe(reopened);
  expect(confirm.getAttribute("aria-busy")).toBeNull();
  view.store.dispose();
});

it("진행 중에도 초점은 저장 단추에 남고 Enter와 누름은 요청을 더 보내지 않는다", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let confirms = 0;
  const view = await openDialog(async () => { confirms += 1; await gate; return { op: "data.act", sequence: 1 }; });
  view.confirmButton.focus();
  fireEvent.click(view.confirmButton);
  await sleep(300);
  expect(view.confirmButton.getAttribute("aria-busy")).toBe("true");
  expect(view.confirmButton.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(view.confirmButton);
  fireEvent.click(view.confirmButton);
  await userEvent.keyboard("{Enter}");
  await sleep(60);
  expect(confirms).toBe(1);
  release();
  await sleep(500);
  expect(view.confirmButton.getAttribute("aria-busy")).toBeNull();
  expect(document.activeElement).toBe(view.confirmButton);
  view.store.dispose();
});

it("느린 실패 뒤에도 초점은 저장 단추에 남고 Enter로 다시 보낸다", async () => {
  let confirms = 0;
  const view = await openDialog(async () => {
    confirms += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    throw new Error("저장하지 못했습니다");
  });
  view.confirmButton.focus();
  fireEvent.click(view.confirmButton);
  await screen.findByText(/저장하지 못했습니다/);
  await waitFor(() => expect(view.confirmButton.getAttribute("aria-disabled")).toBeNull(), { timeout: 3000 });
  expect(confirms).toBe(1);
  expect(document.activeElement).toBe(view.confirmButton);
  expect(screen.getByRole("dialog")).toBe(view.dialog);
  await userEvent.keyboard("{Enter}");
  await waitFor(() => expect(confirms).toBe(2), { timeout: 2000 });
  await sleep(700);
  view.store.dispose();
});

it("진행이 끝나도 다른 곳의 초점을 가져오지 않는다", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const view = await openDialog(async () => { await gate; throw new Error("저장하지 못했습니다"); });
  const outside = document.createElement("button");
  outside.textContent = "바깥";
  document.body.appendChild(outside);
  view.confirmButton.focus();
  fireEvent.click(view.confirmButton);
  outside.focus();
  await sleep(300);
  release();
  await sleep(500);
  expect(screen.getByRole("dialog")).toBe(view.dialog);
  expect(document.activeElement).toBe(outside);
  outside.remove();
  view.store.dispose();
});
