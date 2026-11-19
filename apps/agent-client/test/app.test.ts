import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { AppClient } from "../src/app.ts";

test("기본 에이전트 중 Antigravity만 HTTP MCP 지원을 명시한다", () => {
  const definition = JSON.parse(readFileSync(new URL("../../agent.json", import.meta.url), "utf8"));
  const agents = definition.storage.entries.find((entry: any) => entry.id === "agents").default;
  assert.equal(agents.find((agent: any) => agent.id === "antigravity").assume_http_mcp, true);
  for (const id of ["claude", "codex", "gemini"]) {
    assert.equal(Object.hasOwn(agents.find((agent: any) => agent.id === id), "assume_http_mcp"), false);
  }
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

function makeApp() {
  const handlers = new Map<string, (context: any) => unknown>();
  const views: any[] = [];
  const storage = new Map<string, (value: unknown) => void>(), writes: [string, unknown][] = [];
  const client = {
    process: { onReady() {}, onServicesChanged() {} },
    files: { on_grant() {} }, blobs: {}, host: {}, context: {}, chat: { publish() {} },
    onStorageChange: (entry: string, fn: any) => { storage.set(entry, fn); }, onLifecycle() {}, onMessage() {},
    setStorage: async (entry: string, value: unknown) => { writes.push([entry, value]); },
    handle: (name: string, fn: any) => handlers.set(name, fn), publish: (view: any) => views.push(view),
  };
  return { handlers, views, storage, writes, app: new AppClient(client as any, []) };
}

function readyView() {
  return { phase: "ready", items: [], stream_id: null, text: "", busy: false, tool: null,
    queued: [], permissions: [], controls: [], authMethods: [], failure: null,
    sessionId: "current", canListSessions: true, canDeleteSessions: false, sessions: [], sessionsLoading: false, sessionError: null,
    switching: false, deleting: false, configuring: false,
    context: null, limits: [], account: null, subagents: 0 };
}

test("목록 능력이 없는 에이전트의 지난 세션 단추는 잠기고 이유를 표시한다", () => {
  const { views, app } = makeApp();
  (app as any).receive({ ...readyView(), canListSessions: false });
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

test("응답 중에는 목록 행을 눌러도 세션을 바꾸지 않는다", async () => {
  const handlers = new Map<string, (context: any) => any>(), views: any[] = [];
  const client = { process: { onReady() {}, onServicesChanged() {} }, files: { on_grant() {} }, blobs: {}, host: {}, context: {}, chat: { publish() {} },
    onStorageChange() {}, onLifecycle() {}, onMessage() {}, handle: (name: string, fn: any) => handlers.set(name, fn), publish: (view: any) => views.push(view) };
  const app = new AppClient(client as any, []);
  (app as any).receive({ phase: "responding", items: [], stream_id: null, text: "", busy: true, tool: null,
    queued: [], permissions: [], controls: [], authMethods: [], failure: null, sessionId: "current",
    canListSessions: true, sessions: [], sessionsLoading: false, sessionError: null, switching: false, configuring: false });
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

test("제목 검색은 표시 제목을 대소문자 없이 거르고 대화상자를 닫으면 비운다", async () => {
  const { handlers, views, app } = makeApp();
  (app as any).receive({ ...readyView(), sessions: [
    { sessionId: "a1", cwd: "/work", title: "Fix Login" },
    { sessionId: "b2", cwd: "/work", title: "배포 정리" },
    { sessionId: "zz998877665544", cwd: "/work" },
  ] });
  await handlers.get("search_history")!({ event: "  login " });
  assert.deepEqual(views.at(-1).history_items.map((i: any) => i.key), ["a1"]);
  assert.equal(views.at(-1).history_query, "  login ");
  await handlers.get("search_history")!({ event: "ZZ9988" });
  assert.deepEqual(views.at(-1).history_items.map((i: any) => i.key), ["zz998877665544"]);
  await handlers.get("search_history")!({ event: "없는 제목" });
  assert.deepEqual(views.at(-1).history_items, []);
  assert.equal(views.at(-1).history_no_match, true);
  assert.equal(views.at(-1).history_has_items, true);
  await handlers.get("search_history")!({ event: "정리" });
  (app as any).receive({ ...(app as any).view, sessions: [{ sessionId: "a1", cwd: "/work", title: "Fix Login" }] });
  assert.deepEqual(views.at(-1).history_items, []);
  assert.equal(views.at(-1).history_query, "정리");
  await handlers.get("close_history")!({});
  assert.equal(views.at(-1).history_query, "");
  assert.deepEqual(views.at(-1).history_items.map((i: any) => i.key), ["a1"]);
  assert.equal(views.at(-1).history_no_match, false);
});

test("삭제는 능력이 있을 때만 메뉴를 보이고 잠긴 동안에는 보내지 않는다", async () => {
  const { handlers, views, app } = makeApp();
  (app as any).receive({ ...readyView(), sessions: [{ sessionId: "a1", cwd: "/work", title: "Fix Login" }] });
  assert.equal(views.at(-1).history_can_delete, false);
  assert.equal(views.at(-1).history_cannot_delete, true);
  assert.equal(views.at(-1).history_items[0].confirm, "「Fix Login」 세션을 지웁니다. 되돌릴 수 없습니다.");
  await handlers.get("search_history")!({ event: "없는 제목" });
  assert.equal(views.at(-1).history_no_match, true);
  assert.equal(views.at(-1).history_can_delete, false);
  assert.equal(views.at(-1).history_cannot_delete, false);
  await handlers.get("search_history")!({ event: "" });
  assert.equal(views.at(-1).history_cannot_delete, true);
  const deleted: string[] = [];
  (app as any).session.deleteSession = async (id: string) => { deleted.push(id); };
  await handlers.get("delete_session")!({ event: "a1" });
  assert.deepEqual(deleted, []);
  (app as any).receive({ ...(app as any).view, canDeleteSessions: true });
  assert.equal(views.at(-1).history_can_delete, true);
  await handlers.get("search_history")!({ event: "없는 제목" });
  assert.equal(views.at(-1).history_can_delete, false);
  assert.equal(views.at(-1).history_cannot_delete, false);
  await handlers.get("search_history")!({ event: "" });
  assert.equal(views.at(-1).history_can_delete, true);
  assert.equal(views.at(-1).history_cannot_delete, false);
  (app as any).receive({ ...(app as any).view, busy: true });
  await handlers.get("delete_session")!({ event: "a1" });
  assert.deepEqual(deleted, []);
  (app as any).receive({ ...(app as any).view, busy: false });
  await handlers.get("delete_session")!({ event: "a1" });
  assert.deepEqual(deleted, ["a1"]);
  (app as any).receive({ ...(app as any).view, deleting: true });
  assert.equal(views.at(-1).session_buttons_busy, true);
  assert.equal(views.at(-1).history_disabled, true);
});

function stagedApp(view: any) {
  const made = makeApp();
  (made.app as any).stage = "session";
  (made.app as any).receive(view);
  return made;
}
const control = (id: string, category: string, value: string, label: string) => ({ id, label: id, category, kind: "select" as const, value, options: [{ value, label }] });
const limit = (id: string, label: string, usedRatio: number | null, extra: any = {}) => ({ id, label, usedRatio, resetsAt: null, blocked: false, ...extra });

test("상태 줄 표시 조건: 저장소가 켜져도 채팅이 안 보이면 숨긴다", () => {
  const { views, storage, app } = makeApp();
  storage.get("status_bar")!(true);
  (app as any).stage = "session";
  (app as any).receive({ ...readyView(), phase: "starting" });
  assert.equal(views.at(-1).status_bar_on, true);
  assert.equal(views.at(-1).show_status_bar, false);
  (app as any).receive({ ...readyView(), phase: "ready" });
  assert.equal(views.at(-1).show_status_bar, true);
  storage.get("status_bar")!(false);
  assert.equal(views.at(-1).status_bar_on, false);
  assert.equal(views.at(-1).show_status_bar, false);
});

test("칩 순서: 계정 라벨(이메일 없이), model, thought_level, mode", () => {
  const controls = [control("mode", "mode", "auto", "Auto"), control("model", "model", "opus", "Opus 5.5"), control("t", "thought_level", "high", "높음")];
  const { views, app } = stagedApp({ ...readyView(), controls, account: { label: "Claude Team", email: "a@b.c" } });
  assert.deepEqual(views.at(-1).status_chips.map((chip: any) => chip.text), ["Claude Team", "Opus 5.5", "높음", "Auto"]);
  // 설정의 계정 줄은 이메일까지 보인다
  assert.equal(views.at(-1).status_account, "Claude Team, a@b.c");
  (app as any).receive({ ...readyView(), controls, account: null });
  assert.deepEqual(views.at(-1).status_chips.map((chip: any) => chip.text), ["Opus 5.5", "높음", "Auto"]);
});

test("한도 막대: session은 5시간, weekly는 7일 창이고 다른 창은 설정에서만 보인다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: new Date(2031, 10, 17, 12, 0) });
  const at = (day: number, hour: number) => new Date(2031, 10, day, hour, 0).toISOString();
  const limits = [limit("seven_day", "7일", 0.3, { resetsAt: at(20, 18) }), limit("five_hour", "5시간", 0.58, { resetsAt: at(17, 15) }), limit("seven_day_opus", "Opus 7일", 0.9, { resetsAt: at(19, 0) })];
  const { views, app } = stagedApp({ ...readyView(), limits });
  assert.deepEqual(views.at(-1).status_limit_bars, [
    { key: "session", label: "session", value: 0.58, text: "58%", left: "3시간 남음" },
    { key: "weekly", label: "weekly", value: 0.3, text: "30%", left: "3일 남음" },
  ]);
  assert.deepEqual(views.at(-1).status_limits.map((row: any) => [row.label, row.text]), [["7일", "30% 사용, 3일 남음"], ["5시간", "58% 사용, 3시간 남음"], ["Opus 7일", "90% 사용, 1일 남음"]]);
  assert.equal(views.at(-1).status_no_limits, false);
  (app as any).receive({ ...readyView(), limits: [] });
  assert.deepEqual(views.at(-1).status_limit_bars, []);
  assert.equal(views.at(-1).status_no_limits, true);
});

test("컨텍스트와 서브에이전트 표기", () => {
  const { views, app } = stagedApp({ ...readyView(), context: { used: 42, size: 100 }, subagents: 2, account: { label: "Claude Team", email: null } });
  assert.equal(views.at(-1).status_context, 0.42);
  assert.equal(views.at(-1).status_context_text, "42%");
  assert.equal(views.at(-1).status_subagents, "서브에이전트 2");
  assert.equal(views.at(-1).status_subagents_text, "2개 실행 중");
  assert.equal(views.at(-1).status_account, "Claude Team");
  (app as any).receive(readyView());
  assert.equal(views.at(-1).status_context, null);
  assert.equal(views.at(-1).status_context_text, "아직 모름");
  assert.equal(views.at(-1).status_subagents, null);
  assert.equal(views.at(-1).status_subagents_text, "없음");
  assert.equal(views.at(-1).status_account, null);
});

test("토글 쓰기: toggle_status_bar는 저장소 status_bar에 쓴다", async () => {
  const { handlers, writes } = makeApp();
  await handlers.get("toggle_status_bar")!({ event: true });
  assert.deepEqual(writes, [["status_bar", true]]);
});

test("한도 막대: 모르는 창은 빼고 설정 행은 모름, 막히면 막힘과 남은 시간", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: new Date(2031, 10, 17, 4, 0) });
  const unknown = stagedApp({ ...readyView(), limits: [limit("five_hour", "5시간", null)] });
  const view = unknown.views.at(-1);
  assert.deepEqual(view.status_limit_bars, []);
  assert.equal(view.status_limits.length, 1);
  assert.equal(view.status_limits[0].known, false);
  assert.equal(view.status_limits[0].text, "아직 모름");
  const resetsAt = new Date(2031, 10, 17, 5, 0).toISOString();
  const blocked = stagedApp({ ...readyView(), limits: [limit("five_hour", "5시간", 1, { blocked: true, resetsAt })] });
  assert.deepEqual(blocked.views.at(-1).status_limit_bars, [{ key: "session", label: "session", value: 1, text: "막힘", left: "1시간 남음" }]);
  assert.equal(blocked.views.at(-1).status_limits[0].text, "막힘, 1시간 남음");
});

test("상태 줄 칸 표시 여부: when은 참인 불리언만 보므로 값이 있는 칸마다 짝 필드가 있다", () => {
  const { views, app } = stagedApp({ ...readyView(), context: { used: 42, size: 100 }, subagents: 2, account: { label: "Claude Team", email: null } });
  let view = views.at(-1);
  assert.deepEqual([view.status_has_context, view.status_has_subagents, view.status_has_account], [true, true, true]);
  assert.equal(view.status_context_bar, 0.42);
  (app as any).receive(readyView());
  view = views.at(-1);
  assert.deepEqual([view.status_has_context, view.status_has_subagents, view.status_has_account], [false, false, false]);
  assert.equal(view.status_context_bar, 0);
});

test("좁은 창 칩은 model 하나만", () => {
  const controls = [control("mode", "mode", "auto", "Auto"), control("model", "model", "opus", "Opus 5.5"), control("t", "thought_level", "high", "높음")];
  const { views } = stagedApp({ ...readyView(), controls, account: { label: "Claude Team", email: null } });
  const view = views.at(-1);
  assert.deepEqual(view.status_chips_narrow.map((chip: any) => chip.text), ["Opus 5.5"]);
  assert.equal(view.status_chips.length, 4);
  assert.equal(view.status_no_context, true);
});

test("다시 차는 시각이 지나면 그 막대를 빼고 설정 행은 아직 모름으로 다시 그린다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: new Date(2031, 10, 17, 4, 59, 30) });
  const soon = new Date(2031, 10, 17, 5, 0).toISOString(), later = new Date(2031, 10, 18, 18, 0).toISOString();
  const { views } = stagedApp({ ...readyView(), limits: [limit("five_hour", "5시간", 1, { blocked: true, resetsAt: soon }), limit("seven_day", "7일", 0.3, { resetsAt: later })] });
  assert.deepEqual(views.at(-1).status_limit_bars.map((bar: any) => [bar.key, bar.text, bar.left]), [["session", "막힘", "1분 남음"], ["weekly", "30%", "1일 남음"]]);
  t.mock.timers.tick(30_000);
  assert.equal(views.at(-1).status_limit_bars.length, 2);
  t.mock.timers.tick(1);
  const view = views.at(-1);
  assert.deepEqual(view.status_limit_bars.map((bar: any) => bar.key), ["weekly"]);
  assert.deepEqual(view.status_limits.map((row: any) => [row.text, row.unknown]), [["아직 모름", true], ["30% 사용, 1일 남음", false]]);
});

test("남은 시간 글은 단위 경계마다 다시 그리고, 먼 경계는 1시간마다 다시 잰다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: new Date(2031, 10, 17, 3, 0) });
  const resetsAt = new Date(2031, 10, 17, 5, 30).toISOString();
  const { views } = stagedApp({ ...readyView(), limits: [limit("five_hour", "5시간", 0.5, { resetsAt })] });
  assert.equal(views.at(-1).status_limit_bars[0].left, "2시간 남음");
  // 꼭 2시간 남은 때는 아직 2시간이고, 1ms 뒤에 1시간으로 바뀐다
  t.mock.timers.tick(30 * 60_000);
  assert.equal(views.at(-1).status_limit_bars[0].left, "2시간 남음");
  t.mock.timers.tick(1);
  assert.equal(views.at(-1).status_limit_bars[0].left, "1시간 남음");
  t.mock.timers.tick(60 * 60_000);
  assert.equal(views.at(-1).status_limit_bars[0].left, "59분 남음");
  t.mock.timers.tick(60 * 60_000);
  assert.deepEqual(views.at(-1).status_limit_bars, []);
  assert.equal(views.at(-1).status_limits[0].text, "아직 모름");
});

test("하루가 넘게 남은 창은 다음 경계가 멀어도 1시간 뒤에 다시 잰다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: new Date(2031, 10, 17, 3, 0) });
  const resetsAt = new Date(2031, 10, 20, 2, 0).toISOString();
  const { views } = stagedApp({ ...readyView(), limits: [limit("seven_day", "7일", 0.5, { resetsAt })] });
  const published = views.length;
  assert.equal(views.at(-1).status_limit_bars[0].left, "2일 남음");
  t.mock.timers.tick(60 * 60_000);
  assert.equal(views.length, published);
  assert.equal(views.at(-1).status_limit_bars[0].left, "2일 남음");
});
