import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { AppClient, resolveParallel } from "../src/app.ts";

test("기본 에이전트 중 Antigravity만 HTTP MCP 지원을 명시한다", () => {
  const definition = JSON.parse(readFileSync(new URL("../../agent.json", import.meta.url), "utf8"));
  const agents = definition.storage.entries.find((entry: any) => entry.id === "agents").default;
  assert.equal(agents.find((agent: any) => agent.id === "antigravity").assume_http_mcp, true);
  for (const id of ["claude", "codex", "gemini"]) {
    assert.equal(Object.hasOwn(agents.find((agent: any) => agent.id === id), "assume_http_mcp"), false);
  }
});

test("기본 에이전트 네 개는 모두 동시 세션을 켠다", () => {
  const definition = JSON.parse(readFileSync(new URL("../../agent.json", import.meta.url), "utf8"));
  const agents = definition.storage.entries.find((entry: any) => entry.id === "agents").default;
  assert.deepEqual(agents.map((agent: any) => agent.id), ["claude", "codex", "gemini", "antigravity"]);
  for (const agent of agents) assert.equal(agent.parallel_sessions, true, agent.id);
});

const DEFAULTS = [
  { id: "claude", name: "Claude Code", command: "npx", args: [], env: {}, parallel_sessions: true },
  { id: "antigravity", name: "Antigravity", command: "agy", args: ["acp"], env: {}, parallel_sessions: true },
];

test("저장된 기본 에이전트에 값이 없으면 기본값을 따르고, 저장한 거짓은 지키며, 추가한 에이전트는 끈다", () => {
  assert.equal(resolveParallel({ id: "antigravity", name: "Antigravity", command: "agy", args: ["acp"], env: {} }, DEFAULTS).parallel_sessions, true);
  assert.equal(resolveParallel({ id: "claude", name: "Claude Code", command: "npx", args: [], env: {}, parallel_sessions: false }, DEFAULTS).parallel_sessions, false);
  assert.equal(resolveParallel({ id: "mine", name: "내 에이전트", command: "mine", args: [], env: {} }, DEFAULTS).parallel_sessions, false);
  assert.equal(resolveParallel({ id: "mine", name: "내 에이전트", command: "mine", args: [], env: {}, parallel_sessions: true }, DEFAULTS).parallel_sessions, true);
});

/** 저장소 한 칸을 흉내 내는 가짜 다리. setStorage는 바로 변경 알림을 보낸다. */
function storageClient(initial: any[]) {
  const handlers = new Map<string, (context: any) => any>(), views: any[] = [], writes: any[] = [];
  let storage: any, lifecycle: any;
  const client = {
    process: { onReady() {}, onServicesChanged() {}, attach: async () => null, start: async () => ({ status: "cancelled" }) },
    files: { grant: () => null, on_grant() {}, pick_folder: async () => null }, blobs: { open: async () => null }, host: {}, context: {}, chat: { publish() {} },
    getStorage: async () => initial, setStorage: async (_entry: string, value: any) => { writes.push(value); await storage(value); },
    getState: () => null, setState() {}, onStorageChange: (entry: string, fn: any) => { if (entry === "agents") storage = fn; }, onLifecycle: (fn: any) => { lifecycle = fn; },
    onMessage() {}, handle: (name: string, fn: any) => handlers.set(name, fn), publish: (view: any) => views.push(view),
  };
  return { client, handlers, views, writes, storage: (value: any) => storage(value), ready: () => lifecycle({ phase: "ready" }) };
}

test("고른 에이전트의 동시 세션 스위치는 저장값을 따르고, 바꾸면 그 에이전트 항목만 고쳐 저장한다", async () => {
  const saved = [
    { id: "antigravity", name: "Antigravity", command: "agy", args: ["acp"], env: {} },
    { id: "mine", name: "내 에이전트", command: "mine", args: [], env: {} },
  ];
  const { client, handlers, views, writes, storage, ready } = storageClient(saved);
  new AppClient(client as any, DEFAULTS as any);
  await ready();
  await storage(saved);
  await handlers.get("choose_agent")!({ item: { id: "antigravity" } });
  assert.equal(views.at(-1).parallel_sessions, true);
  await handlers.get("choose_agent")!({ item: { id: "mine" } });
  assert.equal(views.at(-1).parallel_sessions, false);
  await handlers.get("set_parallel")!({ event: true });
  assert.equal(writes.length, 1);
  // 기본 에이전트 항목은 손대지 않아 기본값을 계속 따른다.
  assert.deepEqual(writes[0], [saved[0], { ...saved[1], parallel_sessions: true }]);
  assert.equal(views.at(-1).parallel_sessions, true);
  await handlers.get("set_parallel")!({ event: true });
  assert.equal(writes.length, 1);
  await handlers.get("choose_agent")!({ item: { id: "antigravity" } });
  await handlers.get("set_parallel")!({ event: false });
  assert.deepEqual(writes[1][0], { ...saved[0], parallel_sessions: false });
  assert.equal(views.at(-1).parallel_sessions, false);
});

