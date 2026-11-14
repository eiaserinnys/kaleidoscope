// 가짜 코어가 앱 정의에 serde 기본값을 채운다.
//
// 표는 crates/contract/src/data.rs의 ui_tables 시험이 만든 definition-defaults.ts다.
// 손으로 목록을 만들지 않는다. 코어가 기본값을 더하거나 바꾸면 표를 다시 만들고,
// 대조 시험이 DEFINITION_DEFAULTS_RESULT와 어긋나는 곳을 잡는다.

import {
  DEFINITION_DEFAULT_DEFS,
  DEFINITION_DEFAULTS,
  type DefaultNode,
  type DefaultVariant,
} from "../contract/definition-defaults";
import type { JsonValue } from "../contract/serde_json/JsonValue";

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolve(node: DefaultNode): DefaultNode {
  let current = node;
  const seen = new Set<string>();
  while (current.ref !== undefined) {
    if (seen.has(current.ref)) break;
    seen.add(current.ref);
    const next: DefaultNode | undefined = DEFINITION_DEFAULT_DEFS[current.ref];
    if (next === undefined) break;
    current = next;
  }
  return current;
}

function matchesShape(node: DefaultNode, value: JsonValue): boolean {
  const target = resolve(node);
  if (Array.isArray(value)) return target.items !== undefined;
  if (isRecord(value)) return target.properties !== undefined || target.values !== undefined;
  return false;
}

function pickVariant(variants: DefaultVariant[], value: JsonValue): DefaultVariant | undefined {
  for (const variant of variants) {
    if (variant.key === undefined) continue;
    if (isRecord(value) && value[variant.key] === variant.const) return variant;
  }
  for (const variant of variants) {
    if (variant.key !== undefined) continue;
    if (matchesShape(variant.node, value)) return variant;
  }
  return undefined;
}

function fillNode(node: DefaultNode, value: JsonValue | undefined): JsonValue | undefined {
  let current = value;
  if (current === undefined && node.default !== undefined) {
    current = JSON.parse(JSON.stringify(node.default)) as JsonValue;
  }
  const target = resolve(node);
  if (target.variants !== undefined) {
    if (current === undefined) return current;
    const variant = pickVariant(target.variants, current);
    return variant === undefined ? current : fillNode(variant.node, current);
  }
  if (target.option !== undefined) {
    if (current === undefined || current === null) return current;
    return fillNode(target.option, current);
  }
  if (target.properties !== undefined && isRecord(current)) {
    const filled: Record<string, JsonValue> = { ...current };
    for (const [key, child] of Object.entries(target.properties)) {
      const next = fillNode(child, filled[key]);
      if (next !== undefined) filled[key] = next;
    }
    current = filled;
  }
  if (target.items !== undefined && Array.isArray(current)) {
    const items = target.items;
    current = current.map((item) => fillNode(items, item) ?? null);
  }
  if (target.values !== undefined && isRecord(current)) {
    const values = target.values;
    const filled: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(current)) {
      filled[key] = fillNode(values, item) ?? null;
    }
    current = filled;
  }
  return current;
}

/**
 * 앱 정의에 코어의 serde 기본값을 채운 새 값을 돌려준다. 들어온 값은 바꾸지 않는다.
 *
 * 정의에 없는 칸은 만들지 않는다. 필수 칸이 빠진 정의는 코어가 거부하는 그대로 둔다.
 */
export function fillDefinitionDefaults<T>(definition: T): T {
  return fillNode(DEFINITION_DEFAULTS, definition as unknown as JsonValue) as unknown as T;
}
