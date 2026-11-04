import { eventModifiers } from "../runtime/shortcuts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import type { Block, SelectOption } from "../contract/contract";
import { ICON_NAMES } from "../contract/limits";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import type { BlockContext } from "./block-context";
import { useBinding, useWindowData } from "../data/window-data";
import { BindingFailureNotice, DataState, isMessageBindingFailure } from "../components/data-state";
import { DataIcon } from "../components/data-icons";
import { Dialog } from "../components/dialog";
import { X } from "../components/icons";
import { Select, Toggle } from "../components/select-toggle";
import { Button, ErrorId, IconButton } from "../components/primitives";
import { display, isMultilineInput } from "./data-layout";
import { asArray } from "./data-view-common";
import { createSerialSend, createThrottledSend } from "../data/throttled-send";
import { registerPendingFlush } from "../share/pending-flush";
import { isWindowTop, useWindowVisible } from "../data/window-state";
import { isClock, useClockPosition } from "../data/clock";
import { renderBlock } from "../render/render-block";
import { PreviewContext } from "./preview-context";

interface Props<T extends Block["type"]> { block: Extract<Block, { type: T }>; context: BlockContext; pointer: string }
const uninitializedFocus = Symbol("uninitialized focus");
const fieldPosition = (position: "inline" | "top" | "hidden" | undefined) => position && position !== "inline" ? ` is-label-${position}` : "";
const identityJson = <T extends JsonValue>(value: T): JsonValue => value;
function bindingText(value: ReturnType<typeof useBinding>): string {
  return value.status === "ready" && value.value !== null && value.value !== undefined ? display(value.value) : "";
}
const bindingName = (value: unknown, fallback: string) => {
  if (value && typeof value === "object") {
    if ("state" in value && typeof value.state === "string") return value.state;
    if ("client" in value && typeof value.client === "string") return value.client;
  }
  return fallback;
};