test("대화 중에 스위치를 바꾸면 새 값으로 에이전트를 다시 시작하고, 뒤에서 응답 중이면 먼저 묻는다", async () => {
  const saved = [{ id: "mine", name: "내 에이전트", command: "mine", args: [], env: {} }];
  const { client, handlers, views, writes, storage, ready } = storageClient(saved);
  const app = new AppClient(client as any, DEFAULTS as any);
  await ready();
  await storage(saved);
  const replaced: any[] = [];
  (app as any).session.replace = async (spec: any) => { replaced.push(spec); return true; };
  const base = { phase: "ready", items: [], stream_id: null, text: "", busy: false, tool: null, queued: [], permissions: [], controls: [], authMethods: [], failure: null,
    sessionId: "current", canListSessions: true, sessions: [], sessionsLoading: false, sessionError: null, switching: false, configuring: false, parallel: true };
  (app as any).stage = "session";
  (app as any).receive({ ...base, live: [{ sessionId: "current", busy: false, permissions: 0 }, { sessionId: "back", busy: true, permissions: 0 }] });
  await handlers.get("set_parallel")!({ event: true });
  assert.equal(writes.length, 0);
  assert.equal(views.at(-1).change_open, true);
  assert.equal(views.at(-1).change_title, "여러 세션 동시에 바꾸기");
  await handlers.get("cancel_change")!({});
  assert.equal(views.at(-1).change_open, false);
  assert.equal(views.at(-1).parallel_sessions, false);
  await handlers.get("set_parallel")!({ event: true });
  await handlers.get("confirm_change")!({});
  assert.equal(writes.length, 1);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].parallel_sessions, true);
  assert.equal(views.at(-1).parallel_sessions, true);
});

test("여러 에이전트는 가운데 선택을 거쳐 폴더를 고르고, 실행 취소 뒤 다시 시도한다", async () => {
  let lifecycle: any, storage: any, reads = 0;
  const handlers = new Map<string, (context: any) => Promise<void>>();
  const views: any[] = [];
  const process = { onReady() {}, onServicesChanged() {}, attach: async () => null,
    start: async () => ({ status: "cancelled" }) };
  const client = {
    process, files: { grant: () => null, on_grant() {}, pick_folder: async () => "작업" },
    blobs: { open: async () => null }, host: {}, context: {}, chat: { publish() {} },
    getStorage: async () => { reads++; return []; },
    getState: () => null, setState() {}, onStorageChange: (_entry: string, fn: any) => { storage = fn; }, onLifecycle: (fn: any) => { lifecycle = fn; },
    onMessage() {}, handle: (name: string, fn: any) => handlers.set(name, fn), publish: (view: any) => views.push(view),
  };
  new AppClient(client as any, []);
  await lifecycle({ phase: "ready" });
  assert.equal(reads, 0);
  await storage([{ id: "a", name: "A", command: "a", args: [], env: {} }, { id: "b", name: "B", command: "b", args: [], env: {} }]);
  assert.equal(views.at(-1).show_agents, true);
  await handlers.get("choose_agent")!({ item: { id: "a" } });
  assert.equal(views.at(-1).show_folder, true);
  assert.equal(views.at(-1).agent_label, "A");
  assert.equal(views.at(-1).window_title, "에이전트");
  assert.equal(views.at(-1).window_meta, null);
  await handlers.get("pick_folder")!({});
  assert.equal(views.at(-1).show_folder, true);
  assert.equal(views.at(-1).show_retry, true);
  assert.equal(views.at(-1).show_picked_folder, true);
  assert.equal(views.at(-1).folder_label, "작업");
  await handlers.get("back_agent")!({});
  assert.equal(views.at(-1).show_agents, true);
  assert.equal(views.at(-1).show_retry, false);
});

