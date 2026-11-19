import { test } from "node:test";
import { strict as assert } from "node:assert";
import { controlLabel, formatReset, limitRow, limitsAt, nextReset, tightestLimit } from "../src/status-view.ts";
import type { Limit } from "../src/status.ts";

const now = new Date(2026, 10, 16, 12, 0);
const limit = (id: string, usedRatio: number | null, extra: Partial<Limit> = {}): Limit => ({ id, label: id, usedRatio, resetsAt: null, blocked: false, ...extra });

test("formatReset: 오늘이면 시각만, 아니면 날짜를 붙인다", () => {
  assert.equal(formatReset(new Date(2026, 10, 16, 18, 30).toISOString(), now), "18:30");
  assert.equal(formatReset(new Date(2026, 10, 17, 5, 0).toISOString(), now), "11/17 05:00");
});

test("tightestLimit: 막힘, 사용률 순이고 모르는 창은 뒤로", () => {
  assert.equal(tightestLimit([limit("seven_day", 0.3), limit("five_hour", 0.9)])?.id, "five_hour");
  assert.equal(tightestLimit([limit("five_hour", 0.99), limit("seven_day", 0.1, { blocked: true })])?.id, "seven_day");
  assert.equal(tightestLimit([limit("a", null), limit("b", 0.1)])?.id, "b");
  assert.equal(tightestLimit([]), null);
});

test("limitRow: 남은 비율과 시각, 막힘, 모름", () => {
  const at = new Date(2026, 10, 16, 18, 30).toISOString();
  assert.deepEqual(limitRow(limit("five_hour", 0.89, { resetsAt: at }), now), { key: "five_hour", label: "five_hour", value: 0.89, text: "11% 남음 (18:30)", known: true });
  const blocked = limitRow(limit("seven_day", 0.5, { blocked: true, resetsAt: new Date(2026, 10, 17, 5, 0).toISOString() }), now);
  assert.equal(blocked.text, "막힘, 11/17 05:00까지");
  assert.equal(blocked.value, 1);
  assert.deepEqual(limitRow(limit("x", null), now), { key: "x", label: "x", value: 0, text: "아직 모름", known: false });
});

test("limitsAt: 다시 차는 시각이 지난 창은 다시 찬 것으로 보고 사용률을 모름으로 둔다", () => {
  const past = new Date(2026, 10, 16, 11, 0).toISOString(), at = now.toISOString(), future = new Date(2026, 10, 16, 18, 30).toISOString();
  const limits = [limit("five_hour", 1, { blocked: true, resetsAt: past }), limit("now", 0.5, { resetsAt: at }), limit("seven_day", 0.3, { resetsAt: future }), limit("plain", 0.2)];
  assert.deepEqual(limitsAt(limits, now), [
    limit("five_hour", null, { resetsAt: past }), limit("now", null, { resetsAt: at }), limits[2], limits[3],
  ]);
  // 지난 창은 상태 줄 후보에서 빠진다
  assert.equal(tightestLimit(limitsAt(limits, now))?.id, "seven_day");
  assert.equal(limitRow(limitsAt(limits, now)[0], now).text, "아직 모름");
});

test("nextReset: 지금보다 뒤인 가장 가까운 다시 차는 시각", () => {
  const at = (hour: number) => new Date(2026, 10, 16, hour, 0).toISOString();
  assert.equal(nextReset([limit("a", 0.1, { resetsAt: at(18) }), limit("b", 0.1, { resetsAt: at(14) }), limit("c", 0.1, { resetsAt: at(11) }), limit("d", 0.1)], now), new Date(at(14)).getTime());
  assert.equal(nextReset([limit("c", 0.1, { resetsAt: at(11) }), limit("now", 0.1, { resetsAt: now.toISOString() })], now), null);
  assert.equal(nextReset([], now), null);
});

test("controlLabel: 선택지 라벨, boolean은 켜졌을 때만", () => {
  const select = { id: "m", label: "모델", category: "model", kind: "select" as const, value: "o", options: [{ value: "o", label: "Opus 5.5" }] };
  assert.equal(controlLabel(select), "Opus 5.5");
  const flag = { id: "f", label: "빠르게", category: null, kind: "boolean" as const, value: true, options: [] };
  assert.equal(controlLabel(flag), "빠르게");
  assert.equal(controlLabel({ ...flag, value: false }), null);
});
