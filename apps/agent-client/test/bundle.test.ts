import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { checkBundle, checkPreserved } from "../scripts/bundle-check.mjs";

test("번들이나 자산 목록의 해시가 달라지면 검증이 실패한다", () => {
  const generated = Buffer.from("script");
  const entry = { id: "builtin-agent-client", sha256: "hash", byte_size: generated.length };
  assert.doesNotThrow(() => checkBundle(generated, Buffer.from("script"), entry, entry));
  assert.throws(() => checkBundle(generated, Buffer.from("scripT"), entry, entry));
  assert.throws(() => checkBundle(generated, generated, { ...entry, sha256: "wrong" }, entry));
});

test("보존 자산과 목록 중 하나라도 바뀌면 검증이 실패한다", () => {
  const saved = Buffer.from("기존 자산");
  const entry = { sha256: createHash("sha256").update(saved).digest("hex"), byte_size: saved.length, path: "agent/client-v3.js" };
  assert.doesNotThrow(() => checkPreserved(saved, entry, entry));
  assert.throws(() => checkPreserved(Buffer.from("변경 자산"), entry, entry));
  assert.throws(() => checkPreserved(saved, { ...entry, path: "agent/client.js" }, entry));
});
