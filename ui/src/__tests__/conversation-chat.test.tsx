import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatComposer } from "../blocks/chat-composer";
import { ChatHistory } from "../blocks/chat-history";
import { HistoryAttachmentView } from "../blocks/agent-attachments";
import { AgentChatBlock, modelAvailabilityDescription } from "../blocks/agent-chat";
import { Select } from "../components/select-toggle";
import { WindowDataProvider } from "../data/window-data";
import type { AppDefinition, Binding, BindingValue, CoreError, CoreEvent, CoreReply, CoreRequest, ConversationItem, ConversationThread, ShellSnapshot } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { createFakeTransport } from "../core/fake-transport";
import { makeTestSnapshot } from "./fixtures";

const markdownRenderCount = vi.hoisted(() => ({ value: 0 }));
vi.mock("react-markdown", async () => {
  const React = await import("react");
  const actual = await vi.importActual<typeof import("react-markdown")>("react-markdown");
  return {
    ...actual,
    default: (props: React.ComponentProps<typeof actual.default>) => {
      markdownRenderCount.value += 1;
      return React.createElement(actual.default, props);
    },
  };
});

const definition: AppDefinition = {
  id: "provider-chat", name: "대화", requires: { blocks: 2, modules: { agent: 3 } }, permissions: [], state: {}, ui: { type: "chat" },
  agent: { protocol: "conversation-v1", permission: "login", base_path: "api", namespace: "n", profile: "p", collection: "c", model_order: [], selected_model: "", title_template: "", initial_instruction_template: "", instructions_template: "", thread_entry: "thread" },
};
const thread: ConversationThread = { id: "thread-1", external: { namespace: "n", key: "k" }, title: "대화", model: { id: "m", label: "모델", group: { id: "node-a", label: "노드 A" } }, profile: { id: "profile-a", label: "서소영" }, created_at: "2026-10-30T00:00:00Z", archived: false };
const item = (id: string, text: string): ConversationItem => ({ id, kind: "assistant", text, at: "2026-10-30T00:00:00Z", attachments: [] });
const models = [
  { id: "m", label: "모델", available: true, group: { id: "node-a", label: "노드 A" } },
  { id: "m-same", label: "모델 같은 노드", available: true, group: { id: "node-a", label: "노드 A" } },
  { id: "off", label: "불가", available: false, reason: "한도 거부 중", reason_code: "limit_rejected", resets_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), group: { id: "node-a", label: "노드 A" } },
  { id: "m2", label: "모델 2", available: true, group: { id: "node-b", label: "노드 B" } },
];
const profiles = [{ id: "profile-a", label: "서소영", available: true }, { id: "profile-b", label: "키키", available: true }];
function setup(handler: (request: CoreRequest) => Promise<CoreReply>, appDefinition: AppDefinition = definition, initialLoading: Binding = false) {
  const snapshot = makeTestSnapshot({ definitions: [appDefinition] });
  snapshot.link = { state: "connected", mode: "remote", server_url: "https://example.test", device_name: "시험" };
  const listeners = new Set<(event: CoreEvent) => void>();
  const snapshotListeners = new Set<() => void>();
  const transport = createFakeTransport({ snapshot, folder: null, files: {} });
  let currentSnapshot: ShellSnapshot | null = snapshot;
  const unsubscribeTransport = transport.subscribe((event) => {
    if (event.event !== "state.changed") return;
    currentSnapshot = event.snapshot;
    snapshotListeners.forEach((listener) => listener());
  });
  const call = vi.fn(async (request: CoreRequest): Promise<CoreReply> => {
    if (request.op === "data.attach") return { op: "data.attach", view: { values: {}, sources: {} } };
    if (request.op === "data.detach") return { op: "data.detach" };
    return handler(request);
  });
  const store = { call, getSnapshot: () => currentSnapshot, getError: () => null, subscribe: (fn: () => void) => { snapshotListeners.add(fn); return () => snapshotListeners.delete(fn); }, subscribeEvents: (fn: (event: CoreEvent) => void) => { listeners.add(fn); return () => listeners.delete(fn); }, ready: Promise.resolve(), dispose: unsubscribeTransport } as unknown as ShellStore;
  const window = snapshot.shared.windows[0];
  const context = { store, window: { id: window.id, app_id: window.app_id, app_version: window.app_version, desktop_id: window.desktop_id }, definition: appDefinition };
  const view = render(<WindowDataProvider store={store} windowId={window.id} definition={appDefinition}><AgentChatBlock block={{ type: "chat", loading: initialLoading }} context={context} pointer="/ui" /></WindowDataProvider>);
  return {
    call,
    window,
    setLoading: (loading: boolean) => view.rerender(<WindowDataProvider store={store} windowId={window.id} definition={appDefinition}><AgentChatBlock block={{ type: "chat", loading }} context={context} pointer="/ui" /></WindowDataProvider>),
    remount: () => view.rerender(<WindowDataProvider store={store} windowId={window.id} definition={appDefinition}><AgentChatBlock key="new-branch" block={{ type: "chat", loading: initialLoading }} context={context} pointer="/ui/other" /></WindowDataProvider>),
    emit: (event: CoreEvent) => act(() => { listeners.forEach((fn) => fn(event)); }),
    updateSnapshot: () => {
      const nextSnapshot = structuredClone(snapshot);
      nextSnapshot.shared.windows[0].state.changed_by_other_window = true;
      act(() => transport.emit({ event: "state.changed", snapshot: nextSnapshot }));
    },
    updateLink: (link: ShellSnapshot["link"]) => {
      const nextSnapshot = structuredClone(snapshot);
      nextSnapshot.link = link;
      act(() => transport.emit({ event: "state.changed", snapshot: nextSnapshot }));
    },
  };
}
const get = (value: ConversationThread | null = thread, profile = "profile-a"): Extract<CoreReply, { op: "conversation.get" }> => ({ op: "conversation.get", thread: value, items: [item("1", "기록")], cursor: "c", next_before: "older", models, profiles, start: { profile, model: "m" }, own: null, adoptable: [] });
const error = (code: CoreError["code"]): CoreError => code === "binding_conflict"
  ? { id: "CONV_CONTEXT_SAVED_BINDING_MISMATCH", code, message: "workspace: 저장된 대화 연결 정보가 현재 설정과 맞지 않습니다. 에이전트에게 이 오류 코드를 전하세요.", details: [] }
  : code === "login_required"
    ? { id: "CONV_STREAM_LOGIN_REQUIRED", code, message: "대화 제공자 연결 test: 로그인이 필요합니다. 로그인한 뒤 대화를 다시 여세요.", details: [] }
    : { code, message: "실패", details: [] };
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as unknown as CanvasRenderingContext2D); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function setupMarkdownRenderCounter() {
  markdownRenderCount.value = 0;
  const items = Array.from({ length: 24 }, (_, index) => item(`markdown-${index}`, `기록 ${index}`));
  const state = setup(async (request) => request.op === "conversation.get" ? { ...get(), items } : (() => { throw new Error(request.op); })());
  await waitFor(() => expect(markdownRenderCount.value).toBe(items.length));
  markdownRenderCount.value = 0;
  return state;
}

