import { test } from "node:test";
import { strict as assert } from "node:assert";
import { History } from "../src/history.ts";

test("기록을 작은 페이지로 나누고 재생된 항목은 같은 id에 쓴다", async () => {
  const data = new Map<string, Uint8Array>();
  const blobs = { put: async (key: string, bytes: Uint8Array) => { data.set(key, bytes.slice()); }, read: async (key: string) => data.get(key) ?? null };
  const history = new History(blobs);
  for (let index = 0; index < 101; index++) await history.append([{ id: String(index), kind: "user", text: String(index), at: "now", attachments: [] }]);
  await history.append([{ id: "100", kind: "user", text: "수정", at: "now", attachments: [] }]);
  await history.setSession("session");
  const restored = new History(blobs);
  await restored.load();
  assert.equal(restored.items.length, 101);
  assert.equal(restored.items[100].text, "수정");
  assert.equal(restored.sessionId, "session");
  assert.equal([...data.keys()].filter((key) => key.includes("page-")).length, 2);
});

test("에이전트나 작업 폴더가 바뀌면 이전 세션을 이어 쓰지 않는다", async () => {
  const data = new Map<string, Uint8Array>();
  const blobs = { put: async (key: string, bytes: Uint8Array) => { data.set(key, bytes.slice()); }, read: async (key: string) => data.get(key) ?? null };
  const history = new History(blobs);
  await history.bind("spec-a", "/one");
  await history.setSession("old");
  await history.append([{ id: "one", kind: "user", text: "이전", at: "now", attachments: [] }]);
  await history.bind("spec-a", "/one");
  assert.equal(history.sessionId, "old");
  await history.bind("spec-a", "/two");
  assert.equal(history.sessionId, null);
  assert.deepEqual(history.items, []);
});

test("기록 페이지가 없으면 위치가 담긴 오류를 반환한다", async () => {
  const manifest = new TextEncoder().encode(JSON.stringify({ pages: 1, sessionId: null, controls: {}, identity: null, cwd: null }));
  const history = new History({ put: async () => {}, read: async (key) => key === "record/manifest.json" ? manifest : null });
  await assert.rejects(history.load(), (error: any) => error.id === "AGENT_RECORD_PAGE_NOT_FOUND" && error.message.includes("0"));
});

test("Windows 경로 접두어가 없어져도 같은 폴더의 기록을 보존한다", async () => {
  const data = new Map<string, Uint8Array>();
  const blobs = { put: async (key: string, bytes: Uint8Array) => { data.set(key, bytes.slice()); }, read: async (key: string) => data.get(key) ?? null };
  const history = new History(blobs);
  await history.bind("spec", String.raw`\\?\C:\work`);
  await history.setSession("old");
  await history.append([{ id: "one", kind: "user", text: "이전", at: "now", attachments: [] }]);
  await history.bind("spec", String.raw`C:\work`);
  const manifest = JSON.parse(new TextDecoder().decode(data.get("record/manifest.json")));
  assert.equal(manifest.cwd, String.raw`C:\work`);
  assert.equal(manifest.sessions.old.pages, 1);
  assert.equal(history.sessionId, "old");
  assert.equal(history.items[0].text, "이전");
  await history.bind("spec", String.raw`\\?\UNC\server\share`);
  await history.setSession("unc");
  await history.bind("spec", String.raw`\\server\share`);
  assert.equal(history.sessionId, "unc");
});
