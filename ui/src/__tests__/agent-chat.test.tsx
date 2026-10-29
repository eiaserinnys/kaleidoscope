import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentInfo, AgentItem, AgentModel, AppDefinition, CoreEvent, CoreReply, CoreRequest, ShellSnapshot } from "../contract/contract";
import type { BlockContext } from "../blocks/block-context";
import type { ShellStore } from "../core/shell-store";
import { AgentChatBlock } from "../blocks/agent-chat";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { makeTestSnapshot } from "./fixtures";

afterEach(() => cleanup());

const definition: AppDefinition = {
  id: "workspace-pas",
  name: "작업 PAS",
  requires: { blocks: 2, modules: { agent: 1 } },
  permissions: [],
  state: {},
  ui: { type: "agent_chat" },
};

const models: AgentModel[] = [
  { preset: "gemini-4-argon", label: "Argon" },
  { preset: "codex-6.1-sol", label: "Sol" },
];

function makeAgent(workspaceId = "workspace-1", busy = false): AgentInfo {
  return {
    workspace_id: workspaceId,
    model_preset: "gemini-4-argon",
    model_label: "Argon",
    busy,
    tool: null,
    created_at: "2026-10-29T00:00:00Z",
  };
}

function makeItem(id: string, kind: AgentItem["kind"], text: string): AgentItem {
  return { id, kind, text, at: "2026-10-29T00:00:00Z" };
}