describe("대화 제공자 화면", () => {
  it("전송 실패가 다시 마운트된 뒤 돌아와도 초안과 첨부를 복원한다", async () => {
    let rejectSend!: (reason: unknown) => void;
    const send = new Promise<CoreReply>((_resolve, reject) => { rejectSend = reject; });
    const state = setup(async (request) => request.op === "conversation.get" ? get() : request.op === "conversation.send" ? send : (() => { throw new Error(request.op); })());
    await screen.findByText("기록");
    const input = screen.getByRole("textbox", { name: "메시지" }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "실패할 초안" } });
    fireEvent.change(input.parentElement!.querySelector('input[type="file"]')!, { target: { files: [new File(["내용"], "첨부.txt", { type: "text/plain" })] } });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(state.call.mock.calls.some(([request]) => request.op === "conversation.send")).toBe(true));
    state.remount();
    await screen.findByText("기록");
    const next = screen.getByRole("textbox", { name: "메시지" }) as HTMLTextAreaElement;
    expect(next).not.toBe(input);
    fireEvent.change(next, { target: { value: "새로 쓴 글" } });
    await act(async () => rejectSend(new Error("전송 실패")));
    await waitFor(() => expect(next.value).toBe("실패할 초안\n새로 쓴 글"));
    expect(screen.getByText("첨부.txt")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("전송 실패");
  });
  it("불러오는 동안 기록만 뼈대로 바꾸고 입력과 초안을 유지한다", async () => {
    const state = setup(async (request) => request.op === "conversation.get" ? get() : (() => { throw new Error(request.op); })());
    await screen.findByText("기록");
    const input = screen.getByRole("textbox", { name: "메시지" }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "남길 초안" } });
    state.setLoading(true);
    expect(screen.getByLabelText("불러오는 중")).toBeTruthy();
    expect(screen.queryByText("기록")).toBeNull();
    expect(screen.getByLabelText("메시지")).toBe(input);
    expect(input.disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByLabelText("파일 첨부"));
    expect(state.call.mock.calls.filter(([request]) => request.op === "conversation.send")).toHaveLength(0);
    state.setLoading(false);
    expect(screen.getByLabelText("메시지")).toBe(input);
    expect(input.value).toBe("남길 초안");
    expect(screen.getByText("기록")).toBeTruthy();
  });
  it("loading 바인딩 오류와 로그인 필요를 기록 칸에 보이고 입력을 잠근다", async () => {
    const binding: Binding = { expr: "$data.loading" };
    const state = setup(async (request) => request.op === "conversation.get" ? get() : (() => { throw new Error(request.op); })(), definition, binding);
    const update = (value: BindingValue) => state.emit({ event: "data.update", window_id: state.window.id, view: { sources: {}, values: { "/ui/loading": value } } });
    update({ status: "ready", value: "true" });
    await screen.findByText("기록");
    const input = screen.getByLabelText("메시지") as HTMLTextAreaElement;
    expect(input.disabled).toBe(false);
    update({ status: "failed", message: "불러오기 실패", retry: [] });
    expect(await screen.findByText("불러오기 실패")).toBeTruthy();
    expect(input.disabled).toBe(true);
    expect(screen.getByLabelText("메시지")).toBe(input);
    update({ status: "login_required", permission: "login" });
    expect(await screen.findByText("로그인이 필요합니다")).toBeTruthy();
    expect(input.disabled).toBe(true);
    update({ status: "ready", value: false });
    expect(await screen.findByText("기록")).toBeTruthy();
    expect(input.disabled).toBe(false);
  });
  it("입력 한 글자는 이미 표시한 대화를 다시 파싱하지 않는다", async () => {
    await setupMarkdownRenderCounter();
    fireEvent.change(await screen.findByRole("textbox", { name: "메시지" }), { target: { value: "가" } });
    expect(markdownRenderCount.value).toBe(0);
  });
  it("창 상태 스냅샷 변경은 이미 표시한 대화를 다시 파싱하지 않는다", async () => {
    const state = await setupMarkdownRenderCounter();
    state.updateSnapshot();
    expect(markdownRenderCount.value).toBe(0);
  });
  it("연결된 서버 대상이 바뀌면 대화를 다시 불러온다", async () => {
    const state = setup(async (request) => request.op === "conversation.get" ? get() : (() => { throw new Error(request.op); })());
    await screen.findByText("기록");
    state.updateLink({ state: "connected", mode: "remote", server_url: "https://other.test", device_name: "시험" });
    await waitFor(() => expect(state.call.mock.calls.filter(([request]) => request.op === "conversation.get")).toHaveLength(2));
  });
  it("연결 스냅샷 누락 오류는 다시 시도하면 대화를 불러온다", async () => {
    const message = "연결 provider 설정을 찾지 못했습니다. 연결을 설정한 뒤 다시 시도하세요.";
    let connected = false;
    const state = setup(async (request) => {
      if (request.op !== "conversation.get") throw new Error(request.op);
      if (!connected) throw { id: "CONN_AUTHORIZE_CONNECTION_MISSING", code: "server", message, details: [] };
      return get();
    });
    expect(await screen.findByText(message)).toBeTruthy();
    connected = true;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("기록")).toBeTruthy();
    expect(state.call.mock.calls.filter(([request]) => request.op === "conversation.get")).toHaveLength(2);
  });
  it("text update 한 번은 진행 글만 파싱한다", async () => {
    const state = await setupMarkdownRenderCounter();
    state.emit({ event: "conversation.update", thread_id: "thread-1", update: { kind: "text", stream_id: "stream-1", text: "새 진행 글" } });
    await waitFor(() => expect(markdownRenderCount.value).toBe(1));
    expect(markdownRenderCount.value).toBe(1);
  });
  it("같은 프레임의 text 뒤에 답이 끝나면 진행 글이 남지 않는다", async () => {
    const state = setup(async (request) => request.op === "conversation.get" ? get() : (() => { throw new Error(request.op); })());
    await screen.findByText("기록");
    state.emit({ event: "conversation.update", thread_id: "thread-1", update: { kind: "text", stream_id: "stream-1", text: "보류할 진행문" } });
    state.emit({ event: "conversation.update", thread_id: "thread-1", update: { kind: "item", item: item("2", "완료된 답") } });
    expect(await screen.findByText("완료된 답")).toBeTruthy();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(screen.queryByText("보류할 진행문")).toBeNull();
  });
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
    expect(await screen.findByText("진행 중")).toBeTruthy();
    expect(screen.queryByText("다른 대화")).toBeNull();
    expect(screen.queryByText("진행진행 중")).toBeNull();
    state.emit({ event: "conversation.update", thread_id: "thread-1", update: { kind: "item", item: item("1", "기록") } });
    expect(screen.getAllByText("기록")).toHaveLength(1);
  });
  it("시작 판은 실행 위치별 모델만 보이고 고른 위치의 첫 쓸 수 있는 모델로 생성한다", async () => {
    let created = false;
    const state = setup(async (request) => {
      if (request.op === "conversation.get") return get(created ? thread : null);
      if (request.op === "conversation.create") { created = true; return { op: "conversation.create", thread }; }
      throw new Error(request.op);
    });
    await screen.findByRole("button", { name: "프로필" });
    expect(screen.getByRole("button", { name: "프로필" }).textContent).toContain("서소영");
    expect(screen.getByRole("button", { name: "모델" }).textContent).toContain("모델");
    expect(screen.getByRole("button", { name: "실행 위치" }).textContent).toContain("노드 A");
    expect(screen.queryByRole("button", { name: /불가/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "모델" }));
    expect(screen.getByRole("menuitem", { name: /불가/ })).toBeTruthy();
    expect((screen.getByRole("menuitem", { name: /불가/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/한도 거부 중/)).toBeTruthy();
    expect(screen.getByText(/풀림/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "모델" }));
    fireEvent.click(screen.getByRole("button", { name: "실행 위치" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "노드 B" }));
    expect(screen.getByRole("button", { name: "모델" }).textContent).toContain("모델 2");
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await screen.findByRole("textbox", { name: "메시지" });
    expect(state.call).toHaveBeenCalledWith({ op: "conversation.create", window_id: state.window.id, model: "m2", profile: "profile-a" });
  });
  it("실행 위치가 하나면 칸을 숨기고 모델 메뉴에서 바로 모델을 고른다", async () => {
    let created = false;
    const singlePlaceModels = models.filter((model) => model.group?.id === "node-a");
    const state = setup(async (request) => {
      if (request.op === "conversation.get") return { ...get(created ? thread : null), models: singlePlaceModels, start: { profile: "profile-a", model: "m" } };
      if (request.op === "conversation.create") { created = true; return { op: "conversation.create", thread }; }
      throw new Error(request.op);
    });
    await screen.findByRole("button", { name: "모델" });
    expect(screen.queryByRole("button", { name: "실행 위치" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "모델" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "모델 같은 노드" }));
    expect(screen.getByRole("button", { name: "모델" }).textContent).toContain("모델 같은 노드");
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await screen.findByRole("textbox", { name: "메시지" });
    expect(state.call).toHaveBeenCalledWith({ op: "conversation.create", window_id: state.window.id, model: "m-same", profile: "profile-a" });
  });
  it("모두 막힌 실행 위치는 사유를 보이고 눌러도 선택을 바꾸지 않는다", async () => {
    const blockedModel = { id: "blocked", label: "막힌 모델", available: false, reason: "한도 거부 중", reason_code: "limit_rejected", resets_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), group: { id: "node-c", label: "노드 C" } };
    const state = setup(async (request) => {
      if (request.op === "conversation.get") return { ...get(), models: [...models, blockedModel] };
      throw new Error(request.op);
    });
    await screen.findByText("기록");
    fireEvent.click(screen.getByRole("button", { name: "실행 위치" }));
    const blockedPlace = screen.getByRole("menuitem", { name: /노드 C/ }) as HTMLButtonElement;
    expect(blockedPlace.disabled).toBe(true);
    expect(screen.getByText(/한도 거부 중/)).toBeTruthy();
    fireEvent.click(blockedPlace);
    expect(screen.getByRole("button", { name: "실행 위치" }).textContent).toContain("노드 A");
    expect(screen.getByRole("button", { name: "모델" }).textContent).toContain("모델");
    expect(state.call).not.toHaveBeenCalledWith(expect.objectContaining({ op: "conversation.switch", model: "blocked" }));
  });
  it("시작 프로필을 바꾸면 그 프로필의 모델을 다시 받고 선택값으로 생성한다", async () => {
    let created = false;
    const state = setup(async (request) => {
      if (request.op === "conversation.get") {
        if (created) return get(thread);
        const profile = request.profile ?? "profile-a";
        const reply = get(null, profile);
        return { ...reply, models: profile === "profile-b" ? models.filter((model) => model.group?.id === "node-b") : models, start: { profile, model: profile === "profile-b" ? "m2" : "m" } };
      }
      if (request.op === "conversation.create") { created = true; return { op: "conversation.create", thread }; }
      throw new Error(request.op);
    });
    await screen.findByRole("button", { name: "프로필" });
    fireEvent.click(screen.getByRole("button", { name: "프로필" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "키키" }));
    await waitFor(() => expect(state.call).toHaveBeenCalledWith({ op: "conversation.get", window_id: state.window.id, profile: "profile-b" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "모델" }).textContent).toContain("모델 2"));
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await screen.findByRole("textbox", { name: "메시지" });
    expect(state.call).toHaveBeenCalledWith({ op: "conversation.create", window_id: state.window.id, model: "m2", profile: "profile-b" });
  });
  it("프로필을 바꿔도 실행 위치가 남아 있으면 같은 이름 모델을 유지한다", async () => {
    let created = false;
    const nextProfileModels = [
      { id: "start-b", label: "기본 모델", available: true, group: { id: "node-a", label: "노드 A" } },
      { id: "m2-profile-b", label: "모델 2", available: true, group: { id: "node-b", label: "노드 B" } },
    ];
    const state = setup(async (request) => {
      if (request.op === "conversation.get") {
        if (created) return get(thread);
        const profile = request.profile ?? "profile-a";
        return profile === "profile-b"
          ? { ...get(null, profile), models: nextProfileModels, start: { profile, model: "start-b" } }
          : get(null, profile);
      }
      if (request.op === "conversation.create") { created = true; return { op: "conversation.create", thread }; }
      throw new Error(request.op);
    });
    await screen.findByRole("button", { name: "프로필" });
    fireEvent.click(screen.getByRole("button", { name: "실행 위치" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "노드 B" }));
    expect(screen.getByRole("button", { name: "모델" }).textContent).toContain("모델 2");
    fireEvent.click(screen.getByRole("button", { name: "프로필" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "키키" }));
    await waitFor(() => expect(state.call).toHaveBeenCalledWith({ op: "conversation.get", window_id: state.window.id, profile: "profile-b" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "실행 위치" }).textContent).toContain("노드 B"));
    expect(screen.getByRole("button", { name: "모델" }).textContent).toContain("모델 2");
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await screen.findByRole("textbox", { name: "메시지" });
    expect(state.call).toHaveBeenCalledWith({ op: "conversation.create", window_id: state.window.id, model: "m2-profile-b", profile: "profile-b" });
    expect(state.call).not.toHaveBeenCalledWith({ op: "conversation.create", window_id: state.window.id, model: "start-b", profile: "profile-b" });
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
  it("로그인 필요 표면은 합성 로그인 누름을 막는다", async () => {
    let logged = false;
    const state = setup(async (request) => {
      if (request.op === "conversation.get") { if (!logged) throw error("login_required"); return get(); }
      if (request.op === "connection.login") { logged = true; return { op: "connection.login" }; }
      throw new Error(request.op);
    });
    fireEvent.click(await screen.findByRole("button", { name: "로그인" }));
    expect(state.call.mock.calls.some(([request]) => request.op === "connection.login")).toBe(false);
    expect(screen.getByRole("button", { name: "로그인" }).hasAttribute("data-ks-user-consent")).toBe(true);
  });
  it("묶음 충돌에서 시작과 입력을 숨긴다", async () => {
    setup(async () => { throw error("binding_conflict"); });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("CONV_CONTEXT_SAVED_BINDING_MISMATCH");
    expect(alert.textContent).toContain("현재 설정과 맞지 않습니다");
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
  it("시작 판은 기존 대화 연결 줄을 시작 줄과 함께 보이고 후보가 없으면 숨긴다", async () => {
    const adoptable = [
      { id: "session-1", title: "다른 대화", updated_at: "2026-11-07T09:00:00Z" },
      { id: "session-2", title: "서소영 PAS", profile: { id: "profile-a", label: "서소영" }, updated_at: "2026-11-08T09:00:00Z" },
    ];
    setup(async (request) => request.op === "conversation.get" ? { ...get(null), adoptable } : (() => { throw new Error(request.op); })());
    expect(await screen.findByRole("button", { name: "시작" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "기존 대화" })).toBeTruthy();
    cleanup();
    setup(async (request) => request.op === "conversation.get" ? { ...get(null), adoptable: [] } : (() => { throw new Error(request.op); })());
    expect(await screen.findByRole("button", { name: "시작" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "기존 대화" })).toBeNull();
  });
  it("이 작업의 대화가 있으면 시작 줄을 숨기고 그 대화를 먼저 고른 채로 보인다", async () => {
    const own = { ...thread, title: "작업 1 PAS" };
    setup(async (request) => request.op === "conversation.get"
      ? { ...get(null), own, adoptable: [{ id: "session-2", title: "", updated_at: "2026-11-07T09:00:00Z" }] }
      : (() => { throw new Error(request.op); })());
    const attach = await screen.findByRole("button", { name: "기존 대화" });
    expect(attach.textContent).toContain("작업 1 PAS (이 작업)");
    expect(screen.queryByRole("button", { name: "시작" })).toBeNull();
    expect(screen.queryByRole("button", { name: "프로필" })).toBeNull();
  });
  it("연결을 누르면 고른 대화 id로 연결하고 그 대화를 연다", async () => {
    let attached = false;
    const state = setup(async (request) => {
      if (request.op === "conversation.get") return attached ? { ...get(thread), attached: true } : { ...get(null), adoptable: [
        { id: "session-1", title: "다른 대화", updated_at: "2026-11-07T09:00:00Z" },
        { id: "session-2", title: "서소영 PAS", updated_at: "2026-11-08T09:00:00Z" },
      ] };
      if (request.op === "conversation.attach") { attached = true; return { op: "conversation.attach", thread }; }
      throw new Error(request.op);
    });
    fireEvent.click(await screen.findByRole("button", { name: "기존 대화" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "서소영 PAS" }));
    fireEvent.click(screen.getByRole("button", { name: "연결" }));
    await screen.findByRole("textbox", { name: "메시지" });
    expect(state.call).toHaveBeenCalledWith({ op: "conversation.attach", window_id: state.window.id, thread_id: "session-2" });
  });
  it("연결한 대화 머리는 고르기 칸 없이 이름과 모델을 보이고 대화 바꾸기를 둔다", async () => {
    setup(async (request) => request.op === "conversation.get" ? { ...get(thread), attached: true } : (() => { throw new Error(request.op); })());
    await screen.findByText("기록");
    expect(screen.getByText("대화 · 모델")).toBeTruthy();
    expect(screen.getByRole("button", { name: "대화 바꾸기" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "프로필" })).toBeNull();
    expect(screen.queryByRole("button", { name: "모델" })).toBeNull();
    expect(screen.queryByRole("button", { name: "실행 위치" })).toBeNull();
    cleanup();
    setup(async (request) => request.op === "conversation.get" ? { ...get({ ...thread, title: "" }), attached: true } : (() => { throw new Error(request.op); })());
    await screen.findByText("기록");
    expect(screen.getByText("이름 없는 대화 · 모델")).toBeTruthy();
  });
  it("자기 대화는 제목 막대 다음에 설정 막대를 보인다", async () => {
    setup(async (request) => request.op === "conversation.get" ? get(thread) : (() => { throw new Error(request.op); })());
    await screen.findByText("기록");
    const toolbars = document.querySelectorAll(".ks-agent-chat-toolbar");
    expect(toolbars).toHaveLength(2);
    expect(toolbars[0].textContent).toBe("대화");
    expect(toolbars[0].querySelector('[aria-label="대화 바꾸기"]')).toBeTruthy();
    expect(toolbars[1].querySelector('[aria-label="프로필"]')).toBeTruthy();
    expect(toolbars[1].querySelector('[aria-label="대화 바꾸기"]')).toBeNull();
  });
  it("대화 바꾸기는 대화 머리에서 연결을 풀고 시작 판으로 돌아간다", async () => {
    let attached = true;
    const state = setup(async (request) => {
      if (request.op === "conversation.get") return attached
        ? get(thread)
        : { ...get(null), adoptable: [{ id: "session-2", title: "서소영 PAS", updated_at: "2026-11-08T09:00:00Z" }] };
      if (request.op === "conversation.detach") { attached = false; return { op: "conversation.detach" }; }
      throw new Error(request.op);
    });
    await screen.findByText("기록");
    expect(screen.getByRole("button", { name: "프로필" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "대화 바꾸기" }));
    expect(await screen.findByRole("button", { name: "기존 대화" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "메시지" })).toBeNull();
    expect(state.call).toHaveBeenCalledWith({ op: "conversation.detach", window_id: state.window.id });
  });

});

describe("공용 대화 부품", () => {
  it("자리 표시를 거쳐 다른 기록을 불러오면 바닥을 따라간다", () => {
    const followTail = { current: false };
    const snapshot = makeTestSnapshot({ definitions: [definition] });
    const store = {
      getSnapshot: () => snapshot, subscribe: () => () => {}, subscribeEvents: () => () => {},
      call: vi.fn(async (request: CoreRequest) => request.op === "data.attach"
        ? { op: "data.attach", view: { values: {}, sources: {} } }
        : { op: "data.detach" }),
    } as unknown as ShellStore;
    const windowId = snapshot.shared.windows[0].id;
    const props = {
      items: [item("old", "이전 기록")], pending: null, delta: "", busy: false, tool: null,
      historyRef: createRef<HTMLDivElement>(), followTail,
      renderAttachment: () => null, renderPendingAttachment: () => null,
    };
    const wrap = (state: Exclude<BindingValue, { status: "ready" }> | null, items = props.items) => <WindowDataProvider store={store} windowId={windowId} definition={definition}>
      <ChatHistory {...props} items={items} state={state} />
    </WindowDataProvider>;
    const { rerender } = render(wrap(null));
    rerender(wrap({ status: "loading" }));
    expect(followTail.current).toBe(true);
    rerender(wrap(null, [item("new", "새 기록")]));
    expect(followTail.current).toBe(true);
  });

  it("자리 표시 없이 기록 전체가 바뀌면 바닥으로 이동한다", () => {
    const followTail = { current: false };
    const historyRef = createRef<HTMLDivElement>();
    const props = {
      items: [item("old", "이전 기록")], pending: null, delta: "", busy: false, tool: null,
      historyRef, followTail, renderAttachment: () => null, renderPendingAttachment: () => null,
    };
    const { rerender } = render(<ChatHistory {...props} />);
    Object.defineProperty(historyRef.current!, "scrollHeight", { configurable: true, value: 1000 });
    rerender(<ChatHistory {...props} items={[item("new", "새 기록")]} />);
    expect(followTail.current).toBe(true);
    expect(historyRef.current!.scrollTop).toBe(1000);
  });

  it("기록 앞이나 뒤에 항목이 붙으면 읽던 자리를 유지한다", () => {
    const followTail = { current: false };
    const original = item("original", "읽던 기록");
    const props = {
      items: [original], pending: null, delta: "", busy: false, tool: null,
      historyRef: createRef<HTMLDivElement>(), followTail,
      renderAttachment: () => null, renderPendingAttachment: () => null,
    };
    const { rerender } = render(<ChatHistory {...props} />);
    const appended = [original, item("later", "새 답변")];
    rerender(<ChatHistory {...props} items={appended} />);
    expect(followTail.current).toBe(false);
    rerender(<ChatHistory {...props} items={[item("older", "옛 기록"), ...appended]} />);
    expect(followTail.current).toBe(false);
  });

  it("생각 중은 줄 선 말과 넘어가기 전 말 뒤에 놓는다", () => {
    render(<ChatHistory items={[]} pending={{ text: "새 말", attachments: [], afterResponse: true }} delta="" busy tool={null}
      historyRef={createRef<HTMLDivElement>()} followTail={{ current: true }}
      renderAttachment={() => null} renderPendingAttachment={() => null} queued={<div>줄 선 말</div>} />);
    const rows = [...screen.getByRole("log").querySelector(".ks-agent-chat-content")!.children].map((node) => node.textContent);
    expect(rows).toEqual(["줄 선 말", "새 말", "생각 중입니다…"]);
  });
  it("사용자의 답을 기다리는 footer에서는 생각 중 표시를 숨긴다", () => {
    const props = {
      items: [], pending: null, delta: "", busy: true, tool: null,
      historyRef: createRef<HTMLDivElement>(), followTail: { current: true },
      renderAttachment: () => null, renderPendingAttachment: () => null,
      footer: <button type="button">허용</button>,
    };
    const { rerender } = render(<ChatHistory {...props} hideThinking />);
    expect(screen.queryByLabelText("생각 중입니다")).toBeNull();
    rerender(<ChatHistory {...props} />);
    expect(screen.getByLabelText("생각 중입니다")).toBeTruthy();
  });

  it("응답 중 보낸 대기 말은 진행 글과 이미 줄 선 말 뒤에 놓는다", () => {
    render(<ChatHistory
      items={[item("one", "기록")]} pending={{ text: "새 대기 말", attachments: [], afterResponse: true }} delta="진행 글" busy tool={null}
      historyRef={createRef<HTMLDivElement>()} followTail={{ current: true }}
      renderAttachment={() => null} renderPendingAttachment={() => null}
      queued={<div>먼저 줄 선 말</div>}
    />);
    const rows = [...screen.getByRole("log").querySelector(".ks-agent-chat-content")!.children].map((node) => node.textContent);
    expect(rows).toEqual(["기록", "진행 글", "먼저 줄 선 말", "새 대기 말"]);
  });

  it("기록, 진행 줄, footer를 기존 순서로 그린다", () => {
    const historyRef = createRef<HTMLDivElement>();
    render(<ChatHistory
      items={[item("one", "기록")]} pending={null} delta="" busy tool="문서 읽기"
      historyRef={historyRef} followTail={{ current: true }}
      renderAttachment={() => null} renderPendingAttachment={() => null}
      footer={<button type="button">도구 승인</button>}
    />);
    const history = screen.getByRole("log", { name: "대화 기록" });
    const content = history.querySelector(".ks-agent-chat-content");
    expect(within(history).getByText("기록")).toBeTruthy();
    expect(within(history).getByText("생각 중입니다… · 문서 읽기")).toBeTruthy();
    expect(content?.lastElementChild?.textContent).toBe("도구 승인");
  });

  it("입력은 Enter만 보내고 Shift+Enter와 IME Enter는 보존한다", () => {
    const onSend = vi.fn();
    render(<ChatComposer
      draft="" onDraft={() => {}} inputRef={createRef<HTMLTextAreaElement>()} attachments={[]} onAttachmentsChange={() => {}}
      onSend={onSend} disabled={false} busy={false} sharedWindows={[]}
      onRemoveShared={() => {}} onPreview={() => {}} error={null} onError={() => {}}
    />);
    const input = screen.getByRole("textbox", { name: "메시지" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229, isComposing: true });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith();
  });

  it("채팅 영역에 붙여넣은 이미지를 입력칸 밖에서도 첨부로 받는다", async () => {
    if (!URL.createObjectURL) URL.createObjectURL = () => "";
    if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:시험");
    setup(async (request) => request.op === "conversation.get" ? get() : (() => { throw new Error(request.op); })());
    await screen.findByText("기록");
    const section = document.querySelector<HTMLElement>(".ks-agent-chat")!;
    const image = new File(["png"], "image.png", { type: "image/png" });
    const clipboardData = { items: [{ kind: "file", getAsFile: () => image }], files: [image], types: ["Files"], getData: () => "" } as unknown as DataTransfer;
    fireEvent.paste(section, { clipboardData });
    expect(await screen.findByText("붙여넣은 이미지.png")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "메시지" }));
  });

  it("기록 그림은 불러오는 중과 표시된 뒤 같은 틀을 쓴다", async () => {
    const attachment = { id: "0", name: "기록.png", mime: "image/png" };
    let resolveLoad!: (value: { mime: string; data_base64: string }) => void;
    const load = () => new Promise<{ mime: string; data_base64: string }>((resolve) => { resolveLoad = resolve; });
    const { container } = render(<HistoryAttachmentView attachment={attachment} cacheKey={["frame-test"]} load={load} open={async () => {}} onPreview={() => {}} onError={() => {}} />);
    expect(container.querySelector(".ks-agent-attachment-placeholder")?.classList.contains("ks-agent-attachment-image")).toBe(true);
    await act(async () => resolveLoad({ mime: "image/png", data_base64: "YQ==" }));
    expect(screen.getByRole("button", { name: "기록.png" }).classList.contains("ks-agent-attachment-image")).toBe(true);
  });

  it("기존 대화의 프로필 변경은 확인 뒤 switch하고 notice를 보인다", async () => {
    const changed: ConversationThread = { ...thread, profile: { id: "profile-b", label: "키키" } };
    let current = thread;
    const state = setup(async (request) => {
      if (request.op === "conversation.get") return get(current, request.profile ?? "profile-a");
      if (request.op === "conversation.switch") { current = changed; return { op: "conversation.switch", thread: changed, notices: ["키키 프로필로 바꿨습니다"] }; }
      throw new Error(request.op);
    });
    await screen.findByText("기록");
    fireEvent.click(screen.getByRole("button", { name: "프로필" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "키키" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("키키(으)로 바꾸면 새 세션으로 이어집니다. 지난 대화는 요약으로 넘어갑니다.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "바꾸기" }));
    await waitFor(() => expect(state.call).toHaveBeenCalledWith({ op: "conversation.switch", window_id: state.window.id, profile: "profile-b" }));
    expect(await screen.findByText("키키 프로필로 바꿨습니다")).toBeTruthy();
  });

  it("같은 실행 위치의 모델은 바로 switch하고 다른 위치는 확인 뒤 switch한다", async () => {
    let current = thread;
    const state = setup(async (request) => {
      if (request.op === "conversation.get") return get(current);
      if (request.op === "conversation.switch") {
        current = request.model === "m-same"
          ? { ...thread, model: { id: "m-same", label: "모델 같은 노드", group: { id: "node-a", label: "노드 A" } } }
          : { ...thread, model: { id: "m2", label: "모델 2", group: { id: "node-b", label: "노드 B" } } };
        return { op: "conversation.switch", thread: current, notices: [] };
      }
      throw new Error(request.op);
    });
    await screen.findByText("기록");
    fireEvent.click(screen.getByRole("button", { name: "모델" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /모델 같은 노드/ }));
    await waitFor(() => expect(state.call).toHaveBeenCalledWith({ op: "conversation.switch", window_id: state.window.id, model: "m-same" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "실행 위치" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "노드 B" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("노드 B의 모델 2(으)로 바꾸면 새 세션으로 이어집니다. 지난 대화는 요약으로 넘어갑니다.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "실행 위치" }).textContent).toContain("노드 A");
    expect(state.call).not.toHaveBeenCalledWith({ op: "conversation.switch", window_id: state.window.id, model: "m2" });
    fireEvent.click(screen.getByRole("button", { name: "실행 위치" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "노드 B" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "바꾸기" }));
    await waitFor(() => expect(state.call).toHaveBeenCalledWith({ op: "conversation.switch", window_id: state.window.id, model: "m2" }));
  });

  it("다른 실행 위치 전환은 확인창을 닫고 기다린 뒤 새 위치와 모델을 보인다", async () => {
    let current = thread;
    let resolveSwitch!: (reply: CoreReply) => void;
    let resolveReload!: (reply: CoreReply) => void;
    let getCount = 0;
    setup(async (request) => {
      if (request.op === "conversation.get") {
        getCount += 1;
        if (getCount === 1) return get(current);
        return new Promise<CoreReply>((resolve) => { resolveReload = resolve; });
      }
      if (request.op === "conversation.switch") return new Promise<CoreReply>((resolve) => { resolveSwitch = resolve; });
      throw new Error(request.op);
    });
    await screen.findByText("기록");
    fireEvent.click(screen.getByRole("button", { name: "실행 위치" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "노드 B" }));
    fireEvent.click(await screen.findByRole("button", { name: "바꾸기" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("바꾸는 중")).toBeTruthy();
    expect((screen.getByRole("button", { name: "실행 위치" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("기록")).toBeTruthy();
    const messageInput = screen.getByRole("textbox", { name: "메시지" }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(messageInput);
    fireEvent.change(messageInput, { target: { value: "가나다" } });
    messageInput.setSelectionRange(3, 3);

    current = { ...thread, model: { id: "m2", label: "모델 2", group: { id: "node-b", label: "노드 B" } } };
    await act(async () => resolveSwitch({ op: "conversation.switch", thread: current, notices: [] }));
    await waitFor(() => expect(getCount).toBe(2));
    expect(screen.getByRole("textbox", { name: "메시지" })).toBe(messageInput);
    expect(messageInput.value).toBe("가나다");
    expect(messageInput.selectionStart).toBe(3);
    expect(screen.queryByText("불러오는 중")).toBeNull();
    expect(screen.getByText("바꾸는 중")).toBeTruthy();
    fireEvent.change(messageInput, { target: { value: "가나다라마" } });
    messageInput.setSelectionRange(5, 5);
    await act(async () => resolveReload(get(current)));
    await waitFor(() => expect(screen.getByRole("button", { name: "실행 위치" }).textContent).toContain("노드 B"));
    expect(screen.getByRole("button", { name: "모델" }).textContent).toContain("모델 2");
    expect(screen.queryByText("바꾸는 중")).toBeNull();
    expect(screen.getByRole("textbox", { name: "메시지" })).toBe(messageInput);
    expect(messageInput.value).toBe("가나다라마");
    expect(messageInput.selectionStart).toBe(5);
    expect(document.activeElement).toBe(messageInput);
  });

  it("같은 실행 위치의 모델 변경이 실패해도 입력에 포커스를 둔다", async () => {
    let rejectSwitch!: (reason: unknown) => void;
    setup(async (request) => {
      if (request.op === "conversation.get") return get();
      if (request.op === "conversation.switch") return new Promise<CoreReply>((_resolve, reject) => { rejectSwitch = reject; });
      throw new Error(request.op);
    });
    await screen.findByText("기록");
    fireEvent.click(screen.getByRole("button", { name: "모델" }));
    const choice = screen.getByRole("menuitem", { name: "모델 같은 노드" });
    choice.focus();
    fireEvent.click(choice);
    const messageInput = screen.getByRole("textbox", { name: "메시지" });
    expect(screen.getByText("바꾸는 중")).toBeTruthy();
    expect(document.activeElement).toBe(messageInput);
    await act(async () => rejectSwitch(error("server")));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(document.activeElement).toBe(messageInput);
  });

  it("실행 위치 전환 실패는 대화 기록을 남기고 알림 뒤 선택을 다시 연다", async () => {
    let rejectSwitch!: (reason: unknown) => void;
    const state = setup(async (request) => {
      if (request.op === "conversation.get") return get();
      if (request.op === "conversation.switch") return new Promise<CoreReply>((_resolve, reject) => { rejectSwitch = reject; });
      throw new Error(request.op);
    });
    await screen.findByText("기록");
    fireEvent.click(screen.getByRole("button", { name: "실행 위치" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "노드 B" }));
    fireEvent.click(await screen.findByRole("button", { name: "바꾸기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("바꾸는 중")).toBeTruthy();

    await act(async () => rejectSwitch(error("server")));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("실패");
    expect(screen.getByText("기록")).toBeTruthy();
    expect(screen.queryByText("다시 시도")).toBeNull();
    expect((screen.getByRole("button", { name: "실행 위치" }) as HTMLButtonElement).disabled).toBe(false);
    expect(state.call.mock.calls.filter(([request]) => request.op === "conversation.get")).toHaveLength(1);
  });

  it("답하는 중에는 고르기를 막고 안내한다", async () => {
    const state = setup(async (request) => request.op === "conversation.get" ? get() : (() => { throw new Error(request.op); })());
    await screen.findByText("기록");
    state.emit({ event: "conversation.update", thread_id: "thread-1", update: { kind: "activity", busy: true, tool: "작업 중" } });
    expect((screen.getByRole("button", { name: "프로필" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "모델" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("답변이 끝난 뒤 바꿀 수 있습니다")).toBeTruthy();
  });
});

describe("모델 풀림 시각", () => {
  it("기기 지역 시각으로 오늘, 내일, 그 밖의 날짜를 표시한다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 30, 12, 0));
    const local = (month: number, day: number, hour: number, minute: number) => new Date(2026, month - 1, day, hour, minute).toISOString();
    try {
      expect(modelAvailabilityDescription({ reason: "한도 거부 중", resets_at: local(10, 30, 14, 6) })).toBe("한도 거부 중, 오늘 14:06 풀림");
      expect(modelAvailabilityDescription({ reason: "한도 거부 중", resets_at: local(10, 31, 7, 6) })).toBe("한도 거부 중, 내일 07:06 풀림");
      expect(modelAvailabilityDescription({ reason: "한도 거부 중", resets_at: local(11, 2, 7, 6) })).toBe("한도 거부 중, 11월 2일 07:06 풀림");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("공용 Select 묶음", () => {
  it("선택지가 없으면 비활성화하고 빈 메뉴를 열지 않는다", () => {
    render(<Select items={[]} value={undefined} label="항목" onChange={vi.fn()} />);
    const button = screen.getByRole("button", { name: "항목" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("묶음 머리와 막힌 선택지는 건너뛰고 설명을 보인다", () => {
    const onChange = vi.fn();
    render(<Select groups={[{ name: "노드 A", options: [{ value: "a", label: "A" }, { value: "b", label: "B", disabled: true, description: "한도 거부 중" }, { value: "c", label: "C" }] }]} value="a" label="모델" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "모델" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("노드 A")).toBeTruthy();
    const blocked = within(menu).getByRole("menuitem", { name: /B/ }) as HTMLButtonElement;
    expect(blocked.disabled).toBe(true);
    expect(within(blocked).getByText("한도 거부 중")).toBeTruthy();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "C" }));
  });
});
