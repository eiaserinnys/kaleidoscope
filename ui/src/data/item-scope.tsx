import { createContext, useContext, type ReactNode } from "react";
import type { JsonValue } from "../contract/serde_json/JsonValue";

export interface ItemScope {
  item: JsonValue;
  parent_item?: JsonValue;
  key: string | number;
  index: number;
  instance: object;
}

const Context = createContext<ItemScope | null>(null);
export const useItemScope = () => useContext(Context);
export function ItemScopeProvider({ value, children }: { value: ItemScope; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function itemPath(value: JsonValue | undefined, path: string): JsonValue {
  let result: JsonValue | undefined = value;
  for (const part of path.split(".")) {
    if (result === null || typeof result !== "object") return null;
    result = (result as Record<string, JsonValue>)[part];
  }
  return result ?? null;
}
