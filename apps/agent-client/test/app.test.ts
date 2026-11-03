import { test } from "node:test";
import { strict as assert } from "node:assert";
import { AppClient } from "../src/app.ts";

test("여러 에이전트는 가운데 선택을 거쳐 폴더를 고르고, 실행 취소 뒤 다시 시도한다", async () => {
  let lifecycle: any;
  const handlers = new Map<string, (context: any) => Promise<void>>();
  const views: any[] = [];
  const process = { onReady() {}, onServicesChanged() {}, attach: async () => null,
    start: async () => ({ status: "cancelled" }) };
  const client = {
    process, files: { grant: () => null, on_grant() {}, pick_folder: async () => "작업" },
    blobs: { open: async () => null }, host: {}, context: {}, chat: { publish() {} },
    getStorage: async () => [{ id: "a", name: "A", command: "a", args: [], env: {} }, { id: "b", name: "B", command: "b", args: [], env: {} }],
    getState: () => null, setState() {}, onStorageChange() {}, onLifecycle: (fn: any) => { lifecycle = fn; },
    handle: (name: string, fn: any) => handlers.set(name, fn), publish: (view: any) => views.push(view),
  };
  new AppClient(client as any, []);
  await lifecycle({ phase: "ready" });
  assert.equal(views.at(-1).show_agents, true);
  await handlers.get("choose_agent")!({ item: { id: "a" } });
  assert.equal(views.at(-1).show_folder, true);
  assert.equal(views.at(-1).agent_label, "← A");
  assert.equal(views.at(-1).window_title, "에이전트");
  assert.equal(views.at(-1).window_meta, null);
  await handlers.get("pick_folder")!({});
  assert.equal(views.at(-1).show_folder, true);
  assert.equal(views.at(-1).show_retry, true);
});

test("에이전트가 하나일 때 폴더 grant 알림과 선택 결과가 겹쳐도 한 번만 실행한다", async () => {
  let lifecycle: any, grant: any, starts = 0, attaches = 0;
  const handlers = new Map<string, (context: any) => Promise<void>>();
  const client = {
    process: { onReady() {}, onServicesChanged() {}, attach: async () => { attaches++; return null; }, start: async () => { starts++; return { status: "cancelled" }; } },
    files: { grant: () => null, on_grant: (_id: string, fn: any) => { grant = fn; }, pick_folder: async () => { grant("작업"); return "작업"; } },
    blobs: { open: async () => null }, host: {}, context: {}, chat: { publish() {} },
    getStorage: async () => [{ id: "a", name: "A", command: "a", args: [], env: {} }],
    getState: () => null, setState() {}, onStorageChange() {}, onLifecycle: (fn: any) => { lifecycle = fn; },
    handle: (name: string, fn: any) => handlers.set(name, fn), publish() {},
  };
  new AppClient(client as any, []);
  await lifecycle({ phase: "ready" });
  await handlers.get("pick_folder")!({});
  assert.equal(attaches, 0);
  assert.equal(starts, 1);
});
