import { expect, it, vi } from "vitest";
import { registerSelectOptions } from "../share/select-options";
import { selectElement } from "../share/action-select";

it("등록 콜백은 이름과 값으로 선택하고 중복과 비활성을 기존 오류로 막는다", () => {
  const input = document.createElement("input");
  const choose = vi.fn();
  const dispose = registerSelectOptions(input, [
    { value: "a", label: "첫째" }, { value: "b", label: "둘째" },
    { value: "c", label: "중복" }, { value: "d", label: "중복" },
    { value: "e", label: "잠김", disabled: true },
  ], choose);
  expect(selectElement("fixture", input, { by: "label", value: "첫째" })).toBeUndefined();
  expect(selectElement("fixture", input, { by: "value", value: "b" })).toBeUndefined();
  expect(choose.mock.calls).toEqual([[0], [1]]);
  expect(selectElement("fixture", input, { by: "label", value: "중복" })?.id).toBe("SHELL_WINDOW_CONTROL_OPTION_AMBIGUOUS");
  expect(selectElement("fixture", input, { by: "value", value: "e" })?.id).toBe("SHELL_WINDOW_CONTROL_TARGET_DISABLED");
  expect(choose).toHaveBeenCalledTimes(2);
  dispose();
});
