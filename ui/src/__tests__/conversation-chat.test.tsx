import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatComposer } from "../blocks/chat-composer";
import { ChatHistory } from "../blocks/chat-history";
import { HistoryAttachmentView } from "../blocks/agent-attachments";
import { AgentChatBlock, modelAvailabilityDescription } from "../blocks/agent-chat";
import { Select } from "../components/select-toggle";
import { WindowDataProvider } from "../data/window-data";
import type { AppDefinition, CoreEvent, CoreReply, CoreRequest, ConversationItem, ConversationThread } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { makeTestSnapshot } from "./fixtures";

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
function setup(handler: (request: CoreRequest) => Promise<CoreReply>, appDefinition: AppDefinition = definition) {
  const snapshot = makeTestSnapshot({ definitions: [appDefinition] });
  snapshot.link = { state: "connected", mode: "remote", server_url: "https://example.test", device_name: "시험" };
  const listeners = new Set<(event: CoreEvent) => void>();
  const call = vi.fn(async (request: CoreRequest): Promise<CoreReply> => {
    if (request.op === "data.attach") return { op: "data.attach", view: { values: {}, sources: {} } };
    if (request.op === "data.detach") return { op: "data.detach" };
    return handler(request);
  });
  const store = { call, getSnapshot: () => snapshot, getError: () => null, subscribe: () => () => {}, subscribeEvents: (fn: (event: CoreEvent) => void) => { listeners.add(fn); return () => listeners.delete(fn); }, ready: Promise.resolve(), dispose: () => {} } as unknown as ShellStore;
  const window = snapshot.shared.windows[0];
  const context = { store, snapshot, window, definition: appDefinition };
  render(<WindowDataProvider store={store} appWindow={window} definition={appDefinition}><AgentChatBlock block={{ type: "chat" }} context={context} /></WindowDataProvider>);
  return { call, window, emit: (event: CoreEvent) => act(() => { listeners.forEach((fn) => fn(event)); }) };
}
const get = (value: ConversationThread | null = thread, profile = "profile-a"): CoreReply => ({ op: "conversation.get", thread: value, items: [item("1", "기록")], cursor: "c", next_before: "older", models, profiles, start: { profile, model: "m" } });
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

describe("공용 대화 부품", () => {
  it("기록, 진행 줄, footer를 기존 순서로 그린다", () => {
    const historyRef = createRef<HTMLDivElement>();
    render(<ChatHistory
      items={[item("one", "기록")]} pending={null} delta="" busy tool="문서 읽기"
      historyRef={historyRef} onScroll={() => {}}
      renderAttachment={() => null} renderPendingAttachment={() => null}
      footer={<button type="button">도구 승인</button>}
    />);
    const history = screen.getByRole("log", { name: "대화 기록" });
    expect(within(history).getByText("기록")).toBeTruthy();
    expect(within(history).getByText("생각 중입니다… · 문서 읽기")).toBeTruthy();
    expect(history.lastElementChild?.textContent).toBe("도구 승인");
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

  it("히스토리 첨부 캐시는 운송 범위가 다르면 분리한다", async () => {
    const attachment = { id: "0", name: "사진.png", mime: "image/png" };
    const loadConversation = vi.fn(async () => ({ mime: "image/png", data_base64: "YQ==" }));
    const loadLocalAgent = vi.fn(async () => ({ mime: "image/png", data_base64: "Yg==" }));
    render(<>
      <HistoryAttachmentView attachment={attachment} cacheKey={["conversation", "window", "item", "0"]} load={loadConversation} open={async () => {}} onPreview={() => {}} onError={() => {}} />
      <HistoryAttachmentView attachment={attachment} cacheKey={["local_agent", "window", "item", "0"]} load={loadLocalAgent} open={async () => {}} onPreview={() => {}} onError={() => {}} />
    </>);
    const buttons = await screen.findAllByRole("button", { name: "사진.png" });
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.querySelector("img")?.getAttribute("src"))).toEqual([
      "data:image/png;base64,YQ==", "data:image/png;base64,Yg==",
    ]);
    expect(loadConversation).toHaveBeenCalledTimes(1);
    expect(loadLocalAgent).toHaveBeenCalledTimes(1);
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
