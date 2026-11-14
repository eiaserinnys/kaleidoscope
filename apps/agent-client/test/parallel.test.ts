import { test } from "node:test";
import { strict as assert } from "node:assert";
import { AgentSession } from "../src/session.ts";
import { AppClient } from "../src/app.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const parallel = { name: "시험", command: "agent", args: [], env: {}, parallel_sessions: true };
const single = { name: "시험", command: "agent", args: [], env: {} };

function fixture() {
  const blobs = new Map<string, Uint8Array>();
  let checkpoint: unknown = null, after = 0, buffer = new Uint8Array(), handle = "p1", tools: string | null = "http://tools/old";
  let callback = (_handle: string) => {}, serviceCallback = (_handle: string) => {};
  let nextUuid = 0, starts = 0;
  const writes: any[] = [], snapshots: any[] = [];
  const process = {
    attach: async () => ({ handle, after, checkpoint, cwd: "/work", services: { tools }, exit: null }),
    start: async () => { starts++; handle = `p${starts + 1}`; after = 0; checkpoint = null; buffer = new Uint8Array(); tools = tools === null ? null : "http://tools/new"; return { handle, cwd: "/work", services: { tools } }; },
    read: async ({ after: cursor }: any) => ({ bytes: Array.from(buffer.slice(cursor - after)), next: after + buffer.length, exit: null, stderr_tail: [] }),
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
  async function emit(message: unknown) {
    const bytes = encoder.encode(`${JSON.stringify(message)}\n`);
    const next = new Uint8Array(buffer.length + bytes.length);
    next.set(buffer); next.set(bytes, buffer.length); buffer = next;
    callback(handle);
    await tick();
  }
  async function revokeTools() { tools = null; serviceCallback(handle); await tick(); }
  const reply = (request: any, result: unknown) => emit({ jsonrpc: "2.0", id: request.id, result });
  const last = (method: string) => writes.filter((entry) => entry.method === method).at(-1);
  const count = (method: string) => writes.filter((entry) => entry.method === method).length;
  const chunk = (sessionId: string, text: string, kind = "agent_message_chunk", messageId?: string) =>
    emit({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: kind, ...(messageId ? { messageId } : {}), content: { type: "text", text } } } });
  return { host, writes, snapshots, emit, reply, last, count, chunk, revokeTools, getCheckpoint: () => checkpoint as any, setCheckpoint: (value: unknown) => { checkpoint = value; } };
}

/** 세션 a를 연 뒤 목록을 받은 상태. */
async function started(spec: typeof parallel | typeof single = parallel, capabilities: Record<string, unknown> = { loadSession: true, sessionCapabilities: { list: {} } }) {
  const f = fixture();
  const session = new AgentSession(f.host as any);
  await session.start(spec);
  await f.reply(f.last("initialize"), { agentCapabilities: capabilities });
  await f.reply(f.last("session/new"), { sessionId: "a" });
  if (f.last("session/list")) await f.reply(f.last("session/list"), { sessions: [] });
  return { f, session };
}

async function prompt(f: ReturnType<typeof fixture>, session: AgentSession, id: string, text: string) {
  await session.send({ id, text, attachments: [] });
  await tick();
  return f.writes.filter((entry) => entry.method === "session/prompt").at(-1);
}

test("응답 중에도 새 세션을 열어 두 세션에 동시에 말을 보내고 섞인 업데이트를 세션별로 남긴다", async () => {
  const { f, session } = await started();
  const promptA = await prompt(f, session, "qa", "A 질문");
  assert.equal(promptA.params.sessionId, "a");
  await f.chunk("a", "A1 ");
  await session.newSession();
  const created = f.last("session/new");
  await f.chunk("a", "A2 ");
  await f.reply(created, { sessionId: "b" });
  assert.equal(f.snapshots.at(-1).sessionId, "b");
  assert.equal(f.snapshots.at(-1).busy, false);
  assert.deepEqual(f.snapshots.at(-1).live.find((entry: any) => entry.sessionId === "a"), { sessionId: "a", busy: true, permissions: 0 });
  const promptB = await prompt(f, session, "qb", "B 질문");
  assert.equal(promptB.params.sessionId, "b");
  await f.chunk("b", "B1 ");
  await f.chunk("a", "A3");
  await f.chunk("b", "B2");
  assert.equal(f.snapshots.at(-1).text, "B1 B2");
  await f.reply(promptA, { stopReason: "end_turn" });
  assert.equal(f.snapshots.at(-1).busy, true, "전경 b는 아직 응답 중이다");
  await f.reply(promptB, { stopReason: "end_turn" });
  assert.deepEqual(f.snapshots.at(-1).items.map((item: any) => item.text), ["B 질문", "B1 B2"]);
  await session.loadSession("a");
  assert.deepEqual(f.snapshots.at(-1).items.map((item: any) => item.text), ["A 질문", "A1 A2 A3"]);
});

