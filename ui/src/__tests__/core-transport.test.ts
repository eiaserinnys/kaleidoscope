import { describe, expect, it } from "vitest";
import { isCoreError, toCoreError } from "../core/core-transport";

describe("core error conversion", () => {
  it.each(["invalid_name", "file_busy", "trash_unavailable"] as const)("preserves the %s core error shape", (code) => {
    const error = { code, message: "핵심 오류 문구", details: [] };
    expect(isCoreError(error)).toBe(true);
    expect(toCoreError(error)).toEqual(error);
  });

  it("preserves the web view unavailable code", () => {
    const unavailable = { code: "unavailable", message: "웹 화면을 쓸 수 없습니다", details: [] };
    expect(isCoreError(unavailable)).toBe(true);
    expect(toCoreError(unavailable)).toEqual(unavailable);
  });

  it.each(["unauthorized"] as const)("preserves the %s error instead of stringifying it", (code) => {
    const error = { code, message: "접근이 거부되었습니다", details: [] };
    expect(isCoreError(error)).toBe(true);
    expect(toCoreError(error)).toEqual(error);
    expect(toCoreError(error).message).not.toContain("[object Object]");
  });

  it("uses a string message from an unfamiliar error object", () => {
    expect(toCoreError({ message: "네트워크 연결이 끊겼습니다" }).message)
      .toContain("네트워크 연결이 끊겼습니다");
  });
});
