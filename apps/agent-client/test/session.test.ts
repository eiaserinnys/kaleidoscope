import { test } from "node:test";
import { strict as assert } from "node:assert";
import { AgentSession } from "../src/session.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
function fixture() {
  const blobs = new Map<string, Uint8Array>();
  let checkpoint: unknown = null, after = 0, buffer = new Uint8Array(), handle = "p1", tools: string | null = "http://tools/old", exited = false;
  let nextUuid = 0;
  let callback = (_handle: string) => {}, serviceCallback = (_handle: string) => {};
  const writes: any[] = [], snapshots: any[] = [];
  const process = {
    attach: async () => ({ handle, after, checkpoint, cwd: "/work", services: { tools }, exit: exited ? { code: 1 } : null }),
    start: async () => { handle = "p2"; after = 0; checkpoint = null; buffer = new Uint8Array(); tools = "http://tools/new"; exited = false; return { handle, cwd: "/work", services: { tools } }; },
    read: async ({ after: cursor }: any) => ({ bytes: Array.from(buffer.slice(cursor - after)), next: after + buffer.length, exit: exited ? { code: 1 } : null, stderr_tail: [] }),
    ack: async (value: any) => { buffer = buffer.slice(value.after - after); after = value.after; checkpoint = structuredClone(value.checkpoint); },
    write: async ({ bytes, checkpoint: next }: any) => { writes.push(JSON.parse(decoder.decode(bytes))); checkpoint = structuredClone(next); },
    stop: async () => {}, file_uri: async (key: string) => `file:///${key}`,
    onReady: (listener: (handle: string) => void) => { callback = listener; }, onServicesChanged: (listener: (handle: string) => void) => { serviceCallback = listener; },
  };
  const host = {
    process,
    blobs: { put: async (key: string, bytes: Uint8Array) => { blobs.set(key, bytes.slice()); }, read: async (key: string) => blobs.get(key) ?? null, remove: async (key: string) => { blobs.delete(key); } },
    instructions: async () => "안내문",
    prepare: async () => ({ text: null, images: [], ticket: "ticket" }), commit: async () => {},
    publish: (value: any) => { snapshots.push(structuredClone(value)); },
    uuid: () => `generation-${++nextUuid}`, now: () => "now",
  };
  async function emit(message: unknown, notify = true) {
    const bytes = encoder.encode(`${JSON.stringify(message)}\n`);
    const next = new Uint8Array(buffer.length + bytes.length);
    next.set(buffer); next.set(bytes, buffer.length); buffer = next;
    if (notify) callback(handle);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  async function revokeTools() { tools = null; serviceCallback(handle); await new Promise((resolve) => setTimeout(resolve, 0)); }
  async function exit(notify: boolean) { exited = true; if (notify) callback(handle); await new Promise((resolve) => setTimeout(resolve, 0)); }
  return { host, writes, snapshots, emit, exit, revokeTools, getCheckpoint: () => checkpoint, blobKeys: () => [...blobs.keys()] };
}

test("연속 응답을 읽는 동안에도 다음 말 접수를 끝낸다", async () => {
  const f = fixture();
  const session = new AgentSession(f.host as any);
  await session.attach();
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: {} } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "session" } });
  await session.send({ id: "first", text: "첫 말", attachments: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const read = f.host.process.read;
  let batches = 0;
  let accepted: Promise<void> | undefined;
  let queuedBeforeEnd = false;
  f.host.process.read = async (args: any) => {
    if (++batches <= 8) {
      await f.emit({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "응답" } } } }, false);
      if (batches === 1) accepted = session.send({ id: "second", text: "다음 말", attachments: [] });
      if (batches === 4) queuedBeforeEnd = f.snapshots.at(-1).queued.some((entry: any) => entry.id === "second");
    }
    return read(args);
  };
  await f.emit({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "시작" } } } });
  while (batches <= 8) await new Promise((resolve) => setTimeout(resolve, 0));
  await accepted;
  assert.ok(queuedBeforeEnd, "다음 말을 응답 종료 전 대기열에 넣어야 합니다");
});