export function InputBlock({ block, pointer }: Props<"input">) {
  const data = useWindowData();
  const multiline = isMultilineInput(block);
  const bound = useBinding(`${pointer}/value`, block.value);
  const readOnlyBinding = useBinding(`${pointer}/read_only`, block.read_only ?? null);
  const readOnly = readOnlyBinding.status === "ready" && readOnlyBinding.value === true;
  const label = useBinding(`${pointer}/label`, block.label ?? null);
  const placeholder = useBinding(`${pointer}/placeholder`, block.placeholder ?? null);
  const hasLabel = block.label != null;
  const labelText = hasLabel ? bindingText(label) : "";
  const current = bound.status === "ready" ? bound.value : null;
  const minimum = useNumericBinding(`${pointer}/min`, block.min ?? null);
  const maximum = useNumericBinding(`${pointer}/max`, block.max ?? null);
  const step = useNumericBinding(`${pointer}/step`, block.step ?? null);
  const focus = useBinding(`${pointer}/focus`, block.focus ?? null);
  const initialDraft = inputDraft(current, block.kind, block.format);
  const toEventValue = useCallback((value: string): JsonValue => {
    if (block.kind !== "number") return value;
    if (value.trim() === "" || !Number.isFinite(Number(value))) return null;
    let number = Number(value);
    if (minimum !== null) number = Math.max(minimum, number);
    if (maximum !== null) number = Math.min(maximum, number);
    if (block.format?.kind === "decimal") number = Number(number.toFixed(decimalDigits(block.format.digits)));
    return number;
  }, [block.kind, block.format, minimum, maximum]);
  const prepare = useRef<() => void>(() => {});
  const { draft, change, finish, holding, send, mark, adopt } = useLocalDraft<string>(initialDraft, pointer, { sendOnChange: false, resetOnFailure: false, syncOnSuccess: true, toJson: toEventValue, prepare });
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unregisterFlush = useRef<(() => void) | null>(null);
  const timerValue = useRef("");
  const inputElement = useRef<HTMLInputElement | null>(null);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const composing = useRef(false);
  const edited = useRef(false);
  const previousFocus = useRef<JsonValue | typeof uninitializedFocus>(uninitializedFocus);
  const customSpinbutton = block.kind === "number" && (block.format?.kind === "decimal" || block.focus !== undefined);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); unregisterFlush.current?.(); }, []);
  useLayoutEffect(() => {
    if (!readOnly) {
      if (focused) holding.current = true;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    unregisterFlush.current?.(); unregisterFlush.current = null;
    edited.current = false;
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
    textarea.current.style.height = "auto";
    textarea.current.style.height = `${textarea.current.scrollHeight}px`;
  }, [draft, block.rows]);
  const sendDraft = useCallback((value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    unregisterFlush.current?.(); unregisterFlush.current = null;
    edited.current = false;
    const normalized = toEventValue(value);
    const formatted = typeof normalized === "number" ? inputDraft(normalized, block.kind, block.format) : value;
    if (formatted !== value) change(formatted);
    return send(value, false);
  }, [block.kind, block.format, change, send, toEventValue]);
  prepare.current = () => { if (timer.current) sendDraft(timerValue.current); };
  const markChanged = (value: string) => {
    if (readOnly) return;
    edited.current = true;
    change(value);
    if (timer.current) clearTimeout(timer.current);
    unregisterFlush.current?.(); unregisterFlush.current = null;
    if ((block.commit ?? "debounce") === "debounce") {
      timerValue.current = value;
      timer.current = setTimeout(() => { void sendDraft(timerValue.current); }, 300);
      const element = inputElement.current ?? textarea.current;
      if (element) unregisterFlush.current = registerPendingFlush(element, () => sendDraft(timerValue.current));
    }
  };
  const commit = (value: string) => { if (!readOnly && edited.current) sendDraft(value); };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    unregisterFlush.current?.(); unregisterFlush.current = null;
    edited.current = false;
    change(initialDraft);
    finish();
    if (block.on_cancel) void data.act(`${pointer}/on_cancel`, null);
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (readOnly) return;
    if (event.key === "Escape" && !event.nativeEvent.isComposing && !composing.current && block.on_cancel && (focused || edited.current)) {
      event.preventDefault();
      cancel();
      return;
    }
    if (customSpinbutton && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const currentNumber = Number.isFinite(Number(draft)) ? Number(draft) : 0;
      const increment = step ?? 1;
      let next = currentNumber + (event.key === "ArrowUp" ? increment : -increment);
      if (minimum !== null) next = Math.max(minimum, next);
      if (maximum !== null) next = Math.min(maximum, next);
      markChanged(String(next));
      return;
    }
    if (event.key !== "Enter" || event.nativeEvent.isComposing || composing.current || (multiline && !event.ctrlKey)) return;
    if (block.commit === "submit" || block.on_submit) { event.preventDefault(); commit(draft); }
    if (block.on_submit) {
      const submitted = mark();
      void data.act(`${pointer}/on_submit`, toEventValue(draft)).then((success) => { if (success) adopt(submitted); });
    }
  };
  const props = { className: "ks-text-input", "aria-label": block.label_position === "hidden" ? labelText : undefined, placeholder: block.placeholder === undefined ? undefined : bindingText(placeholder), value: readOnly ? initialDraft : draft, readOnly, "aria-readonly": readOnly,
    onFocus: () => { setFocused(true); holding.current = !readOnly; }, onBlur: () => {
      setFocused(false);
      if ((block.commit ?? "debounce") !== "submit") commit(draft);
      finish(!edited.current);
    },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => markChanged(event.currentTarget.value), onKeyDown: keyDown,
    onCompositionStart: () => { composing.current = true; }, onCompositionEnd: () => { composing.current = false; },
  };
  const numericValue = block.kind === "number" && draft.trim() !== "" && Number.isFinite(Number(draft)) ? Number(draft) : undefined;
  const input = <div className={`ks-data-input${block.kind === "search" ? " is-search" : ""}${(block.rows ?? 0) >= 2 ? " has-rows" : ""}${block.columns !== undefined ? ` has-columns${block.kind === "number" && !customSpinbutton ? " is-native-number" : ""}` : ""}`}
    style={block.columns !== undefined ? { "--ks-input-columns": `${block.columns}ch` } as CSSProperties : undefined}>
    {block.kind === "search" ? <span className="ks-data-input-search"><DataIcon name="search" size="inline" /></span> : null}
    {multiline ? <textarea {...props} ref={textarea} rows={block.rows ?? 1} /> : <input {...props}
      ref={inputElement}
      type={customSpinbutton ? "text" : block.kind === "number" ? "number" : "text"}
      inputMode={customSpinbutton ? "decimal" : undefined}
      role={customSpinbutton ? "spinbutton" : undefined}
      min={block.kind === "number" ? minimum ?? undefined : undefined}
      max={block.kind === "number" ? maximum ?? undefined : undefined}
      step={block.kind === "number" ? step ?? undefined : undefined}
      aria-valuemin={customSpinbutton ? minimum ?? undefined : undefined}
      aria-valuemax={customSpinbutton ? maximum ?? undefined : undefined}
      aria-valuenow={customSpinbutton ? numericValue : undefined}
    />}
    {block.kind === "search" && (readOnly ? initialDraft : draft) ? <span className="ks-data-input-clear"><IconButton aria-label="지우기" disabled={readOnly} onClick={() => { markChanged(""); sendDraft(""); }}><X size="inline" /></IconButton></span> : null}
  </div>;
  return hasLabel ? <><label className={`ks-field ks-input-field${fieldPosition(block.label_position)}`}>{block.label_position !== "hidden" ? <span className="ks-field-label" data-ks-share-skip="">{labelText}</span> : null}{input}</label><BindingFailureNotice value={label} /></> : input;
}

