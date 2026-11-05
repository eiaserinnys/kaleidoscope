import { test } from "node:test";
import { strict as assert } from "node:assert";
import { AppClient } from "../src/app.ts";

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
  (app as any).receive({ ...(app as any).view, canListSessions: true });
  assert.equal(views.at(-1).history_disabled, false);
  assert.equal(views.at(-1).history_description, null);
  (app as any).receive({ ...(app as any).view, configuring: true });
  assert.equal(views.at(-1).history_disabled, true);
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