test("A가 응답하는 동안 B를 load해도 기록이 섞이지 않고 A로 돌아갈 때 session/load를 다시 보내지 않는다", async () => {
  const { f, session } = await started();
  const promptA = await prompt(f, session, "qa", "A 질문");
  await f.chunk("a", "A 응답 ");
  await session.loadSession("b");
  const load = f.last("session/load");
  assert.equal(load.params.sessionId, "b");
  assert.equal(f.snapshots.at(-1).switching, true);
  await f.chunk("b", "B 옛 질문", "user_message_chunk", "u1");
  await f.chunk("a", "이어짐");
  await f.chunk("b", "B 옛 답", "agent_message_chunk", "m1");
  assert.equal(f.snapshots.at(-1).text, "A 응답 이어짐", "전환 응답 전까지는 A가 보인다");
  await f.reply(load, {});
  let view = f.snapshots.at(-1);
  assert.equal(view.sessionId, "b");
  assert.deepEqual(view.items.map((item: any) => item.text), ["B 옛 질문", "B 옛 답"]);
  assert.equal(view.text, "");
  await f.chunk("a", " 끝");
  await f.reply(promptA, { stopReason: "end_turn" });
  const loads = f.count("session/load");
  await session.loadSession("a");
  assert.equal(f.count("session/load"), loads, "이미 들고 있는 세션은 다시 load하지 않는다");
  view = f.snapshots.at(-1);
  assert.equal(view.sessionId, "a");
  assert.deepEqual(view.items.map((item: any) => item.text), ["A 질문", "A 응답 이어짐 끝"]);
  await session.loadSession("b");
  assert.equal(f.count("session/load"), loads);
  assert.deepEqual(f.snapshots.at(-1).items.map((item: any) => item.text), ["B 옛 질문", "B 옛 답"]);
});

test("뒤 세션의 허용 요청은 요약에 남고 답하면 그 세션으로 간다", async () => {
  const { f, session } = await started();
  await prompt(f, session, "qa", "A 질문");
  await session.newSession();
  await f.reply(f.last("session/new"), { sessionId: "b" });
  await f.emit({ jsonrpc: "2.0", id: "perm", method: "session/request_permission", params: { sessionId: "a", toolCall: { title: "파일 쓰기" }, options: [{ optionId: "yes", name: "허용", kind: "allow_once" }] } });
  let view = f.snapshots.at(-1);
  assert.deepEqual(view.permissions, [], "전경 b의 허용 목록에는 없다");
  assert.equal(view.live.find((entry: any) => entry.sessionId === "a").permissions, 1);
  await session.loadSession("a");
  view = f.snapshots.at(-1);
  assert.equal(view.permissions[0].rpcId, "perm");
  await session.answer("perm", "yes");
  assert.deepEqual(f.writes.at(-1), { jsonrpc: "2.0", id: "perm", result: { outcome: { outcome: "selected", optionId: "yes" } } });
  assert.ok(f.snapshots.at(-1).items.some((item: any) => item.kind === "notice" && item.text === "파일 쓰기: 허용"));
});

test("멈춤은 전경 세션에만 session/cancel을 보낸다", async () => {
  const { f, session } = await started();
  await prompt(f, session, "qa", "A 질문");
  await session.newSession();
  await f.reply(f.last("session/new"), { sessionId: "b" });
  await prompt(f, session, "qb", "B 질문");
  await session.cancel();
  const cancels = f.writes.filter((entry) => entry.method === "session/cancel");
  assert.deepEqual(cancels.map((entry) => entry.params.sessionId), ["b"]);
  await session.loadSession("a");
  await session.cancel();
  assert.deepEqual(f.writes.filter((entry) => entry.method === "session/cancel").map((entry) => entry.params.sessionId), ["b", "a"]);
});