test("에이전트가 하나일 때 폴더 grant 알림과 선택 결과가 겹쳐도 한 번만 실행한다", async () => {
  let lifecycle: any, grant: any, storage: any, starts = 0, attaches = 0;
  const handlers = new Map<string, (context: any) => Promise<void>>();
  const client = {
    process: { onReady() {}, onServicesChanged() {}, attach: async () => { attaches++; return null; }, start: async () => { starts++; return { status: "cancelled" }; } },
    files: { grant: () => null, on_grant: (_id: string, fn: any) => { grant = fn; }, pick_folder: async () => { grant("작업"); return "작업"; } },
    blobs: { open: async () => null }, host: {}, context: {}, chat: { publish() {} },
    getStorage: async () => [{ id: "a", name: "A", command: "a", args: [], env: {} }],
    getState: () => null, setState() {}, onStorageChange: (_entry: string, fn: any) => { storage = fn; }, onLifecycle: (fn: any) => { lifecycle = fn; },
    onMessage() {}, handle: (name: string, fn: any) => handlers.set(name, fn), publish() {},
  };
  new AppClient(client as any, []);
  await lifecycle({ phase: "ready" });
  await storage([{ id: "a", name: "A", command: "a", args: [], env: {} }]);
  await handlers.get("pick_folder")!({});
  assert.equal(attaches, 0);
  assert.equal(starts, 1);
});

test("초기 저장소 오류는 가운데에 보이고 다시 읽기에 실패해도 유지하며 성공하면 선택 화면을 연다", async () => {
  let lifecycle: any, storageError: any, reads = 0;
  const handlers = new Map<string, (context: any) => Promise<void>>();
  const views: any[] = [];
  const problem = { id: "STORAGE_READ_FAILED", code: "unavailable", message: "저장소를 읽지 못했습니다" };
  const client = {
    process: { onReady() {}, onServicesChanged() {} },
    files: { grant: () => null, on_grant() {} }, blobs: {}, host: {}, context: {}, chat: { publish() {} },
    getStorage: async () => { reads++; if (reads === 1) throw problem; return [{ id: "a", name: "A", command: "a", args: [], env: {} }]; },
    getState: () => null, setState() {},
    onStorageChange: (_entry: string, _fn: any, onError: any) => { storageError = onError; },
    onLifecycle: (fn: any) => { lifecycle = fn; },
    onMessage() {}, handle: (name: string, fn: any) => handlers.set(name, fn), publish: (view: any) => views.push(view),
  };
  new AppClient(client as any, []);
  await lifecycle({ phase: "ready" });
  assert.equal(reads, 0);
  storageError(problem);
  assert.equal(views.at(-1).show_failed, true);
  assert.equal(views.at(-1).error_id, problem.id);
  await handlers.get("retry")!({});
  assert.equal(views.at(-1).show_failed, true);
  assert.equal(views.at(-1).error_message, problem.message);
  await handlers.get("retry")!({});
  assert.equal(reads, 2);
  assert.equal(views.at(-1).show_folder, true);
  assert.equal(views.at(-1).error_id, null);
});

test("목록 능력이 없는 에이전트의 지난 세션 단추는 잠기고 이유를 표시한다", () => {
  const handlers = new Map<string, (context: any) => unknown>();
  const views: any[] = [];
  const client = {
    process: { onReady() {}, onServicesChanged() {} },
    files: { on_grant() {} }, blobs: {}, host: {}, context: {}, chat: { publish() {} },
    onStorageChange() {}, onLifecycle() {}, onMessage() {},
    handle: (name: string, fn: any) => handlers.set(name, fn), publish: (view: any) => views.push(view),
  };
  const app = new AppClient(client as any, []);
  (app as any).receive({ phase: "ready", items: [], stream_id: null, text: "", busy: false, tool: null,
    queued: [], permissions: [], controls: [], authMethods: [], failure: null,
    sessionId: "current", canListSessions: false, sessions: [], sessionsLoading: false, sessionError: null, switching: false });
  assert.equal(views.at(-1).history_disabled, true);
  assert.equal(views.at(-1).history_description, "이 에이전트는 지난 세션 목록을 주지 않습니다");
  assert.equal(views.at(-1).history_unsupported, true);
  assert.equal(views.at(-1).history_empty, false);
  assert.equal(views.at(-1).history_no_items, true);
  (app as any).receive({ ...(app as any).view, canListSessions: true });
  assert.equal(views.at(-1).history_disabled, false);
  assert.equal(views.at(-1).history_description, null);
  (app as any).receive({ ...(app as any).view, sessions: [{ sessionId: "old", cwd: "/work" }], sessionsLoading: true });
  assert.equal(views.at(-1).history_loading, false);
  assert.equal(views.at(-1).history_has_items, true);
  assert.equal(views.at(-1).history_no_items, false);
  (app as any).receive({ ...(app as any).view, configuring: true });
  assert.equal(views.at(-1).history_disabled, true);
  assert.equal(views.at(-1).session_buttons_busy, true);
});

