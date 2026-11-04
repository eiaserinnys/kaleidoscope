import { test } from "node:test";
import { strict as assert } from "node:assert";
import { AppClient } from "../src/app.ts";

const agent = { id: "a", name: "시험 에이전트", command: "missing", args: [], env: {} };
const programs = { missing: { name: "시험 프로그램", winget: "Test.Program", url: "https://example.test/" } };
const missing = { id: "PROCESS_START_COMMAND_NOT_FOUND", code: "not_found", message: "명령 없음" };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(condition: () => boolean) {
  for (let i = 0; i < 100; i++) { if (condition()) return; await tick(); }
  assert.fail("기다린 상태에 도달하지 못했습니다");
}

async function scenario(finishBeforeReload: boolean) {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "Windows" } });
  let listeners: Array<(handle: string) => void> = [], agentStarts = 0, after = 0, checkpoint: any = null, exit: any = null;
  let installStarted = false;
  const process = {
    onReady(fn: (handle: string) => void) { listeners.push(fn); return () => { listeners = listeners.filter((item) => item !== fn); }; },
    onServicesChanged() {},
    attach: async ({ key }: any) => key === "install" && installStarted ? { handle: "install-handle", after, checkpoint, cwd: "/work", services: {}, exit } : null,
    start: async ({ key }: any) => {
      if (key === "main") {
        agentStarts++;
        if (agentStarts === 1) throw missing;
        return { handle: "main-handle", cwd: "/work", services: {} };
      }
      installStarted = true;
      return { handle: "install-handle", cwd: "/work", services: {} };
    },
    read: async ({ handle, after: cursor }: any) => {
      if (handle === "main-handle") return { bytes: [], next: 0, stderr_tail: [], exit: null };
      assert.equal(cursor, after, "저장된 위치부터 읽어야 합니다");
      if (!after) return { bytes: [65], next: 1, stderr_tail: [], exit: null };
      return { bytes: [], next: after, stderr_tail: [], exit };
    },
    ack: async (args: any) => { if (args.handle === "install-handle") { after = args.after; checkpoint = args.checkpoint; } },
    write: async () => {}, stop: async () => {},
  };
  const make = (restore: boolean) => {
    const handlers = new Map<string, Function>(), stores = new Map<string, Function>(), views: any[] = [];
    const client = {
      process, files: { grant: () => restore ? "작업" : null, on_grant() {}, pick_folder: async () => "작업" },
      blobs: { open: async () => null, put: async () => {}, remove: async () => {} }, host: {}, context: {}, chat: { publish() {} },
      getStorage: async (id: string) => id === "programs" ? programs : [agent],
      getState: () => restore ? "a" : null, setState() {}, onStorageChange: (id: string, fn: Function) => stores.set(id, fn),
      onLifecycle() {}, handle: (name: string, fn: Function) => handlers.set(name, fn), publish: (view: any) => views.push(view),
    };
    new AppClient(client as any, []);
    stores.get("programs")!(programs);
    stores.get("agents")!([agent]);
    return { handlers, views };
  };
  const first = make(false);
  await first.handlers.get("pick_folder")!({});
  void first.handlers.get("install")!({});
  await until(() => after === 1);
  if (finishBeforeReload) exit = { code: 0 };
  listeners = [];
  const second = make(true);
  await until(() => second.views.some((view) => view.show_installing));
  if (!finishBeforeReload) { exit = { code: 0 }; listeners.forEach((listener) => listener("install-handle")); }
  await until(() => agentStarts === 2);
  assert.equal(after, 1);
  assert.equal(agentStarts, 2);
}

test("설치 중 리로드하면 확인한 위치부터 이어 읽고 시작한다", async () => scenario(false));
test("설치가 끝난 뒤 리로드해도 결과를 처리하고 시작한다", async () => scenario(true));
