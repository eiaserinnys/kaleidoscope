import type { JsonValue } from "../contract/serde_json/JsonValue";

/** JSON preserves the type of a key, including nested path components. */
export function encodeCommentKey(value: JsonValue): string { return JSON.stringify(value); }
export function decodeCommentKey(value: string): JsonValue | undefined {
  try { return JSON.parse(value) as JsonValue; } catch { return undefined; }
}