for (const framePresent of [true, false]) {
  test(`응답 중 프로세스 종료 시 ${framePresent ? "열린 프레임" : "다시 붙은 프레임"}에서 남은 글을 중단 기록으로 보존한다`, async () => {
    const f = fixture();
    const spec = { name: "시험", command: "agent", args: [], env: {} };
    const first = new AgentSession(f.host as any);
    await first.attach(spec);
    await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: { loadSession: true } } });
    await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "session" } });
    await first.send({ id: "one", text: "질문", attachments: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const chunk = (text: string) => ({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } });
    await f.emit(chunk("앞부분 "));
    await f.emit(chunk("마지막"), false);
    await f.exit(framePresent);
    const active = framePresent ? first : new AgentSession(f.host as any);
    if (!framePresent) await active.attach(spec);
    assert.equal(f.snapshots.at(-1).phase, "failed");
    await active.retry();
    const item = f.snapshots.at(-1).items.find((entry: any) => entry.kind === "assistant");
    assert.ok(item?.text.includes("앞부분 마지막"));
    assert.ok(item?.text.includes("중단"));
    assert.equal(f.writes.filter((entry) => entry.method === "session/prompt").length, 1);
  });
}

test("같은 프로세스에 다시 붙으면 진행 중인 승인과 큐를 복원한다", async () => {
  const f = fixture();
  const first = new AgentSession(f.host as any);
  await first.attach();
  assert.equal(f.writes[0].method, "initialize");
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } } } });
  assert.equal(f.writes[1].method, "session/new");
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "session" } });
  await first.send({ id: "first", text: "첫 말", attachments: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.writes[2].method, "session/prompt");
  await first.send({ id: "second", text: "다음 말", attachments: [] });
  await f.emit({ jsonrpc: "2.0", id: "permission", method: "session/request_permission", params: { toolCall: { title: "수정" }, options: [{ optionId: "yes", name: "허용", kind: "allow_once" }] } });
  const resumed = new AgentSession(f.host as any);
  await resumed.attach();
  const view = f.snapshots.at(-1);
  assert.equal(view.queued[0].id, "second");
  assert.equal(view.permissions[0].rpcId, "permission");
  assert.equal(f.writes.filter((message) => message.method === "session/prompt").length, 1);
  await resumed.answer("permission", "yes");
  assert.equal(f.writes.at(-1).result.outcome.optionId, "yes");
  assert.ok(f.snapshots.at(-1).items.some((item: any) => item.kind === "notice" && item.text.includes("허용")));
  const firstPrompt = f.writes.find((message) => message.method === "session/prompt");
  const beforeHandoff = f.snapshots.length;
  await f.emit({ jsonrpc: "2.0", id: firstPrompt.id, result: { stopReason: "end_turn" } });
  assert.ok(f.snapshots.slice(beforeHandoff).every((view) => view.busy), "줄 선 말을 이어 보내는 동안 생각 중 상태를 유지해야 합니다");
  const prompts = f.writes.filter((message) => message.method === "session/prompt");
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].params.prompt.some((part: any) => part.text?.includes("<kaleidoscope-app-guide>")), false);
});

test("응답 중 도구 주소가 바뀌면 턴을 마친 뒤 프로세스를 바꾸고 같은 세션을 load한다", async () => {
  const f = fixture();
  const session = new AgentSession(f.host as any);
  await session.attach({ name: "시험", command: "agent", args: [], env: {} });
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } } } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "session" } });
  await session.send({ id: "first", text: "말", attachments: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const prompt = f.writes.find((message) => message.method === "session/prompt");
  await f.revokeTools();
  assert.equal(f.writes.filter((message) => message.method === "initialize").length, 1);
  await f.emit({ jsonrpc: "2.0", id: prompt.id, result: { stopReason: "end_turn" } });
  assert.equal(f.writes.filter((message) => message.method === "initialize").length, 2);
  const reinit = f.writes.at(-1);
  await f.emit({ jsonrpc: "2.0", id: reinit.id, result: { agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } } } });
  const load = f.writes.at(-1);
  assert.equal(load.method, "session/load");
  assert.equal(load.params.sessionId, "session");
  assert.equal(load.params.mcpServers[0].url, "http://tools/new");
});

