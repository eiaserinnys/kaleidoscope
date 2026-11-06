import type { Binding, BindingValue, DataView } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import * as shellErrors from "../contract/shell-errors";
import type { ItemScope } from "./item-scope";

/** 동작 하나가 시작될 때 코어에서 읽은 현재 상태와 계산값. 그 동작 안에서만 쓰고 화면 값 저장소에는 넣지 않는다. */
export interface ActionRead {
  state: Record<string, JsonValue>;
  view: DataView;
}

export type ActionBindingResolver = (pointer: string, binding: Binding, scope: ItemScope | null | undefined) => BindingValue;

/** scope나 그 조상 가운데 repeat 위치 정보가 있는 것이 있는가. */
export function hasRepeatLocator(scope: ItemScope | null | undefined): boolean {
  for (let current = scope; current; current = current.parentScope) if (current.locator) return true;
  return false;
}

/**
 * 렌더 때 만든 항목 범위를 현재 값으로 다시 만든다. 부모부터 풀고, repeat 항목은 같은 key로 현재 배열에서 다시 찾는다.
 * 항목 배열이 아직 준비되지 않았으면 렌더 때의 범위를 그대로 쓴다. 준비됐는데 key가 없으면 던진다.
 */
export function resolveActionScope(scope: ItemScope, resolve: ActionBindingResolver): ItemScope {
  const parent = scope.parentScope ? resolveActionScope(scope.parentScope, resolve) : undefined;
  const locator = scope.locator;
  if (!locator) {
    return parent === scope.parentScope ? scope : { ...scope, parent_item: parent?.item, parentScope: parent };
  }
  const items = resolve(`${locator.pointer}/items`, locator.items, parent);
  if (items.status !== "ready") return scope;
  const list = items.value === null || items.value === undefined ? [] : Array.isArray(items.value) ? items.value : [items.value];
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const key = (item as Record<string, JsonValue>)[locator.keyField];
    if (key !== scope.key || (typeof key !== "string" && typeof key !== "number")) continue;
    return { item, parent_item: parent?.item, key: scope.key, index, instance: scope.instance, locator, parentScope: parent };
  }
  throw { ...shellErrors.SHELL_ACTION_ITEM_REMOVED(), details: [`repeat: ${locator.pointer}`, `key: ${String(scope.key)}`] };
}
