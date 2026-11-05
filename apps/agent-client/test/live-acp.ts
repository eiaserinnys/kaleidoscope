import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { AgentSession } from "../src/session.ts";

const binary = process.env.LIVE_ACP_BINARY;
if (!binary) throw new Error("LIVE_ACP_BINARY에 리포의 가짜 ACP 실행 파일을 지정하세요");

function fixture(scenario: string) {
  const blobs = new Map<string, Uint8Array>();
  let child: ReturnType<typeof spawn> | undefined;
  let checkpoint: any = null, after = 0, buffer = Buffer.alloc(0), ready = (_handle: string) => {};
  let exit: { code: number | null } | null = null, attached = true;
  let view: any;
  const writes: any[] = [];
  const processPort = {
    onReady: (listener: (handle: string) => void) => { ready = listener; }, onServicesChanged() {},
    start: async () => {
      checkpoint = null; after = 0; buffer = Buffer.alloc(0); exit = null;
      child = spawn(binary!, [], { env: { ...process.env, TEST_SCENARIO: scenario }, stdio: ["pipe", "pipe", "pipe"] });
      child.stdout!.on("data", (chunk: Buffer) => { buffer = Buffer.concat([buffer, chunk]); if (attached) ready("test"); });
      child.on("close", (code) => { exit = { code }; if (attached) ready("test"); });
      return { handle: "test", cwd: "/tmp", services: { tools: null } };
    },
    attach: async () => { attached = true; return child ? { handle: "test", after, checkpoint: structuredClone(checkpoint), cwd: "/tmp", services: { tools: null }, exit } : null; },
    read: async ({ after: cursor, max_bytes }: any) => {
      const bytes = buffer.subarray(cursor - after, cursor - after + max_bytes);
      return { bytes, next: cursor + bytes.length, stderr_tail: [], exit };
    },
    ack: async (state: any) => { buffer = buffer.subarray(state.after - after); after = state.after; checkpoint = structuredClone(state.checkpoint); },
    write: async (state: any) => {
      checkpoint = structuredClone(state.checkpoint);
      writes.push(JSON.parse(Buffer.from(state.bytes).toString("utf8")));
      await new Promise<void>((resolve, reject) => child!.stdin!.write(state.bytes, (error) => error ? reject(error) : resolve()));
    },
    stop: async () => { child?.kill(); }, file_uri: async (key: string) => `file:///tmp/${key}`,
  };
  const host = {
    process: processPort,
    blobs: { put: async (key: string, bytes: Uint8Array) => { blobs.set(key, bytes.slice()); }, read: async (key: string) => blobs.get(key) ?? null, remove: async (key: string) => { blobs.delete(key); } },
    instructions: async () => "시험 지침", prepare: async () => ({ text: null, images: [], ticket: "ticket" }), commit: async () => {},
    publish: (next: any) => { view = next; }, uuid: () => "id", now: () => new Date().toISOString(),
  };
  async function waitFor(predicate: () => boolean) {
    const end = Date.now() + 10000;
    while (!predicate()) { if (Date.now() > end) throw new Error(`ACP 시험 대기 초과: ${JSON.stringify(view)}`); await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  return { host, writes, waitFor, view: () => view, pid: () => child?.pid, pause: () => { attached = false; }, exited: () => exit !== null, close: () => child?.kill() };
}

for (const framePresent of [true, false]) {
  test(`실제 ACP 종료 뒤 ${framePresent ? "열린" : "재연결한"} 프레임에서 응답 기록을 보존한다`, async (t) => {
    const f = fixture("");
    t.after(f.close);
    const spec = { name: "시험", command: binary!, args: [], env: {} };
    const first = new AgentSession(f.host as any);
    await first.start(spec);
    await f.waitFor(() => f.view()?.phase === "ready");
    if (!framePresent) f.pause();
    await first.send({ id: "one", text: "end-mid-turn", attachments: [] });
    await f.waitFor(() => f.exited());
    const active = framePresent ? first : new AgentSession(f.host as any);
    if (!framePresent) await active.attach(spec);
    await f.waitFor(() => f.view()?.phase === "failed");
    await active.retry();
    await f.waitFor(() => f.view()?.phase === "ready");
    const item = f.view().items.find((entry: any) => entry.kind === "assistant");
    assert.ok(item?.text.includes("종료 전 응답"));
    assert.ok(item?.text.includes("중단"));
    assert.equal(f.writes.filter((entry) => entry.method === "session/prompt").length, 1);
  });
}

test("실제 가짜 ACP 프로세스의 승인 중 재접속과 큐", async (t) => {
  const f = fixture("");
  t.after(f.close);
  const spec = { name: "시험", command: binary!, args: [], env: {} };
  const first = new AgentSession(f.host as any);
  await first.start(spec);
  await f.waitFor(() => f.view()?.phase === "ready");
  const pid = f.pid();
  await first.configure("toggle", true);
  await f.waitFor(() => f.view()?.controls.some((control: any) => control.id === "toggle" && control.value === true));
  await first.send({ id: "one", text: "permission", attachments: [
    { name: "image.png", mime: "image/png", bytes: new Uint8Array([1, 2]) },
    { name: "note.txt", mime: "text/plain", bytes: new Uint8Array([3]) },
  ] });
  await f.waitFor(() => f.view()?.permissions.length === 1);
  const prompt = f.writes.find((item) => item.method === "session/prompt");
  assert.deepEqual(prompt.params.prompt.map((item: any) => item.type), ["text", "image", "resource_link", "text"]);
  await first.send({ id: "two", text: "next", attachments: [] });
  const resumed = new AgentSession(f.host as any);
  assert.equal(await resumed.attach(spec), true);
  assert.equal(f.pid(), pid);
  assert.equal(f.view().permissions[0].options[0].id, "yes");
  assert.equal(f.view().queued[0].id, "two");
  await resumed.answer("permission-1", "yes");
  await f.waitFor(() => f.view()?.phase === "ready" && f.writes.filter((item) => item.method === "session/prompt").length === 2);
  assert.equal(f.writes.filter((item) => item.method === "session/prompt").length, 2);
  assert.ok(f.view().items.some((item: any) => item.text.includes("선택: yes")));
  assert.ok(f.view().items.some((item: any) => item.text === "안녕"));
});

test("실제 가짜 ACP 프로세스의 로그인 뒤 세션 시작", async (t) => {
  const f = fixture("auth");
  t.after(f.close);
  const session = new AgentSession(f.host as any);
  await session.start({ name: "시험", command: binary!, args: [], env: {} });
  await f.waitFor(() => f.view()?.phase === "login");
  assert.deepEqual(f.view().authMethods.map((method: any) => method.id), ["login"]);
  await session.authenticate("login");
  await f.waitFor(() => f.view()?.phase === "ready");
  assert.ok(f.writes.some((message) => message.method === "authenticate"));
});

test("로그인 실패 뒤 같은 선택을 다시 시도해 세션을 시작한다", async (t) => {
  const f = fixture("auth_fail_once");
  t.after(f.close);
  const session = new AgentSession(f.host as any);
  await session.start({ name: "시험", command: binary!, args: [], env: {} });
  await f.waitFor(() => f.view()?.phase === "login");
  await session.authenticate("login");
  await f.waitFor(() => f.view()?.phase === "login" && f.view()?.failure);
  assert.equal(f.view().failure.id, "AGENT_LOGIN_AUTHENTICATE_FAILED");
  await session.authenticate("login");
  await f.waitFor(() => f.view()?.phase === "ready");
});
