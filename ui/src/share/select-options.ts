import type { JsonValue } from "../contract/serde_json/JsonValue";

export type ControlOption = { label: string; value: JsonValue; disabled?: boolean };
type RegisteredOptions = { entries: ControlOption[]; onSelect?: (index: number) => void };
const options = new WeakMap<Element, RegisteredOptions>();
export function registerSelectOptions(element: Element, entries: ControlOption[], onSelect?: (index: number) => void): () => void {
  const record = { entries, onSelect };
  options.set(element, record);
  return () => { if (options.get(element) === record) options.delete(element); };
}
export function selectOptions(element: Element): ControlOption[] | undefined {
  return (options.get(element) ?? options.get(element.closest(".ks-data-segmented") ?? element))?.entries;
}
export function selectRegisteredOption(element: Element, index: number): boolean {
  const callback = options.get(element)?.onSelect;
  if (!callback) return false;
  callback(index);
  return true;
}
