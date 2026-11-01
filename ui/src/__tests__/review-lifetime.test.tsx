import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentChatBlock } from "../blocks/agent-chat";
import { WindowDataProvider } from "../data/window-data";
import type { AppDefinition, CoreEvent, CoreReply, CoreRequest, ConversationItem, ConversationThread } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { createFakeTransport } from "../core/fake-transport";
import { makeTestSnapshot } from "./fixtures";

const definition: AppDefinition = {
  id: "provider-chat", name: "대화", requires: { blocks: 2, modules: { agent: 3 } }, permissions: [], state: {}, ui: { type: "agent_chat" },
  agent: { protocol: "conversation-v1", permission: "login", base_path: "api", namespace: "n", profile: "p", collection: "c", model_order: [], selected_model: "", title_template: "", initial_instruction_template: "", instructions_template: "", thread_entry: "thread" },
};
const thread: ConversationThread = { id: "thread-1", external: { namespace: "n", key: "k" }, title: "대화", model: { id: "m", label: "모델" }, created_at: "2026-10-30T00:00:00Z", archived: false };
const item = (id: string, text: string): ConversationItem => ({ id, kind: "assistant", text, at: "2026-10-30T00:00:00Z", attachments: [] });
const models = [{ id: "m", label: "모델", available: true }, { id: "off", label: "불가", available: false, reason: "사용 불가" }];
function setup(handler: (request: CoreRequest) => Promise<CoreReply>) {
  const snapshot = makeTestSnapshot({ definitions: [definition] });
  snapshot.link = { state: "connected", mode: "remote", server_url: "https://example.test", device_name: "시험" };
  const listeners = new Set<(event: CoreEvent) => void>();
  const call = vi.fn(async (request: CoreRequest): Promise<CoreReply> => {
    if (request.op === "data.attach") return { op: "data.attach", view: { values: {}, sources: {} } };
    if (request.op === "data.detach") return { op: "data.detach" };
    return handler(request);
  });
  const store = { call, getSnapshot: () => snapshot, getError: () => null, subscribe: () => () => {}, subscribeEvents: (fn: (event: CoreEvent) => void) => { listeners.add(fn); return () => listeners.delete(fn); }, ready: Promise.resolve(), dispose: () => {} } as unknown as ShellStore;
  const window = snapshot.shared.windows[0];
  const context = { store, snapshot, window, definition };
  const view = render(<WindowDataProvider store={store} appWindow={window} definition={definition}><AgentChatBlock block={{ type: "agent_chat" }} context={context} /></WindowDataProvider>);
  return { call, window, rerender: () => view.rerender(<WindowDataProvider store={store} appWindow={window} definition={definition}><AgentChatBlock block={{ type: "agent_chat" }} context={{ ...context, definition: structuredClone(definition) }} /></WindowDataProvider>), emit: (event: CoreEvent) => act(() => { listeners.forEach((fn) => fn(event)); }) };
}
const get = (value: ConversationThread | null = thread): CoreReply => ({ op: "conversation.get", thread: value, items: [item("1", "기록")], cursor: "c", next_before: "older", models, profiles: [], start: { profile: "", model: null } });
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as unknown as CanvasRenderingContext2D); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('감수 수명 재현', () => {
  it('재접속 snapshot에서 접수된 사용자 글을 받으면 전송 중 말풍선을 없앤다', async () => {
    const state = setup(async request => {
      if (request.op === 'conversation.get') return get();
      if (request.op === 'conversation.send') return {op: 'conversation.send'};
      throw new Error(request.op);
    });
    const input = await screen.findByRole('textbox', {name: '메시지'});
    fireEvent.change(input, {target: {value: '연결 복구 메시지'}});
    fireEvent.click(screen.getByRole('button', {name: '보내기'}));
    await waitFor(() => expect(state.call.mock.calls.some(([r]) => r.op === 'conversation.send')).toBe(true));
    state.emit({event: 'conversation.update', thread_id: 'thread-1', update: {kind: 'snapshot', snapshot: {cursor: '2', busy: false, tool: null, stream_id: null, text: null, items: [{...item('user-2','연결 복구 메시지'), kind: 'user'}]}}});
    expect(screen.getAllByText('연결 복구 메시지')).toHaveLength(1);
    expect(screen.queryByLabelText('생각 중입니다')).toBeNull();
  });
  it('배치 snapshot이 같은 앱 정의를 새 객체로 전달해도 진행 중 답이 유지된다', async () => {
    const state = setup(async request => {
      if (request.op === 'conversation.get') return get();
      throw new Error(request.op);
    });
    await screen.findByRole('textbox', {name: '메시지'});
    state.emit({event: 'conversation.update', thread_id: 'thread-1', update: {kind: 'activity', busy: true, tool: '계속 작업'}});
    state.emit({event: 'conversation.update', thread_id: 'thread-1', update: {kind: 'text', stream_id: 's', text: '아직 작성 중인 답'}});
    expect(screen.getByText('아직 작성 중인 답')).toBeTruthy();
    state.rerender();
    await screen.findByRole('textbox', {name: '메시지'});
    expect(screen.queryByText('아직 작성 중인 답')).toBeTruthy();
    expect(state.call.mock.calls.filter(([r]) => r.op === 'conversation.get')).toHaveLength(1);
  });
  it('다른 기기의 사용자 항목은 이 창의 전송 중 말풍선을 지우지 않는다', async () => {
    const state = setup(async request => {
      if (request.op === 'conversation.get') return get();
      if (request.op === 'conversation.send') return {op: 'conversation.send'};
      throw new Error(request.op);
    });
    const input = await screen.findByRole('textbox', {name: '메시지'});
    fireEvent.change(input, {target: {value: '내 메시지'}});
    fireEvent.click(screen.getByRole('button', {name: '보내기'}));
    await waitFor(() => expect(state.call.mock.calls.some(([r]) => r.op === 'conversation.send')).toBe(true));
    state.emit({event: 'conversation.update', thread_id: 'thread-1', update: {kind: 'item', item: {...item('other', '다른 메시지'), kind: 'user'}}});
    expect(document.querySelector('.ks-agent-chat-user.is-pending')?.textContent).toBe('내 메시지');
    state.emit({event: 'conversation.update', thread_id: 'thread-1', update: {kind: 'item', item: {...item('mine', '내 메시지'), kind: 'user'}}});
    expect(document.querySelector('.ks-agent-chat-user.is-pending')).toBeNull();
  });
  it('같이 보기 캡처가 덧붙은 접수 항목도 전송 중 말풍선을 정리한다', async () => {
    const state = setup(async request => {
      if (request.op === 'conversation.get') return get();
      if (request.op === 'conversation.send') return {op: 'conversation.send'};
      throw new Error(request.op);
    });
    const input = await screen.findByRole('textbox', {name: '메시지'});
    fireEvent.change(input, {target: {value: '같이 봐줘'}});
    fireEvent.click(screen.getByRole('button', {name: '보내기'}));
    await waitFor(() => expect(state.call.mock.calls.some(([r]) => r.op === 'conversation.send')).toBe(true));
    state.emit({event: 'conversation.update', thread_id: 'thread-1', update: {kind: 'item', item: {...item('mine', '같이 봐줘'), kind: 'user', attachments: [{id: 'image', name: '같이 보기.png', mime: 'image/png'}]}}});
    expect(document.querySelector('.ks-agent-chat-user.is-pending')).toBeNull();
  });
  it('같은 대화를 다시 조회해도 진행 중인 답과 작업 상태를 보존한다', async () => {
    const state = setup(async request => {
      if (request.op === 'conversation.get') return get();
      throw new Error(request.op);
    });
    await screen.findByRole('textbox', {name: '메시지'});
    state.emit({event: 'conversation.update', thread_id: 'thread-1', update: {kind: 'activity', busy: true, tool: '문서 읽기'}});
    state.emit({event: 'conversation.update', thread_id: 'thread-1', update: {kind: 'text', stream_id: 's', text: '진행 중'}});
    state.emit({event: 'conversation.error', thread_id: 'thread-1', code: 'io'});
    fireEvent.click(screen.getByRole('button', {name: '다시 시도'}));
    expect(await screen.findByText('진행 중')).toBeTruthy();
    state.emit({event: 'conversation.update', thread_id: 'thread-1', update: {kind: 'text', stream_id: 's', text: ''}});
    expect(screen.getByText('생각 중입니다… · 문서 읽기')).toBeTruthy();
  });
  it('가짜 코어는 열린 스트림을 재조회해도 snapshot을 다시 보내지 않는다', async () => {
    const snapshot = makeTestSnapshot({ definitions: [definition] });
    const fake = createFakeTransport({ snapshot, folder: null, files: {}, conversation: { thread, items: [], models } });
    const events: CoreEvent[] = [];
    fake.subscribe(event => events.push(event));
    await fake.call({op: 'conversation.get', window_id: snapshot.shared.windows[0].id});
    await waitFor(() => expect(events.filter(event => event.event === 'conversation.update').length).toBe(1));
    await fake.call({op: 'conversation.get', window_id: snapshot.shared.windows[0].id});
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(events.filter(event => event.event === 'conversation.update')).toHaveLength(1);
  });
});
