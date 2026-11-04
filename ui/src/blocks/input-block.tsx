import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { Block } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import type { BlockContext } from "./block-context";
import { useBinding, useWindowData } from "../data/window-data";
import { useLocalDraft } from "../data/use-local-draft";
import { BindingFailureNotice } from "../components/data-state";
import { DataIcon } from "../components/data-icons";
import { IconButton } from "../components/primitives";
import { X } from "../components/icons";
import { display, isMultilineInput } from "./data-layout";
import { isWindowTop } from "../data/window-state";
import { inputDraft, decimalDigits, useInputDraft } from "./input-draft";
interface Props<T extends Block["type"]> { block: Extract<Block, { type: T }>; context: BlockContext; pointer: string }
const uninitializedFocus = Symbol("uninitialized focus");
const fieldPosition = (position: "inline" | "top" | "hidden" | undefined) => position && position !== "inline" ? ` is-label-${position}` : "";
function bindingText(value: ReturnType<typeof useBinding>): string {
  return value.status === "ready" && value.value !== null && value.value !== undefined ? display(value.value) : "";
}

function fitTextarea(element: HTMLTextAreaElement) {
  if (element.clientWidth === 0) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
}

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
  const { sendDraft, markChanged, commit, cancel } = useInputDraft({ block, pointer, data, readOnly, initialDraft, toEventValue, change, finish, send, prepare, timer, timerValue, unregisterFlush, inputElement, textarea, edited });
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

function useNumericBinding(pointer: string, binding: Extract<Block, { type: "input" }>['min']): number | null {
  const value = useBinding(pointer, binding ?? null);
  return value.status === "ready" && typeof value.value === "number" && Number.isFinite(value.value) ? value.value : null;
}
