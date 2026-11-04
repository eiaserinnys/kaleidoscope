import type { JsonValue } from "../contract/serde_json/JsonValue";

export type ControlOption = { label: string; value: JsonValue; disabled?: boolean };
const options = new WeakMap<Element, ControlOption[]>();
export function registerSelectOptions(element: Element, entries: ControlOption[]): () => void {
  options.set(element, entries);
  return () => { if (options.get(element) === entries) options.delete(element); };
}
export function selectOptions(element: Element): ControlOption[] | undefined {
  return options.get(element) ?? options.get(element.closest(".ks-data-segmented") ?? element);
}
