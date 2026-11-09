import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { SelectOption } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { ChevronDown, Plus } from "./icons";
import { Menu } from "./menu";
import { Button } from "./primitives";
import { registerSelectOptions } from "../share/select-options";
import { ownerOf } from "../share/overlay-owner";
import { preserveWindowActionFocus } from "../share/action-context";

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
  rootProps?: import("../comments/block-root").BlockRootProps;
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

export function Select({ items, groups, value, onChange, placeholder = "", segmented = false, label, invalid, describedBy, add = false, disabled = false, className, prefix, suffix, rootProps }: SelectProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const control = useRef<HTMLButtonElement | HTMLDivElement>(null);
  const close = useCallback(() => setAnchor(null), []);
  const choices = groups ? groups.flatMap((group) => group.options) : items ?? [];
  useLayoutEffect(() => {
    if (!control.current) return;
    return registerSelectOptions(control.current, choices.map((item) => typeof item === "string" ? { label: item, value: item } : item));
  });
  const restore = () => { const owner = anchor && ownerOf(anchor); if (!owner || !preserveWindowActionFocus(owner)) anchor?.focus(); };
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
          onSelect: () => { onChange(item.value); restore(); },
        })),
      ])
    : (items ?? []).map((item, index) => ({
        id: String(index),
        label: optionLabel(item),
        description: typeof item === "string" ? undefined : item.description,
        checked: equalOption(value, optionValue(item)),
        onSelect: () => { onChange(optionValue(item)); restore(); },
      }));
  if (segmented) return <div {...rootProps} ref={control as React.RefObject<HTMLDivElement>} role="group" aria-label={label} aria-describedby={describedBy} className={`ks-data-segmented${className ? ` ${className}` : ""}`}>{(items ?? []).map((item, index) => <Button key={index} disabled={disabled} aria-pressed={equalOption(value, optionValue(item))} onClick={() => onChange(optionValue(item))}><span className="ks-truncate-label">{optionLabel(item)}</span></Button>)}</div>;
  return <><Button rootProps={rootProps} ref={control as React.RefObject<HTMLButtonElement>} className={`ks-select-button${className ? ` ${className}` : ""}`} aria-label={label} aria-invalid={invalid} aria-describedby={describedBy} disabled={disabled || choices.length === 0} onClick={(event) => setAnchor(event.currentTarget)}>{prefix}{selected ? <span className="ks-select-choice-label">{groups ? (selected as SelectChoice).label : optionLabel(selected as SelectOption)}</span> : <span className="ks-select-choice-label">{placeholder}</span>}{selected && groups && selectedGroup?.name ? <span className="ks-select-group-label">{selectedGroup.name}</span> : null}{suffix ? <span className="ks-select-group-label">{suffix}</span> : null}{add ? <Plus size="inline" /> : <ChevronDown size="inline" />}</Button>{anchor && menuItems.length > 0 ? <Menu anchor={anchor} onClose={close} items={menuItems} /> : null}</>;
}

export function Toggle({ checked, onChange, label, labelVisible = Boolean(label), labelledBy, invalid, describedBy, disabled = false, rootProps }: { checked: boolean; onChange: (value: boolean) => void; label?: string; labelVisible?: boolean; labelledBy?: string; invalid?: boolean; describedBy?: string; disabled?: boolean; rootProps?: import("../comments/block-root").BlockRootProps }) {
  return <button {...rootProps} className="ks-data-toggle" type="button" role="switch" aria-checked={checked} aria-labelledby={labelledBy} aria-invalid={invalid} aria-describedby={describedBy} disabled={disabled} onClick={() => onChange(!checked)}><span className="ks-data-toggle-track"><span className="ks-data-toggle-thumb" /></span>{labelVisible ? <span>{label}</span> : null}</button>;
}
