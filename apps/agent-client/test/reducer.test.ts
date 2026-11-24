import { test } from "node:test";
import { strict as assert } from "node:assert";
import { initialState, reduceMessage, reserveRequest, enqueue, answerPermission } from "../src/reducer.ts";
import { decodeLines } from "../src/transport.ts";

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
      let state = initialState(), id: number;
      [state, id] = reserveRequest(state, kind, {});
      state = reduceMessage(state, { jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error", data } }, "unused");
      assert.equal(state.failure?.reason, expected, kind);
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
  let state = initialState();
  [state] = reserveRequest(state, "prompt", { sessionId: "session", prompt: [] });
  state = enqueue(state, { id: "queued", text: "다음", attachments: [] });
  state = reduceMessage(state, { jsonrpc: "2.0", method: "session/update", params: { sessionId: "session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "첫" } } } }, "stream-1");
  state = reduceMessage(state, { jsonrpc: "2.0", id: 44, method: "session/request_permission", params: { sessionId: "session", toolCall: { title: "파일 쓰기" }, options: [{ optionId: "allow", name: "허용", kind: "allow_once" }] } }, "unused");
  state = JSON.parse(JSON.stringify(state));
  state = reduceMessage(state, { jsonrpc: "2.0", method: "session/update", params: { sessionId: "session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "째" } } } }, "unused");
  assert.equal(state.stream.text, "첫째");
  assert.equal(state.stream.id, "stream-1");
  assert.equal(state.permissions[0].rpcId, 44);
  assert.equal(state.permissions[0].options[0].id, "allow");
  assert.equal(state.queue[0].id, "queued");
  assert.equal(state.pending["1"].kind, "prompt");
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
  assert.equal(state.sessionId, "s1");
  assert.equal(state.controls[0].id, "__legacy_mode");
  assert.equal(state.controls[0].value, "m1");
  assert.deepEqual(state.pending, {});
});

test("load 재생은 기록에 중복되지 않고, 턴 완료는 조각을 기록으로 넘긴다", () => {
  let state = { ...initialState(), sessionId: "s1", replay: true };
  state = reduceMessage(state, { jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "이전 기록" } } } }, "old");
  assert.equal(state.stream.text, "");
  state = { ...state, replay: false, phase: "ready" };
  let id: number;
  [state, id] = reserveRequest(state, "prompt", {});
  state = reduceMessage(state, { jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "중간 답변" } } } }, "stream-2");
  state = reduceMessage(state, { jsonrpc: "2.0", id, result: { stopReason: "cancelled" } }, "unused");
  assert.equal(state.phase, "ready");
  assert.equal(state.completed[0].text, "중간 답변");
  assert.equal(state.completed[0].id, "stream-2");
  assert.equal(state.stream.text, "");
});

test("승인은 응답을 한 번만 예약하고 알 수 없는 요청에는 method-not-found를 보낸다", () => {
  let state = initialState();
  state = reduceMessage(state, { jsonrpc: "2.0", id: "p1", method: "session/request_permission", params: { toolCall: { title: "수정" }, options: [{ optionId: "yes", name: "허용", kind: "allow_once" }] } }, "unused");
  state = answerPermission(state, "p1", "yes");
  assert.equal(state.permissions.length, 0);
  assert.deepEqual(state.outbox[0], { jsonrpc: "2.0", id: "p1", result: { outcome: { outcome: "selected", optionId: "yes" } } });
  assert.throws(() => answerPermission(state, "p1", "yes"));
  state = reduceMessage(state, { jsonrpc: "2.0", id: 7, method: "fs/read_text_file", params: {} }, "unused");
  assert.deepEqual(state.outbox[1], { jsonrpc: "2.0", id: 7, error: { code: -32601, message: "Method not found" } });
});

test("로그인 필요와 인증 실패를 구분하고, load 실패는 새 세션으로 넘긴다", () => {
  let state = { ...initialState(), sessionId: "previous" };
  let id: number;
  [state, id] = reserveRequest(state, "load", {});
  state = reduceMessage(state, { jsonrpc: "2.0", id, error: { code: -32000, message: "Authentication required" } }, "unused");
  assert.equal(state.phase, "login");
  assert.equal(state.sessionId, "previous");
  [state, id] = reserveRequest(state, "authenticate", {});
  state = reduceMessage(state, { jsonrpc: "2.0", id, error: { code: -32603, message: "login failed" } }, "unused");
  assert.equal(state.phase, "login");
  assert.equal(state.failure?.id, "AGENT_LOGIN_AUTHENTICATE_FAILED");
  [state, id] = reserveRequest(state, "load", {});
  state = reduceMessage(state, { jsonrpc: "2.0", id, error: { code: -32603, message: "load failed" } }, "unused");
  assert.equal(state.needsNew, true);
  assert.equal(state.replay, false);
});