function setup(options: {
  link?: ShellSnapshot["link"];
  agent?: AgentInfo | null;
  items?: AgentItem[];
  models?: AgentModel[];
  rejectSend?: boolean;
  sendGate?: Promise<void>;
} = {}) {
  const snapshot = makeTestSnapshot({ definitions: [definition] });
  snapshot.link = options.link ?? { state: "connected", server_url: "https://example.test", device_name: "Test PC" };
  const listeners = new Set<(event: CoreEvent) => void>();
  const call = vi.fn(async (request: CoreRequest): Promise<CoreReply> => {
    if (request.op === "agent.get") {
      return { op: "agent.get", agent: options.agent ?? null, items: options.items ?? [], models: options.models ?? models };
    }
    if (request.op === "agent.create") {
      return { op: "agent.create", agent: makeAgent(request.workspace_id) };
    }
    if (request.op === "agent.send") {
      await options.sendGate;
      if (options.rejectSend) throw { code: "server", message: "보낼 수 없습니다", details: [] };
      return { op: "agent.send" };
    }
    throw new Error(`Unexpected request ${request.op}`);
  });
  const store = {
    call,
    getSnapshot: () => snapshot,
    getError: () => null,
    subscribe: () => () => undefined,
    subscribeEvents(listener: (event: CoreEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ready: Promise.resolve(),
    dispose: () => undefined,
  } as unknown as ShellStore;
  const appWindow = snapshot.shared.windows[0];
  if (!appWindow) throw new Error("Test window is missing");
  const context: BlockContext = { store, snapshot, window: appWindow, definition };
  return {
    context,
    call,
    emit(event: CoreEvent) { for (const listener of listeners) listener(event); },
  };
}

describe("agent_chat block", () => {
  it("shows the connection state without calling the agent while disconnected", () => {
    const state = setup({ link: { state: "offline", server_url: "https://example.test", device_name: "Test PC", reason: "offline" } });
    render(<AgentChatBlock block={{ type: "agent_chat" }} context={state.context} />);

    expect(screen.getByText("서버에 연결하면 대화할 수 있습니다")).toBeTruthy();
    expect(state.call).not.toHaveBeenCalled();
  });

  it("loads the model choices, keeps their order, and creates the workspace agent with the selected preset", async () => {
    const state = setup();
    render(<AgentChatBlock block={{ type: "agent_chat" }} context={state.context} />);

    const argonButton = await screen.findByRole("button", { name: "Argon" });
    const solButton = screen.getByRole("button", { name: "Sol" });
    expect(argonButton.getAttribute("aria-pressed")).toBe("true");
    expect(argonButton.classList.contains("is-selected")).toBe(true);
    expect(solButton.getAttribute("aria-pressed")).toBe("false");
    expect(solButton.classList.contains("is-selected")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Sol" }));
    fireEvent.click(screen.getByRole("button", { name: "시작" }));

    await waitFor(() => expect(state.call).toHaveBeenCalledWith({
      op: "agent.create",
      workspace_id: "workspace-1",
      model_preset: "codex-6.1-sol",
    }));
    expect(screen.getByRole("status").textContent).toContain("시작하는 중");
  });

  it("sends Enter, preserves Shift+Enter, and does not send a composing Enter", async () => {
    const state = setup({ agent: makeAgent() });
    render(<AgentChatBlock block={{ type: "agent_chat" }} context={state.context} />);
    const input = await screen.findByRole("textbox", { name: "메시지" });
    const user = userEvent.setup();

    await user.type(input, "첫 줄");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(state.call).not.toHaveBeenCalledWith(expect.objectContaining({ op: "agent.send" }));
    fireEvent.change(input, { target: { value: "첫 줄\n둘째 줄" } });

    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(state.call).not.toHaveBeenCalledWith(expect.objectContaining({ op: "agent.send" }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(state.call).toHaveBeenCalledWith({
      op: "agent.send", workspace_id: "workspace-1", text: "첫 줄\n둘째 줄",
    }));
  });

  it("keeps the draft and shows the server error when sending fails", async () => {
    const state = setup({ agent: makeAgent(), rejectSend: true });
    render(<AgentChatBlock block={{ type: "agent_chat" }} context={state.context} />);
    const input = await screen.findByRole("textbox", { name: "메시지" });
    fireEvent.change(input, { target: { value: "보존할 문장" } });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("보낼 수 없습니다");
    expect(alert.closest(".ks-agent-chat-input-area")).toBeTruthy();
    expect((input as HTMLTextAreaElement).value).toBe("보존할 문장");
  });

  it("keeps a new draft typed while the previous send is in flight", async () => {
    let releaseSend: (() => void) | undefined;
    const sendGate = new Promise<void>((resolve) => { releaseSend = resolve; });
    const state = setup({ agent: makeAgent(), sendGate });
    render(<AgentChatBlock block={{ type: "agent_chat" }} context={state.context} />);
    const input = await screen.findByRole("textbox", { name: "메시지" });

    fireEvent.change(input, { target: { value: "첫 요청" } });
    const sendButton = screen.getByRole("button", { name: "보내기" }) as HTMLButtonElement;
    fireEvent.click(sendButton);
    fireEvent.change(input, { target: { value: "다음 초안" } });
    releaseSend?.();

    await waitFor(() => expect(sendButton.disabled).toBe(false));
    expect((input as HTMLTextAreaElement).value).toBe("다음 초안");
  });

  it("appends deltas, clears them on the final assistant item, and ignores other workspaces", async () => {
    const state = setup({ agent: makeAgent() });
    render(<AgentChatBlock block={{ type: "agent_chat" }} context={state.context} />);
    await screen.findByRole("textbox", { name: "메시지" });

    state.emit({ event: "agent.update", workspace_id: "workspace-2", update: { kind: "delta", text: "다른 작업" } });
    expect(screen.queryByText("다른 작업")).toBeNull();
    state.emit({ event: "agent.update", workspace_id: "workspace-1", update: { kind: "delta", text: "이어 " } });
    state.emit({ event: "agent.update", workspace_id: "workspace-1", update: { kind: "delta", text: "쓰는 중" } });
    expect(await screen.findByText("이어 쓰는 중")).toBeTruthy();

    state.emit({ event: "agent.update", workspace_id: "workspace-1", update: { kind: "item", item: makeItem("1", "assistant", "완성된 답") } });
    expect(await screen.findByText("완성된 답")).toBeTruthy();
    expect(screen.queryByText("이어 쓰는 중")).toBeNull();
  });

  it("renders each history id once", async () => {
    const item = makeItem("same-id", "user", "중복 기록");
    const state = setup({ agent: makeAgent(), items: [item, item] });
    render(<AgentChatBlock block={{ type: "agent_chat" }} context={state.context} />);

    await screen.findByRole("textbox", { name: "메시지" });
    expect(screen.getAllByText("중복 기록")).toHaveLength(1);
  });

  it("seeds, creates, and streams fake workspace PAS conversations", async () => {
    const snapshot = makeTestSnapshot({ definitions: [definition] });
    snapshot.link = { state: "connected", server_url: "https://example.test", device_name: "Test PC" };
    const transport = createFakeTransport({
      snapshot,
      folder: null,
      files: {},
      agentModels: models,
      agents: {
        "workspace-1": {
          agent: makeAgent(),
          items: [makeItem("seed-1", "assistant", "기존 기록")],
          models,
        },
      },
    });
    const store = createShellStore(transport);
    await store.ready;
    const events: CoreEvent[] = [];
    const unsubscribe = store.subscribeEvents((event) => events.push(event));

    const history = await store.call({ op: "agent.get", workspace_id: "workspace-1" });
    expect(history).toMatchObject({ op: "agent.get", agent: { model_preset: "gemini-4-argon" }, items: [{ text: "기존 기록" }] });
    const created = await store.call({ op: "agent.create", workspace_id: "workspace-2", model_preset: "codex-6.1-sol" });
    expect(created).toMatchObject({ op: "agent.create", agent: { workspace_id: "workspace-2", model_preset: "codex-6.1-sol" } });
    await waitFor(() => expect(events.some((event) => event.event === "agent.update" && event.workspace_id === "workspace-2" && event.update.kind === "item")).toBe(true));
    await store.call({ op: "agent.send", workspace_id: "workspace-2", text: "두 번째 요청" });
    expect(events.some((event) => event.event === "agent.update" && event.workspace_id === "workspace-2" && event.update.kind === "item" && event.update.item.kind === "user")).toBe(true);
    await waitFor(() => expect(events.filter((event) => event.event === "agent.update" && event.workspace_id === "workspace-2" && event.update.kind === "item" && event.update.item.kind === "assistant")).toHaveLength(2));
    expect(events.some((event) => event.event === "agent.update" && event.workspace_id === "workspace-2" && event.update.kind === "delta")).toBe(true);

    unsubscribe();
    store.dispose();
  });
});
