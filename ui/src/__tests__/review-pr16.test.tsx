import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentChatBlock } from "../blocks/agent-chat";
import { makeTestSnapshot } from "./fixtures";
import type { BlockContext } from "../blocks/block-context";
import type { AgentInfo, AppDefinition, CoreEvent, CoreReply, CoreRequest } from "../contract/contract";

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const agent: AgentInfo = { workspace_id: "workspace-1", model_preset: "gemini-4-argon", model_label: "Argon", busy: false, tool: null, created_at: "2026-10-29T00:00:00Z" };
const models = [{ preset: "gemini-4-argon", label: "Argon" }];
function setup(call: (request: CoreRequest) => Promise<CoreReply>) {
  const definition: AppDefinition = { id: "workspace-pas", name: "PAS", requires: { blocks: 2, modules: { agent: 1 } }, permissions: [], state: {}, ui: { type: "agent_chat" } };
  const snapshot = makeTestSnapshot({ definitions: [definition] });
  snapshot.link = { state: "connected", server_url: "https://example.test", device_name: "PC" };
  return { definition, snapshot, window: snapshot.shared.windows[0], store: { call, subscribeEvents: () => () => undefined } } as unknown as BlockContext;
}

it("keeps the current successful load when an older pre-reconnect load finishes", async () => {
  let finishOld!: (reply: CoreReply) => void;
  const old = new Promise<CoreReply>((resolve) => { finishOld = resolve; });
  const call = vi.fn<(request: CoreRequest) => Promise<CoreReply>>()
    .mockImplementationOnce(() => old)
    .mockResolvedValue({ op: "agent.get", agent, items: [], models });
  const context = setup(call);
  const { rerender } = render(<AgentChatBlock block={{ type: "agent_chat" }} context={context} />);
  const offline: BlockContext = { ...context, snapshot: { ...context.snapshot, link: { state: "offline", server_url: "https://example.test", device_name: "PC", reason: "offline" } } };
  rerender(<AgentChatBlock block={{ type: "agent_chat" }} context={offline} />);
  rerender(<AgentChatBlock block={{ type: "agent_chat" }} context={context} />);
  await screen.findByRole("textbox", { name: "메시지" });
  await act(async () => { finishOld({ op: "agent.get", agent: null, items: [], models }); });
  expect(screen.queryByRole("textbox", { name: "메시지" })).not.toBeNull();
});

it("opens the returned existing PAS after create succeeds without a created event", async () => {
  const context = setup(async (request) => request.op === "agent.get"
    ? { op: "agent.get", agent: null, items: [], models }
    : { op: "agent.create", agent });
  render(<AgentChatBlock block={{ type: "agent_chat" }} context={context} />);
  const start = await screen.findByRole("button", { name: "시작" });
  await act(async () => { fireEvent.click(start); });
  expect(screen.queryByRole("textbox", { name: "메시지" })).not.toBeNull();
});

it("keeps a newer successful load when an older load fails", async () => {
  let failOld!: (error: unknown) => void;
  const old = new Promise<CoreReply>((_resolve, reject) => { failOld = reject; });
  const call = vi.fn<(request: CoreRequest) => Promise<CoreReply>>()
    .mockImplementationOnce(() => old)
    .mockResolvedValue({ op: "agent.get", agent, items: [], models });
  const context = setup(call);
  const { rerender } = render(<AgentChatBlock block={{ type: "agent_chat" }} context={context} />);
  const offline: BlockContext = { ...context, snapshot: { ...context.snapshot, link: { state: "offline", server_url: "https://example.test", device_name: "PC", reason: "offline" } } };
  rerender(<AgentChatBlock block={{ type: "agent_chat" }} context={offline} />);
  rerender(<AgentChatBlock block={{ type: "agent_chat" }} context={context} />);
  await screen.findByRole("textbox", { name: "메시지" });
  await act(async () => { failOld({ code: "server", message: "오래된 오류", details: [] }); });
  expect(screen.queryByText("오래된 오류")).toBeNull();
  expect(screen.queryByRole("textbox", { name: "메시지" })).not.toBeNull();
});

