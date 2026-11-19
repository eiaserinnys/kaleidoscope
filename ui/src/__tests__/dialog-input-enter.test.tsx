import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block, CoreRequest } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed } from "./fixtures";

// dialog 블록 안 한 줄 input의 Enter는 확정 단추를 누른 것과 같다(카드 #1729 S8).
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const STATE = { open: true, draft: "보존", note: "" };

function definition(child: Block, dialog: Record<string, unknown>): AppDefinition {
  return {
    id: "dialog-enter", name: "대화상자 Enter", requires: { blocks: 19, modules: {} }, permissions: [],
    state: { ...STATE },
    ui: {
      type: "dialog", open: { state: "open" }, title: "저장 확인", close_label: "저장", child,
      on_confirm: [{ set_state: "open", value: false }], on_close: [{ set_state: "open", value: false }], ...dialog,
    } as unknown as Block,
  };
}

const input = (extra: Record<string, unknown> = {}): Block => ({ type: "input", value: { state: "draft" }, on_change: { set_state: "draft" }, label: "이름", ...extra } as unknown as Block);
const sleep = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

async function open(child: Block, dialog: Record<string, unknown> = {}) {
  const seed = makeTestSeed({ definitions: [definition(child, dialog)] });
  seed.snapshot.shared.windows[0].state = { ...STATE };
  const transport = createFakeTransport(seed);
  const original = transport.call.bind(transport);
  const acts: string[] = [];
  vi.spyOn(transport, "call").mockImplementation((async (request: CoreRequest) => {
    if (request.op === "data.act") acts.push(request.pointer.split("/").at(-1)!);
    return original(request as never) as never;
  }) as typeof transport.call);
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  const dialogElement = await screen.findByRole("dialog");
  const field = within(dialogElement).getByRole("textbox", { name: "이름" });
  field.focus();
  return { store, acts, field, confirms: () => acts.filter((pointer) => pointer === "on_confirm").length };
}

it("on_submit 없는 한 줄 input에서 Enter를 누르면 on_confirm이 한 번 돈다", async () => {
  const view = await open(input());
  fireEvent.keyDown(view.field, { key: "Enter" });
  await waitFor(() => expect(view.confirms()).toBe(1));
  await sleep(100);
  expect(view.confirms()).toBe(1);
  view.store.dispose();
});

it("confirm_disabled가 참이면 한 줄 input의 Enter로 on_confirm이 돌지 않는다", async () => {
  const view = await open(input(), { confirm_disabled: true });
  fireEvent.keyDown(view.field, { key: "Enter" });
  await sleep(100);
  expect(view.confirms()).toBe(0);
  view.store.dispose();
});

it("입력기 조합 중(isComposing)의 Enter는 on_confirm을 부르지 않는다", async () => {
  const view = await open(input());
  fireEvent.keyDown(view.field, { key: "Enter", isComposing: true });
  await sleep(100);
  expect(view.confirms()).toBe(0);
  view.store.dispose();
});

it("on_submit이 있는 input에서 Enter를 누르면 on_submit만 돌고 on_confirm은 돌지 않는다", async () => {
  const view = await open(input({ on_submit: [{ set_state: "note", value: "보냄" }] }));
  fireEvent.keyDown(view.field, { key: "Enter" });
  await waitFor(() => expect(view.acts.filter((pointer) => pointer === "on_submit")).toHaveLength(1));
  await sleep(100);
  expect(view.acts.filter((pointer) => pointer === "on_submit")).toHaveLength(1);
  expect(view.confirms()).toBe(0);
  view.store.dispose();
});

it("여러 줄 input의 Enter는 줄바꿈이고 Ctrl+Enter여도 확정하지 않는다", async () => {
  const view = await open(input({ multiline: true }));
  expect(view.field.tagName).toBe("TEXTAREA");
  expect(fireEvent.keyDown(view.field, { key: "Enter" })).toBe(true);
  fireEvent.keyDown(view.field, { key: "Enter", ctrlKey: true });
  await sleep(100);
  expect(view.confirms()).toBe(0);
  view.store.dispose();
});
