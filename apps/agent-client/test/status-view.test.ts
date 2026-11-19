import { test } from "node:test";
import { strict as assert } from "node:assert";
import { controlLabel, limitBars, limitRow, limitsAt, nextRedraw, timeLeft } from "../src/status-view.ts";
import type { Limit } from "../src/status.ts";

const now = new Date(2026, 10, 16, 12, 0);
const later = (ms: number) => new Date(now.getTime() + ms).toISOString();
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const limit = (id: string, usedRatio: number | null, extra: Partial<Limit> = {}): Limit => ({ id, label: id, usedRatio, resetsAt: null, blocked: false, ...extra });

test("timeLeft: 하루 이상은 일, 한 시간 이상은 시간, 그 밖은 분으로 내리고 최소 1분", () => {
  assert.equal(timeLeft(later(3 * DAY + 23 * HOUR), now), "3일 남음");
  assert.equal(timeLeft(later(DAY), now), "1일 남음");
  assert.equal(timeLeft(later(DAY - 1), now), "23시간 남음");
  assert.equal(timeLeft(later(3 * HOUR + 59 * MINUTE), now), "3시간 남음");
  assert.equal(timeLeft(later(HOUR - 1), now), "59분 남음");
  assert.equal(timeLeft(later(90 * 1000), now), "1분 남음");
  assert.equal(timeLeft(later(5_000), now), "1분 남음");
});

test("limitRow: 사용률과 남은 시간, 막힘, 모름", () => {
  assert.deepEqual(limitRow(limit("five_hour", 0.58, { resetsAt: later(3 * HOUR + 10 * MINUTE) }), now), { key: "five_hour", label: "five_hour", value: 0.58, text: "58% 사용, 3시간 남음", known: true });
  const blocked = limitRow(limit("seven_day", 0.5, { blocked: true, resetsAt: later(2 * DAY + HOUR) }), now);
  assert.equal(blocked.text, "막힘, 2일 남음");
  assert.equal(blocked.value, 1);
  assert.equal(limitRow(limit("a", 0.2), now).text, "20% 사용");
  assert.equal(limitRow(limit("b", null, { blocked: true }), now).text, "막힘");
  assert.deepEqual(limitRow(limit("x", null), now), { key: "x", label: "x", value: 0, text: "아직 모름", known: false });
});

test("limitBars: five_hour는 session, seven_day는 weekly 자리이고 없거나 모르는 창은 뺀다", () => {
  const limits = [
    limit("seven_day_opus", 0.9, { resetsAt: later(DAY) }),
    limit("seven_day", 0.3, { resetsAt: later(5 * DAY) }),
    limit("five_hour", 0.58, { resetsAt: later(3 * HOUR) }),
  ];
  assert.deepEqual(limitBars(limits, now), [
    { key: "session", label: "session", value: 0.58, text: "58%", left: "3시간 남음" },
    { key: "weekly", label: "weekly", value: 0.3, text: "30%", left: "5일 남음" },
  ]);
  assert.deepEqual(limitBars([limit("five_hour", 0.2, { blocked: true, resetsAt: later(20 * MINUTE) }), limit("seven_day", null)], now), [
    { key: "session", label: "session", value: 1, text: "막힘", left: "20분 남음" },
  ]);
  assert.deepEqual(limitBars([limit("five_hour", 0.4)], now), [{ key: "session", label: "session", value: 0.4, text: "40%", left: null }]);
  assert.deepEqual(limitBars([limit("seven_day_opus", 0.4)], now), []);
});

test("limitsAt: 다시 차는 시각이 지난 창은 다시 찬 것으로 보고 사용률을 모름으로 둔다", () => {
  const past = later(-HOUR), at = now.toISOString(), future = later(6 * HOUR);
  const limits = [limit("five_hour", 1, { blocked: true, resetsAt: past }), limit("now", 0.5, { resetsAt: at }), limit("seven_day", 0.3, { resetsAt: future }), limit("plain", 0.2)];
  assert.deepEqual(limitsAt(limits, now), [
    limit("five_hour", null, { resetsAt: past }), limit("now", null, { resetsAt: at }), limits[2], limits[3],
  ]);
  // 지난 창은 상태 줄 막대에서 빠지고 설정 행은 모름이 된다
  assert.deepEqual(limitBars(limitsAt(limits, now), now).map((bar) => bar.key), ["weekly"]);
  assert.equal(limitRow(limitsAt(limits, now)[0], now).text, "아직 모름");
});

test("nextRedraw: 보이는 남은 시간 글이 처음 달라지는 시각(경계를 막 지난 때)", () => {
  const at = (ms: number) => now.getTime() + ms;
  // 3시간 30분 남음은 3시간 남음 경계를 지나는 30분 뒤에 바뀐다
  assert.equal(nextRedraw([limit("a", 0.1, { resetsAt: later(3 * HOUR + 30 * MINUTE) })], now), at(30 * MINUTE) + 1);
  // 1일 2시간 남음은 하루 경계(23시간 남음으로 바뀌는 때)
  assert.equal(nextRedraw([limit("a", 0.1, { resetsAt: later(DAY + 2 * HOUR) })], now), at(2 * HOUR) + 1);
  // 1분이 안 남으면 다시 차는 시각을 막 지난 때
  assert.equal(nextRedraw([limit("a", 0.1, { resetsAt: later(30_000) })], now), at(30_000) + 1);
  // 막힌 창도 보이므로 센다. 여럿이면 가장 이른 것
  assert.equal(nextRedraw([limit("a", 0.1, { resetsAt: later(5 * HOUR + 10 * MINUTE) }), limit("b", null, { blocked: true, resetsAt: later(2 * HOUR + 5 * MINUTE) })], now), at(5 * MINUTE) + 1);
  // 지난 창, 시각 없는 창, 모르는 창은 다시 그릴 일이 없다
  assert.equal(nextRedraw([limit("c", 0.1, { resetsAt: later(-HOUR) }), limit("d", 0.1), limit("e", null, { resetsAt: later(HOUR + MINUTE) })], now), null);
  assert.equal(nextRedraw([], now), null);
});

test("controlLabel: 선택지 라벨, boolean은 켜졌을 때만", () => {
  const select = { id: "m", label: "모델", category: "model", kind: "select" as const, value: "o", options: [{ value: "o", label: "Opus 5.5" }] };
  assert.equal(controlLabel(select), "Opus 5.5");
  const flag = { id: "f", label: "빠르게", category: null, kind: "boolean" as const, value: true, options: [] };
  assert.equal(controlLabel(flag), "빠르게");
  assert.equal(controlLabel({ ...flag, value: false }), null);
});