function decimalDigits(digits: number): number { return Math.max(0, Math.min(20, Math.trunc(digits))); }

function inputDraft(value: unknown, kind: string | undefined, format: Extract<Block, { type: "input" }>['format']): string {
  if (value == null) return "";
  if (kind === "number" && typeof value === "number" && format?.kind === "decimal") return value.toFixed(decimalDigits(format.digits));
  return String(value);
}

function useNumericBinding(pointer: string, binding: Extract<Block, { type: "input" }>['min']): number | null {
  const value = useBinding(pointer, binding ?? null);
  return value.status === "ready" && typeof value.value === "number" && Number.isFinite(value.value) ? value.value : null;
}

function validOption(value: unknown): value is SelectOption {
  return typeof value === "string" || (typeof value === "object" && value !== null && "label" in value && typeof value.label === "string" && "value" in value);
}

function validGroup(value: unknown): value is { name: string; options: unknown[] } {
  return typeof value === "object" && value !== null && "name" in value && typeof value.name === "string" && "options" in value && Array.isArray(value.options);
}

function useLocalDraft<T extends JsonValue>(
  current: T,
  pointer: string,
  options: { sendOnChange?: boolean; toJson?: (value: T) => JsonValue; intervalMs?: number; resetOnFailure?: boolean; syncOnSuccess?: boolean; prepare?: { current: () => void } } = {},
) {
  const data = useWindowData();
  const [draft, setDraft] = useState(current);
  const holding = useRef(false);
  const inFlight = useRef(0);
  const revision = useRef(0);
  const externalChanges = useRef(0);
  const adoptRevision = useRef<number | null>(null);
  const latest = useRef(current);
  latest.current = current;
  const sendOnChange = options.sendOnChange ?? true;
  const toJson = options.toJson ?? identityJson;
  const resetOnFailure = options.resetOnFailure ?? true;
  const syncOnSuccess = options.syncOnSuccess ?? false;
  const serialSend = useMemo(() => createSerialSend(async ({ value, revision: sentRevision }: { value: T; revision: number }) => {
    inFlight.current += 1;
    let success = false;
    try {
      success = await data.act(`${pointer}/on_change`, toJson(value), undefined, undefined, undefined, { input: true });
      if (!success && resetOnFailure && !holding.current && revision.current === sentRevision) setDraft(latest.current);
    } finally {
      inFlight.current -= 1;
      if (success && syncOnSuccess && inFlight.current === 0 && !holding.current && revision.current === sentRevision) setDraft(latest.current);
    }
  }), [data, pointer, resetOnFailure, syncOnSuccess, toJson]);
  const enqueue = (value: T, coalesce: boolean) => serialSend({ value, revision: revision.current }, { coalesce });
  const throttled = useMemo(() => createThrottledSend((next: T) => enqueue(next, true), options.intervalMs ?? 100), [options.intervalMs, serialSend]);
  useEffect(() => () => throttled.flush(), [throttled]);
  useEffect(() => data.holdInput(() => {
    options.prepare?.current();
    if (sendOnChange) throttled.flush();
    return serialSend.idle();
  }), [data, options.prepare, sendOnChange, serialSend, throttled]);
  useEffect(() => {
    externalChanges.current += 1;
    if ((!holding.current || adoptRevision.current === revision.current) && inFlight.current === 0) setDraft(current);
  }, [current]);
  const change = (next: T) => { revision.current += 1; setDraft(next); if (sendOnChange) throttled.send(next); };
  const finish = (sync = true) => { if (sendOnChange) throttled.flush(); holding.current = false; if (sync && inFlight.current === 0) setDraft(latest.current); };
  const send = (next: T, coalesce = false) => enqueue(next, coalesce);
  const mark = () => ({ revision: revision.current, externalChanges: externalChanges.current });
  const adopt = (submitted: ReturnType<typeof mark>) => {
    if (revision.current !== submitted.revision) return;
    adoptRevision.current = submitted.revision;
    if (externalChanges.current !== submitted.externalChanges && inFlight.current === 0) setDraft(latest.current);
  };
  return { draft, change, finish, holding, send, mark, adopt };
}

