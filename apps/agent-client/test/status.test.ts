import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readClaudeRateLimits, mergeLimit, readAuthStatus, isSubagentTool, type Limit } from "../src/status.ts";

// 2026-11-19 claude-agent-acp 0.108.0, Claude Team 계정에서 받은 실제 usage_update의 _meta
const live = {"status":"allowed","resetsAt":1795062600,"rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,"unifiedWindows":{"five_hour":{"utilization":0.39,"resetsAt":1795062600,"status":"allowed"},"seven_day":{"utilization":0.47,"resetsAt":1795219200,"status":"allowed"}}};

test("한도 해석: unifiedWindows의 창마다 하나씩 읽는다", () => {
  assert.deepEqual(readClaudeRateLimits(live), [
    { id: "five_hour", label: "5시간", usedRatio: 0.39, resetsAt: new Date(1795062600_000).toISOString(), blocked: false },
    { id: "seven_day", label: "7일", usedRatio: 0.47, resetsAt: new Date(1795219200_000).toISOString(), blocked: false },
  ]);
  const windows = { five_hour: { utilization: 1, resetsAt: 1795062600, status: "rejected" }, seven_day: { utilization: 0.2, resetsAt: 1795219200, status: "allowed" } };
  assert.deepEqual(readClaudeRateLimits({ status: "allowed", rateLimitType: "seven_day", unifiedWindows: windows }).map((l) => l.blocked), [true, false]);
  // 맨 위 status가 rejected면 rateLimitType 창도 막힌다
  const rejected = readClaudeRateLimits({ ...live, status: "rejected", rateLimitType: "seven_day" });
  assert.deepEqual(rejected.map((l) => [l.id, l.blocked]), [["five_hour", false], ["seven_day", true]]);
  // unifiedWindows에 없는 맨 위 창은 뒤에 더한다
  const overage = readClaudeRateLimits({ ...live, status: "rejected", rateLimitType: "overage", resetsAt: 1795062600 });
  assert.deepEqual(overage.map((l) => [l.id, l.blocked, l.usedRatio]), [["five_hour", false, 0.39], ["seven_day", false, 0.47], ["overage", true, null]]);
});

test("한도 해석: unifiedWindows가 없으면 맨 위 창 하나", () => {
  assert.deepEqual(readClaudeRateLimits({ status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.89, resetsAt: 1763400600 }),
    [{ id: "five_hour", label: "5시간", usedRatio: 0.89, resetsAt: new Date(1763400600_000).toISOString(), blocked: false }]);
  assert.equal(readClaudeRateLimits({ status: "allowed", rateLimitType: "seven_day_overage_included" })[0].label, "7일(추가 사용 포함)");
  assert.equal(readClaudeRateLimits({ status: "allowed", rateLimitType: "weird_new" })[0].label, "weird_new");
  assert.equal(readClaudeRateLimits({ status: "rejected", rateLimitType: "five_hour" })[0].blocked, true);
  assert.equal(readClaudeRateLimits({ status: "allowed", rateLimitType: "five_hour" })[0].usedRatio, null);
  assert.deepEqual(readClaudeRateLimits({ status: "allowed" }), []);
  assert.deepEqual(readClaudeRateLimits(undefined), []);
});

test("한도 해석: 0~1 밖이거나 유한하지 않은 사용률은 모름", () => {
  for (const utilization of [39, -0.1, 1.01, Number.NaN, Number.POSITIVE_INFINITY, "0.5"]) {
    assert.equal(readClaudeRateLimits({ status: "allowed", rateLimitType: "five_hour", utilization })[0].usedRatio, null, String(utilization));
    assert.equal(readClaudeRateLimits({ unifiedWindows: { five_hour: { utilization, status: "allowed" } } })[0].usedRatio, null, String(utilization));
  }
  assert.equal(readClaudeRateLimits({ status: "allowed", rateLimitType: "five_hour", utilization: 0 })[0].usedRatio, 0);
  assert.equal(readClaudeRateLimits({ status: "allowed", rateLimitType: "five_hour", utilization: 1 })[0].usedRatio, 1);
});

test("한도 창 합치기", () => {
  const limit = (id: string, usedRatio: number): Limit => ({ id, label: id, usedRatio, resetsAt: null, blocked: false });
  let limits = mergeLimit([limit("five_hour", 0.5)], limit("seven_day", 0.2));
  assert.deepEqual(limits.map((l) => l.id), ["five_hour", "seven_day"]);
  limits = mergeLimit(limits, limit("five_hour", 0.9));
  assert.equal(limits.length, 2);
  assert.equal(limits[0].usedRatio, 0.9);
});

test("한도 창 합치기: 같은 주기의 사용률 모름 갱신은 알던 사용률을 지킨다", () => {
  const at = new Date(1795062600_000).toISOString();
  const known: Limit = { id: "five_hour", label: "5시간", usedRatio: 0.4, resetsAt: at, blocked: false };
  const merged = mergeLimit([known], { ...known, usedRatio: null, blocked: true });
  assert.deepEqual(merged, [{ ...known, usedRatio: 0.4, blocked: true }]);
  // 주기가 바뀌었으면 예전 사용률을 버린다
  const later = new Date(1795080600_000).toISOString();
  assert.equal(mergeLimit([known], { ...known, usedRatio: null, resetsAt: later })[0].usedRatio, null);
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