test("전송 동작은 준비가 오래 걸려도 큐 수락 뒤 바로 끝난다", async () => {
  const f = fixture();
  let release: ((value: any) => void) | undefined;
  f.host.prepare = async () => new Promise((resolve) => { release = resolve; });
  const session = new AgentSession(f.host as any);
  await session.attach();
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: {} } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "session" } });
  await session.send({ id: "queued", text: "메시지", attachments: [] });
  assert.equal(f.snapshots.at(-1).queued[0].id, "queued");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(typeof release, "function");
  assert.equal(f.writes.some((message) => message.method === "session/prompt"), false);
  release!({ text: null, images: [], ticket: "ticket" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.writes.at(-1).method, "session/prompt");
});

test("같이 보기 준비 오류는 원래 코드와 문구를 유지한다", async () => {
  const f = fixture();
  f.host.prepare = async () => { throw Object.assign(new Error("같이 보기 준비 결과를 찾지 못했습니다."), { id: "SHARE_CONTEXT_TICKET_NOT_FOUND", code: "not_found" }); };
  const session = new AgentSession(f.host as any);
  await session.attach();
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: {} } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "session" } });
  await session.send({ id: "queued", text: "메시지", attachments: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const failure = f.snapshots.at(-1).failure;
  assert.equal(failure.id, "SHARE_CONTEXT_TICKET_NOT_FOUND");
  assert.equal(failure.message, "같이 보기 준비 결과를 찾지 못했습니다.");
  assert.equal(failure.code, "not_found");
});

test("실행 중인 에이전트가 종료되면 프로토콜 오류와 다른 코드를 보인다", async () => {
  const f = fixture();
  f.host.process.read = async () => ({ bytes: [], next: 0, exit: { code: 1 }, stderr_tail: [] });
  const session = new AgentSession(f.host as any);
  await session.attach({ name: "시험", command: "agent", args: [], env: {} });
  assert.equal(f.snapshots.at(-1).failure.id, "AGENT_PROCESS_EXITED");
  assert.ok(f.snapshots.at(-1).failure.message.includes("시험"));
});

test("에이전트 오류에 도구 중계 주소가 담겨도 화면에 내보내지 않는다", async () => {
  const f = fixture();
  const session = new AgentSession(f.host as any);
  await session.attach();
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: { mcpCapabilities: { http: true } } } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "session" } });
  await session.send({ id: "one", text: "말", attachments: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, error: { code: -32603, message: "failed http://tools/old" } });
  assert.ok(!f.snapshots.at(-1).failure.reason.includes("http://tools/old"));
});

test("큐를 순서대로 보내고 첫 말에만 지침과 같이 보기 및 첨부를 넣는다", async () => {
  const f = fixture();
  let guides = 0, commits = 0;
  f.host.instructions = async () => { guides++; return "안내문"; };
  f.host.prepare = async () => ({ text: "같이 보는 글", images: [], ticket: "ticket" });
  f.host.commit = async () => { commits++; };
  const session = new AgentSession(f.host as any);
  await session.attach();
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: { promptCapabilities: { image: true } } } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "session" } });
  await session.send({ id: "one", text: "첫 말", attachments: [
    { name: "그림.png", mime: "image/png", bytes: new Uint8Array([1, 2]) },
    { name: "메모.txt", mime: "text/plain", bytes: new Uint8Array([3]) },
  ] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await session.send({ id: "two", text: "다음 말", attachments: [] });
  const first = f.writes.find((message) => message.method === "session/prompt");
  assert.deepEqual(first.params.prompt.map((block: any) => block.type), ["text", "text", "image", "resource_link", "text"]);
  assert.ok(first.params.prompt[4].text.includes("MCP 도구"));
  assert.equal(first.params.prompt[3].uri, "file:///attachments/one-1");
  assert.equal(JSON.stringify(f.getCheckpoint()).includes("안내문"), false);
  assert.equal(JSON.stringify(f.getCheckpoint()).includes("AQI="), false);
  assert.equal(f.writes.filter((message) => message.method === "session/prompt").length, 1);
  await f.emit({ jsonrpc: "2.0", id: first.id, result: { stopReason: "end_turn" } });
  const prompts = f.writes.filter((message) => message.method === "session/prompt");
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].params.prompt[0].text, "다음 말");
  assert.equal(guides, 1);
  assert.equal(commits, 2);
});

