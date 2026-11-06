import { useBlockRootProps } from "../comments/block-root";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type KeyboardEvent } from "react";
import type { Block } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import type { BlockContext } from "./block-context";
import { useBinding, useWindowData } from "../data/window-data";
import { useLocalDraft } from "../data/use-local-draft";
import { BindingFailureNotice, DataState } from "../components/data-state";
import { Combobox } from "../components/combobox";
import { DatePicker } from "../components/date-picker";
import { TimePicker } from "../components/time-picker";
import { Notice } from "../components/primitives";
import { DataIcon } from "../components/data-icons";
import { IconButton } from "../components/primitives";
import { SpinButtons, steppedNumber } from "../components/number-input";
import { X } from "../components/icons";
import { display, isMultilineInput } from "./data-layout";
import { isWindowTop, useWindowStateValue, useWindowVisible } from "../data/window-state";
import { inputDraft, decimalDigits, useInputDraft } from "./input-draft";
import { inputOptionsError, normalizeInputOptions } from "./input-options";
import * as shellErrors from "../contract/shell-errors";
import { createDateTimeFormat, parseISODate, parseISOTime } from "./input-date-time";
interface Props<T extends Block["type"]> { block: Extract<Block, { type: T }>; context: BlockContext; pointer: string }
const uninitializedFocus = Symbol("uninitialized focus");
const fieldPosition = (position: "inline" | "top" | "hidden" | undefined) => position && position !== "inline" ? ` is-label-${position}` : "";
function bindingText(value: ReturnType<typeof useBinding>): string {
  return value.status === "ready" && value.value !== null && value.value !== undefined ? display(value.value) : "";
}

function fitTextarea(element: HTMLTextAreaElement) {
  if (getComputedStyle(element).getPropertyValue("--ks-textarea-fill").trim() === "100%") {
    element.style.height = "";
    return;
  }
  if (element.clientWidth === 0) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
}

