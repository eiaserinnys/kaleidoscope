import { describe, expect, it } from "vitest";
import { objectParticle } from "../../../app/src/shell/korean-particle";

describe("목적격 조사", () => {
  it.each([
    ["설치", "를"],
    ["사과", "를"],
    ["책", "을"],
    ["Unix", "를"],
    ["npm", "을"],
    ["Node.js 설치", "를"],
    ["CLI", "를"],
    ["3", "을"],
    ["2", "를"],
    ["Unix!", "를"],
    ["npm ", "을"],
  ])("%s 뒤에 %s를 붙인다", (word, particle) => {
    expect(objectParticle(word)).toBe(particle);
  });

  it("판단할 수 없으면 을(를)로 둔다", () => {
    expect(objectParticle("")).toBe("을(를)");
    expect(objectParticle("   ")).toBe("을(를)");
    expect(objectParticle("!?")).toBe("을(를)");
  });
});
