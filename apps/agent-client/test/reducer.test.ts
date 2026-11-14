import { test } from "node:test";
import { strict as assert } from "node:assert";
import { initialState, reduceMessage, reserveRequest, enqueue, answerPermission, migrateState, sessionState, type State } from "../src/reducer.ts";
import { decodeLines } from "../src/transport.ts";

/** 연결이 준비되고 주어진 세션들을 들고 있는 상태. 첫 세션이 전경이다. */
function ready(...ids: string[]): State {
  return { ...initialState(), phase: "ready", initialized: true, foreground: ids[0] ?? null, sessions: Object.fromEntries(ids.map((id) => [id, sessionState()])) };
}
const chunk = (sessionId: string | undefined, text: string, kind = "agent_message_chunk", messageId?: string) =>
  ({ jsonrpc: "2.0", method: "session/update", params: { ...(sessionId ? { sessionId } : {}), update: { sessionUpdate: kind, ...(messageId ? { messageId } : {}), content: { type: "text", text } } } });

test("UTF-8 문자가 바이트 경계에서 나뉘어도 JSON 줄이 복원된다", () => {
  const bytes = new TextEncoder().encode('{"text":"안녕"}\n{"n":2}\n');
  const split = bytes.indexOf(0xec) + 1;
  const first = decodeLines([], bytes.slice(0, split));
  assert.deepEqual(first.messages, []);
  const second = decodeLines(first.partial, bytes.slice(split));
  assert.deepEqual(second.messages, [{ text: "안녕" }, { n: 2 }]);
  assert.deepEqual(second.partial, []);
});

test("진행 중인 응답, 승인과 큐를 직렬화해 같은 턴을 이어간다", () => {
  let state = ready("session");
  [state] = reserveRequest(state, "prompt", { sessionId: "session", prompt: [] }, "session");
  state = enqueue(state, "session", { id: "queued", text: "다음", attachments: [] });
  state = reduceMessage(state, chunk("session", "첫"), "stream-1");
  state = reduceMessage(state, { jsonrpc: "2.0", id: 44, method: "session/request_permission", params: { sessionId: "session", toolCall: { title: "파일 쓰기" }, options: [{ optionId: "allow", name: "허용", kind: "allow_once" }] } }, "unused");
  state = JSON.parse(JSON.stringify(state));
  state = reduceMessage(state, chunk("session", "째"), "unused");
  const session = state.sessions.session;
  assert.equal(session.stream.text, "첫째");
  assert.equal(session.stream.id, "stream-1");
  assert.equal(session.phase, "responding");
  assert.equal(session.permissions[0].rpcId, 44);
  assert.equal(session.permissions[0].sessionId, "session");
  assert.equal(session.permissions[0].options[0].id, "allow");
  assert.equal(session.queue[0].id, "queued");
  assert.equal(state.pending["1"].kind, "prompt");
  assert.equal(state.pending["1"].sessionId, "session");
});

test("초기화와 세션 설정 응답은 후속 요청에 필요한 상태를 남긴다", () => {
  let state = initialState();
  let id: number;
  [state, id] = reserveRequest(state, "initialize", {});
  state = reduceMessage(state, { jsonrpc: "2.0", id, result: { agentCapabilities: { loadSession: true, promptCapabilities: { image: true }, mcpCapabilities: { http: true } }, authMethods: [{ id: "login", name: "로그인" }] } }, "unused");
  assert.equal(state.capabilities.loadSession, true);
  assert.equal(state.capabilities.image, true);
  assert.equal(state.capabilities.http, true);
  assert.equal(state.authMethods[0].id, "login");
  [state, id] = reserveRequest(state, "new", {});
  state = reduceMessage(state, { jsonrpc: "2.0", id, result: { sessionId: "s1", modes: { currentModeId: "m1", availableModes: [{ id: "m1", name: "기본" }] } } }, "unused");
  assert.equal(state.foreground, "s1");
  assert.equal(state.phase, "ready");
  assert.equal(state.sessions.s1.controls[0].id, "__legacy_mode");
  assert.equal(state.sessions.s1.controls[0].value, "m1");
  assert.deepEqual(state.pending, {});
});

test("load 재생은 기록에 중복되지 않고, 턴 완료는 조각을 기록으로 넘긴다", () => {
  let state: State = { ...initialState(), foreground: "s1" };
  let id: number;
  [state, id] = reserveRequest(state, "load", {}, "s1");
  state = reduceMessage(state, chunk(undefined, "이전 기록"), "old");
  assert.equal(state.sessions.s1.stream.text, "");
  state = reduceMessage(state, { jsonrpc: "2.0", id, result: {} }, "unused");
  assert.equal(state.sessions.s1.phase, "ready");
  [state, id] = reserveRequest(state, "prompt", {}, "s1");
  state = reduceMessage(state, chunk(undefined, "중간 답변"), "stream-2");
  state = reduceMessage(state, { jsonrpc: "2.0", id, result: { stopReason: "cancelled" } }, "unused");
  const session = state.sessions.s1;
  assert.equal(session.phase, "ready");
  assert.equal(session.completed[0].text, "중간 답변");
  assert.equal(session.completed[0].id, "stream-2");
  assert.equal(session.stream.text, "");
});

