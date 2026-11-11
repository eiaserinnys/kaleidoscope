import { test } from "node:test";
import { strict as assert } from "node:assert";
import { AppClient } from "../src/app.ts";
import { agentError } from "../src/errors.ts";

const programs = { missing: { name: "Node.js", winget: "Test.Program", url: "https://example.test/" } };
const agent = { id: "a", name: "Claude Code", command: "missing", args: [], env: {} };
const missing = { id: "PROCESS_START_COMMAND_NOT_FOUND", code: "not_found", message: "명령 없음" };

async function fixture({ platform = "Windows", known = true, result = 0, cancel = false, noWinget = false, missingAgain = false, deferred = false }: any = {}) {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: platform } });
  const handlers = new Map<string, Function>();
  const stores = new Map<string, Function>();
  const views: any[] = [], starts: any[] = [], ready: Function[] = [];
  let agentStarts = 0, installerRead = false;
  let releasePermission: (result: any) => void = () => {};
  let receive: Function = () => {};
  const permission = new Promise((resolve) => { releasePermission = resolve; });
  const process = {
    onReady(fn: Function) { ready.push(fn); return () => {}; }, onServicesChanged() {}, attach: async () => null,
    start: async (params: any) => {
      starts.push(params);
      if (params.key === "main") {
        agentStarts++;
        if (agentStarts === 1 || missingAgain) throw missing;
        return { status: "cancelled" };
      }
      if (deferred) return permission;
      if (cancel) return { status: "cancelled" };
      if (noWinget) throw missing;
      return { handle: "installer", cwd: "/work" };
    },
    read: async () => { const bytes = installerRead ? [] : [...new TextEncoder().encode("원인 메시지\n")]; installerRead = true; return { bytes, next: 14, stderr_tail: [], exit: { code: result } }; },
    ack: async () => {}, stop: async () => {},
  };
  const client = {
    process, files: { grant: () => null, on_grant() {}, pick_folder: async () => "작업" },
    blobs: { open: async () => null }, host: {}, context: {}, chat: { publish() {} },
    getStorage: async (id: string) => id === "programs" ? (known ? programs : {}) : [agent],
    getState: () => null, setState() {}, onStorageChange: (id: string, fn: Function) => stores.set(id, fn),
    onLifecycle() {}, onMessage: (fn: Function) => { receive = fn; }, handle: (name: string, fn: Function) => handlers.set(name, fn), publish: (view: any) => views.push(view),
  };
  new AppClient(client as any, []);
  stores.get("programs")?.(known ? programs : {});
  stores.get("agents")!([agent]);
  await handlers.get("pick_folder")!({});
  return { handlers, views, starts, releasePermission, receive: (message: any) => receive(message), get view() { return views.at(-1); }, get agentStarts() { return agentStarts; } };
}

test("등록된 명령은 Windows에서 설치 단추를 보이고 다른 플랫폼은 주소를 안내한다", async () => {
  let f = await fixture();
  assert.equal(f.view.show_install, true);
  assert.deepEqual(await f.receive({ request_id: "one", text: "안녕" }), { status: "not_ready", reason: "에이전트 창에서 프로그램 설치를 마친 뒤 다시 보내세요" });
  assert.equal(f.view.install_label, "Node.js 설치");
  assert.equal(f.view.error_message, "Claude Code 에이전트를 시작하려면 Node.js 프로그램이 필요합니다.");
  f = await fixture({ platform: "Linux" });
  assert.equal(f.view.show_install, false);
  assert.equal(f.view.error_id, "AGENT_INSTALL_UNSUPPORTED_PLATFORM");
  assert.equal(f.view.error_message, "Claude Code 에이전트에 필요한 Node.js 프로그램이 이 기기에 없습니다. 창에서 설치는 Windows에서만 되니 https://example.test/에서 받아 설치한 뒤 다시 시도하세요.");
  f = await fixture({ known: false });
  assert.equal(f.view.show_install, false);
  assert.equal(f.view.error_id, missing.id);
});

test("실행 허용 취소는 설치 제안으로 돌아간다", async () => {
  const f = await fixture({ cancel: true });
  await f.handlers.get("install")!({});
  assert.equal(f.view.show_install, true);
  assert.equal(f.view.error_id, missing.id);
});

test("설치 성공은 같은 에이전트를 다시 시작한다", async () => {
  const f = await fixture();
  await f.handlers.get("install")!({});
  assert.equal(f.agentStarts, 2);
  assert.deepEqual(f.starts[1], { key: "install", permission: "install", cwd_permission: "work", spec: { name: "Node.js 설치 프로그램", command: "winget", args: ["install", "--id", "Test.Program", "--exact", "--source", "winget", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"], env: {} } });
  assert.ok(f.views.some((view: any) => view.show_installing && view.install_message === "Node.js 설치 중"));
});

test("설치 후에도 명령이 없으면 별도 오류를 표시한다", async () => {
  const f = await fixture({ missingAgain: true });
  await f.handlers.get("install")!({});
  assert.equal(f.view.error_id, "AGENT_INSTALL_COMMAND_STILL_MISSING");
});

test("winget이 없으면 받는 곳을 안내한다", async () => {
  const f = await fixture({ noWinget: true });
  await f.handlers.get("install")!({});
  assert.equal(f.view.error_id, "AGENT_INSTALL_WINGET_NOT_FOUND");
});

for (const [name, result, id] of [
  ["그룹 정책", 0x8A15003A, "AGENT_INSTALL_BLOCKED_BY_POLICY"],
  ["설치 정책", 0x8A15010F, "AGENT_INSTALL_BLOCKED_BY_POLICY"],
  ["설치 취소", 0x8A15010C, "AGENT_INSTALL_CANCELLED_BY_USER"],
  ["기타 실패", 1, "AGENT_INSTALL_FAILED"],
] as const) test(`${name} 종료 코드를 표시한다`, async () => {
  const f = await fixture({ result });
  await f.handlers.get("install")!({});
  assert.equal(f.view.error_id, id);
  assert.match(f.view.error_message, /https:\/\/example.test\//);
  if (result === 1) assert.equal(f.view.error_message, "Node.js 프로그램을 설치하지 못했습니다. 다시 시도하거나 https://example.test/에서 받아 설치하세요. 원인: 원인 메시지");
});

test("허용을 기다리는 동안 제안 화면을 유지하고 취소해도 같은 화면을 보인다", async () => {
  const f = await fixture({ deferred: true });
  const pending = f.handlers.get("install")!({});
  assert.equal(f.view.show_install, true);
  assert.equal(f.view.show_installing, false);
  f.releasePermission({ status: "cancelled" });
  await pending;
  assert.equal(f.view.show_install, true);
});

test("일반 설치 실패의 종료 코드는 상세에만 남는다", () => {
  const error = agentError("AGENT_INSTALL_FAILED", "시험", "https://example.test/", "0x00000001", "문제");
  assert.deepEqual(error.details, ["winget 종료 코드: 0x00000001"]);
  assert.doesNotMatch(error.message, /0x00000001/);
});
