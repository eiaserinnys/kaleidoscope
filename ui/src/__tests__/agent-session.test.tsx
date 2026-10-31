import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionBlock } from "../blocks/agent-session";
import { WindowDataProvider } from "../data/window-data";
import type { AppDefinition, CoreEvent, CoreReply, CoreRequest, DataView, LocalAgentSnapshot } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { createFakeTransport } from "../core/fake-transport";
import { makeTestSnapshot } from "./fixtures";
import agentJson from "../../../apps/agent.json";

const definition: AppDefinition = {
  id: "agent", name: "에이전트", requires: { blocks: 8, modules: { files: 1, local_agent: 1 } },
  permissions: [
    { module: "local_agent", id: "run", label: "에이전트 실행" },
    { module: "files", id: "work", access: "readwrite", label: "작업 폴더" },
  ],
  state: { agent_id: null },
  ui: { type: "agent_session", permission: "run", root: { permission: "work" }, agents: [], selected: { state: "agent_id" }, on_select: { set_state: "agent_id" } },
};

function localAgent(phase: LocalAgentSnapshot["phase"]): LocalAgentSnapshot {
  return {
    generation: "generation-1",
    phase,
    agents: [{ id: "agent-a", name: "Agent A" }, { id: "agent-b", name: "Agent B" }],
    selected: phase === "choosing_agent" ? null : "agent-b",
    folder_name: phase === "choosing_agent" ? null : "work folder",
    execution: phase === "awaiting_permission" ? { spec_hash: "spec-hash", name: "Agent B", command: "npx", args: ["-y", "@agentclientprotocol/agent-b-acp"], env: { HOME: "ignored" } } : null,
    auth_methods: [{ id: "chat-gpt", name: "ChatGPT 로그인", description: "브라우저에서 로그인" }],
    controls: [
      { id: "model", label: "모델", category: null, value: "balanced", kind: { kind: "select", options: [{ name: "모델", options: [{ id: "balanced", name: "균형" }, { id: "fast", name: "빠름" }] }] } },
      { id: "approval", label: "자동 승인", category: null, value: false, kind: { kind: "boolean" } },
    ],
    history: [{ id: "assistant-1", kind: "assistant", text: "지난 답변", at: "2026-10-30T00:00:00Z", attachments: [] }],
    stream_id: null,
    text: phase === "responding" ? "답변 중" : "",
    activity: { busy: phase === "responding", tool: phase === "responding" ? "파일 읽기" : null },
    permissions: [],
    queued: [],
    failure: phase === "failed" ? { code: "local_agent_failed", message: "실행에 실패했습니다", command: "npx agent-b-acp" } : null,
  };
}

