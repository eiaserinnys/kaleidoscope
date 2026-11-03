import { test } from "node:test";
import { strict as assert } from "node:assert";
import { initialState, reduceMessage, reserveRequest, enqueue, answerPermission } from "../src/reducer.ts";
import { decodeLines } from "../src/transport.ts";

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
