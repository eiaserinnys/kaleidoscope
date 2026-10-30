import { useCallback, useState } from "react";
import type { SelectOption } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { ChevronDown, Plus } from "./icons";
import { Menu } from "./menu";
import { Button } from "./primitives";

export const optionValue = (option: SelectOption): JsonValue => typeof option === "string" ? option : option.value;
export const optionLabel = (option: SelectOption) => typeof option === "string" ? option : option.label;
export const equalOption = (a: JsonValue | undefined, b: JsonValue) => JSON.stringify(a) === JSON.stringify(b);

export function Select({ items, value, onChange, placeholder = "", segmented = false, label, invalid, describedBy, add = false }: { items: SelectOption[]; value: JsonValue | undefined; onChange: (value: JsonValue) => void; placeholder?: string; segmented?: boolean; label?: string; invalid?: boolean; describedBy?: string; add?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const selected = items.find((item) => equalOption(value, optionValue(item)));
  if (segmented) return <div className="ks-data-segmented">{items.map((item, index) => <Button key={index} aria-pressed={equalOption(value, optionValue(item))} onClick={() => onChange(optionValue(item))}>{optionLabel(item)}</Button>)}</div>;
  return <><Button aria-label={label} aria-invalid={invalid} aria-describedby={describedBy} disabled={add && items.length === 0} onClick={(event) => setAnchor(event.currentTarget)}>{selected ? optionLabel(selected) : placeholder}{add ? <Plus size="inline" /> : <ChevronDown size="inline" />}</Button>{anchor ? <Menu anchor={anchor} onClose={close} items={items.map((item, index) => ({ id: String(index), label: optionLabel(item), checked: equalOption(value, optionValue(item)), onSelect: () => { onChange(optionValue(item)); anchor.focus(); } }))} /> : null}</>;
}

export function Toggle({ checked, onChange, label, labelledBy, invalid, describedBy }: { checked: boolean; onChange: (value: boolean) => void; label?: string; labelledBy?: string; invalid?: boolean; describedBy?: string }) {
  return <button className="ks-data-toggle" type="button" role="switch" aria-checked={checked} aria-labelledby={labelledBy} aria-invalid={invalid} aria-describedby={describedBy} onClick={() => onChange(!checked)}><span className="ks-data-toggle-track"><span className="ks-data-toggle-thumb" /></span>{label ? <span>{label}</span> : null}</button>;
}
