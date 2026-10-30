import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentChatBlock } from "../blocks/agent-chat";
import { WindowDataProvider } from "../data/window-data";
import type { AppDefinition, CoreEvent, CoreReply, CoreRequest, ConversationItem, ConversationThread } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { makeTestSnapshot } from "./fixtures";

const definition: AppDefinition = {
  id: "provider-chat", name: "대화", requires: { blocks: 2, modules: { agent: 3 } }, permissions: [], state: {}, ui: { type: "agent_chat" },
  agent: { protocol: "conversation-v1", permission: "login", base_path: "api", namespace: "n", profile: "p", collection: "c", model_order: [], selected_model: "", title_template: "", initial_instruction_template: "", instructions_template: "", thread_entry: "thread" },
};
const thread: ConversationThread = { id: "thread-1", external: { namespace: "n", key: "k" }, title: "대화", model: { id: "m", label: "모델" }, created_at: "2026-10-30T00:00:00Z", archived: false };
const item = (id: string, text: string): ConversationItem => ({ id, kind: "assistant", text, at: "2026-10-30T00:00:00Z", attachments: [] });
const models = [{ id: "m", label: "모델", available: true }, { id: "off", label: "불가", available: false, reason: "사용 불가" }];
function setup(handler: (request: CoreRequest) => Promise<CoreReply>, appDefinition: AppDefinition = definition) {
  const snapshot = makeTestSnapshot({ definitions: [appDefinition] });
  snapshot.link = { state: "connected", server_url: "https://example.test", device_name: "시험" };
  const listeners = new Set<(event: CoreEvent) => void>();
  const call = vi.fn(async (request: CoreRequest): Promise<CoreReply> => {
    if (request.op === "data.attach") return { op: "data.attach", view: { values: {}, sources: {} } };
    if (request.op === "data.detach") return { op: "data.detach" };
    return handler(request);
  });
  const store = { call, getSnapshot: () => snapshot, getError: () => null, subscribe: () => () => {}, subscribeEvents: (fn: (event: CoreEvent) => void) => { listeners.add(fn); return () => listeners.delete(fn); }, ready: Promise.resolve(), dispose: () => {} } as unknown as ShellStore;
  const window = snapshot.shared.windows[0];
  const context = { store, snapshot, window, definition: appDefinition };
  render(<WindowDataProvider store={store} appWindow={window} definition={appDefinition}><AgentChatBlock block={{ type: "agent_chat" }} context={context} /></WindowDataProvider>);
  return { call, window, emit: (event: CoreEvent) => act(() => { listeners.forEach((fn) => fn(event)); }) };
}
const get = (value: ConversationThread | null = thread): CoreReply => ({ op: "conversation.get", thread: value, items: [item("1", "기록")], cursor: "c", next_before: "older", models });
const error = (code: string) => ({ code, message: "실패", details: [] });
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as unknown as CanvasRenderingContext2D); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("대화 제공자 화면", () => {
  it("기존 앱에 제공자가 없으면 빈 상태를 보이고 대화 요청을 보내지 않는다", () => {
    const legacy: AppDefinition = { ...definition, agent: undefined };
    const state = setup(async (request) => { throw new Error(request.op); }, legacy);
    expect(screen.getByText("이 앱 판에는 대화 제공자가 없습니다")).toBeTruthy();
    expect(state.call.mock.calls.some(([request]) => request.op.startsWith("conversation."))).toBe(false);
  });
  it("기록과 이전 페이지를 합치고 같은 id를 중복하지 않으며 진행문을 교체한다", async () => {
    const state = setup(async (request) => {
      if (request.op === "conversation.get") return get();
      if (request.op === "conversation.history") return { op: "conversation.history", items: [item("0", "이전"), item("1", "기록")], next_before: undefined };
      throw new Error(request.op);
    });
    await screen.findByText("기록");
    fireEvent.scroll(screen.getByRole("log"));
    expect(await screen.findByText("이전")).toBeTruthy();
    state.emit({ event: "conversation.update", thread_id: "thread-1", update: { kind: "text", stream_id: "s", text: "진행" } });
    state.emit({ event: "conversation.update", thread_id: "thread-1", update: { kind: "text", stream_id: "s", text: "진행 중" } });
    state.emit({ event: "conversation.update", thread_id: "other-thread", update: { kind: "text", stream_id: "other", text: "다른 대화" } });
    expect(screen.getByText("진행 중")).toBeTruthy();
    expect(screen.queryByText("다른 대화")).toBeNull();
    expect(screen.queryByText("진행진행 중")).toBeNull();
    state.emit({ event: "conversation.update", thread_id: "thread-1", update: { kind: "item", item: item("1", "기록") } });
    expect(screen.getAllByText("기록")).toHaveLength(1);
  });
  it("시작 판에서 이용 가능한 모델로 생성하고 다시 조회한다", async () => {
    let created = false;
    const state = setup(async (request) => {
      if (request.op === "conversation.get") return get(created ? thread : null);
      if (request.op === "conversation.create") { created = true; return { op: "conversation.create", thread }; }
      throw new Error(request.op);
    });
    expect((await screen.findByRole("button", { name: /불가/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await screen.findByRole("textbox", { name: "메시지" });
    expect(state.call).toHaveBeenCalledWith({ op: "conversation.create", window_id: state.window.id, model: "m" });
  });
  it("생성 응답 전에 온 진행문을 조회 뒤에도 보인다", async () => {
    let finishCreate!: (value: CoreReply) => void;
    let created = false;
    const state = setup(async (request) => {
      if (request.op === "conversation.get") return get(created ? thread : null);
      if (request.op === "conversation.create") return new Promise<CoreReply>((resolve) => { finishCreate = resolve; });
      throw new Error(request.op);
    });
    fireEvent.click(await screen.findByRole("button", { name: "시작" }));
    state.emit({ event: "conversation.update", thread_id: "thread-1", update: { kind: "text", stream_id: "early", text: "먼저 시작한 답" } });
    created = true;
    await act(async () => { finishCreate({ op: "conversation.create", thread }); });
    expect(await screen.findByText("먼저 시작한 답")).toBeTruthy();
  });
  it("조회 중 다른 기기가 묶은 대화를 다시 조회한다", async () => {
    let finishOld!: (value: CoreReply) => void;
    let calls = 0;
    const state = setup(async (request) => {
      if (request.op === "conversation.get") {
        calls += 1;
        if (calls === 1) return new Promise<CoreReply>((resolve) => { finishOld = resolve; });
        return get();
      }
      throw new Error(request.op);
    });
    await waitFor(() => expect(calls).toBe(1));
    state.emit({ event: "storage.update", window_id: state.window.id, update: { kind: "changed", changed: { bucket_id: "bucket", item: { entry_id: "thread", key: "thread", kind: "json", revision: "r", exists: true } } } });
    await screen.findByText("기록");
    await act(async () => { finishOld(get(null)); });
    expect(screen.getByRole("textbox", { name: "메시지" })).toBeTruthy();
  });
  it("로그인 필요와 스트림 인증 오류 뒤 로그인하고 다시 조회한다", async () => {
    let logged = false;
    const state = setup(async (request) => {
      if (request.op === "conversation.get") { if (!logged) throw error("login_required"); return get(); }
      if (request.op === "connection.login") { logged = true; return { op: "connection.login" }; }
      throw new Error(request.op);
    });
    fireEvent.click(await screen.findByRole("button", { name: "로그인" }));
    await screen.findByText("기록");
    state.emit({ event: "conversation.error", thread_id: "thread-1", code: "login_required" });
    fireEvent.click(await screen.findByRole("button", { name: "로그인" }));
    await screen.findByText("기록");
    expect(state.call).toHaveBeenCalledWith({ op: "connection.login", window_id: state.window.id, permission: "login" });
  });
  it("묶음 충돌에서 시작과 입력을 숨긴다", async () => {
    setup(async () => { throw error("binding_conflict"); });
    expect((await screen.findByRole("alert")).textContent).toContain("저장된 대화와 제공자의 대화가 다릅니다");
    expect(screen.queryByRole("button", { name: "시작" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "메시지" })).toBeNull();
  });
  it("미접수 초안을 복원하고 같은 요청 id와 첨부로 재전송한다", async () => {
    const state = setup(async (request) => {
      if (request.op === "conversation.get") return get();
      if (request.op === "conversation.send") return { op: "conversation.send" };
      throw new Error(request.op);
    });
    const input = await screen.findByRole("textbox", { name: "메시지" });
    state.emit({ event: "conversation.draft", window_id: state.window.id, request_id: "retry-id", text: "보존된 글", attachments: [{ name: "note.txt", mime: "text/plain", data_base64: "aGVsbG8=" }], failed: false });
    expect((input as HTMLTextAreaElement).value).toBe("보존된 글");
    expect(screen.getByText("note.txt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(state.call).toHaveBeenCalledWith({ op: "conversation.send", window_id: state.window.id, request_id: "retry-id", text: "보존된 글", attachments: [{ name: "note.txt", mime: "text/plain", data_base64: "aGVsbG8=" }] }));
  });
  it("제공자가 실패한 초안은 새 요청 id로 보낸다", async () => {
    const state = setup(async (request) => {
      if (request.op === "conversation.get") return get();
      if (request.op === "conversation.send") return { op: "conversation.send" };
      throw new Error(request.op);
    });
    await screen.findByRole("textbox", { name: "메시지" });
    state.emit({ event: "conversation.draft", window_id: state.window.id, request_id: "failed-id", text: "실패한 글", attachments: [], failed: true });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => {
      const request = state.call.mock.calls.map(([value]) => value).find((value) => value.op === "conversation.send");
      expect(request).toMatchObject({ op: "conversation.send", text: "실패한 글" });
      expect(request?.op === "conversation.send" && request.request_id).not.toBe("failed-id");
    });
  });
  it("알 수 없는 스레드의 오류는 시작 판으로 바꾸지 않는다", async () => {
    setup(async () => { throw error("not_found"); });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "시작" })).toBeNull();
  });

});