test("프로세스 교체 후 세션과 저장한 모델을 복원한다", async () => {
  const f = fixture();
  const session = new AgentSession(f.host as any);
  await session.attach({ name: "시험", command: "agent", args: [], env: {} });
  const capabilities = { loadSession: true, mcpCapabilities: { http: true } };
  const models = { currentModelId: "a", availableModels: [{ modelId: "a", name: "A" }, { modelId: "b", name: "B" }] };
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: capabilities } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "session", models } });
  await session.configure("__legacy_model", "b");
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: {} });
  await f.revokeTools();
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: { agentCapabilities: capabilities } });
  assert.equal(f.writes.at(-1).method, "session/load");
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: { models } });
  assert.equal(f.writes.at(-1).method, "session/set_model");
  assert.equal(f.writes.at(-1).params.modelId, "b");
});

test("긴 진행 글은 checkpoint에 파일 참조로 남기고 재접속 때 복원한다", async () => {
  const f = fixture();
  const first = new AgentSession(f.host as any);
  await first.attach();
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: {} } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "session" } });
  await first.send({ id: "one", text: "말", attachments: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const text = "가".repeat(70000);
  await f.emit({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } });
  const checkpoint = f.getCheckpoint() as any;
  assert.equal(checkpoint.stream.text.length, 0);
  assert.ok(checkpoint.streamKey);
  await f.emit({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "나" } } } });
  assert.equal(f.blobKeys().filter((key) => key.startsWith("transient/stream-")).length, 1);
  const resumed = new AgentSession(f.host as any);
  await resumed.attach();
  assert.equal(f.snapshots.at(-1).text, `${text}나`);
});

test("실패한 한 턴은 글과 오류를 남기고 같은 세션에서 다음 말을 받는다", async () => {
  const f = fixture();
  const session = new AgentSession(f.host as any);
  await session.attach({ name: "시험", command: "agent", args: [], env: {} });
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: { loadSession: true } } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "session" } });
  await session.send({ id: "one", text: "말", attachments: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const prompt = f.writes.at(-1);
  await f.emit({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "남은 글" } } } });
  await f.emit({ jsonrpc: "2.0", id: prompt.id, error: { code: -32603, message: "오류" } });
  assert.equal(f.snapshots.at(-1).phase, "ready");
  assert.equal(f.snapshots.at(-1).failure.id, "AGENT_ACP_PROTOCOL_FAILED");
  assert.equal(f.snapshots.at(-1).items.at(-1).text, "남은 글");
  await session.send({ id: "two", text: "다음 말", attachments: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.writes.at(-1).method, "session/prompt");
  assert.equal(f.writes.at(-1).params.sessionId, "session");
  assert.equal(f.snapshots.at(-1).failure, null);
});

test("입력 검사는 기존 에이전트 제한과 오류 식별자를 유지한다", async () => {
  const f = fixture();
  const session = new AgentSession(f.host as any);
  await session.attach();
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: {} } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "session" } });
  await assert.rejects(session.send({ id: "", text: "말", attachments: [] }), { id: "AGENT_PROMPT_REQUEST_ID_MISSING" });
  await assert.rejects(session.send({ id: "id", text: " ", attachments: [] }), { id: "AGENT_PROMPT_CONTENT_EMPTY" });
  await assert.rejects(session.send({ id: "id", text: "가".repeat(20001), attachments: [] }), { id: "AGENT_PROMPT_TEXT_TOO_LONG" });
  await assert.rejects(session.send({ id: "id", text: "말", attachments: Array.from({ length: 11 }, () => ({ name: "a", mime: "text/plain", bytes: new Uint8Array() })) }), { id: "AGENT_PROMPT_TOO_MANY_ATTACHMENTS" });
});

test("이전 세션 load를 거절하면 안내를 기록하고 새 세션을 연다", async () => {
  const f = fixture();
  const session = new AgentSession(f.host as any);
  await session.attach({ name: "시험", command: "agent", args: [], env: {} });
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } } } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "session" } });
  await f.revokeTools();
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: { agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } } } });
  assert.equal(f.writes.at(-1).method, "session/load");
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, error: { code: -32603, message: "load failed" } });
  assert.equal(f.writes.at(-1).method, "session/new");
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: { sessionId: "new" } });
  assert.ok(f.snapshots.at(-1).items.some((item: any) => item.text.includes("앞 대화를 이어받지 못했습니다")));
});