test("승인은 응답을 한 번만 예약하고 알 수 없는 요청에는 method-not-found를 보낸다", () => {
  let state = ready("s");
  state = reduceMessage(state, { jsonrpc: "2.0", id: "p1", method: "session/request_permission", params: { toolCall: { title: "수정" }, options: [{ optionId: "yes", name: "허용", kind: "allow_once" }] } }, "unused");
  state = answerPermission(state, "p1", "yes");
  assert.equal(state.sessions.s.permissions.length, 0);
  assert.deepEqual(state.outbox[0], { jsonrpc: "2.0", id: "p1", result: { outcome: { outcome: "selected", optionId: "yes" } } });
  assert.throws(() => answerPermission(state, "p1", "yes"));
  state = reduceMessage(state, { jsonrpc: "2.0", id: 7, method: "fs/read_text_file", params: {} }, "unused");
  assert.deepEqual(state.outbox[1], { jsonrpc: "2.0", id: 7, error: { code: -32601, message: "Method not found" } });
});

test("로그인 필요와 인증 실패를 구분하고, load 실패는 새 세션으로 넘긴다", () => {
  let state: State = { ...initialState(), foreground: "previous" };
  let id: number;
  [state, id] = reserveRequest(state, "load", {}, "previous");
  state = reduceMessage(state, { jsonrpc: "2.0", id, error: { code: -32000, message: "Authentication required" } }, "unused");
  assert.equal(state.phase, "login");
  assert.equal(state.foreground, "previous");
  [state, id] = reserveRequest(state, "authenticate", {});
  state = reduceMessage(state, { jsonrpc: "2.0", id, error: { code: -32603, message: "login failed" } }, "unused");
  assert.equal(state.phase, "login");
  assert.equal(state.failure?.id, "AGENT_LOGIN_AUTHENTICATE_FAILED");
  [state, id] = reserveRequest(state, "load", {}, "previous");
  state = reduceMessage(state, { jsonrpc: "2.0", id, error: { code: -32603, message: "load failed" } }, "unused");
  assert.equal(state.needsNew, true);
  assert.equal(state.sessions.previous.replay, null);
});

test("기존 모델 설정 성공은 응답 뒤 표시 값을 갱신한다", () => {
  let state = ready("s");
  state.sessions.s.controls = [{ id: "__legacy_model", label: "모델", category: "model", value: "a", kind: "select" as const, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }];
  let id: number;
  [state, id] = reserveRequest(state, "configure", { id: "__legacy_model", value: "b" }, "s");
  state = reduceMessage(state, { jsonrpc: "2.0", id, result: {} }, "unused");
  assert.equal(state.sessions.s.controls[0].value, "b");
});

test("로그인 요청을 보내는 동안에는 시작 상태이고 실패하면 로그인 선택으로 돌아간다", () => {
  let state: State = { ...initialState(), phase: "login" };
  let id: number;
  [state, id] = reserveRequest(state, "authenticate", { methodId: "login" });
  assert.equal(state.phase, "starting");
  state = reduceMessage(state, { jsonrpc: "2.0", id, error: { code: -32603, message: "failed" } }, "unused");
  assert.equal(state.phase, "login");
});

test("두 세션의 섞인 업데이트를 sessionId로 나눠 각 세션의 글로 모은다", () => {
  let state = ready("a", "b");
  let promptA: number, promptB: number;
  [state, promptA] = reserveRequest(state, "prompt", {}, "a");
  [state, promptB] = reserveRequest(state, "prompt", {}, "b");
  for (const [session, text] of [["a", "가"], ["b", "나"], ["a", "다"], ["b", "라"], ["b", "마"]]) state = reduceMessage(state, chunk(session, text), `stream-${session}`);
  assert.equal(state.sessions.a.stream.text, "가다");
  assert.equal(state.sessions.b.stream.text, "나라마");
  state = reduceMessage(state, { jsonrpc: "2.0", id: promptB, result: { stopReason: "end_turn" } }, "unused");
  assert.equal(state.sessions.b.phase, "ready");
  assert.equal(state.sessions.b.completed[0].text, "나라마");
  assert.equal(state.sessions.a.phase, "responding");
  assert.equal(state.sessions.a.stream.text, "가다");
  state = reduceMessage(state, { jsonrpc: "2.0", id: promptA, error: { code: -32603, message: "오류" } }, "unused");
  assert.equal(state.sessions.a.failure?.id, "AGENT_ACP_PROTOCOL_FAILED");
  assert.equal(state.sessions.b.failure, null);
  assert.equal(state.phase, "ready");
});