export function InputBlock({ block, context, pointer }: Props<"input">) {
  const blockRoot = useBlockRootProps();
  const data = useWindowData();
  const multiline = block.kind !== "number" && isMultilineInput(block);
  const inputId = useId();
  const dateTime = block.kind === "date" || block.kind === "time";
  const localeState = useWindowStateValue(context, dateTime ? context.definition.locale?.state ?? null : null);
  const locale = typeof localeState === "string" ? localeState : undefined;
  const formatter = useMemo(() => createDateTimeFormat(locale), [locale]);
  const editFormatter = useRef(formatter);
  const bound = useBinding(`${pointer}/value`, block.value);
  const optionsBinding = useBinding(`${pointer}/options`, block.options ?? null);
  const optionsValue = optionsBinding.status === "ready" ? optionsBinding.value : undefined;
  const normalizedOptions = useMemo(() => optionsBinding.status === "ready" ? normalizeInputOptions(optionsValue) : null, [optionsBinding.status, optionsValue]);
  const optionValues = useMemo(() => normalizedOptions?.ok ? normalizedOptions.options.map((option) => option.value) : null, [normalizedOptions]);
  const optionsOnly = block.options_only === true && block.options !== undefined;
  const readOnlyBinding = useBinding(`${pointer}/read_only`, block.read_only ?? null);
  const readOnly = readOnlyBinding.status === "ready" && readOnlyBinding.value === true;
  const label = useBinding(`${pointer}/label`, block.label ?? null);
  const placeholder = useBinding(`${pointer}/placeholder`, block.placeholder ?? null);
  const hasLabel = block.label != null;
  const labelText = hasLabel ? bindingText(label) : "";
  const current = bound.status === "ready" ? bound.value : null;
  const minBinding = useBinding(`${pointer}/min`, block.min ?? null);
  const maxBinding = useBinding(`${pointer}/max`, block.max ?? null);
  const stepBinding = useBinding(`${pointer}/step`, block.step ?? null);
  const minimum = numericBinding(minBinding);
  const maximum = numericBinding(maxBinding);
  const step = numericBinding(stepBinding);
  const minValue = minBinding.status === "ready" ? minBinding.value : null;
  const maxValue = maxBinding.status === "ready" ? maxBinding.value : null;
  const stepValue = stepBinding.status === "ready" ? stepBinding.value : null;
  const isDate = block.kind === "date";
  const parseBound = isDate ? parseISODate : parseISOTime;
  const dateTimeValue = dateTime && typeof current === "string" ? parseBound(current) : null;
  const minDateTime = typeof minValue === "string" ? parseBound(minValue) : null;
  const maxDateTime = typeof maxValue === "string" ? parseBound(maxValue) : null;
  const codec = useMemo(() => dateTime ? {
    parse: (value: string) => {
      const parsed = isDate ? editFormatter.current.parseDate(value) : editFormatter.current.parseTime(value);
      if (parsed.valid && parsed.value !== null && ((minDateTime && parsed.value < minDateTime) || (maxDateTime && parsed.value > maxDateTime))) return { valid: false } as const;
      return parsed;
    },
    format: (value: string | null) => isDate ? formatter.formatDate(value) : formatter.formatTime(value),
  } : undefined, [dateTime, isDate, formatter, minDateTime, maxDateTime]);
  const focus = useBinding(`${pointer}/focus`, block.focus ?? null);
  const initialDraft = codec ? codec.format(dateTimeValue) : inputDraft(current, block.kind, block.format);
  const toEventValue = useCallback((value: string): JsonValue => {
    if (codec) { const canonical = isDate ? parseISODate(value) : parseISOTime(value); if (canonical) return canonical; const parsed = codec.parse(value); return parsed.valid ? parsed.value : null; }
    if (block.kind !== "number") return value;
    if (value.trim() === "" || !Number.isFinite(Number(value))) return null;
    let number = Number(value);
    if (minimum !== null) number = Math.max(minimum, number);
    if (maximum !== null) number = Math.min(maximum, number);
    if (block.format?.kind === "decimal") number = Number(number.toFixed(decimalDigits(block.format.digits)));
    return number;
  }, [block.kind, block.format, minimum, maximum, codec, isDate]);
  const prepare = useRef<() => void>(() => {});
  const { draft, change, finish, holding, send, mark, adopt } = useLocalDraft<string>(initialDraft, pointer, { sendOnChange: false, resetOnFailure: false, syncOnSuccess: true, toJson: toEventValue, prepare });
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  useLayoutEffect(() => { if (!focused) editFormatter.current = formatter; }, [focused, formatter]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unregisterFlush = useRef<(() => void) | null>(null);
  const timerValue = useRef("");
  const inputElement = useRef<HTMLInputElement | null>(null);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const composing = useRef(false);
  const tabKey = useRef(false);
  const edited = useRef(false);
  const spinPending = useRef(false);
  const spinning = useRef(false);
  const afterSpin = useRef<() => void>(() => {});
  const spinButtons = useRef<{ end: () => boolean }>(null);
  const sendDraftRef = useRef<(value: string) => Promise<void>>(async () => {});
  const previousFocus = useRef<JsonValue | typeof uninitializedFocus>(uninitializedFocus);
  useEffect(() => () => {
    unregisterFlush.current?.();
    if (spinPending.current && edited.current) {
      if (!timer.current) timer.current = setTimeout(() => { void sendDraftRef.current(timerValue.current); }, 300);
    } else if (timer.current) clearTimeout(timer.current);
  }, []);
  useLayoutEffect(() => {
    if (!readOnly) {
      if (focused) holding.current = true;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    unregisterFlush.current?.(); unregisterFlush.current = null;
    edited.current = false;
    spinPending.current = false;
    change(initialDraft);
    finish();
  }, [readOnly]);
  useEffect(() => {
    if (focus.status !== "ready") return;
    if (previousFocus.current === uninitializedFocus) {
      previousFocus.current = focus.value;
      if (focus.value === false || focus.value === null || !isWindowTop(data.store.getSnapshot(), data.windowId)) return;
      const target = inputElement.current ?? textarea.current;
      const active = document.activeElement;
      if (active !== target && active instanceof HTMLElement && active.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      target?.focus();
      target?.select();
      return;
    }
    if (Object.is(previousFocus.current, focus.value)) return;
    previousFocus.current = focus.value;
    if (focus.value === false || focus.value === null) return;
    if (!isWindowTop(data.store.getSnapshot(), data.windowId)) return;
    const target = inputElement.current ?? textarea.current;
    target?.focus();
    target?.select();
  }, [data, focus]);
  useLayoutEffect(() => {
    if (!textarea.current || (block.rows ?? 0) >= 2) return;
    fitTextarea(textarea.current);
  }, [draft, block.rows, multiline]);
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element || (block.rows ?? 0) >= 2) return;
    let width = 0;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0].contentRect.width;
      if (nextWidth === width) return;
      width = nextWidth;
      if (width > 0) fitTextarea(element);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [block.rows, multiline]);
  const { sendDraft, markChanged, commit, cancel, endSpin, choose, canSyncExternal } = useInputDraft({ block, pointer, data, readOnly, initialDraft, toEventValue, change, finish, send, prepare, timer, timerValue, unregisterFlush, inputElement, textarea, edited, spinPending, afterSpin, composing, optionsOnly, optionValues, codec });
  sendDraftRef.current = sendDraft;
  afterSpin.current = () => { if (!spinning.current && !focusedRef.current && !edited.current) finish(false); };
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const normalizeNumberDraft = () => {
    if (block.kind !== "number" || readOnly) return;
    const normalized = toEventValue(latestDraft.current);
    if (typeof normalized === "number") {
      const next = inputDraft(normalized, block.kind, block.format);
      if (next !== latestDraft.current) { latestDraft.current = next; change(next); }
    }
  };
  const setNumber = (number: number, held = false) => {
    const normalized = toEventValue(String(number));
    if (typeof normalized !== "number") return false;
    const next = inputDraft(normalized, block.kind, block.format);
    if (latestDraft.current === next) return false;
    holding.current = true;
    latestDraft.current = next;
    markChanged(next, held ? "hold" : "debounce");
    return true;
  };
  const increment = (direction: 1 | -1, multiplier = 1, held = false) => {
    if (readOnly) return false;
    if (held) { spinning.current = true; holding.current = true; }
    const normalized = toEventValue(latestDraft.current);
    const currentNumber = typeof normalized === "number" ? normalized : 0;
    const changed = setNumber(steppedNumber(currentNumber, step ?? 1, direction * multiplier), held);
    const next = Number(latestDraft.current);
    return changed && (direction === 1 ? maximum === null || next < maximum : minimum === null || next > minimum);
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (readOnly) return;
    if (event.key === "Escape" && !event.nativeEvent.isComposing && !composing.current && block.on_cancel && (focused || edited.current)) {
      event.preventDefault();
      cancel();
      return;
    }
    if (block.kind === "number" && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
      if ((event.key === "Home" && minimum === null) || (event.key === "End" && maximum === null)) return;
      event.preventDefault();
      if (event.key === "Home") setNumber(minimum!);
      else if (event.key === "End") setNumber(maximum!);
      else increment(event.key === "ArrowUp" || event.key === "PageUp" ? 1 : -1, event.key.startsWith("Page") ? 10 : 1);
      return;
    }
    if (event.key !== "Enter" || event.nativeEvent.isComposing || composing.current || (multiline && !event.ctrlKey)) return;
    normalizeNumberDraft();
    if (dateTime || block.commit === "submit" || block.on_submit) { event.preventDefault(); if (!commit(draft)) return; }
    if (block.on_submit) {
      const submitted = mark();
      void data.act(`${pointer}/on_submit`, toEventValue(draft)).then((success) => { if (success) adopt(submitted); });
    }
  };
  const props = { id: inputId, className: "ks-text-input", "aria-label": block.label_position === "hidden" ? labelText : undefined, placeholder: block.placeholder === undefined ? undefined : bindingText(placeholder), value: readOnly ? initialDraft : draft, readOnly, "aria-readonly": readOnly,
    onFocus: () => { setFocused(true); focusedRef.current = true; editFormatter.current = formatter; holding.current = !readOnly; }, onBlur: () => {
      setFocused(false);
      focusedRef.current = false;
      normalizeNumberDraft();
      if (spinButtons.current?.end()) return;
      if (spinPending.current && edited.current) { endSpin(); return; }
      if (dateTime && block.commit === "submit") prepare.current();
      else if (dateTime || optionsOnly || (block.commit ?? "debounce") !== "submit") commit(draft);
      finish(dateTime || block.options !== undefined ? canSyncExternal() : !edited.current);
    },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { latestDraft.current = event.currentTarget.value; markChanged(event.currentTarget.value); }, onKeyDown: keyDown,
    onKeyDownCapture: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => { if (dateTime && !isDate) tabKey.current = event.key === "Tab"; },
    onCompositionStart: () => { composing.current = true; if (block.options !== undefined || dateTime) { if (timer.current) clearTimeout(timer.current); timer.current = null; unregisterFlush.current?.(); unregisterFlush.current = null; } },
    onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => { composing.current = false; if ((block.options !== undefined || dateTime) && edited.current) markChanged(event.currentTarget.value); },
  };
  const numericValue = block.kind === "number" && draft.trim() !== "" && Number.isFinite(Number(draft)) ? Number(draft) : undefined;
  const input = <div {...(!hasLabel ? blockRoot : {})} className={`ks-data-input${dateTime && isDate ? " has-date-time" : ""}${block.kind === "search" ? " is-search" : ""}${block.kind === "number" ? " is-number" : ""}${block.spin ? " has-spin" : ""}${(block.rows ?? 0) >= 2 ? " has-rows" : ""}${block.columns !== undefined ? " has-columns" : ""}`}
    style={{ ...(block.columns !== undefined ? { "--ks-input-columns": `${block.columns}ch` } : {}), "--ks-input-rows": block.rows ?? 1 } as CSSProperties}>
    {block.kind === "search" ? <span className="ks-data-input-search"><DataIcon name="search" size="inline" /></span> : null}
    {multiline ? <textarea {...props} ref={textarea} rows={block.rows ?? 1} /> : dateTime && isDate ? <WindowDatePicker context={context} inputProps={props} inputRef={inputElement} value={dateTimeValue} min={minDateTime} max={maxDateTime} locale={formatter.locale} label={labelText} onChoose={choose} onEditingEnd={() => { if (block.commit === "submit") prepare.current(); else commit(draft); setFocused(false); finish(canSyncExternal()); }} /> : dateTime ? <WindowTimePicker context={context} inputProps={props} inputRef={inputElement} value={dateTimeValue} min={minDateTime} max={maxDateTime} step={typeof stepValue === "number" && Number.isInteger(stepValue) && stepValue > 0 ? stepValue : 30} locale={formatter.locale} onChoose={choose} onCommit={() => { if (block.commit === "submit" && tabKey.current) { tabKey.current = false; prepare.current(); return true; } tabKey.current = false; return commit(draft); }} onEditingEnd={() => { setFocused(false); finish(canSyncExternal()); }} /> : block.options !== undefined ? <WindowCombobox context={context} optionsOnly={optionsOnly} loading={optionsBinding.status === "loading"} inputProps={{ ...props, type: "text" }} inputRef={inputElement} options={normalizedOptions?.ok ? normalizedOptions.options : []} ready={normalizedOptions?.ok === true} onChoose={choose} onCommit={() => commit(draft)} onEditingEnd={() => { setFocused(false); finish(canSyncExternal()); }} /> : <input {...props}
      ref={inputElement}
      type="text"
      inputMode={block.kind === "number" ? "decimal" : undefined}
      role={block.kind === "number" ? "spinbutton" : undefined}
      min={block.kind === "number" ? minimum ?? undefined : undefined}
      max={block.kind === "number" ? maximum ?? undefined : undefined}
      step={block.kind === "number" ? step ?? undefined : undefined}
      aria-valuemin={block.kind === "number" ? minimum ?? undefined : undefined}
      aria-valuemax={block.kind === "number" ? maximum ?? undefined : undefined}
      aria-valuenow={block.kind === "number" ? numericValue : undefined}
    />}
    {block.kind === "number" && block.spin ? <WindowSpinButtons context={context} ref={spinButtons} increment={(direction, held) => increment(direction, 1, held)} onEnd={() => { spinning.current = false; endSpin(); if (!spinPending.current && !edited.current && !focusedRef.current) finish(); }} atMin={minimum !== null && numericValue !== undefined && numericValue <= minimum} atMax={maximum !== null && numericValue !== undefined && numericValue >= maximum} readOnly={readOnly} /> : null}
    {block.kind === "search" && (readOnly ? initialDraft : draft) ? <span className="ks-data-input-clear"><IconButton aria-label="지우기" disabled={readOnly} onClick={() => { markChanged(""); if (optionsOnly) commit(""); else sendDraft(""); }}><X size="inline" /></IconButton></span> : null}
  </div>;
  const optionsError = normalizedOptions && !normalizedOptions.ok ? inputOptionsError(normalizedOptions) : null;
  const invalidBound = dateTime && block.min !== undefined && minBinding.status === "ready" && !minDateTime ? "min" : dateTime && block.max !== undefined && maxBinding.status === "ready" && !maxDateTime ? "max" : null;
  const dateTimeError = invalidBound ? (isDate ? shellErrors.SHELL_INPUT_DATE_BOUND_INVALID({ field: invalidBound }) : shellErrors.SHELL_INPUT_TIME_BOUND_INVALID({ field: invalidBound })) : dateTime && !isDate && block.step !== undefined && stepBinding.status === "ready" && !(typeof stepValue === "number" && Number.isInteger(stepValue) && stepValue > 0) ? shellErrors.SHELL_INPUT_TIME_STEP_INVALID() : null;
  return <>{hasLabel ? <><div {...blockRoot} className={`ks-field ks-input-field${fieldPosition(block.label_position)}`}>{block.label_position !== "hidden" ? <label htmlFor={inputId} className="ks-field-label" data-ks-share-skip="">{labelText}</label> : null}{input}</div><BindingFailureNotice rootProps={blockRoot} value={label} /></> : input}{block.options !== undefined && optionsBinding.status !== "ready" && optionsBinding.status !== "loading" ? <DataState rootProps={blockRoot} value={optionsBinding} compact /> : null}{block.options !== undefined && optionsError ? <Notice rootProps={blockRoot} role="alert" errorId={optionsError.id}>{optionsError.message}</Notice> : null}{dateTime && [minBinding, maxBinding, stepBinding].map((binding, index) => binding.status !== "ready" && binding.status !== "loading" ? <DataState rootProps={blockRoot} key={index} value={binding} compact /> : null)}{dateTimeError ? <Notice rootProps={blockRoot} role="alert" errorId={dateTimeError.id}>{dateTimeError.message}</Notice> : null}</>;
}

function WindowCombobox({ context, ...props }: Omit<ComponentProps<typeof Combobox>, "visible"> & { context: BlockContext }) {
  const visible = useWindowVisible(context);
  return <Combobox {...props} visible={visible} />;
}

function WindowSpinButtons({ context, ...props }: Omit<ComponentProps<typeof SpinButtons>, "visible"> & { context: BlockContext }) {
  const visible = useWindowVisible(context);
  return <SpinButtons {...props} visible={visible} />;
}

function numericBinding(value: ReturnType<typeof useBinding>): number | null {
  return value.status === "ready" && typeof value.value === "number" && Number.isFinite(value.value) ? value.value : null;
}
function WindowDatePicker({ context, ...props }: Omit<ComponentProps<typeof DatePicker>, "visible"> & { context: BlockContext }) { return <DatePicker {...props} visible={useWindowVisible(context)} />; }
function WindowTimePicker({ context, ...props }: Omit<ComponentProps<typeof TimePicker>, "visible"> & { context: BlockContext }) { return <TimePicker {...props} visible={useWindowVisible(context)} />; }
