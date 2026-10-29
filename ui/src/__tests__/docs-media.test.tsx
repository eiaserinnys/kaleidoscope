import { describe, expect, it } from "vitest";
import { codeLanguageForPath, codeViewText } from "../blocks/code-language";
import { imageRequestSize } from "../blocks/data-image";
import { formatMediaTime } from "../blocks/data-media";

describe("문서와 미디어 계약", () => {
  it("계약의 모든 확장자와 명시 언어를 고른다", () => {
    const cases: Record<string, string> = { json: "json", yaml: "yaml", yml: "yaml", toml: "toml", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", rs: "rust", css: "css", html: "html", htm: "html", sql: "sql", sh: "shell", bash: "shell", zsh: "shell", ps1: "shell", xml: "xml", svg: "xml", md: "markdown", markdown: "markdown", txt: "plain" };
    for (const [ext, expected] of Object.entries(cases)) expect(codeLanguageForPath(`a.${ext.toUpperCase()}`)).toBe(expected);
    expect(codeLanguageForPath("a.json", "plain")).toBe("plain");
  });
  it("보기 값은 문자열이나 읽기 좋은 JSON으로 만든다", () => {
    expect(codeViewText("abc")).toBe("abc");
    expect(codeViewText({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
  it("픽셀 비율과 확대를 반영해 캐시 크기를 고른다", () => {
    expect(imageRequestSize(300, 200, 2, 1)).toBe(1024);
    expect(imageRequestSize(300, 200, 2, 3)).toBe(2048);
    expect(imageRequestSize(3000, 2000, 2, 8)).toBe(4096);
  });
  it("재생 시간을 표시한다", () => {
    expect(formatMediaTime(42)).toBe("0:42");
    expect(formatMediaTime(111)).toBe("1:51");
  });
});
