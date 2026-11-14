import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import type { AppDefinition } from "../contract/contract";
import { fillDefinitionDefaults } from "../core/app-defaults";
import { createFakeTransport } from "../core/fake-transport";
import { makeTestSeed } from "./fixtures";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function jsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function definitionFiles(): string[] {
  const fromEnvironment = (process.env.KALEIDOSCOPE_APP_DEFINITIONS ?? "")
    .split(path.delimiter)
    .filter((file) => file !== "")
    .map((file) => path.resolve(file));
  for (const file of fromEnvironment) {
    expect(existsSync(file), `KALEIDOSCOPE_APP_DEFINITIONS에 적힌 정의가 없습니다: ${file}`).toBe(true);
  }
  return [
    ...jsonFiles(path.join(repoRoot, "apps")),
    ...jsonFiles(path.join(repoRoot, "examples")),
    path.join(repoRoot, "tests", "fixtures", "fake-core-parity.json"),
    ...fromEnvironment,
  ].filter((file, index, files) => files.indexOf(file) === index);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/// 식 바인딩만 고른다. state·client·item 같은 바인딩은 jsonata로 컴파일하지 않는다.
function isExpressionBinding(value: unknown): value is { expr: string } {
  return isRecord(value) && Object.keys(value).length === 1 && typeof value.expr === "string";
}

function collectExpressions(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectExpressions);
  if (!isRecord(value)) return [];
  const own = isExpressionBinding(value) ? [value.expr] : [];
  return own.concat(Object.values(value).flatMap(collectExpressions));
}

/// `when` 블록의 식 값 자리. 가짜 코어가 이 자리를 계산해야 한다.
function whenExpressionSlots(value: unknown, pointer: string): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => whenExpressionSlots(item, `${pointer}/${index}`));
  if (!isRecord(value)) return [];
  const own = value.type === "when" && isExpressionBinding(value.value) ? [`${pointer}/value`] : [];
  return own.concat(Object.entries(value).flatMap(([key, child]) => whenExpressionSlots(child, `${pointer}/${key}`)));
}

interface ClientFields {
  outputs?: unknown;
  storage_entries?: unknown;
}

describe("가짜 코어가 읽는 앱 정의", () => {
  const files = definitionFiles();

  it.each(files)("%s", async (file) => {
    const definition = JSON.parse(readFileSync(file, "utf8")) as AppDefinition;
    const label = path.relative(repoRoot, file);

    for (const expression of collectExpressions(definition)) {
      expect(() => jsonata(expression), `${label}의 식이 UI jsonata로 컴파일되지 않습니다: ${expression}`).not.toThrow();
    }

    const filled = fillDefinitionDefaults(definition);
    const client = (filled as { client?: ClientFields }).client;
    if (client !== undefined) {
      // 코어가 serde 기본값으로 채우는 칸이다. 없으면 client 런타임이 storage_entries를 돌 수 없다.
      expect(Array.isArray(client.storage_entries), `${label}의 client.storage_entries`).toBe(true);
      expect(isRecord(client.outputs), `${label}의 client.outputs`).toBe(true);
      for (const entry of client.storage_entries as unknown[]) expect(entry).toBeDefined();
      expect(() => Object.entries(client.outputs as Record<string, unknown>)).not.toThrow();
    }

    if (label === path.join("tests", "fixtures", "fake-core-parity.json")) {
      const rawClient = (definition as { client?: ClientFields }).client;
      expect(rawClient?.outputs).toBeUndefined();
      expect(rawClient?.storage_entries).toBeUndefined();
    }

    const seed = makeTestSeed({ definitions: [filled] });
    const windowId = seed.snapshot.shared.windows[0].id;
    const transport = createFakeTransport(seed);
    try {
      await transport.call({ op: "data.attach", window_id: windowId });
      await transport.call({ op: "data.refresh", window_id: windowId, sources: [] });
      const view = (await transport.call({ op: "data.read", window_id: windowId })).view;
      for (const pointer of whenExpressionSlots(definition.ui, "/ui")) {
        const slot = view.values[pointer];
        expect(slot, `${label}: when 식 자리 ${pointer}가 계산되지 않았습니다`).toBeDefined();
        expect(slot?.status, `${label}: when 식 자리 ${pointer}가 준비 상태가 아닙니다`).toBe("ready");
      }
      if (label === path.join("tests", "fixtures", "fake-core-parity.json")) {
        expect(view.values["/ui/children/0/value"]).toEqual({ status: "ready", value: true });
      }
    } finally {
      await transport.call({ op: "data.detach", window_id: windowId });
    }
  });

  it("state.changed로 들어온 정의에도 기본값을 채운다", async () => {
    const definition = JSON.parse(readFileSync(path.join(repoRoot, "tests", "fixtures", "fake-core-parity.json"), "utf8")) as AppDefinition;
    const seed = makeTestSeed({ definitions: [definition] });
    const transport = createFakeTransport(seed);
    transport.emit({ event: "state.changed", snapshot: seed.snapshot });
    const { snapshot } = await transport.call({ op: "state.get" });
    const client = (snapshot.shared.app_versions[0].definition as { client?: ClientFields }).client;
    expect({ storage_entries: Array.isArray(client?.storage_entries), outputs: isRecord(client?.outputs) })
      .toEqual({ storage_entries: true, outputs: true });
  });
});
