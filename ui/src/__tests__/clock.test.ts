import { describe, expect, it } from "vitest";
import { clockPosition, formatClockTime, isClock } from "../data/clock";

describe("Clock 표시 계산", () => {
  it("재생 중에는 sample 이후 경과 시간과 배율을 적용한다", () => {
    expect(clockPosition({ position: 8, sampled_at: 10_000, rate: 1.5, running: true, duration: 20 }, 11_000)).toBe(9.5);
  });

  it("일시 정지 위치를 유지하고 재생 위치를 재생 구간에 맞춘다", () => {
    expect(clockPosition({ position: 8, sampled_at: 10_000, rate: 2, running: false, duration: 20 }, 15_000)).toBe(8);
    expect(clockPosition({ position: 19, sampled_at: 10_000, rate: 2, running: true, duration: 20 }, 15_000)).toBe(20);
    expect(clockPosition({ position: 1, sampled_at: 10_000, rate: 1, running: true, duration: 20 }, 0)).toBe(0);
  });

  it("시간 숫자를 분, 초, 센티초로 표시한다", () => {
    expect(formatClockTime(1.2)).toBe("00:01.20");
    expect(formatClockTime(62.349)).toBe("01:02.35");
    expect(formatClockTime(120)).toBe("02:00.00");
  });

  it("Clock 모양의 값만 인식한다", () => {
    expect(isClock({ position: 0, sampled_at: 1, rate: 1, running: true, duration: 10 })).toBe(true);
    expect(isClock({ position: 0, sampled_at: 1, rate: 1, running: true })).toBe(false);
    expect(isClock([0, 1, 1, true, 10])).toBe(false);
  });
});
