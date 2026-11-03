import { expect, it } from "vitest";
import { clockPosition, rulerStep, snapTime } from "../blocks/timeline";

it("재생 시계는 현재 시각으로 보간하고 길이에서 멈춘다", () => {
  expect(clockPosition({ position: 1, sampled_at: 1000, rate: 1.5, running: true, duration: 10 }, 3000)).toBe(4);
  expect(clockPosition({ position: 9, sampled_at: 1000, rate: 1, running: true, duration: 10 }, 5000)).toBe(10);
  expect(clockPosition({ position: 3, sampled_at: 1000, rate: 1, running: false, duration: 10 }, 5000)).toBe(3);
});

it("스냅은 픽셀 문턱 안의 가장 가까운 시간으로 이동하며 Shift로 끈다", () => {
  expect(snapTime(2.06, { points: [2, 3], step: 0.5, threshold_px: 8 }, 100, false)).toBe(2);
  expect(snapTime(2.16, { points: [2], threshold_px: 8 }, 100, false)).toBe(2.16);
  expect(snapTime(2.06, { points: [2], threshold_px: 8 }, 100, true)).toBe(2.06);
});

it("8배 확대에서도 눈금은 최소 0.5초 간격이다", async () => {
  const { rulerStep } = await import("../blocks/timeline");
  expect(rulerStep(10, 8, true)).toBe(0.5);
});

it("새 viewport 기능을 쓰면 긴 구간 눈금을 줄이고, 기존 6분 간격은 유지한다", () => {
  const fullStep = rulerStep(28_800, 1, true);
  expect(fullStep).toBeGreaterThan(60);
  expect(Math.floor(28_800 / fullStep) + 1).toBeLessThanOrEqual(6);
  expect(rulerStep(28_800, 8, true)).toBeLessThan(fullStep);
  expect(rulerStep(360, 1)).toBe(60);
  expect(rulerStep(360, 1, true)).toBe(120);
});

it("최소 폭과 확대 상태에서도 시간축 라벨 사이에 간격을 둔다", () => {
  const narrow = rulerStep(28_800, 1, true, 230, 94);
  expect(narrow).toBeGreaterThan(7_200);
  expect(narrow * 230 / 28_800).toBeGreaterThanOrEqual(94);

  const zoomed = rulerStep(28_800, 1.6, true, 230, 94);
  expect(zoomed * 1.6 * 230 / 28_800).toBeGreaterThanOrEqual(94);

  const wide = rulerStep(28_800, 1, true, 900, 94);
  expect(wide).toBe(7_200);
});
