import { describe, expect, it } from "vitest";
import jsonata from "jsonata";

describe("jsonata 정규식 스캐너", () => {
  it("문자 클래스 안의 ) 뒤에서 패턴을 끝내지 않는다", async () => {
    const expression = jsonata("$match($, /[^)\\s]+/g)");
    const result = await expression.evaluate("a b)c") as Array<{ match: string }>;
    expect(result.map((item) => item.match)).toEqual(["a", "b", "c"]);
  });

  it("/gm의 g와 m 플래그를 읽는다", async () => {
    const expression = jsonata("$match($, /^a.*$/gm)");
    const result = await expression.evaluate("a\nb\na") as Array<{ match: string }>;
    expect(result.map((item) => item.match)).toEqual(["a", "a"]);
  });
});