test("기존 모델 설정 성공은 응답 뒤 표시 값을 갱신한다", () => {
  let state = { ...initialState(), controls: [{ id: "__legacy_model", label: "모델", category: "model", value: "a", kind: "select" as const, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }] };
  let id: number;
  [state, id] = reserveRequest(state, "configure", { id: "__legacy_model", value: "b" });
  state = reduceMessage(state, { jsonrpc: "2.0", id, result: {} }, "unused");
  assert.equal(state.controls[0].value, "b");
});

test("로그인 요청을 보내는 동안에는 시작 상태이고 실패하면 로그인 선택으로 돌아간다", () => {
  let state = { ...initialState(), phase: "login" as const };
  let id: number;
  [state, id] = reserveRequest(state, "authenticate", { methodId: "login" });
  assert.equal(state.phase, "starting");
  state = reduceMessage(state, { jsonrpc: "2.0", id, error: { code: -32603, message: "failed" } }, "unused");
  assert.equal(state.phase, "login");
});

const update = (body: Record<string, unknown>) => ({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s", update: body } });
const fiveHour = { status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.5, resetsAt: 1763400600 };

test("usage_update가 컨텍스트와 한도를 채운다", () => {
  let state = reduceMessage(initialState(), update({ sessionUpdate: "usage_update", used: 42000, size: 100000, _meta: { "_claude/rateLimit": fiveHour } }), "x");
  assert.deepEqual(state.context, { used: 42000, size: 100000 });
  assert.equal(state.limits.length, 1);
  state = reduceMessage(state, update({ sessionUpdate: "usage_update", used: 1, size: 0 }), "x");
  assert.equal(state.context, null);
  state = reduceMessage(state, update({ sessionUpdate: "usage_update", used: 1 }), "x");
  assert.equal(state.context, null);
});

test("거절된 턴의 오류가 한도를 막힘으로 기록한다", () => {
  let state = initialState();
  let id: number;
  [state, id] = reserveRequest(state, "prompt", { sessionId: "s", prompt: [] });
  state = reduceMessage(state, { jsonrpc: "2.0", id, error: { code: -32000, message: "limit", data: { errorKind: "rate_limit", rateLimit: { status: "rejected", rateLimitType: "five_hour", resetsAt: 1763400600 } } } }, "x");
  assert.equal(state.phase, "ready");
  assert.equal(state.limits[0].blocked, true);
});

test("usage_update와 거절된 턴의 오류는 unifiedWindows의 창을 모두 합친다", () => {
  // 2026-11-19 실제 이벤트 모양
  const live = { status: "allowed", resetsAt: 1795062600, rateLimitType: "five_hour", unifiedWindows: {
    five_hour: { utilization: 0.39, resetsAt: 1795062600, status: "allowed" }, seven_day: { utilization: 0.47, resetsAt: 1795219200, status: "allowed" } } };
  let state = reduceMessage(initialState(), update({ sessionUpdate: "usage_update", used: 48019, size: 1000000, _meta: { "_claude/rateLimit": live } }), "x");
  assert.deepEqual(state.limits.map((l) => [l.id, l.label, l.usedRatio]), [["five_hour", "5시간", 0.39], ["seven_day", "7일", 0.47]]);
  let id: number;
  [state, id] = reserveRequest(state, "prompt", { sessionId: "s", prompt: [] });
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
  let state = reduceMessage(initialState(), update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "x", status: "in_progress", _meta: { claudeCode: { toolName: "Agent" } } }), "x");
  assert.equal(state.tools[0].subagent, true);
  state = reduceMessage(state, update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" }), "x");
  assert.deepEqual(state.tools, []);
});

test("세션 전환은 컨텍스트만 비우고 한도와 계정은 남긴다", () => {
  let state = reduceMessage(initialState(), update({ sessionUpdate: "usage_update", used: 1, size: 10, _meta: { "_claude/rateLimit": fiveHour } }), "x");
  state = reduceMessage(state, { jsonrpc: "2.0", method: "auth/status_update", params: { state: "authenticated", accounts: [{ label: "A", active: true }] } }, "x");
  let id: number;
  [state, id] = reserveRequest(state, "switch", "s2");
  state = reduceMessage(state, { jsonrpc: "2.0", id, result: {} }, "x");
  assert.equal(state.context, null);
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
  let state = reduceMessage(initialState(), update({ sessionUpdate: "usage_update", used: 1, size: 10, _meta: { "_claude/rateLimit": fiveHour } }), "x");
  [state] = reserveRequest(state, "switch", "s2");
  const replayed = reduceMessage(state, update({ sessionUpdate: "usage_update", used: 9, size: 10, _meta: { "_claude/rateLimit": { ...fiveHour, rateLimitType: "seven_day" } } }), "x");
  assert.deepEqual(replayed.context, { used: 1, size: 10 });
  assert.equal(replayed.limits.length, 1);
});
