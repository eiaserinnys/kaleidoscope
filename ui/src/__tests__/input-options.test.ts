import { describe, expect, it } from "vitest";
import { filterInputOptions, normalizeInputOptions } from "../blocks/input-options";

describe("입력 선택지", () => {
  it("문자열과 설명이 있는 객체를 정규화하고 값과 이름으로 대소문자 없이 거른다", () => {
    const result = normalizeInputOptions(["Zombie", { value: "wave-2", label: "두 번째 ZOM", description: "설명" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(filterInputOptions(result.options, "zOm").map((option) => option.value)).toEqual(["Zombie", "wave-2"]);
    expect(filterInputOptions(result.options, "설명")).toEqual([]);
  });

  it("문자열이 아닌 값과 이름, 배열이 아닌 자료를 거부한다", () => {
    expect(normalizeInputOptions([{ value: 1, label: "하나" }, "둘"]).ok).toBe(false);
    expect(normalizeInputOptions([{ value: "one", label: 1 }, "둘"]).ok).toBe(false);
    expect(normalizeInputOptions("하나").ok).toBe(false);
  });
});
