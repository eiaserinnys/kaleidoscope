import { test } from "node:test";
import { strict as assert } from "node:assert";
import { checkBundle } from "../scripts/bundle-check.mjs";

test("번들이나 자산 목록의 해시가 달라지면 검증이 실패한다", () => {
  const generated = Buffer.from("script");
  const entry = { id: "builtin-agent-client", sha256: "hash", byte_size: generated.length };
  assert.doesNotThrow(() => checkBundle(generated, Buffer.from("script"), entry, entry));
  assert.throws(() => checkBundle(generated, Buffer.from("scripT"), entry, entry));
  assert.throws(() => checkBundle(generated, generated, { ...entry, sha256: "wrong" }, entry));
});
