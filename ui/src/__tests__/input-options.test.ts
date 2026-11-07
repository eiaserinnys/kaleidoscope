import { describe, expect, it } from "vitest";
import { filterInputOptions, normalizeInputOptions, resolveInputOption } from "../blocks/input-options";

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

it.each([
  [12, "ARRAY_INVALID"], [[12], "ITEM_INVALID"], [[{}], "KEY_MISSING"],
  [[{ value: 12, label: "둘" }], "KEY_NOT_STRING"],
  [[{ value: "a", label: "A", description: 12 }], "KEY_NOT_STRING"],
])("잘못된 자료 %j의 원인 %s를 구분한다", (value, reason) => {
  expect(normalizeInputOptions(value)).toMatchObject({ ok: false, reason });
});

it("오류 문구에 항목 번호와 키와 받은 값을 담는다", async () => {
  const { inputOptionsError } = await import("../blocks/input-options");
  const result = normalizeInputOptions(["정상", { value: 12, label: "둘" }]);
  if (result.ok) throw new Error("잘못된 선택지를 허용했습니다");
  expect(inputOptionsError(result)).toMatchObject({ id: "SHELL_INPUT_OPTIONS_KEY_NOT_STRING", message: "입력 선택지 2번째의 value 키 값이 문자열이 아닙니다. 받은 값: 12. 앱 정의의 options 자료에서 해당 키를 문자열로 고치세요." });
});

describe("입력 선택지 이름 해석", () => {
  const result = normalizeInputOptions([
    { value: "code-77", label: "Zombie 마지막" },
    { value: "Zombie 마지막", label: "충돌 값" },
    { value: "code-78", label: "Zombie 마지막" },
    { value: "b", label: "Bee" },
  ]);
  if (!result.ok) throw new Error("선택지를 정규화하지 못했습니다");
  const options = result.options;

  it("값이 그대로면 값을 고른다", () => {
    expect(resolveInputOption(options, "code-78")).toBe("code-78");
  });

  it("이름은 대소문자와 앞뒤 공백을 넘겨 값을 고른다", () => {
    expect(resolveInputOption(options, "  bee ")).toBe("b");
    expect(resolveInputOption(options, "ZOMBIE 마지막")).toBe("code-77");
  });

  it("값과 이름이 겹치면 값 일치를 먼저 본다", () => {
    expect(resolveInputOption(options, "Zombie 마지막")).toBe("Zombie 마지막");
  });

  it("같은 이름이 여럿이면 첫 선택지의 값을 고른다", () => {
    const valid = normalizeInputOptions([{ value: "code-77", label: "같은 이름" }, { value: "code-78", label: "같은 이름" }]);
    if (!valid.ok) throw new Error("선택지를 정규화하지 못했습니다");
    expect(resolveInputOption(valid.options, "같은 이름")).toBe("code-77");
  });

  it("맞는 값도 이름도 없으면 null이다", () => {
    expect(resolveInputOption(options, "없는 이름")).toBeNull();
    expect(resolveInputOption(options, "Zombie")).toBeNull();
  });
});
