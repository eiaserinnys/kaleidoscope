import { useCallback, useState, type ReactNode } from "react";
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
  className?: string;
  prefix?: ReactNode;
  suffix?: string;
};

type SelectProps = SelectBaseProps & (
  | { items: SelectOption[]; groups?: never }
  | { groups: SelectGroup[]; items?: never }
);

export function Select({ items, groups, value, onChange, placeholder = "", segmented = false, label, invalid, describedBy, add = false, disabled = false, className, prefix, suffix }: SelectProps) {
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
  if (segmented) return <div role="group" aria-label={label} className={`ks-data-segmented${className ? ` ${className}` : ""}`}>{(items ?? []).map((item, index) => <Button key={index} disabled={disabled} aria-pressed={equalOption(value, optionValue(item))} onClick={() => onChange(optionValue(item))}>{optionLabel(item)}</Button>)}</div>;
  return <><Button className={`ks-select-button${className ? ` ${className}` : ""}`} aria-label={label} aria-invalid={invalid} aria-describedby={describedBy} disabled={disabled || choices.length === 0} onClick={(event) => setAnchor(event.currentTarget)}>{prefix}{selected ? <span className="ks-select-choice-label">{groups ? (selected as SelectChoice).label : optionLabel(selected as SelectOption)}</span> : <span className="ks-select-choice-label">{placeholder}</span>}{selected && groups && selectedGroup?.name ? <span className="ks-select-group-label">{selectedGroup.name}</span> : null}{suffix ? <span className="ks-select-group-label">{suffix}</span> : null}{add ? <Plus size="inline" /> : <ChevronDown size="inline" />}</Button>{anchor && menuItems.length > 0 ? <Menu anchor={anchor} onClose={close} items={menuItems} /> : null}</>;
}

export function Toggle({ checked, onChange, label, labelVisible = Boolean(label), labelledBy, invalid, describedBy, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label?: string; labelVisible?: boolean; labelledBy?: string; invalid?: boolean; describedBy?: string; disabled?: boolean }) {
  return <button className="ks-data-toggle" type="button" role="switch" aria-checked={checked} aria-labelledby={labelledBy} aria-invalid={invalid} aria-describedby={describedBy} disabled={disabled} onClick={() => onChange(!checked)}><span className="ks-data-toggle-track"><span className="ks-data-toggle-thumb" /></span>{labelVisible ? <span>{label}</span> : null}</button>;
}