it("replays updates received during a load after its snapshot without duplicate items", async () => {
  let finishLoad!: (reply: CoreReply) => void;
  let emit!: (event: CoreEvent) => void;
  const pending = new Promise<CoreReply>((resolve) => { finishLoad = resolve; });
  const context = setup(() => pending);
  context.store.subscribeEvents = (listener) => { emit = listener; return () => undefined; };
  const item = { id: "same", kind: "user" as const, text: "조회 중 받은 기록", at: "2026-10-29T00:00:00Z" };
  render(<AgentChatBlock block={{ type: "agent_chat" }} context={context} />);
  act(() => {
    emit({ event: "agent.update", workspace_id: "workspace-1", update: { kind: "created", agent } });
    emit({ event: "agent.update", workspace_id: "workspace-1", update: { kind: "item", item } });
    emit({ event: "agent.update", workspace_id: "workspace-1", update: { kind: "delta", text: "진행 중인 답" } });
    emit({ event: "agent.update", workspace_id: "workspace-1", update: { kind: "activity", busy: true, tool: "문서 읽기" } });
  });
  await act(async () => { finishLoad({ op: "agent.get", agent: null, items: [item], models }); });
  expect(screen.getAllByText("조회 중 받은 기록")).toHaveLength(1);
  expect(screen.getByText("진행 중인 답")).toBeTruthy();
  expect(screen.queryByText("생각 중입니다… · 문서 읽기")).toBeNull();
  expect(screen.getByRole("textbox", { name: "메시지" })).toBeTruthy();
});

it("keeps activity received before the create response", async () => {
  let finishCreate!: (reply: CoreReply) => void;
  let emit!: (event: CoreEvent) => void;
  const pending = new Promise<CoreReply>((resolve) => { finishCreate = resolve; });
  const context = setup(async (request) => request.op === "agent.get"
    ? { op: "agent.get", agent: null, items: [], models }
    : pending);
  context.store.subscribeEvents = (listener) => { emit = listener; return () => undefined; };
  render(<AgentChatBlock block={{ type: "agent_chat" }} context={context} />);
  fireEvent.click(await screen.findByRole("button", { name: "시작" }));
  act(() => {
    emit({ event: "agent.update", workspace_id: "workspace-1", update: { kind: "created", agent } });
    emit({ event: "agent.update", workspace_id: "workspace-1", update: { kind: "activity", busy: true, tool: "문서 읽기" } });
  });
  await act(async () => { finishCreate({ op: "agent.create", agent }); });
  expect(screen.getByText("생각 중입니다… · 문서 읽기")).toBeTruthy();
});

it("clears an invalidated create when reconnecting reloads an empty workspace", async () => {
  let finishCreate!: (reply: CoreReply) => void;
  const pending = new Promise<CoreReply>((resolve) => { finishCreate = resolve; });
  const context = setup(async (request) => request.op === "agent.get"
    ? { op: "agent.get", agent: null, items: [], models }
    : pending);
  const { rerender } = render(<AgentChatBlock block={{ type: "agent_chat" }} context={context} />);
  fireEvent.click(await screen.findByRole("button", { name: "시작" }));
  expect(screen.getByText("시작하는 중")).toBeTruthy();
  const offline: BlockContext = { ...context, snapshot: { ...context.snapshot, link: { state: "offline", server_url: "https://example.test", device_name: "PC", reason: "offline" } } };
  rerender(<AgentChatBlock block={{ type: "agent_chat" }} context={offline} />);
  rerender(<AgentChatBlock block={{ type: "agent_chat" }} context={context} />);
  const start = await screen.findByRole("button", { name: "시작" });
  expect((start as HTMLButtonElement).disabled).toBe(false);
  await act(async () => { finishCreate({ op: "agent.create", agent }); });
  expect(screen.queryByRole("textbox", { name: "메시지" })).toBeNull();
  expect((start as HTMLButtonElement).disabled).toBe(false);
});
