import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

function violations(path: string, source: string): string[] {
  return source.split("\n").flatMap((line, index) => {
    if (!/\bnew\s+Error\s*\(/.test(line)) return [];
    if (path === "ui/src/blocks/sandbox-frame.ts" &&
        line.trim() === "const fail = (error) => Object.assign(new Error(error.message), { id: error.id, code: error.code });") return [];
    return [`${path}:${index + 1}`];
  });
}

function scan(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__" || entry.name.includes("fake")) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return scan(path);
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
  });
});
