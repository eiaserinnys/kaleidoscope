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
  await f.emit({ jsonrpc: "2.0", id: firstPrompt.id, result: { stopReason: "end_turn" } });
  const prompts = f.writes.filter((message) => message.method === "session/prompt");
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].params.prompt.some((part: any) => part.text?.startsWith("안내문")), false);
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
  assert.deepEqual(first.params.prompt.map((block: any) => block.type), ["text", "text", "text", "image", "resource_link"]);
  assert.ok(first.params.prompt[0].text.includes("MCP 도구"));
  assert.equal(first.params.prompt[4].uri, "file:///attachments/one-1");
  assert.equal(JSON.stringify(f.getCheckpoint()).includes("안내문"), false);
  assert.equal(JSON.stringify(f.getCheckpoint()).includes("AQI="), false);
  assert.equal(f.writes.filter((message) => message.method === "session/prompt").length, 1);
  await f.emit({ jsonrpc: "2.0", id: first.id, result: { stopReason: "end_turn" } });
  const prompts = f.writes.filter((message) => message.method === "session/prompt");
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].params.prompt.at(-1).text, "다음 말");
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

test("실패한 응답의 조각을 기록에 남기고 다시 시도하면 이전 세션을 불러온다", async () => {
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
  assert.equal(f.snapshots.at(-1).phase, "failed");
  assert.equal(f.snapshots.at(-1).items.at(-1).text, "남은 글");
  await session.retry();
  await f.emit({ jsonrpc: "2.0", id: f.writes.at(-1).id, result: { agentCapabilities: { loadSession: true } } });
  assert.equal(f.writes.at(-1).method, "session/load");
  assert.equal(f.writes.at(-1).params.sessionId, "session");
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
