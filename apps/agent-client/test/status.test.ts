import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readClaudeRateLimit, mergeLimit, readAuthStatus, isSubagentTool, type Limit } from "../src/status.ts";

test("한도 해석", () => {
  assert.deepEqual(readClaudeRateLimit({ status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.89, resetsAt: 1763400600 }),
    { id: "five_hour", label: "5시간", usedRatio: 0.89, resetsAt: new Date(1763400600_000).toISOString(), blocked: false });
  assert.equal(readClaudeRateLimit({ status: "allowed", rateLimitType: "seven_day_overage_included" })?.label, "7일(추가 사용 포함)");
  assert.equal(readClaudeRateLimit({ status: "allowed", rateLimitType: "weird_new" })?.label, "weird_new");
  assert.equal(readClaudeRateLimit({ status: "rejected", rateLimitType: "five_hour" })?.blocked, true);
  assert.equal(readClaudeRateLimit({ status: "allowed", rateLimitType: "five_hour" })?.usedRatio, null);
  assert.equal(readClaudeRateLimit({ status: "allowed" }), null);
});

test("한도 창 합치기", () => {
  const limit = (id: string, usedRatio: number): Limit => ({ id, label: id, usedRatio, resetsAt: null, blocked: false });
  let limits = mergeLimit([limit("five_hour", 0.5)], limit("seven_day", 0.2));
  assert.deepEqual(limits.map((l) => l.id), ["five_hour", "seven_day"]);
  limits = mergeLimit(limits, limit("five_hour", 0.9));
  assert.equal(limits.length, 2);
  assert.equal(limits[0].usedRatio, 0.9);
});

test("계정", () => {
  assert.deepEqual(readAuthStatus({ state: "authenticated", accounts: [{ label: "Claude Team", email: "a@b.c", active: true }] }), { label: "Claude Team", email: "a@b.c" });
  assert.deepEqual(readAuthStatus({ state: "authenticated", accounts: [{ label: "Claude Team", active: true }] }), { label: "Claude Team", email: null });
  assert.equal(readAuthStatus({ state: "unauthenticated", accounts: [{ label: "x", active: true }] }), null);
  assert.equal(readAuthStatus({ state: "unknown" }), null);
  assert.equal(readAuthStatus({ state: "authenticated", accounts: [] }), null);
});

test("서브에이전트 판정", () => {
  assert.equal(isSubagentTool({ _meta: { claudeCode: { toolName: "Agent" } } }), true);
  assert.equal(isSubagentTool({ _meta: { claudeCode: { toolName: "Task" } } }), true);
  assert.equal(isSubagentTool({ _meta: { claudeCode: { toolName: "Bash" } } }), false);
  assert.equal(isSubagentTool({}), false);
});
