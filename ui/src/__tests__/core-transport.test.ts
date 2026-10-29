import { describe, expect, it } from "vitest";
import { isCoreError, toCoreError } from "../core/core-transport";

describe("core error conversion", () => {
  it("preserves the web view unavailable code", () => {
    const unavailable = { code: "unavailable", message: "웹 화면을 쓸 수 없습니다", details: [] };
    expect(isCoreError(unavailable)).toBe(true);
    expect(toCoreError(unavailable)).toEqual(unavailable);
  });
});