test("응답 중에도 목록을 받고, 아직 목록에 없는 새 세션을 목록 앞에 붙인다", async () => {
  const { f, session } = await started();
  await prompt(f, session, "qa", "A 질문");
  await session.newSession();
  await f.reply(f.last("session/new"), { sessionId: "b" });
  const list = f.last("session/list");
  assert.ok(list, "응답 중인 a가 있어도 목록을 요청한다");
  await f.reply(list, { sessions: [{ sessionId: "a", cwd: "/work", title: "A 대화", updatedAt: "2026-11-14T00:00:00Z" }, { sessionId: "old", cwd: "/work" }] });
  assert.deepEqual(f.snapshots.at(-1).sessions.map((entry: any) => [entry.sessionId, entry.title]), [["b", "새 세션"], ["a", "A 대화"], ["old", undefined]]);
});

test("도구 주소가 바뀌면 모든 세션이 쉴 때까지 프로세스 교체를 미루고 뒤 세션의 남은 말을 먼저 보낸다", async () => {
  const { f, session } = await started(parallel, { loadSession: true, mcpCapabilities: { http: true } });
  const promptA = await prompt(f, session, "qa", "A 질문");
  await session.newSession();
  await f.reply(f.last("session/new"), { sessionId: "b" });
  const promptB = await prompt(f, session, "qb", "B 질문");
  await session.loadSession("a");
  await session.send({ id: "qa2", text: "A 다음", attachments: [] });
  await session.loadSession("b");
  await f.revokeTools();
  await f.reply(promptB, { stopReason: "end_turn" });
  assert.equal(f.count("initialize"), 1, "a가 응답 중이라 교체하지 않는다");
  await f.reply(promptA, { stopReason: "end_turn" });
  assert.equal(f.count("initialize"), 1, "뒤 세션 a의 남은 말을 먼저 보낸다");
  const promptA2 = f.last("session/prompt");
  assert.equal(promptA2.params.sessionId, "a");
  assert.equal(promptA2.params.prompt[0].text, "A 다음");
  await f.reply(promptA2, { stopReason: "end_turn" });
  assert.equal(f.count("initialize"), 2);
  await f.reply(f.last("initialize"), { agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } } });
  const load = f.last("session/load");
  assert.equal(load.params.sessionId, "b", "새 프로세스는 전경 세션만 다시 연다");
});

test("도구 교체를 기다리는 동안 전경 세션의 말은 새 프로세스로 넘겨 보낸다", async () => {
  const { f, session } = await started(parallel, { loadSession: true, mcpCapabilities: { http: true } });
  const first = await prompt(f, session, "one", "첫 말");
  await session.send({ id: "two", text: "다음 말", attachments: [] });
  await f.revokeTools();
  await f.reply(first, { stopReason: "end_turn" });
  assert.equal(f.count("session/prompt"), 1);
  await f.reply(f.last("initialize"), { agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } } });
  await f.reply(f.last("session/load"), {});
  assert.equal(f.last("session/prompt").params.prompt[0].text, "다음 말");
  assert.equal(f.last("session/prompt").params.sessionId, "a");
});

test("동시 세션을 끈 에이전트는 응답 중 세션을 바꾸지 않고 돌아갈 때 다시 load한다", async () => {
  const { f, session } = await started(single);
  const first = await prompt(f, session, "qa", "A 질문");
  const loads = f.count("session/load"), news = f.count("session/new");
  await session.loadSession("b");
  await session.newSession();
  assert.equal(f.count("session/load"), loads);
  assert.equal(f.count("session/new"), news);
  assert.equal(f.snapshots.at(-1).parallel, false);
  await f.reply(first, { stopReason: "end_turn" });
  await session.loadSession("b");
  await f.reply(f.last("session/load"), {});
  assert.equal(f.snapshots.at(-1).sessionId, "b");
  assert.deepEqual(f.snapshots.at(-1).live.map((entry: any) => entry.sessionId), ["b"]);
  await session.loadSession("a");
  assert.equal(f.last("session/load").params.sessionId, "a", "앞 세션은 들고 있지 않으므로 다시 load한다");
});

test("동시 세션을 끈 에이전트는 응답 중에 목록을 받지 않는다", async () => {
  const { f, session } = await started(single);
  const first = await prompt(f, session, "qa", "A 질문");
  const lists = f.count("session/list");
  await session.listSessions();
  assert.equal(f.count("session/list"), lists);
  await f.reply(first, { stopReason: "end_turn" });
  assert.equal(f.count("session/list"), lists + 1);
});

test("뒤에서 실패한 턴은 그 세션의 기록에 안내로 남는다", async () => {
  const { f, session } = await started();
  const promptA = await prompt(f, session, "qa", "A 질문");
  await session.newSession();
  await f.reply(f.last("session/new"), { sessionId: "b" });
  await f.emit({ jsonrpc: "2.0", id: promptA.id, error: { code: -32603, message: "실패 http://tools/new" } });
  assert.equal(f.snapshots.at(-1).failure, null, "전경 b에는 오류를 띄우지 않는다");
  await session.loadSession("a");
  const notice = f.snapshots.at(-1).items.at(-1);
  assert.equal(notice.kind, "notice");
  assert.match(notice.text, /에이전트 응답을 받지 못했습니다/);
  assert.ok(!notice.text.includes("http://tools/new"));
});