test("프로세스 교체 뒤에도 이전 응답과 새 응답을 서로 다른 기록으로 보존한다", async () => {
  const f = fixture();
  const session = new AgentSession(f.host as any);
  await session.attach({ name: "시험", command: "agent", args: [], env: {} });
  const capabilities = { loadSession: true, mcpCapabilities: { http: true } };
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: capabilities } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "session" } });
  await session.send({ id: "one", text: "first", attachments: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const first = f.writes.at(-1);
  const chunk = (text: string) => ({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } });
  await f.emit(chunk("이전"));
  await f.emit({ jsonrpc: "2.0", id: first.id, result: { stopReason: "end_turn" } });
  await f.revokeTools();
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: { agentCapabilities: capabilities } });
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: { sessionId: "session" } });
  await session.send({ id: "two", text: "second", attachments: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = f.writes.at(-1);
  await f.emit(chunk("새 응답"));
  await f.emit({ jsonrpc: "2.0", id: second.id, result: { stopReason: "end_turn" } });
  assert.deepEqual(f.snapshots.at(-1).items.filter((item: any) => item.kind === "assistant").map((item: any) => item.text), ["이전", "새 응답"]);
});

async function readyWithHistory() {
  const f = fixture();
  const session = new AgentSession(f.host as any);
  await session.attach();
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } } } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "current" } });
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: { sessions: [] } });
  await session.send({ id: "old", text: "기존 대화", attachments: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: { stopReason: "end_turn" } });
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: { sessions: [] } });
  return { f, session };
}

test("지난 세션은 모든 쪽을 받고 폴더를 정확히 거른 뒤 최근 순으로 보인다", async () => {
  const { f, session } = await readyWithHistory();
  await session.listSessions();
  assert.equal(f.writes.at(-1).method, "session/list");
  assert.deepEqual(f.writes.at(-1).params, { cwd: "/work" });
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: { sessions: [
    { sessionId: "older", cwd: "/work", updatedAt: "2026-11-05T01:00:00+09:00" },
    { sessionId: "other", cwd: "/work/sub", updatedAt: "2026-11-04T01:00:00Z" }
  ], nextCursor: "next" } });
  assert.deepEqual(f.snapshots.at(-1).sessions.map((s: any) => s.sessionId), ["older"]);
  assert.deepEqual(f.writes.at(-1).params, { cwd: "/work", cursor: "next" });
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: { sessions: [
    { sessionId: "newer", cwd: "/work", updatedAt: "2026-11-04T23:00:00Z" }
  ] } });
  assert.deepEqual(f.snapshots.at(-1).sessions.map((s: any) => s.sessionId), ["newer", "older"]);
  assert.equal(f.snapshots.at(-1).sessionsLoading, false);
  assert.equal(JSON.stringify(f.getCheckpoint()).includes("newer"), false);
});

test("고른 세션의 리플레이를 메시지별로 모아 성공 후에 기록과 세션을 바꾼다", async () => {
  const { f, session } = await readyWithHistory();
  await session.loadSession("chosen");
  const load = f.writes.at(-1);
  assert.equal(load.method, "session/load");
  const chunk = (type: string, id: string, text: string) => ({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "chosen", update: { sessionUpdate: type, messageId: id, content: { type: "text", text } } } });
  await f.emit(chunk("user_message_chunk", "u", "안"));
  await f.emit(chunk("user_message_chunk", "u", "녕"));
  await f.emit(chunk("agent_message_chunk", "a", "응답"));
  assert.ok(f.snapshots.at(-1).items.some((item: any) => item.text === "기존 대화"));
  await f.emit({ jsonrpc: "2.0", id: load.id, result: {} });
  assert.deepEqual(f.snapshots.at(-1).items.map((item: any) => [item.kind, item.text]), [["user", "안녕"], ["assistant", "응답"]]);
  assert.equal(f.snapshots.at(-1).sessionId, "chosen");
  const manifest = JSON.parse(decoder.decode((await f.host.blobs.read("record/manifest.json"))!));
  assert.equal(manifest.sessionId, "chosen");
  const resumed = new AgentSession(f.host as any);
  await resumed.attach();
  assert.equal(f.snapshots.at(-1).sessionId, "chosen");
});

