import { createContext, useContext, type ReactNode } from "react";
import type { Binding } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";

/** repeat가 항목을 그린 자리. 동작을 실행하는 순간 같은 key의 항목을 현재 값에서 다시 찾는 데 쓴다. 정적 값이다. */
export interface RepeatLocator {
  pointer: string;
  items: Binding;
  keyField: string;
}

export interface ItemScope {
  item: JsonValue;
  parent_item?: JsonValue;
  key: string | number;
  index: number;
  instance: object;
  locator?: RepeatLocator;
  parentScope?: ItemScope;
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