test("schema 1 체크포인트에 다시 붙으면 진행 중인 턴과 승인을 이어 간다", async () => {
  const f = fixture();
  f.setCheckpoint({
    schema: 1, generation: "g", nextId: 4, pending: { "3": { kind: "prompt", params: { refreshList: false } } }, sessionId: "s",
    capabilities: { loadSession: true, image: false, http: false, list: false }, authMethods: [], controls: [],
    permissions: [{ id: "p", rpcId: "perm", title: "쓰기", options: [{ id: "yes", label: "허용", kind: "allow_once" }] }], queue: [{ id: "q", text: "다음 말", attachments: [] }],
    stream: { id: "st", text: "진행 " }, tools: [], partial: [], partialKey: null, streamKey: null, guideSent: true,
    phase: "responding", replay: false, replayItems: [], sessionError: null, needsNew: false, initialized: true, failure: null,
    completed: [], outbox: [], servicesUsed: null, restartPending: false, contextTicket: null, restoreControls: [],
  });
  const session = new AgentSession(f.host as any);
  assert.equal(await session.attach(parallel), true);
  let view = f.snapshots.at(-1);
  assert.equal(view.phase, "responding");
  assert.equal(view.sessionId, "s");
  assert.equal(view.text, "진행 ");
  assert.equal(view.queued[0].id, "q");
  await session.answer("perm", "yes");
  assert.equal(f.writes.at(-1).result.outcome.optionId, "yes");
  await f.emit({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "끝" } } } });
  await f.emit({ jsonrpc: "2.0", id: 3, result: { stopReason: "end_turn" } });
  view = f.snapshots.at(-1);
  assert.ok(view.items.some((item: any) => item.kind === "assistant" && item.text === "진행 끝"));
  assert.equal(f.last("session/prompt").params.prompt[0].text, "다음 말");
  assert.equal(f.getCheckpoint().schema, 2);
});

function appFixture(agent: Record<string, unknown>) {
  const handlers = new Map<string, (context: any) => any>(), views: any[] = [];
  const client = { process: { onReady() {}, onServicesChanged() {} }, files: { on_grant() {} }, blobs: {}, host: {}, context: {}, chat: { publish() {} },
    setState() {}, onStorageChange() {}, onLifecycle() {}, onMessage() {}, handle: (name: string, fn: any) => handlers.set(name, fn), publish: (view: any) => views.push(view) };
  const app = new AppClient(client as any, []) as any;
  app.stage = "session";
  app.agents = [{ id: "a", name: "A", command: "a", args: [], env: {}, ...agent }, { id: "b", name: "B", command: "b", args: [], env: {} }];
  app.selected = app.agents[0];
  const base = { phase: "responding", items: [], stream_id: null, text: "", busy: true, tool: null, queued: [], permissions: [], controls: [], authMethods: [], failure: null,
    sessionId: "current", canListSessions: true, sessionsLoading: false, sessionError: null, switching: false, configuring: false,
    sessions: [{ sessionId: "current", cwd: "/work", title: "지금" }, { sessionId: "other", cwd: "/work", title: "다른" }, { sessionId: "third", cwd: "/work", title: "셋째" }],
    live: [{ sessionId: "current", busy: true, permissions: 0 }], parallel: agent.parallel_sessions === true };
  return { app, handlers, views, base };
}

test("동시 세션을 켠 에이전트는 응답 중에도 목록 행으로 세션을 바꾼다", async () => {
  const { app, handlers, views, base } = appFixture({ parallel_sessions: true });
  app.receive(base);
  assert.equal(views.at(-1).session_buttons_busy, false);
  assert.equal(views.at(-1).history_disabled, false);
  assert.equal(views.at(-1).busy, true, "입력창의 응답 중 표시는 전경 세션을 따른다");
  let loads: string[] = [];
  app.session.loadSession = async (id: string) => { loads.push(id); };
  await handlers.get("select_session")!({ event: "other" });
  assert.deepEqual(loads, ["other"]);
  assert.equal(views.at(-1).session_switching, false, "들고 있는 세션으로 화면만 바꾸면 전환 표시가 남지 않는다");
  app.receive({ ...base, switching: true });
  await handlers.get("select_session")!({ event: "third" });
  assert.deepEqual(loads, ["other"], "다른 세션을 여는 중에는 잠근다");
});