test("이어 가기 실패는 기존 기록을 유지하고 다른 곳에서 열린 까닭을 보인다", async () => {
  const { f, session } = await readyWithHistory();
  await session.loadSession("chosen");
  await f.emit({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "chosen", update: { sessionUpdate: "user_message_chunk", messageId: "u", content: { type: "text", text: "버릴 글" } } } });
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, error: { code: -32600, message: "active", data: { reason: "thread_active_writer" } } });
  const view = f.snapshots.at(-1);
  assert.equal(view.sessionId, "current");
  assert.deepEqual(view.items.map((item: any) => item.text), ["기존 대화"]);
  assert.equal(view.sessionError.id, "AGENT_SESSION_LOAD_ACTIVE_WRITER");
  assert.match(view.sessionError.message, /다른 곳에서 열려 있는 세션/);
  assert.equal(f.writes.at(-1).method, "session/load");
});

test("새 세션 성공은 기록과 세션별 설정을 비운다", async () => {
  const { f, session } = await readyWithHistory();
  await session.newSession();
  assert.equal(f.writes.at(-1).method, "session/new");
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: { sessionId: "new" } });
  assert.equal(f.snapshots.at(-1).sessionId, "new");
  assert.deepEqual(f.snapshots.at(-1).items, []);
  const manifest = JSON.parse(decoder.decode((await f.host.blobs.read("record/manifest.json"))!));
  assert.equal(manifest.sessionId, "new");
  assert.deepEqual(manifest.controls, {});
  assert.equal((f.getCheckpoint() as any).guideSent, false);
});

test("목록 능력이 없으면 지난 세션을 사용할 수 없다", async () => {
  const f = fixture();
  const session = new AgentSession(f.host as any);
  await session.attach();
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: { loadSession: true } } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "current" } });
  assert.equal(f.snapshots.at(-1).canListSessions, false);
  await session.listSessions();
  assert.equal(f.writes.some((write: any) => write.method === "session/list"), false);
});

test("목록 요청이 실패하면 기존 대화와 세션을 유지하고 목록 오류를 표시한다", async () => {
  const { f, session } = await readyWithHistory();
  await session.listSessions();
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, error: { code: -32603, message: "목록 오류" } });
  const view = f.snapshots.at(-1);
  assert.equal(view.sessionId, "current");
  assert.equal(view.items[0].text, "기존 대화");
  assert.equal(view.sessionError.id, "AGENT_SESSION_LIST_FAILED");
  assert.match(view.sessionError.message, /목록 오류/);
  assert.equal(view.sessionsLoading, false);
});

test("세션을 바꾸는 동안 새 메시지를 접수하지 않아 실패 시 예전 대화로 보내지 않는다", async () => {
  const { f, session } = await readyWithHistory();
  const before = f.writes.filter((write: any) => write.method === "session/prompt").length;
  await session.newSession();
  const request = f.writes.at(-1);
  await assert.rejects(session.send({ id: "pending", text: "새 대화의 말", attachments: [] }), { id: "AGENT_PROMPT_SEND_NOT_READY" });
  await f.emit({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: "실패" } });
  assert.equal(f.writes.filter((write: any) => write.method === "session/prompt").length, before);
  assert.equal(f.snapshots.at(-1).sessionId, "current");
});

test("설정 변경을 기다리는 동안 세션 단추를 잠그고 채팅 응답 상태는 유지한다", async () => {
  const { f, session } = await readyWithHistory();
  await session.configure("model", "next");
  assert.equal(f.snapshots.at(-1).configuring, true);
  assert.equal(f.snapshots.at(-1).busy, false);
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: {} });
  assert.equal(f.snapshots.at(-1).configuring, false);
});

