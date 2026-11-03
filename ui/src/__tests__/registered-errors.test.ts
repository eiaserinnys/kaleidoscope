import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const fakeFiles = new Set(["ui/src/core/fake-data.ts", "ui/src/core/fake-transport.ts"].map((path) => resolve(root, path)));

function violations(path: string, source: string): string[] {
  path = path.replaceAll("\\", "/");
  const results = source.split("\n").flatMap((line, index) => {
    if (!/\bnew\s+Error\s*\(/.test(line)) return [];
    if (path === "ui/src/blocks/sandbox-frame.ts" &&
        line.trim() === "const fail = (error) => Object.assign(new Error(error.message), { id: error.id, code: error.code });") return [];
    return [`${path}:${index + 1}`];
  });
  const unregistered = /\{\s*code\s*:\s*["'][^"']+["']\s*,\s*message\s*:/g;
  for (const match of source.matchAll(unregistered)) {
    const line = source.slice(0, match.index).split("\n").length;
    results.push(`${path}:${line}`);
  }
  return results;
}

function scan(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__") return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return scan(path);
    if (fakeFiles.has(path)) return [];
    if (!/\.[jt]sx?$/.test(entry.name) || /\.(test|spec)\.[jt]sx?$/.test(entry.name)) return [];
    return violations(relative(root, path), readFileSync(path, "utf8"));
  });
}

describe("등록된 오류", () => {
  it("제품 코드에서 일반 Error 생성을 막는다", () => {
    expect([...scan(join(root, "ui/src")), ...scan(join(root, "app/src"))],
      "일반 Error를 오류 등록부의 코드로 옮기세요").toEqual([]);
  });

  it("등록되지 않은 Error를 찾아낸다", () => {
    expect(violations("ui/src/example.ts", 'throw new Error("x")')).toEqual(["ui/src/example.ts:1"]);
    expect(violations("ui\\src\\blocks\\sandbox-frame.ts", "const fail = (error) => Object.assign(new Error(error.message), { id: error.id, code: error.code });"))
      .toEqual([]);
    expect(violations("ui\\src\\fake-feature.ts", 'throw new Error("x")')).toEqual(["ui/src/fake-feature.ts:1"]);
  });

  it("코드가 없는 오류 객체도 찾아낸다", () => {
    expect(violations("ui/src/example.ts", 'throw { code: "io", message: "실패", details: [] }')).toEqual(["ui/src/example.ts:1"]);
    expect(violations("ui/src/example.ts", 'setNotice({\n code: "io", message: "실패", details: [] })')).toEqual(["ui/src/example.ts:1"]);
    expect(violations("ui/src/example.ts", 'throw { id: "SHELL_X", code: "io", message: "실패", details: [] }')).toEqual([]);
  });

  it("fake가 포함된 다른 파일과 폴더도 검사한다", () => {
    const dir = mkdtempSync(join(tmpdir(), "registered-errors-"));
    try {
      writeFileSync(join(dir, "fake-component.ts"), 'throw new Error("x")');
      mkdirSync(join(dir, "fake-folder"));
      writeFileSync(join(dir, "fake-folder", "feature.ts"), 'throw new Error("x")');
      expect(scan(dir)).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