test("뒤 세션 배지와 허용 안내 줄을 보이고 이동을 누르면 그 세션을 연다", async () => {
  const { app, handlers, views, base } = appFixture({ parallel_sessions: true });
  app.receive({ ...base, phase: "ready", busy: false, live: [{ sessionId: "current", busy: false, permissions: 0 }, { sessionId: "other", busy: true, permissions: 1 }, { sessionId: "third", busy: true, permissions: 0 }] });
  const view = views.at(-1);
  assert.deepEqual(view.history_items.map((item: any) => item.badges ?? []), [[], [{ text: "허용 필요", color: "#315da8" }], ["응답 중"]]);
  assert.equal(view.show_waiting, true);
  const loads: string[] = [];
  app.session.loadSession = async (id: string) => { loads.push(id); };
  await handlers.get("open_waiting")!({});
  assert.deepEqual(loads, ["other"]);
  app.receive({ ...base, sessionId: "other", live: [{ sessionId: "other", busy: true, permissions: 1 }] });
  assert.equal(views.at(-1).show_waiting, false, "전경 세션의 허용은 대화 아래에서 받는다");
});

test("뒤에서 응답 중인 세션이 있으면 에이전트와 작업 폴더를 바꾸기 전에 묻는다", async () => {
  const { app, handlers, views, base } = appFixture({ parallel_sessions: true });
  let replaced = 0, picked = 0;
  app.session.replace = async () => { replaced++; return true; };
  app.client.files = { pick_folder: async () => { picked++; return null; } };
  app.receive({ ...base, phase: "ready", busy: false, live: [{ sessionId: "current", busy: false, permissions: 0 }, { sessionId: "other", busy: true, permissions: 0 }, { sessionId: "third", busy: true, permissions: 0 }] });
  await handlers.get("settings_agent")!({ event: "b" });
  assert.equal(replaced, 0);
  assert.equal(views.at(-1).change_open, true);
  assert.equal(views.at(-1).change_title, "에이전트 바꾸기");
  assert.equal(views.at(-1).change_message, "응답 중인 세션 2개가 멈춥니다. 바꿀까요?");
  await handlers.get("cancel_change")!({});
  assert.equal(views.at(-1).change_open, false);
  assert.equal(replaced, 0);
  await handlers.get("settings_agent")!({ event: "b" });
  await handlers.get("confirm_change")!({});
  assert.equal(replaced, 1);
  assert.equal(app.selected.id, "b");
  app.selected = app.agents[0];
  app.receive({ ...base, phase: "ready", busy: false, sessionId: "x", live: [{ sessionId: "other", busy: true, permissions: 0 }] });
  await handlers.get("pick_folder")!({});
  assert.equal(picked, 0);
  assert.equal(views.at(-1).change_title, "작업 폴더 바꾸기");
  await handlers.get("confirm_change")!({});
  assert.equal(picked, 1);
});

test("뒤에서 응답 중인 세션이 없으면 묻지 않고 바로 바꾼다", async () => {
  const { app, handlers, base } = appFixture({ parallel_sessions: true });
  let replaced = 0;
  app.session.replace = async () => { replaced++; return true; };
  app.receive({ ...base, phase: "ready", busy: false, live: [{ sessionId: "current", busy: false, permissions: 0 }] });
  await handlers.get("settings_agent")!({ event: "b" });
  assert.equal(replaced, 1);
});

test("에이전트가 제목을 아직 정하지 않은 세션은 목록에 id 조각 대신 처음 보낸 말을 보여 준다", async () => {
  const { f, session } = await started();
  await prompt(f, session, "qa", "관리 앱 목록 정리해 줘\n자세한 조건은 이렇다");
  await session.newSession();
  await f.reply(f.last("session/new"), { sessionId: "b" });
  await session.listSessions();
  await f.reply(f.last("session/list"), { sessions: [{ sessionId: "a", cwd: "/work" }, { sessionId: "old", cwd: "/work" }] });
  const titles = Object.fromEntries(f.snapshots.at(-1).sessions.map((entry: any) => [entry.sessionId, entry.title ?? null]));
  assert.equal(titles.a, "관리 앱 목록 정리해 줘");
  assert.equal(titles.b, "새 세션");
  // 프로세스가 들고 있지 않은 지난 세션은 에이전트가 준 그대로 둔다.
  assert.equal(titles.old, null);
});
