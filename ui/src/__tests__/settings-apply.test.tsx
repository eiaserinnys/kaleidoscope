import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentBinding, AppDefinition } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// @ts-expect-error 대화 설정은 창 상태 바인딩을 받지 않는다.
const invalidAgentBinding: AgentBinding = { state: "selected" };
void invalidAgentBinding;

it("저장과 제공자 적용을 따로 표시하고 다시 시도한다", async () => {
  const definition: AppDefinition = {
    ...mdEditorDefinition,
    requires: { blocks: 6, modules: { storage: 1, agent: 3, connection: 2 } },
    ui: { type: "text", value: "본문" },
    storage: { entries: [{ id: "role", key: "role", label: "역할", kind: "json", schema: { type: "string" }, default: "기본", presentation: "settings" }] },
    agent: { protocol: "conversation-v1", permission: "provider", base_path: "/api", namespace: "ns", profile: "profile", collection: "collection", model_order: ["model"], selected_model: null, title_template: "제목", initial_instruction_template: "처음", instructions_template: "역할", thread_entry: "thread" },
  };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  const spy = vi.spyOn(transport, "call").mockImplementation(async (request) => {
    if (request.op === "conversation.apply_status") return { op: request.op, status: "unapplied" };
    if (request.op === "conversation.apply_retry") return { op: request.op };
    return original(request);
  });
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="editor-window" settingsOpen settingsVisited />);
  expect((await screen.findByRole("alert")).textContent).toContain("대화에 적용 안 됨");
  const retry = screen.getByRole("button", { name: "다시 시도" });
  await userEvent.setup().click(retry);
  expect(spy).toHaveBeenCalledWith({ op: "conversation.apply_retry", window_id: "editor-window" });
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(retry.hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("status", { name: "적용 중" })).toBeTruthy();
  act(() => transport.emit({ event: "conversation.apply_status", app_id: definition.id, status: "unapplied" }));
  await waitFor(() => expect(document.activeElement).toBe(retry));
  expect(retry.hasAttribute("disabled")).toBe(false);
  await userEvent.setup().click(retry);
  expect(retry.hasAttribute("disabled")).toBe(true);
  const input = screen.getByRole("textbox", { name: "역할" });
  await userEvent.setup().click(input);
  act(() => transport.emit({ event: "conversation.apply_status", app_id: definition.id, status: "unapplied" }));
  await waitFor(() => expect(retry.hasAttribute("disabled")).toBe(false));
  expect(document.activeElement).toBe(input);
  await userEvent.setup().click(retry);
  act(() => transport.emit({ event: "conversation.apply_status", app_id: definition.id, status: "applied" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "앱 설정" }));
});