test("A가 응답하는 동안 B를 load해도 B의 재생 기록은 A의 글에 섞이지 않는다", () => {
  let state = ready("a");
  let load: number;
  [state] = reserveRequest(state, "prompt", {}, "a");
  [state, load] = reserveRequest(state, "switch", "b", "b");
  state = reduceMessage(state, chunk("b", "B의 옛 질문", "user_message_chunk", "u1"), "x");
  state = reduceMessage(state, chunk("a", "A 응답"), "stream-a");
  state = reduceMessage(state, chunk("b", "B의 옛 답", "agent_message_chunk", "a1"), "y");
  assert.equal(state.sessions.a.stream.text, "A 응답");
  assert.deepEqual(state.sessions.b.replayItems.map((item) => item.text), ["B의 옛 질문", "B의 옛 답"]);
  assert.equal(state.foreground, "a");
  state = reduceMessage(state, { jsonrpc: "2.0", id: load, result: {} }, "unused");
  assert.equal(state.foreground, "b");
  assert.equal(state.sessions.b.phase, "ready");
  assert.equal(state.sessions.a.phase, "responding");
  assert.equal(state.sessions.a.stream.text, "A 응답");
});

test("뒤 세션의 허용 요청은 그 세션에, 들고 있지 않은 세션의 요청은 취소로 답한다", () => {
  let state = ready("a", "b");
  state = reduceMessage(state, { jsonrpc: "2.0", id: 9, method: "session/request_permission", params: { sessionId: "b", toolCall: { title: "실행" }, options: [{ optionId: "ok", name: "허용", kind: "allow_once" }] } }, "p");
  assert.equal(state.sessions.a.permissions.length, 0);
  assert.equal(state.sessions.b.permissions[0].rpcId, 9);
  state = reduceMessage(state, { jsonrpc: "2.0", id: 10, method: "session/request_permission", params: { sessionId: "gone", toolCall: { title: "실행" }, options: [] } }, "p");
  assert.deepEqual(state.outbox.at(-1), { jsonrpc: "2.0", id: 10, result: { outcome: { outcome: "cancelled" } } });
});

test("schema 1 체크포인트를 진행 중인 턴, 승인, 큐와 함께 schema 2로 옮긴다", () => {
  const legacy = {
    schema: 1, generation: "g", nextId: 5, pending: { "4": { kind: "prompt", params: { refreshList: false } } }, sessionId: "s",
    capabilities: { loadSession: true, image: false, http: true, list: true }, authMethods: [], controls: [{ id: "m", label: "모델", category: "model", value: "x", kind: "select", options: [] }],
    permissions: [{ id: "p", rpcId: 7, title: "쓰기", options: [] }], queue: [{ id: "q", text: "다음", attachments: [] }],
    stream: { id: "st", text: "진행 글" }, tools: [{ id: "t", title: "도구" }], partial: [1], partialKey: null, streamKey: null, guideSent: true,
    phase: "responding", replay: false, replayItems: [], sessionError: null, needsNew: false, initialized: true, failure: null,
    completed: [], outbox: [], servicesUsed: "http://tools", restartPending: false, contextTicket: null, restoreControls: [],
  };
  const state = migrateState(legacy);
  assert.equal(state.schema, 2);
  assert.equal(state.phase, "ready");
  assert.equal(state.foreground, "s");
  assert.equal(state.nextId, 5);
  assert.equal(state.pending["4"].sessionId, "s");
  const session = state.sessions.s;
  assert.equal(session.phase, "responding");
  assert.equal(session.stream.text, "진행 글");
  assert.equal(session.queue[0].id, "q");
  assert.equal(session.permissions[0].sessionId, "s");
  assert.equal(session.guideSent, true);
  assert.equal(session.controls[0].id, "m");
  assert.deepEqual(state.partial, [1]);
  const switching = migrateState({ ...legacy, phase: "ready", pending: { "4": { kind: "switch", params: "other" } }, replay: true, replayItems: [{ id: "u", kind: "user", text: "옛 말", at: "", attachments: [] }] });
  assert.equal(switching.pending["4"].sessionId, "other");
  assert.equal(switching.sessions.other.replay, "collect");
  assert.equal(switching.sessions.other.replayItems[0].text, "옛 말");
  assert.equal(switching.sessions.s.phase, "ready");
});
