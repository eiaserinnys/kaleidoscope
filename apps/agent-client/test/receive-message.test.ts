import { test } from "node:test";
import { strict as assert } from "node:assert";
import { AppClient } from "../src/app.ts";
import { initialState } from "../src/reducer.ts";

const agent = { id: "a", name: "시험", command: "agent", args: [], env: {} };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fixture(phase: "ready" | "responding" | "starting" | "login" | "failed" = "ready", deferAttach = false) {
  let receive: (message: any) => Promise<any>;
  let releaseAttach: () => void = () => {};
  let releaseCheckpoint: () => void = () => {};
  let holdCheckpoint = false;
  const attachWait = new Promise<void>((resolve) => { releaseAttach = resolve; });
  const checkpointWait = new Promise<void>((resolve) => { releaseCheckpoint = resolve; });
  const handlers = new Map<string, Function>(), stores = new Map<string, Function>();
  const views: any[] = [], checkpoints: any[] = [], chats: any[] = [];
  const checkpoint = { ...initialState(), phase, initialized: true, sessionId: "session" };
  const client = {
    process: {
      onReady() {}, onServicesChanged() {},
      attach: async ({ key }: any) => {
        if (key !== "main") return null;
        if (deferAttach) await attachWait;
        return { handle: "process", after: 0, checkpoint, cwd: "/work", services: {}, exit: null };
      },
      read: async () => ({ bytes: [], next: 0, stderr_tail: [], exit: null }),
      ack: async ({ checkpoint: state }: any) => { if (holdCheckpoint) await checkpointWait; checkpoints.push(structuredClone(state)); },
      write: async () => {},
    },
    files: { grant: () => "/work", on_grant() {} },
    blobs: { open: async () => null, put: async () => {}, remove: async () => {} },
    host: { instructions: async () => ({ text: "안내" }) },
    context: { prepare: async () => ({ text: null, images: [], ticket: "ticket" }), commit: async () => {} },
    chat: { publish: (_channel: string, item: any) => chats.push(item) },
    getState: () => "a", setState() {},
    onStorageChange: (id: string, fn: Function) => stores.set(id, fn), onLifecycle() {},
    onMessage: (fn: typeof receive) => { receive = fn; },
    handle: (name: string, fn: Function) => handlers.set(name, fn), publish: (view: any) => views.push(view),
  };
  new AppClient(client as any, []);
  return { stores, handlers, views, checkpoints, chats, releaseAttach, releaseCheckpoint,
    holdCheckpoint: () => { holdCheckpoint = true; }, receive: (message: any) => receive(message) };
}

test("시작 화면은 준비에 필요한 행동을 답한다", async () => {
  const f = fixture();
  f.stores.get("agents")!([]);
  assert.deepEqual(await f.receive({ request_id: "one", text: "안녕" }), {
    status: "not_ready", reason: "에이전트 창에서 에이전트와 작업 폴더를 고른 뒤 다시 보내세요",
  });
});

test("초기 저장소와 복구를 기다리고 준비된 세션에서 접수한다", async () => {
  const f = fixture("ready", true);
  let done = false;
  const result = f.receive({ request_id: "one", text: "받은 글" }).then((value) => { done = true; return value; });
  await tick();
  assert.equal(done, false);
  f.stores.get("agents")!([agent]);
  await tick();
  assert.equal(done, false);
  f.releaseAttach();
  assert.deepEqual(await result, { status: "accepted" });
  assert.ok(f.checkpoints.some((state) => state.queue.some((item: any) => item.id === "one" && item.text === "받은 글" && item.attachments.length === 0)));
});

for (const phase of ["ready", "responding"] as const) {
  test(`${phase}는 입력 전송과 같은 큐에 넣고 체크포인트 뒤 접수한다`, async () => {
    const f = fixture(phase);
    f.stores.get("agents")!([agent]);
    while (!f.views.some((view) => view.show_chat)) await tick();
    f.holdCheckpoint();
    let done = false;
    const result = f.receive({ request_id: "received", text: "받은 글" }).then((value) => { done = true; return value; });
    await tick();
    assert.equal(done, false);
    f.releaseCheckpoint();
    assert.deepEqual(await result, { status: "accepted" });
    await f.handlers.get("send")!({ event: { request_id: "typed", text: "입력한 글", attachments: [] } });
    for (const [id, text] of [["received", "받은 글"], ["typed", "입력한 글"]]) {
      assert.ok(f.checkpoints.some((state) => state.queue.some((item: any) => item.id === id && item.text === text && item.attachments.length === 0)));
    }
  });
}

test("기존 전송 오류를 그대로 전달한다", async () => {
  const f = fixture();
  f.stores.get("agents")!([agent]);
  await assert.rejects(f.receive({ request_id: "one", text: "" }), (error: any) => error.id === "AGENT_PROMPT_CONTENT_EMPTY");
});

for (const [phase, reason] of [
  ["starting", "에이전트가 시작되는 중입니다. 시작된 뒤 다시 보내세요"],
  ["login", "에이전트 창에서 로그인한 뒤 다시 보내세요"],
  ["failed", "에이전트 창의 오류를 확인한 뒤 다시 보내세요"],
] as const) {
  test(`${phase} 상태의 행동 안내를 답한다`, async () => {
    const f = fixture(phase);
    f.stores.get("agents")!([agent]);
    assert.deepEqual(await f.receive({ request_id: "one", text: "안녕" }), { status: "not_ready", reason });
  });
}