test("목록 능력이 없는 이전 판 체크포인트는 같은 프로세스에 붙고 목록만 잠근다", async () => {
  const { f } = await readyWithHistory();
  delete (f.getCheckpoint() as any).capabilities.list;
  const before = f.writes.filter((write: any) => write.method === "initialize").length;
  const resumed = new AgentSession(f.host as any);
  assert.equal(await resumed.attach(), true);
  assert.equal(f.snapshots.at(-1).canListSessions, false);
  assert.equal(f.snapshots.at(-1).sessionId, "current");
  assert.equal(f.writes.filter((write: any) => write.method === "initialize").length, before);
});

test("첫 지침은 사용자 글과 같이 보기 뒤에 표지로 감싸 보낸다", async () => {
  const f = fixture();
  f.host.prepare = async () => ({ text: "같이 보기", images: [], ticket: "ticket" });
  const session = new AgentSession(f.host as any);
  await session.attach();
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: {} } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "s" } });
  await session.send({ id: "q", text: "사용자 말", attachments: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const prompt = f.writes.at(-1).params.prompt;
  assert.equal(prompt[0].text, "사용자 말");
  assert.equal(prompt[1].text, "같이 보기");
  assert.match(prompt.at(-1).text, /^<kaleidoscope-app-guide>\n안내문\n.*\n<\/kaleidoscope-app-guide>$/);
});

for (const hasGuide of [true, false]) {
  test(`리플레이의 지침 표지 ${hasGuide ? "있음" : "없음"}에 따라 기록과 발송 여부를 정한다`, async () => {
    const { f, session } = await readyWithHistory();
    await session.loadSession("chosen");
    const id = f.writes.at(-1).id;
    const chunk = (messageId: string, text: string) => ({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "user_message_chunk", messageId, content: { type: "text", text } } } });
    await f.emit(chunk("one", " 사용자 말 "));
    if (hasGuide) {
      await f.emit(chunk("one", "<kaleidoscope-app-"));
      await f.emit(chunk("one", "guide>지침</kaleidoscope-app-guide>"));
      await f.emit(chunk("two", "<kaleidoscope-app-guide>지침만"));
    }
    await f.emit({ jsonrpc: "2.0", id, result: {} });
    assert.deepEqual(f.snapshots.at(-1).items.map((item: any) => item.text), ["사용자 말"]);
    assert.equal((f.getCheckpoint() as any).guideSent, hasGuide);
    await session.send({ id: "after", text: "다음", attachments: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const parts = f.writes.at(-1).params.prompt;
    assert.equal(parts.some((part: any) => part.text?.includes("<kaleidoscope-app-guide>")), !hasGuide);
  });
}

for (const toolLine of ["MCP 도구가 연결되어 있습니다.", "현재 MCP 도구를 사용할 수 없습니다."]) {
  test(`옛 지침과 ${toolLine} 뒤에 이어 붙은 사용자 말만 복원한다`, async () => {
    const { f, session } = await readyWithHistory();
    await session.loadSession("chosen");
    const id = f.writes.at(-1).id;
    const chunk = (messageId: string, text: string) => ({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "user_message_chunk", messageId, content: { type: "text", text } } } });
    await f.emit(chunk("one", " \n  kaleidoscope 앱 제작 지침\n지침 본문\n" + toolLine));
    await f.emit(chunk("one", "아까 기억하라던 말"));
    await f.emit(chunk("two", "kaleidoscope 앱 제작 지침\n지침 본문\n" + toolLine));
    await f.emit({ jsonrpc: "2.0", id, result: {} });
    assert.deepEqual(f.snapshots.at(-1).items.map((item: any) => item.text), ["아까 기억하라던 말"]);
    assert.equal((f.getCheckpoint() as any).guideSent, true);
    await session.send({ id: "after", text: "다음", attachments: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(f.writes.at(-1).params.prompt.some((part: any) => part.text?.includes("<kaleidoscope-app-guide>")), false);
  });
}

test("도구 줄이 없는 옛 지침 형태의 글은 보존하고 지침을 보낸 세션으로 판정한다", async () => {
  const { f, session } = await readyWithHistory();
  await session.loadSession("chosen");
  const id = f.writes.at(-1).id;
  const text = "  kaleidoscope 앱 제작 지침\n도구 줄 없는 글  ";
  await f.emit({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "user_message_chunk", messageId: "one", content: { type: "text", text } } } });
  await f.emit({ jsonrpc: "2.0", id, result: {} });
  assert.deepEqual(f.snapshots.at(-1).items.map((item: any) => item.text), [text]);
  assert.equal((f.getCheckpoint() as any).guideSent, true);
});

