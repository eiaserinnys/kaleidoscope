import { useMemo, type InputHTMLAttributes, type RefObject } from "react";
import { createDateTimeFormat, timeOptions } from "../blocks/input-date-time";
import { normalizeInputOptions } from "../blocks/input-options";
import { Combobox } from "./combobox";

type Props = { inputProps: InputHTMLAttributes<HTMLInputElement>; inputRef: RefObject<HTMLInputElement | null>; value: string | null; min: string | null; max: string | null; step: number; locale: string; visible: boolean; onChoose: (value: string) => void; onCommit: () => boolean; onEditingEnd: () => void };
export function TimePicker({ value, min, max, step, locale, ...props }: Props) {
  const options = useMemo(() => {
    const formatter = createDateTimeFormat(locale);
    const normalized = normalizeInputOptions(timeOptions(step, min, max).map((value) => ({ value, label: formatter.formatTime(value) })));
    return normalized.ok ? normalized.options : [];
  }, [locale, min, max, step]);
  return <Combobox {...props} options={options} ready selectedValue={value} hideValue />;
}
