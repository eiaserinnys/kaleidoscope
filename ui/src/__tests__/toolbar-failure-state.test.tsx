import { act, cleanup, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, BindingValue, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const LONG = "받지 못했습니다. 서버가 응답하지 않아 작업 목록을 불러오지 못했습니다. 네트워크 연결을 확인하고 잠시 뒤 다시 시도하세요.";
const CODE = "SHELL_DATA_SOURCE_FAILED";
const POINTERS: Record<string, BindingValue> = {
  "/ui/children/0/start/0/value": { status: "failed", id: CODE, message: LONG, retry: ["sample"] },
  "/ui/children/0/start/1/options": { status: "failed", id: CODE, message: LONG, retry: ["sample"] },
  "/ui/children/1/value": { status: "failed", id: CODE, message: LONG, retry: ["sample"] },
};

async function renderFailures() {
  const definition: AppDefinition = {
    ...mdEditorDefinition,
    state: { choice: "" },
    sources: { sample: { kind: "request", permission: "remote", path: "/" } },
    ui: { type: "stack", direction: "column", children: [
      { type: "toolbar", start: [
        { type: "text", value: { expr: "$data.sample.message" } },
        { type: "select", value: { state: "choice" }, on_change: { set_state: "choice" }, options: { expr: "$data.sample.message" } },
      ], end: [{ type: "button", label: "적용", on_click: [] }] },
      { type: "text", value: { expr: "$data.sample.message" } },
    ] } as unknown as Block,
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { choice: "" };
  const transport = createFakeTransport({ ...seed, data: { sources: { sample: { value: { message: "준비됨" } } } } });
  const spy = vi.spyOn(transport, "call");
  const view = render(<AppWindowContent store={createShellStore(transport)} windowId="editor-window" />);
  await waitFor(() => expect(view.container.querySelector(".ks-data-toolbar")).not.toBeNull());
  act(() => transport.emit({ event: "data.update", window_id: "editor-window", view: { sources: {}, values: POINTERS } }));
  return { view, transport, spy };
}

it("도구 막대 안 실패 표시는 한 줄 compact로 서고 긴 문구를 title에 남긴다", async () => {
  const { view } = await renderFailures();
  const toolbar = view.container.querySelector(".ks-data-toolbar") as HTMLElement;
  await waitFor(() => expect(toolbar.querySelectorAll(".ks-data-state-compact").length).toBe(2));
  expect(toolbar.querySelectorAll(".ks-data-state:not(.ks-data-state-compact)").length).toBe(0);
  expect(toolbar.querySelectorAll(":scope > .ks-data-toolbar-group").length).toBe(2);
  const compactStates = Array.from(toolbar.querySelectorAll(".ks-data-state-compact")) as HTMLElement[];
  expect(compactStates.length).toBe(2);
  for (const state of compactStates) expect(state.getAttribute("title")).toBe(LONG);
  const messages = Array.from(toolbar.querySelectorAll(".ks-data-state-message")) as HTMLElement[];
  expect(messages.length).toBe(2);
  for (const message of messages) {
    expect(message.textContent).toBe(LONG);
    expect(message.getAttribute("title")).toBeNull();
    expect(message.querySelector(".ks-error-id")).toBeNull();
  }
  const text = toolbar.querySelector(".ks-data-toolbar-item.is-text");
  expect(text?.querySelector(".ks-data-state-message ~ .ks-error-id")?.textContent).toBe(CODE);
  expect(toolbar.querySelectorAll(".ks-error-id").length).toBe(2);
});

it("도구 막대 밖 실패 표시는 지금처럼 compact가 아니고 문구 span을 쓰지 않는다", async () => {
  const { view } = await renderFailures();
  const outside = view.container.querySelector(".ks-data-stack > .ks-data-stack-item:nth-child(2) .ks-data-state");
  await waitFor(() => expect(outside).not.toBeNull());
  expect(outside?.classList.contains("ks-data-state-compact")).toBe(false);
  expect(outside?.querySelector(".ks-data-state-message")).toBeNull();
  expect(outside?.querySelector(".ks-empty-state-text")?.textContent).toContain(LONG);
  expect(outside?.querySelectorAll(".ks-error-id").length).toBe(1);
});

it("도구 막대 안 「다시 받기」는 실패한 원천을 다시 받는다", async () => {
  const { view, spy } = await renderFailures();
  const toolbar = view.container.querySelector(".ks-data-toolbar") as HTMLElement;
  await waitFor(() => expect(within(toolbar).getAllByRole("button", { name: "다시 받기" }).length).toBe(2));
  await userEvent.click(within(toolbar).getAllByRole("button", { name: "다시 받기" })[0]);
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "data.refresh", window_id: "editor-window", sources: ["sample"] }));
});
