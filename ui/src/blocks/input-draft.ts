import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { Block } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import type { useWindowData } from "../data/window-data";
import { registerPendingFlush } from "../share/pending-flush";
import type { Parsed } from "./input-date-time";


export function decimalDigits(digits: number): number { return Math.max(0, Math.min(20, Math.trunc(digits))); }

export function inputDraft(value: unknown, kind: string | undefined, format: Extract<Block, { type: "input" }>['format']): string {
  if (value == null) return "";
  if (kind === "number" && typeof value === "number" && format?.kind === "decimal") return value.toFixed(decimalDigits(format.digits));
  return String(value);
}

type Input = Extract<Block, { type: "input" }>;
type Ref<T> = RefObject<T>;
export function useInputDraft({ block, pointer, data, readOnly, initialDraft, toEventValue, change, finish, send, prepare, timer, timerValue, unregisterFlush, inputElement, textarea, edited, setEdited, spinPending, afterSpin, composing, optionsOnly, resolveOption, codec }: {
  block: Input; pointer: string; data: ReturnType<typeof useWindowData>; readOnly: boolean; initialDraft: string;
  toEventValue: (value: string) => JsonValue; change: (value: string) => void; finish: (sync?: boolean) => void;
  send: (value: string, coalesce?: boolean) => Promise<void>; prepare: Ref<() => void>;
  timer: Ref<ReturnType<typeof setTimeout> | null>; timerValue: Ref<string>; unregisterFlush: Ref<(() => void) | null>;
  inputElement: Ref<HTMLInputElement | null>; textarea: Ref<HTMLTextAreaElement | null>; edited: Ref<boolean>; setEdited: (next: boolean) => void; spinPending: Ref<boolean>; afterSpin: Ref<() => void>;
  composing: Ref<boolean>;
  optionsOnly: boolean; resolveOption: (text: string) => string | null;
  codec?: { parse: (value: string) => Parsed; format: (value: string | null) => string };
}) {
  const accepted = useRef(initialDraft);
  const pendingAccepted = useRef<{ value: string } | null>(null);
  const pendingSend = useRef<Promise<void> | null>(null);
  useEffect(() => {
    if (pendingAccepted.current && initialDraft === pendingAccepted.current.value) pendingAccepted.current = null;
    if (!pendingAccepted.current) accepted.current = initialDraft;
  }, [initialDraft]);
  const sendDraft = useCallback((value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    unregisterFlush.current?.(); unregisterFlush.current = null;
    const wasSpin = spinPending.current;
    setEdited(false);
    spinPending.current = false;
    const normalized = codec ? toEventValue(value) : null;
    if (codec) {
      const formatted = codec.format(typeof normalized === "string" ? normalized : null);
      accepted.current = formatted;
      pendingAccepted.current = formatted === initialDraft && !pendingAccepted.current ? null : { value: formatted };
    }
    const sent = send(codec ? (typeof normalized === "string" ? normalized : "") : value, false);
    const pending = wasSpin ? sent.finally(() => afterSpin.current()) : sent;
    pendingSend.current = pending;
    return pending;
  }, [send, toEventValue, codec, initialDraft, setEdited]);
  const settle = (value: string, barrier = false): boolean => {
    if (codec) {
      if (readOnly) return true;
      if (!edited.current) { if (!barrier) change(accepted.current); return true; }
      const parsed = codec.parse(value);
      if (parsed.valid && (!barrier || block.commit !== "submit")) {
        const formatted = codec.format(parsed.value);
        if (formatted !== accepted.current) void sendDraft(value);
        else { if (timer.current) clearTimeout(timer.current); timer.current = null; unregisterFlush.current?.(); unregisterFlush.current = null; setEdited(false); }
        if (!barrier) change(formatted);
        return true;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = null; unregisterFlush.current?.(); unregisterFlush.current = null;
      setEdited(false); change(accepted.current);
      return false;
    }
    if (!edited.current || readOnly) return true;
    if (!optionsOnly) { sendDraft(value); return true; }
    if (!barrier || block.commit !== "submit") {
      const resolved = resolveOption(value);
      if (resolved !== null) {
        const changed = resolved !== accepted.current;
        accepted.current = resolved;
        if (resolved !== value) change(resolved);
        if (changed) { pendingAccepted.current = resolved === initialDraft && !pendingAccepted.current ? null : { value: resolved }; sendDraft(resolved); }
        else { unregisterFlush.current?.(); unregisterFlush.current = null; setEdited(false); }
        return true;
      }
    }
    unregisterFlush.current?.(); unregisterFlush.current = null;
    setEdited(false);
    change(accepted.current);
    return false;
  };
  prepare.current = () => { if ((block.options !== undefined || codec) && composing.current) return; if ((optionsOnly || codec) && edited.current) settle(timerValue.current, true); else if (edited.current && (timer.current || spinPending.current)) void sendDraft(timerValue.current); };
  const markChanged = (value: string, mode: "normal" | "debounce" | "hold" = "normal") => {
    if (readOnly) return;
    setEdited(true);
    change(value);
    timerValue.current = value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    unregisterFlush.current?.(); unregisterFlush.current = null;
    spinPending.current = mode !== "normal";
    if ((block.options !== undefined || codec) && composing.current) return;
    if (mode !== "hold" && (mode !== "normal" || (!optionsOnly && (!codec || codec.parse(value).valid) && (block.commit ?? "debounce") === "debounce"))) {
      timer.current = setTimeout(() => { void sendDraft(timerValue.current); }, 300);
    }
    if (mode !== "normal" || codec || optionsOnly || (block.commit ?? "debounce") === "debounce") {
      const element = inputElement.current ?? textarea.current;
      if (element) unregisterFlush.current = registerPendingFlush(element, () => { prepare.current(); return pendingSend.current ?? Promise.resolve(); });
    }
  };
  const endSpin = () => {
    if (!spinPending.current || !edited.current || timer.current) return;
    timer.current = setTimeout(() => { void sendDraft(timerValue.current); }, 300);
  };
  const commit = (value: string) => settle(value);
  const choose = (value: string) => { if (readOnly) return; if (optionsOnly && value === accepted.current) { unregisterFlush.current?.(); unregisterFlush.current = null; setEdited(false); change(value); return; } const formatted = codec ? codec.format(value) : value; accepted.current = formatted; pendingAccepted.current = formatted === initialDraft && !pendingAccepted.current ? null : { value: formatted }; change(formatted); void sendDraft(value); };
  const canSyncExternal = () => pendingAccepted.current === null;
  const revert = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    unregisterFlush.current?.(); unregisterFlush.current = null;
    setEdited(false);
    spinPending.current = false;
    change(accepted.current);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    unregisterFlush.current?.(); unregisterFlush.current = null;
    setEdited(false);
    spinPending.current = false;
    change(initialDraft);
    finish();
    if (block.on_cancel) void data.act(`${pointer}/on_cancel`, null);
  };
  return { sendDraft, markChanged, commit, cancel, endSpin, choose, canSyncExternal, revert };
}