function setup(agent = localAgent("ready"), respond?: (request: CoreRequest) => Promise<CoreReply>, view: DataView = { values: {}, sources: {} }, appDefinition = definition) {
  const base = makeTestSnapshot({ definitions: [appDefinition] });
  const listeners = new Set<(event: CoreEvent) => void>();
  const call = vi.fn(async (request: CoreRequest): Promise<CoreReply> => {
    if (request.op === "data.attach") return { op: "data.attach", view };
    if (request.op === "data.detach") return { op: "data.detach" };
    if (request.op === "local_agent.attach") return { op: "local_agent.attach", snapshot: agent };
    if (request.op === "local_agent.detach") return { op: "local_agent.detach" };
    if (request.op === "files.pick_folder") return { op: "files.pick_folder", grant: null };
    if (request.op === "data.act") return { op: "data.act" };
    if (respond) return respond(request);
    if (request.op === "local_agent.send") return { op: "local_agent.send", request_id: request.request_id, queued: false };
    if (request.op === "local_agent.attachment") return { op: "local_agent.attachment", mime: "text/plain", data_base64: "aGVsbG8=" };
    return { op: request.op } as CoreReply;
  });
  const store = {
    call,
    getSnapshot: () => base,
    getError: () => null,
    subscribe: () => () => undefined,
    subscribeEvents: (listener: (event: CoreEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    ready: Promise.resolve(),
    dispose: () => undefined,
  } as unknown as ShellStore;
  const window = base.shared.windows[0];
  const context = { store, snapshot: base, window, definition: appDefinition };
  render(<WindowDataProvider store={store} appWindow={window} definition={appDefinition}><AgentSessionBlock block={appDefinition.ui as Extract<AppDefinition["ui"], { type: "agent_session" }>} context={context} /></WindowDataProvider>);
  return { call, window, emit: (event: CoreEvent) => act(() => { listeners.forEach((listener) => listener(event)); }) };
}

afterEach(() => cleanup());

describe("기기 로컬 에이전트 화면", () => {
  it("에이전트 목록을 읽지 못하면 오류를 보이고 선택 단추를 비활성화한다", async () => {
    const failedDefinition = {
      ...definition,
      ui: { ...definition.ui, agents: { expr: "$storage.agents" } },
    } as AppDefinition;
    const empty = { ...localAgent("choosing_agent"), agents: [] };
    setup(empty, undefined, {
      values: { "/ui/agents": { status: "failed", message: "저장소를 읽지 못했습니다", retry: [] } },
      sources: {},
    }, failedDefinition);

    expect((await screen.findByRole("alert")).textContent).toContain("저장소를 읽지 못했습니다");
    const button = screen.getByRole("button", { name: "에이전트" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it.each([
    ["choosing_agent", "에이전트를 골라 주세요"],
    ["choosing_folder", "작업 폴더를 골라 주세요"],
    ["awaiting_permission", "이 PC에서 프로그램을 실행합니다"],
    ["starting", "에이전트를 시작하는 중"],
    ["login_required", "ChatGPT 로그인"],
    ["ready", "메시지"],
    ["responding", "멈춤"],
    ["failed", "실행에 실패했습니다"],
    ["ended", "지난 답변"],
  ] as const)("%s 상태를 표시한다", async (phase, expected) => {
    setup(localAgent(phase));
    if (phase === "ready") expect(await screen.findByRole("textbox", { name: "메시지" })).toBeTruthy();
    else if (phase === "responding") expect(await screen.findByRole("button", { name: "멈춤" })).toBeTruthy();
    else if (phase === "awaiting_permission") expect(await screen.findByText("HOME=ignored")).toBeTruthy();
    else expect(await screen.findByText(expected, { exact: false })).toBeTruthy();
    expect(screen.getByRole("button", { name: "에이전트" })).toBeTruthy();
  });

  it("선택·폴더 고르기·실행 허용·로그인·재시도에 계약 명령을 보낸다", async () => {
    const choosing = localAgent("choosing_agent");
    const state = setup(choosing);
    fireEvent.click(await screen.findByRole("button", { name: "에이전트" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Agent B" }));
    await waitFor(() => expect(state.call).toHaveBeenCalledWith({ op: "data.act", window_id: state.window.id, pointer: "/ui/on_select", event: "agent-b" }));

    cleanup();
    const folder = setup(localAgent("choosing_folder"));
    fireEvent.click(await screen.findByRole("button", { name: "폴더 선택" }));
    expect(folder.call).toHaveBeenCalledWith({ op: "files.pick_folder", window_id: folder.window.id, permission: "work" });

    cleanup();
    const approval = setup(localAgent("awaiting_permission"));
    fireEvent.click(await screen.findByRole("button", { name: "허용" }));
    expect(approval.call).toHaveBeenCalledWith({ op: "local_agent.allow", window_id: approval.window.id, spec_hash: "spec-hash" });

    cleanup();
    const login = setup(localAgent("login_required"));
    fireEvent.click(await screen.findByRole("button", { name: "ChatGPT 로그인" }));
    expect(login.call).toHaveBeenCalledWith({ op: "local_agent.authenticate", window_id: login.window.id, generation: "generation-1", method_id: "chat-gpt" });

    cleanup();
    const failed = setup(localAgent("failed"));
    fireEvent.click(await screen.findByRole("button", { name: "다시 시도" }));
    expect(failed.call).toHaveBeenCalledWith({ op: "local_agent.retry", window_id: failed.window.id, generation: "generation-1" });
  });

  it("에이전트 설정을 바꾸고 답변 중에는 설정 선택지를 잠근다", async () => {
    const state = setup(localAgent("ready"));
    fireEvent.click(await screen.findByRole("button", { name: "모델" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "빠름" }));
    expect(state.call).toHaveBeenCalledWith({ op: "local_agent.configure", window_id: state.window.id, generation: "generation-1", control_id: "model", value: "fast" });
    fireEvent.click(screen.getByRole("switch", { name: "자동 승인" }));
    expect(state.call).toHaveBeenCalledWith({ op: "local_agent.configure", window_id: state.window.id, generation: "generation-1", control_id: "approval", value: true });

    cleanup();
    setup(localAgent("responding"));
    expect((await screen.findByRole("button", { name: "모델" })).matches(":disabled")).toBe(true);
    expect(screen.getByRole("switch", { name: "자동 승인" }).matches(":disabled")).toBe(true);
  });

  it("대기 승인을 선택하고 응답 중 보낸 말을 대기열에 표시하며 멈춤을 보낸다", async () => {
    const initial = localAgent("responding");
    initial.permissions = [{ id: "permission-1", title: "파일 읽기", options: [{ id: "allow-once", label: "한 번 허용", kind: "allow_once" }] }];
    const state = setup(initial, async (request) => {
      if (request.op === "local_agent.send") return { op: "local_agent.send", request_id: request.request_id, queued: true };
      return { op: request.op } as CoreReply;
    });
    fireEvent.click(await screen.findByRole("button", { name: "한 번 허용" }));
    expect(state.call).toHaveBeenCalledWith({ op: "local_agent.permission", window_id: state.window.id, generation: "generation-1", request_id: "permission-1", option_id: "allow-once" });
    const input = await screen.findByRole("textbox", { name: "메시지" });
    fireEvent.change(input, { target: { value: "다음 작업" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(state.call.mock.calls.some(([request]) => request.op === "local_agent.send")).toBe(true));
    const request = state.call.mock.calls.find(([item]) => item.op === "local_agent.send")?.[0];
    expect(request).toMatchObject({ op: "local_agent.send", window_id: state.window.id, generation: "generation-1", text: "다음 작업", attachments: [] });
    state.emit({ event: "local_agent.update", window_id: state.window.id, generation: "generation-1", update: { type: "queue", queued: [{ id: "queued-1", text: "대기 중인 말", attachments: [] }] } });
    expect(await screen.findByText("대기 중인 말")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "멈춤" }));
    expect(state.call).toHaveBeenCalledWith({ op: "local_agent.cancel", window_id: state.window.id, generation: "generation-1" });
  });

  it("새 generation snapshot을 받고 오래된 부분 업데이트는 무시한 뒤 최신 generation으로 보낸다", async () => {
    const state = setup(localAgent("ready"));
    await screen.findByRole("textbox", { name: "메시지" });
    const next = { ...localAgent("ready"), generation: "generation-2" };
    state.emit({ event: "local_agent.update", window_id: state.window.id, generation: "generation-2", update: { type: "snapshot", snapshot: next } });
    const failed = localAgent("failed");
    state.emit({ event: "local_agent.update", window_id: state.window.id, generation: "generation-1", update: { type: "state", phase: "failed", controls: failed.controls, auth_methods: failed.auth_methods, execution: failed.execution, failure: failed.failure } });

    expect(screen.getByRole("textbox", { name: "메시지" })).toBeTruthy();
    expect(screen.queryByText("실행에 실패했습니다")).toBeNull();
    const input = screen.getByRole("textbox", { name: "메시지" });
    fireEvent.change(input, { target: { value: "최신 세션에 전송" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(state.call.mock.calls.some(([request]) => request.op === "local_agent.send")).toBe(true));
    expect(state.call.mock.calls.find(([request]) => request.op === "local_agent.send")?.[0]).toMatchObject({ generation: "generation-2" });
  });

  it("attach 응답 전에 받은 새 generation snapshot을 적용한다", async () => {
    const state = setup(localAgent("ready"));
    const next = { ...localAgent("ready"), generation: "generation-2" };
    state.emit({ event: "local_agent.update", window_id: state.window.id, generation: "generation-2", update: { type: "snapshot", snapshot: next } });

    const input = await screen.findByRole("textbox", { name: "메시지" });
    fireEvent.change(input, { target: { value: "attach 이후 전송" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(state.call.mock.calls.some(([request]) => request.op === "local_agent.send")).toBe(true));
    expect(state.call.mock.calls.find(([request]) => request.op === "local_agent.send")?.[0]).toMatchObject({ generation: "generation-2" });
  });

  it("가짜 코어가 선택부터 실행 허용과 도구 호출까지 새 세대로 이어간다", async () => {
    const definition = agentJson as unknown as AppDefinition;
    const configuredAgents = (definition as unknown as {
      storage: {
        entries: Array<{
          id: string;
          default?: Array<{ id: string; name: string; command: string; args: string[]; env: Record<string, string> }>;
        }>;
      };
    }).storage.entries.find((entry) => entry.id === "agents")?.default;
    const configuredAgent = configuredAgents?.[0];
    if (!configuredAgent) throw new Error("configured agent expected");
    const seed = makeTestSnapshot({ definitions: [definition] });
    const windowId = seed.shared.windows[0].id;
    const transport = createFakeTransport({ snapshot: seed, folder: { root_path: "/fake/work", root_name: "작업 폴더" }, files: {}, localAgent: localAgent("choosing_agent") });
    const updates: Extract<CoreEvent, { event: "local_agent.update" }>[] = [];
    transport.subscribe((event) => { if (event.event === "local_agent.update") updates.push(event); });
    await transport.call({ op: "data.attach", window_id: windowId });
    const attached = await transport.call({ op: "local_agent.attach", window_id: windowId });
    if (attached.op !== "local_agent.attach") throw new Error("attach reply expected");
    const firstGeneration = attached.snapshot.generation;

    await transport.call({ op: "data.act", window_id: windowId, pointer: "/ui/on_select", event: configuredAgent.id });
    const chosen = updates.filter((event) => event.update.type === "snapshot").slice(-1)[0]?.update;
    expect(chosen?.type === "snapshot" ? chosen.snapshot : null).toMatchObject({ phase: "choosing_folder", selected: configuredAgent.id });
    const chosenGeneration = chosen?.type === "snapshot" ? chosen.snapshot.generation : firstGeneration;
    expect(chosenGeneration).not.toBe(firstGeneration);

    await transport.call({ op: "files.pick_folder", window_id: windowId, permission: "work" });
    const permissionUpdate = updates.filter((event) => event.update.type === "snapshot").slice(-1)[0]?.update;
    const execution = permissionUpdate?.type === "snapshot" ? permissionUpdate.snapshot.execution : null;
    expect(permissionUpdate?.type === "snapshot" ? permissionUpdate.snapshot : null).toMatchObject({ phase: "awaiting_permission", folder_name: "작업 폴더" });
    expect(execution).toMatchObject({ name: configuredAgent.name, command: configuredAgent.command, args: configuredAgent.args, env: configuredAgent.env });
    const permissionGeneration = permissionUpdate?.type === "snapshot" ? permissionUpdate.snapshot.generation : chosenGeneration;
    expect(permissionGeneration).not.toBe(chosenGeneration);
    if (!execution) throw new Error("execution consent expected");

    await transport.call({ op: "local_agent.allow", window_id: windowId, spec_hash: execution.spec_hash });
    const startingUpdate = updates.filter((event) => event.update.type === "snapshot").slice(-1)[0]?.update;
    const starting = startingUpdate?.type === "snapshot" ? startingUpdate.snapshot : null;
    expect(starting).toMatchObject({ phase: "starting", execution: null });
    expect(starting?.generation).not.toBe(permissionGeneration);
    const readyReply = await transport.call({ op: "local_agent.attach", window_id: windowId });
    if (readyReply.op !== "local_agent.attach") throw new Error("ready snapshot expected");
    const ready = readyReply.snapshot;
    expect(ready).toMatchObject({ phase: "ready", execution: null });
    expect(ready.generation).toBe(starting?.generation);

    await transport.call({ op: "local_agent.retry", window_id: windowId, generation: ready.generation });
    const retryUpdate = updates.filter((event) => event.update.type === "snapshot").slice(-1)[0]?.update;
    const retryStart = retryUpdate?.type === "snapshot" ? retryUpdate.snapshot : null;
    expect(retryStart).toMatchObject({ phase: "starting" });
    expect(retryStart?.generation).not.toBe(ready.generation);
    const retryReply = await transport.call({ op: "local_agent.attach", window_id: windowId });
    if (retryReply.op !== "local_agent.attach") throw new Error("retry snapshot expected");
    expect(retryReply.snapshot.phase).toBe("ready");

    await transport.call({ op: "local_agent.send", window_id: windowId, generation: retryReply.snapshot.generation, request_id: "flow-1", text: "파일을 확인해 줘", attachments: [] });
    const afterTool = await transport.call({ op: "local_agent.attach", window_id: windowId });
    if (afterTool.op !== "local_agent.attach") throw new Error("attach reply expected");
    expect(afterTool.snapshot).toMatchObject({ phase: "responding", text: "", stream_id: null, activity: { busy: true, tool: "파일 읽기" } });
    expect(afterTool.snapshot.history.map((item) => [item.kind, item.text])).toContainEqual(["assistant", "파일을 확인하고 있습니다"]);
    const assistantIndex = updates.findIndex((event) => event.update.type === "conversation" && event.update.update.kind === "item" && event.update.update.item.kind === "assistant");
    const activityIndex = updates.findIndex((event) => event.update.type === "conversation" && event.update.update.kind === "activity" && event.update.update.tool === "파일 읽기");
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(activityIndex).toBeGreaterThan(assistantIndex);
  });
});