export function SliderBlock({ block, pointer, context }: Props<"slider">) {
  const value = useBinding(`${pointer}/value`, block.value);
  const clock = value.status === "ready" && isClock(value.value) ? value.value : null;
  if (clock) return <ClockSlider block={block} pointer={pointer} context={context} clock={clock} />;
  const raw = Number((value.status === "ready" ? value.value : null) ?? block.min);
  const current = Number.isFinite(raw) ? raw : block.min;
  return <SliderControl block={block} pointer={pointer} current={current} />;
}

function ClockSlider({ block, pointer, context, clock }: {
  block: Extract<Block, { type: "slider" }>;
  pointer: string;
  context: BlockContext;
  clock: import("../contract/contract").Clock;
}) {
  const visible = useWindowVisible(context);
  return <SliderControl block={block} pointer={pointer} current={useClockPosition(clock, visible)} />;
}

function SliderControl({ block, pointer, current }: {
  block: Extract<Block, { type: "slider" }>;
  pointer: string;
  current: number;
}) {
  const label = useBinding(`${pointer}/label`, block.label ?? null);
  const hasLabel = block.label != null;
  const labelText = hasLabel ? bindingText(label) : "";
  const { draft, change, finish, holding } = useLocalDraft(current, pointer);
  return <><label className={`ks-field ks-slider-field${fieldPosition(block.label_position)}${block.show_value === false ? " is-value-hidden" : ""}`}>
    {hasLabel && block.label_position !== "hidden" ? <span className="ks-field-label" data-ks-share-skip="">{labelText}</span> : null}
    <input type="range" className="ks-slider" aria-label={labelText || bindingName(block.value, "슬라이더")} min={block.min} max={block.max} step={block.step ?? 1} value={draft}
      onPointerDown={() => { holding.current = true; }} onPointerUp={() => finish()} onPointerCancel={() => finish()} onBlur={() => finish()}
      onKeyDown={() => { holding.current = true; }} onKeyUp={() => finish()}
      onChange={(event) => { const next = Number(event.currentTarget.value); change(next); if (event.nativeEvent.type === "change") finish(); }} />
    {block.show_value !== false ? <span className="ks-slider-value" data-ks-share-skip="">{draft}</span> : null}
  </label><BindingFailureNotice value={label} /></>;
}

export function ColorBlock({ block, pointer }: Props<"color">) {
  const bound = useBinding(`${pointer}/value`, block.value);
  const disabled = useBinding(`${pointer}/disabled`, block.disabled ?? false);
  const label = useBinding(`${pointer}/label`, block.label ?? null);
  const hasLabel = block.label != null;
  const labelText = hasLabel ? bindingText(label) : "";
  const value = bound.status === "ready" ? bound.value : null;
  const current = typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#000000";
  const unavailable = disabled.status !== "ready" || Boolean(disabled.value);
  const { draft: color, change, finish, holding } = useLocalDraft(current, pointer);
  return <><label className={`ks-field ks-color-field${fieldPosition(block.label_position)}${unavailable ? " is-disabled" : ""}`}>
    {hasLabel && block.label_position !== "hidden" ? <span className="ks-field-label" data-ks-share-skip="">{labelText}</span> : null}
    <span className="ks-color-control"><input className="ks-color-input" type="color" aria-label={labelText || bindingName(block.value, "색상")} value={color} disabled={unavailable}
      onPointerDown={() => { holding.current = true; }} onPointerUp={() => finish()} onPointerCancel={() => finish()} onBlur={() => finish()} onKeyDown={() => { holding.current = true; }} onKeyUp={() => finish()}
      onChange={(event) => { change(event.currentTarget.value.toLowerCase()); if (event.nativeEvent.type === "change") finish(); }} /><span className="ks-color-code" data-ks-share-skip="">{color}</span></span>
  </label><BindingFailureNotice value={label} /></>;
}
export function SelectBlock({ block, pointer }: Props<"select">) {
  const data = useWindowData();
  const options = useBinding(`${pointer}/options`, block.options);
  const value = useBinding(`${pointer}/value`, block.value);
  const label = useBinding(`${pointer}/label`, block.label ?? null);
  const placeholder = useBinding(`${pointer}/placeholder`, block.placeholder ?? null);
  const disabled = useBinding(`${pointer}/disabled`, block.disabled ?? false);
  const hasLabel = block.label != null;
  const labelText = hasLabel ? bindingText(label) : undefined;
  const placeholderText = block.placeholder === undefined ? undefined : bindingText(placeholder);
  if (options.status !== "ready") return <DataState value={options} compact />;
  const entries = asArray(options.value);
  const hasGroups = entries.some(validGroup);
  const toChoice = (option: SelectOption) => typeof option === "string" ? { value: option, label: option } : option;
  const groups = entries.flatMap((entry) => {
    if (validGroup(entry)) return [{ name: entry.name, options: entry.options.filter(validOption).map(toChoice) }];
    return validOption(entry) ? [{ name: "", options: [toChoice(entry)] }] : [];
  });
  const props = { value: value.status === "ready" ? value.value : null, placeholder: placeholderText, segmented: block.style === "segmented", label: labelText, disabled: disabled.status !== "ready" || Boolean(disabled.value), onChange: (next: JsonValue) => { void data.act(`${pointer}/on_change`, next); } };
  const select = hasGroups ? <Select {...props} groups={groups} /> : <Select {...props} items={entries.filter(validOption)} />;
  return hasLabel ? <><label className={`ks-field ks-select-field${fieldPosition(block.label_position)}`}>{block.label_position !== "hidden" ? <span className="ks-field-label" data-ks-share-skip="">{labelText}</span> : null}{select}</label><BindingFailureNotice value={label} /></> : select;
}