test("동시 세션을 끈 에이전트는 응답 중에 목록 행을 눌러도 세션을 바꾸지 않는다", async () => {
  const handlers = new Map<string, (context: any) => any>(), views: any[] = [];
  const client = { process: { onReady() {}, onServicesChanged() {} }, files: { on_grant() {} }, blobs: {}, host: {}, context: {}, chat: { publish() {} },
    onStorageChange() {}, onLifecycle() {}, onMessage() {}, handle: (name: string, fn: any) => handlers.set(name, fn), publish: (view: any) => views.push(view) };
  const app = new AppClient(client as any, []);
  (app as any).receive({ phase: "responding", items: [], stream_id: null, text: "", busy: true, tool: null,
    queued: [], permissions: [], controls: [], authMethods: [], failure: null, sessionId: "current",
    canListSessions: true, sessions: [], sessionsLoading: false, sessionError: null, switching: false, configuring: false, live: [], parallel: false });
  let loads = 0;
  (app as any).session.loadSession = async () => { loads++; };
  await handlers.get("select_session")!({ event: "other" });
  assert.equal(loads, 0);
  assert.equal(views.at(-1).session_switching, false);
  assert.equal(views.at(-1).session_buttons_busy, true);
});

test("세션 전환 중 대화를 숨기고 실패하면 대화상자와 오류를 다시 연다", () => {
  const handlers = new Map<string, (context: any) => unknown>(), views: any[] = [];
  const client = { process: { onReady() {}, onServicesChanged() {} }, files: { on_grant() {} }, blobs: {}, host: {}, context: {}, chat: { publish() {} },
    onStorageChange() {}, onLifecycle() {}, onMessage() {}, handle: (name: string, fn: any) => handlers.set(name, fn), publish: (view: any) => views.push(view) };
  const app = new AppClient(client as any, []);
  const base = { phase: "ready", items: [], stream_id: null, text: "", busy: false, tool: null, queued: [], permissions: [], controls: [], authMethods: [], failure: null,
    sessionId: "current", canListSessions: true, sessions: [{sessionId:"other", title:"제목 <kaleidoscope-app-guide>지침</kaleidoscope-app-guide>", cwd:"/work"}], sessionsLoading: false, sessionError: null, switching: false, configuring: false };
  (app as any).stage = "session";
  (app as any).receive(base);
  assert.equal(views.at(-1).history_items[0].title, "제목");
  (app as any).receive({...base, sessions:[{sessionId:"123456789", title:"<kaleidoscope-app-guide>지침", cwd:"/work"}]});
  assert.equal(views.at(-1).history_items[0].title, "12345678");
  (app as any).receive({...base, sessions:[{sessionId:"other", title:"제목 <kaleidoscope-share>화면</kaleidoscope-share>", cwd:"/work"}]});
  assert.equal(views.at(-1).history_items[0].title, "제목");
  (app as any).receive({...base, sessions:[{sessionId:"123456789", title:"<kaleidoscope-share>화면", cwd:"/work"}]});
  assert.equal(views.at(-1).history_items[0].title, "12345678");
  (app as any).receive({...base, sessions:[{sessionId:"123456789", title:"![첨부](data:image/png;base64,QUJD", cwd:"/work"}]});
  assert.equal(views.at(-1).history_items[0].title, "12345678");
  (app as any).receive({...base, sessions:[{sessionId:"123456789", title:"[@image](data:image/png;base64,QUJD", cwd:"/work"}]});
  assert.equal(views.at(-1).history_items[0].title, "12345678");
  (app as any).receive({...base, sessions:[{sessionId:"other", title:"제목 [@image](data:image/png;base64,QUJD)", cwd:"/work"}]});
  assert.equal(views.at(-1).history_items[0].title, "제목");
  (app as any).receive(base);
  (app as any).session.loadSession = async () => {};
  handlers.get("open_history")!({});
  handlers.get("select_session")!({event:"other"});
  assert.equal(views.at(-1).history_open, false);
  assert.equal(views.at(-1).session_switching, true);
  (app as any).receive({...base, switching:true});
  (app as any).receive({...base, sessionError:{id:"AGENT_SESSION_LOAD_FAILED",message:"오류"}});
  assert.equal(views.at(-1).history_open, true);
  assert.equal(views.at(-1).session_switching, false);
  assert.equal(views.at(-1).history_error_message, "오류");
});
