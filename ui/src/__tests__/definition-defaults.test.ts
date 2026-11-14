import { describe, expect, it } from "vitest";
import { DEFINITION_DEFAULTS_RESULT, DEFINITION_DEFAULTS_SAMPLE } from "../contract/definition-defaults";
import { fillDefinitionDefaults } from "../core/app-defaults";

describe("앱 정의 기본값 표", () => {
  it("표가 채운 값이 코어가 읽어 낸 정의와 같다", () => {
    expect(fillDefinitionDefaults(DEFINITION_DEFAULTS_SAMPLE)).toEqual(DEFINITION_DEFAULTS_RESULT);
  });
});