export function ToggleBlock({ block, pointer }: Props<"toggle">) {
  const data = useWindowData();
  const value = useBinding(`${pointer}/value`, block.value);
  const label = useBinding(`${pointer}/label`, block.label);
  const disabled = useBinding(`${pointer}/disabled`, block.disabled ?? false);
  return <><Toggle checked={value.status === "ready" && Boolean(value.value)} disabled={value.status !== "ready" || disabled.status !== "ready" || Boolean(disabled.value)} label={block.label != null ? bindingText(label) : undefined} labelVisible={block.label != null} onChange={(value) => { void data.act(`${pointer}/on_change`, value); }} /><BindingFailureNotice value={label} /></>;
}

export function ButtonBlock({ block, context, pointer }: Props<"button">) {
  const data = useWindowData();
  const label = useBinding(`${pointer}/label`, block.label);
  const icon = useBinding(`${pointer}/icon`, block.icon ?? null);
  const prefix = useBinding(`${pointer}/prefix`, block.prefix ?? null);
  const pressed = useBinding(`${pointer}/pressed`, block.pressed ?? null);
  const disabled = useBinding(`${pointer}/disabled`, block.disabled ?? false);
  const body = useBinding(`${pointer}/confirm/body`, block.confirm?.body ?? null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [copySucceeded, setCopySucceeded] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const setOpener = useCallback((node: HTMLElement | null) => { opener.current = node; }, []);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreAfterAction = useRef(false);
  const confirmModifiers = useRef<ReturnType<typeof eventModifiers> | undefined>(undefined);
  const close = useCallback(() => setConfirm(false), []);
  const labelText = label.status === "ready" && typeof label.value === "string" ? label.value : "";
  const prefixText = block.prefix !== undefined ? bindingText(prefix) : "";
  const labelFailure = isMessageBindingFailure(label) ? label : null;
  const prefixFailure = isMessageBindingFailure(prefix) ? prefix : null;
  const bindingFailure = labelFailure ?? prefixFailure;
  const accessibleName = bindingFailure
    ? [labelText, bindingFailure.id].filter(Boolean).join(": ")
    : prefixText ? `${prefixText}: ${labelText}` : labelText;
  const iconText = icon.status === "ready" && typeof icon.value === "string" ? icon.value : "";
  const pressedValue = block.pressed !== undefined && pressed.status === "ready" ? Boolean(pressed.value) : undefined;
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  const run = async (restore: boolean, modifiers?: ReturnType<typeof eventModifiers>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    restoreAfterAction.current = restore;
    setConfirm(false);
    setBusy(true);
    const succeeded = await data.act(`${pointer}/on_click`, null, undefined, modifiers);
    busyRef.current = false;
    setBusy(false);
    if (succeeded && copyTextAction(block.on_click)) {
      setCopySucceeded(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => { setCopySucceeded(false); copyTimer.current = null; }, 1500);
    }
  };
  const unavailable = disabled.status !== "ready" || Boolean(disabled.value) || bindingFailure !== null;
  useLayoutEffect(() => {
    if (!busy && !unavailable && restoreAfterAction.current) {
      restoreAfterAction.current = false;
      opener.current?.querySelector<HTMLButtonElement>(".ks-data-button-card-action, :scope > button")?.focus();
    }
  });
  const hasIcon = (ICON_NAMES as readonly string[]).includes(iconText);
  const copied = copySucceeded && copyTextAction(block.on_click);
  const buttonLabel = prefixText
    ? <><span className="ks-data-button-prefix">{prefixText}</span><span className="ks-data-button-label is-emphasized ks-truncate-label">{labelText}</span></>
    : <span className="ks-data-button-label ks-truncate-label">{labelText}</span>;
  const contents = <>{bindingFailure ? <DataIcon name="triangle-alert" /> : hasIcon ? <DataIcon name={copied ? "check" : iconText} /> : null}{!block.icon_only ? buttonLabel : null}</>;
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (busyRef.current) return;
    const modifiers = eventModifiers(event);
    if (block.confirm) { confirmModifiers.current = modifiers; setConfirm(true); }
    else void run(false, modifiers);
  };
  const host = opener.current?.closest<HTMLElement>(".ks-data-window");
  const status = <span aria-live="polite" className="ks-accessible-hidden" role="status">{copied ? "복사했습니다" : ""}</span>;
  const previewFailure = bindingFailure ? <span aria-label={bindingFailure.message} className="ks-data-button-card-failure" role="alert">
    <DataIcon name="triangle-alert" size="inline" /><ErrorId id={bindingFailure.id} />
  </span> : null;
  const dialog = confirm && block.confirm && host
    ? <Dialog host={host} title={block.confirm.title} ok={block.confirm.ok ?? labelText} danger={block.variant === "danger"} onCancel={close} onConfirm={() => void run(true, confirmModifiers.current)} body={block.confirm.body === undefined ? undefined : body.status === "ready" ? display(body.value) : <DataState value={body} compact />} />
    : null;
  const className = `ks-data-button is-${block.variant ?? "default"}`;
  if (block.preview) return <div ref={setOpener} className={`${className} has-preview`}>
    <div className={`ks-data-button-card${pressedValue ? " is-selected" : ""}${busy || unavailable ? " is-disabled" : ""}`} title={previewError ?? undefined}>
      <div className="ks-data-button-card-content">
        <div className="ks-data-button-card-preview" aria-hidden="true" inert><PreviewContext.Provider value={setPreviewError}>{renderBlock(block.preview, context, `${pointer}/preview`)}</PreviewContext.Provider></div>
        <div aria-hidden={bindingFailure ? undefined : true} className={`ks-data-button-card-label${bindingFailure ? " is-failure" : ""}`}>
          {!bindingFailure && prefixText ? <><span className="ks-data-button-prefix">{prefixText}</span><wbr /></> : null}
          {!bindingFailure ? <span className="ks-data-button-label is-emphasized">{labelText}</span> : null}
          {previewFailure}
        </div>
      </div>
      <Button aria-label={accessibleName} className="ks-data-button-card-action" aria-pressed={pressedValue} disabled={unavailable} aria-disabled={busy || undefined} onClick={onClick}>
        <span className="ks-accessible-hidden">{accessibleName}</span>
      </Button>
    </div>
    {status}{dialog}
  </div>;
  const control = <span ref={setOpener} className={className}>{block.icon_only
    ? <IconButton aria-label={accessibleName} pressed={pressedValue} disabled={unavailable} aria-disabled={busy || undefined} onClick={onClick}>{contents}</IconButton>
    : <Button aria-label={accessibleName} aria-pressed={pressedValue} variant={block.variant === "primary" ? "emphasis" : "default"} disabled={unavailable} aria-disabled={busy || undefined} onClick={onClick}>{contents}</Button>}
    {status}{dialog}
  </span>;
  return bindingFailure
    ? <div aria-label={bindingFailure.message} className="ks-data-button-failure-item" role="alert" title={bindingFailure.message}>
      {control}<div className="ks-data-state-compact"><ErrorId id={bindingFailure.id} /></div>
    </div>
    : control;
}

function copyTextAction(actions: unknown): boolean {
  const isCopy = (action: unknown) => action !== null && typeof action === "object" && "copy_text" in action;
  return Array.isArray(actions) ? actions.length === 1 && isCopy(actions[0]) : isCopy(actions);
}
