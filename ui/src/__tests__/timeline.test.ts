import { expect, it } from "vitest";
import { clockPosition, snapTime } from "../blocks/timeline";

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
  expect(rulerStep(10, 8)).toBe(0.5);
});