test("세션 준비와 전환, 새 대화의 첫 응답에 목록을 갱신하고 일반 턴에는 갱신하지 않는다", async () => {
  const f = fixture();
  const session = new AgentSession(f.host as any);
  const count = () => f.writes.filter((entry) => entry.method === "session/list").length;
  const finishList = async () => {
    const request = f.writes.filter((entry) => entry.method === "session/list").at(-1);
    await f.emit({ jsonrpc: "2.0", id: request.id, result: { sessions: [] } });
  };
  await session.start({ name: "시험", command: "agent", args: [], env: {} });
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } } } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "first" } });
  assert.equal(count(), 1);
  await session.listSessions();
  assert.equal(count(), 1);
  await finishList();
  await session.send({ id: "first", text: "첫 말", attachments: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: { stopReason: "end_turn" } });
  assert.equal(count(), 2);
  await finishList();
  await session.send({ id: "second", text: "다음 말", attachments: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: { stopReason: "end_turn" } });
  assert.equal(count(), 2);
  await session.loadSession("older");
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: {} });
  assert.equal(count(), 3);
  await finishList();
  await session.newSession();
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: { sessionId: "new" } });
  assert.equal(count(), 4);
  await finishList();
  await session.listSessions();
  assert.equal(count(), 5);
  await finishList();
  await session.send({ id: "new-first", text: "새 대화 첫 말", attachments: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: { stopReason: "end_turn" } });
  assert.equal(count(), 6);
  await finishList();
});

test("이미 준비된 세션에 붙으면 목록을 받는다", async () => {
  const f = fixture();
  const first = new AgentSession(f.host as any);
  await first.attach();
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: { sessionCapabilities: { list: {} } } } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "first" } });
  const initial = f.writes.filter((entry) => entry.method === "session/list").at(-1);
  if (initial) await f.emit({ jsonrpc: "2.0", id: initial.id, result: { sessions: [] } });
  const count = f.writes.filter((entry) => entry.method === "session/list").length;
  const resumed = new AgentSession(f.host as any);
  await resumed.attach();
  assert.equal(f.writes.filter((entry) => entry.method === "session/list").length, count + 1);
});

test("목록을 받는 중 다시 붙으면 진행 표시를 유지하고 중복 요청하지 않는다", async () => {
  const f = fixture();
  const first = new AgentSession(f.host as any);
  await first.attach();
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: { sessionCapabilities: { list: {} } } } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "first" } });
  const count = f.writes.filter((entry) => entry.method === "session/list").length;
  const resumed = new AgentSession(f.host as any);
  await resumed.attach();
  assert.equal(f.snapshots.at(-1).sessionsLoading, true);
  assert.equal(f.writes.filter((entry) => entry.method === "session/list").length, count);
});

test("목록을 기다리는 동안 대화를 보내고 첫 응답 뒤에 목록을 다시 받는다", async () => {
  const f = fixture();
  const session = new AgentSession(f.host as any);
  await session.start({ name: "시험", command: "agent", args: [], env: {} });
  await f.emit({ jsonrpc: "2.0", id: 1, result: { agentCapabilities: { sessionCapabilities: { list: {} } } } });
  await f.emit({ jsonrpc: "2.0", id: 2, result: { sessionId: "new" } });
  const listing = f.writes.at(-1);
  assert.equal(listing.method, "session/list");
  await session.send({ id: "first", text: "첫 말", attachments: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const prompt = f.writes.at(-1);
  assert.equal(prompt.method, "session/prompt");
  await f.emit({ jsonrpc: "2.0", id: prompt.id, result: { stopReason: "end_turn" } });
  assert.equal(f.writes.filter((entry) => entry.method === "session/list").length, 1);
  await f.emit({ jsonrpc: "2.0", id: listing.id, result: { sessions: [] } });
  assert.equal(f.writes.filter((entry) => entry.method === "session/list").length, 2);
});
