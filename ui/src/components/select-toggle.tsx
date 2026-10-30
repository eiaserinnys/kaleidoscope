import { useCallback, useState } from "react";
import type { SelectOption } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { ChevronDown, Plus } from "./icons";
import { Menu } from "./menu";
import { Button } from "./primitives";

export const optionValue = (option: SelectOption): JsonValue => typeof option === "string" ? option : option.value;
export const optionLabel = (option: SelectOption) => typeof option === "string" ? option : option.label;
export const equalOption = (a: JsonValue | undefined, b: JsonValue) => JSON.stringify(a) === JSON.stringify(b);

export interface SelectChoice {
  value: JsonValue;
  label: string;
  disabled?: boolean;
  description?: string;
}

export interface SelectGroup {
  name?: string;
  options: SelectChoice[];
}

type SelectBaseProps = {
  value: JsonValue | undefined;
  onChange: (value: JsonValue) => void;
  placeholder?: string;
  segmented?: boolean;
  label?: string;
  invalid?: boolean;
  describedBy?: string;
  add?: boolean;
  disabled?: boolean;
};

type SelectProps = SelectBaseProps & (
  | { items: SelectOption[]; groups?: never }
  | { groups: SelectGroup[]; items?: never }
);

export function Select({ items, groups, value, onChange, placeholder = "", segmented = false, label, invalid, describedBy, add = false, disabled = false }: SelectProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const choices = groups ? groups.flatMap((group) => group.options) : items ?? [];
  const selected = groups
    ? groups.flatMap((group) => group.options).find((item) => equalOption(value, item.value))
    : (items ?? []).find((item) => equalOption(value, optionValue(item)));
  const selectedGroup = groups?.find((group) => group.options.some((item) => equalOption(value, item.value)));
  const menuItems = groups
    ? groups.flatMap((group, groupIndex) => [
        ...(group.name ? [{ type: "heading" as const, id: `group-${groupIndex}`, label: group.name }] : []),
        ...group.options.map((item, index) => ({
          id: `group-${groupIndex}-item-${index}`,
          label: item.label,
          disabled: item.disabled,
          description: item.description,
          checked: equalOption(value, item.value),
          onSelect: () => { onChange(item.value); anchor?.focus(); },
        })),
      ])
    : (items ?? []).map((item, index) => ({
        id: String(index),
        label: optionLabel(item),
        checked: equalOption(value, optionValue(item)),
        onSelect: () => { onChange(optionValue(item)); anchor?.focus(); },
      }));
  if (segmented) return <div className="ks-data-segmented">{(items ?? []).map((item, index) => <Button key={index} disabled={disabled} aria-pressed={equalOption(value, optionValue(item))} onClick={() => onChange(optionValue(item))}>{optionLabel(item)}</Button>)}</div>;
  return <><Button aria-label={label} aria-invalid={invalid} aria-describedby={describedBy} disabled={disabled || (add && choices.length === 0)} onClick={(event) => setAnchor(event.currentTarget)}>{selected ? groups ? <><span className="ks-select-choice-label">{(selected as SelectChoice).label}</span>{selectedGroup?.name ? <span className="ks-select-group-label">{selectedGroup.name}</span> : null}</> : optionLabel(selected as SelectOption) : placeholder}{add ? <Plus size="inline" /> : <ChevronDown size="inline" />}</Button>{anchor ? <Menu anchor={anchor} onClose={close} items={menuItems} /> : null}</>;
}

export function Toggle({ checked, onChange, label, labelledBy, invalid, describedBy }: { checked: boolean; onChange: (value: boolean) => void; label?: string; labelledBy?: string; invalid?: boolean; describedBy?: string }) {
  return <button className="ks-data-toggle" type="button" role="switch" aria-checked={checked} aria-labelledby={labelledBy} aria-invalid={invalid} aria-describedby={describedBy} onClick={() => onChange(!checked)}><span className="ks-data-toggle-track"><span className="ks-data-toggle-thumb" /></span>{label ? <span>{label}</span> : null}</button>;
}
