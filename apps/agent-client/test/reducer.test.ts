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

test("ACP 오류의 원인 글을 종류별로 보존하고 길이를 제한한다", () => {
  const cases: [unknown, string][] = [
    [{ details: "  실행 파일이 없습니다  ", message: "다른 원인" }, "Internal error: 실행 파일이 없습니다"],
    [" 경로를 찾지 못했습니다 ", "Internal error: 경로를 찾지 못했습니다"],
    [{ message: " 세션 오류 " }, "Internal error: 세션 오류"],
    [undefined, "Internal error"],
    [{ details: "Internal error" }, "Internal error"],
    [{ details: "가".repeat(1001) }, `Internal error: ${"가".repeat(1000)}…`],
  ];
  for (const [data, expected] of cases) {
    for (const kind of ["initialize", "new", "configure", "prompt"]) {
      let state = ready("s"), id: number;
      [state, id] = reserveRequest(state, kind, {}, kind === "prompt" ? "s" : null);
      state = reduceMessage(state, { jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error", data } }, "unused");
      assert.equal((kind === "prompt" ? state.sessions.s.failure : state.failure)?.reason, expected, kind);
      assert.equal(state.phase, kind === "prompt" ? "ready" : "failed");
    }
  }
});

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

const update = (body: Record<string, unknown>) => ({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s", update: body } });
const fiveHour = { status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.5, resetsAt: 1763400600 };

test("usage_update가 컨텍스트와 한도를 채운다", () => {
  let state = reduceMessage(ready("s"), update({ sessionUpdate: "usage_update", used: 42000, size: 100000, _meta: { "_claude/rateLimit": fiveHour } }), "x");
  assert.deepEqual(state.sessions.s.context, { used: 42000, size: 100000 });
  assert.equal(state.limits.length, 1);
  state = reduceMessage(state, update({ sessionUpdate: "usage_update", used: 1, size: 0 }), "x");
  assert.equal(state.sessions.s.context, null);
  state = reduceMessage(state, update({ sessionUpdate: "usage_update", used: 1 }), "x");
  assert.equal(state.sessions.s.context, null);
});

test("거절된 턴의 오류가 한도를 막힘으로 기록한다", () => {
  let state = ready("s");
  let id: number;
  [state, id] = reserveRequest(state, "prompt", { sessionId: "s", prompt: [] }, "s");
  state = reduceMessage(state, { jsonrpc: "2.0", id, error: { code: -32000, message: "limit", data: { errorKind: "rate_limit", rateLimit: { status: "rejected", rateLimitType: "five_hour", resetsAt: 1763400600 } } } }, "x");
  assert.equal(state.phase, "ready");
  assert.equal(state.limits[0].blocked, true);
});

test("usage_update와 거절된 턴의 오류는 unifiedWindows의 창을 모두 합친다", () => {
  // 2026-11-19 실제 이벤트 모양
  const live = { status: "allowed", resetsAt: 1795062600, rateLimitType: "five_hour", unifiedWindows: {
    five_hour: { utilization: 0.39, resetsAt: 1795062600, status: "allowed" }, seven_day: { utilization: 0.47, resetsAt: 1795219200, status: "allowed" } } };
  let state = reduceMessage(ready("s"), update({ sessionUpdate: "usage_update", used: 48019, size: 1000000, _meta: { "_claude/rateLimit": live } }), "x");
  assert.deepEqual(state.limits.map((l) => [l.id, l.label, l.usedRatio]), [["five_hour", "5시간", 0.39], ["seven_day", "7일", 0.47]]);
  let id: number;
  [state, id] = reserveRequest(state, "prompt", { sessionId: "s", prompt: [] }, "s");
  const rejected = { ...live, status: "rejected", rateLimitType: "seven_day", unifiedWindows: { ...live.unifiedWindows, seven_day: { utilization: 1, resetsAt: 1795219200, status: "rejected" } } };
  state = reduceMessage(state, { jsonrpc: "2.0", id, error: { code: -32000, message: "limit", data: { errorKind: "rate_limit", rateLimit: rejected } } }, "x");
  assert.deepEqual(state.limits.map((l) => [l.id, l.usedRatio, l.blocked]), [["five_hour", 0.39, false], ["seven_day", 1, true]]);
});

test("계정 알림은 auth/status_update만 읽고 응답을 만들지 않는다", () => {
  let state = reduceMessage(initialState(), { jsonrpc: "2.0", method: "auth/status_update", params: { state: "authenticated", accounts: [{ label: "Claude Team", email: "a@b.c", active: true }] } }, "x");
  assert.deepEqual(state.account, { label: "Claude Team", email: "a@b.c" });
  state = reduceMessage(state, { jsonrpc: "2.0", method: "_auth/status_update", params: { authStatus: { state: "authenticated" } } }, "x");
  assert.deepEqual(state.account, { label: "Claude Team", email: "a@b.c" });
  assert.deepEqual(state.outbox, []);
});

test("서브에이전트 도구는 끝나면 사라진다", () => {
  let state = reduceMessage(ready("s"), update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "x", status: "in_progress", _meta: { claudeCode: { toolName: "Agent" } } }), "x");
  assert.equal(state.sessions.s.tools[0].subagent, true);
  state = reduceMessage(state, update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" }), "x");
  assert.deepEqual(state.sessions.s.tools, []);
});

test("세션 전환은 컨텍스트만 비우고 한도와 계정은 남긴다", () => {
  let state = reduceMessage(ready("s"), update({ sessionUpdate: "usage_update", used: 1, size: 10, _meta: { "_claude/rateLimit": fiveHour } }), "x");
  state = reduceMessage(state, { jsonrpc: "2.0", method: "auth/status_update", params: { state: "authenticated", accounts: [{ label: "A", active: true }] } }, "x");
  let id: number;
  [state, id] = reserveRequest(state, "switch", "s2", "s2");
  state = reduceMessage(state, { jsonrpc: "2.0", id, result: {} }, "x");
  assert.equal(state.sessions.s2.context, null);
  assert.equal(state.limits.length, 1);
  assert.notEqual(state.account, null);
});

test("인증이 풀렸다는 알림은 계정을 지우고, 깨진 알림은 무시한다", () => {
  const auth = (params: unknown) => ({ jsonrpc: "2.0", method: "auth/status_update", params });
  let state = reduceMessage(initialState(), auth({ state: "authenticated", accounts: [{ label: "A", active: true }] }), "x");
  state = reduceMessage(state, auth(undefined), "x");
  assert.deepEqual(state.account, { label: "A", email: null });
  state = reduceMessage(state, auth({ state: "unauthenticated" }), "x");
  assert.equal(state.account, null);
});

test("재생 중인 usage_update는 컨텍스트와 한도를 바꾸지 않는다", () => {
  let state = reduceMessage(ready("s"), update({ sessionUpdate: "usage_update", used: 1, size: 10, _meta: { "_claude/rateLimit": fiveHour } }), "x");
  [state] = reserveRequest(state, "switch", "s2", "s2");
  const replayed = reduceMessage(state, { jsonrpc: "2.0", method: "session/update", params: { sessionId: "s2", update:{ sessionUpdate: "usage_update", used: 9, size: 10, _meta: { "_claude/rateLimit": { ...fiveHour, rateLimitType: "seven_day" } } } } }, "x");
  assert.deepEqual(replayed.sessions.s.context, { used: 1, size: 10 });
  assert.equal(replayed.limits.length, 1);
});

test("병렬 사용량과 서브에이전트는 세션마다 분리하고 한도는 공유한다", () => {
  let state = ready("a", "b");
  const usage = (id: string, used: number) => ({ jsonrpc: "2.0", method: "session/update", params: { sessionId: id, update: { sessionUpdate: "usage_update", used, size: 100, _meta: { "_claude/rateLimit": fiveHour } } } });
  state = reduceMessage(state, usage("a", 20), "x");
  state = reduceMessage(state, usage("b", 80), "x");
  assert.deepEqual(state.sessions.a.context, { used: 20, size: 100 });
  assert.deepEqual(state.sessions.b.context, { used: 80, size: 100 });
  assert.equal(state.limits.length, 1);
  state = reduceMessage(state, { jsonrpc: "2.0", method: "session/update", params: { sessionId: "b", update: { sessionUpdate: "tool_call", toolCallId: "t", title: "작업", _meta: { claudeCode: { toolName: "Agent" } } } } }, "x");
  assert.equal(state.sessions.a.tools.length, 0);
  assert.equal(state.sessions.b.tools[0].subagent, true);
});

test("schema 1의 상태 줄과 삭제 지원을 전경 세션과 연결에 복원한다", () => {
  const old = { schema: 1, phase: "ready", sessionId: "s", context: { used: 42, size: 100 }, limits: [{ id: "five_hour" }], account: { label: "계정", email: null }, capabilities: { delete: true }, tools: [{ id: "t", title: "작업", subagent: true }] };
  const state = migrateState(old);
  assert.deepEqual(state.sessions.s.context, old.context);
  assert.equal(state.sessions.s.tools[0].subagent, true);
  assert.deepEqual(state.limits, old.limits);
  assert.deepEqual(state.account, old.account);
  assert.equal(state.capabilities.delete, true);
});
