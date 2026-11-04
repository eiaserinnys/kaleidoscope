import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { Block } from "../contract/contract";
import type { useWindowData } from "../data/window-data";
import { registerPendingFlush } from "../share/pending-flush";


export function decimalDigits(digits: number): number { return Math.max(0, Math.min(20, Math.trunc(digits))); }

export function inputDraft(value: unknown, kind: string | undefined, format: Extract<Block, { type: "input" }>['format']): string {
  if (value == null) return "";
  if (kind === "number" && typeof value === "number" && format?.kind === "decimal") return value.toFixed(decimalDigits(format.digits));
  return String(value);
}

type Input = Extract<Block, { type: "input" }>;
type Ref<T> = RefObject<T>;
export function useInputDraft({ block, pointer, data, readOnly, initialDraft, change, finish, send, prepare, timer, timerValue, unregisterFlush, inputElement, textarea, edited, spinPending, afterSpin, composing, optionsOnly, optionValues }: {
  block: Input; pointer: string; data: ReturnType<typeof useWindowData>; readOnly: boolean; initialDraft: string;
  change: (value: string) => void; finish: (sync?: boolean) => void;
  send: (value: string, coalesce?: boolean) => Promise<void>; prepare: Ref<() => void>;
  timer: Ref<ReturnType<typeof setTimeout> | null>; timerValue: Ref<string>; unregisterFlush: Ref<(() => void) | null>;
  inputElement: Ref<HTMLInputElement | null>; textarea: Ref<HTMLTextAreaElement | null>; edited: Ref<boolean>; spinPending: Ref<boolean>; afterSpin: Ref<() => void>;
  composing: Ref<boolean>;
  optionsOnly: boolean; optionValues: string[] | null;
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
    edited.current = false;
    spinPending.current = false;
    const sent = send(value, false);
    const pending = wasSpin ? sent.finally(() => afterSpin.current()) : sent;
    pendingSend.current = pending;
    return pending;
  }, [send]);
  const settle = (value: string, barrier = false): boolean => {
    if (!edited.current || readOnly) return true;
    if (!optionsOnly) { sendDraft(value); return true; }
    if ((!barrier || block.commit !== "submit") && optionValues?.includes(value)) {
      const changed = value !== accepted.current;
      accepted.current = value;
      if (changed) { pendingAccepted.current = value === initialDraft && !pendingAccepted.current ? null : { value }; sendDraft(value); }
      else { unregisterFlush.current?.(); unregisterFlush.current = null; edited.current = false; }
      return true;
    }
    unregisterFlush.current?.(); unregisterFlush.current = null;
    edited.current = false;
    change(accepted.current);
    return false;
  };
  prepare.current = () => { if (block.options !== undefined && composing.current) return; if (optionsOnly && edited.current) settle(timerValue.current, true); else if (edited.current && (timer.current || spinPending.current)) void sendDraft(timerValue.current); };
  const markChanged = (value: string, mode: "normal" | "debounce" | "hold" = "normal") => {
    if (readOnly) return;
    edited.current = true;
    change(value);
    timerValue.current = value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    unregisterFlush.current?.(); unregisterFlush.current = null;
    spinPending.current = mode !== "normal";
    if (block.options !== undefined && composing.current) return;
    if (mode !== "hold" && (mode !== "normal" || (!optionsOnly && (block.commit ?? "debounce") === "debounce"))) {
      timer.current = setTimeout(() => { void sendDraft(timerValue.current); }, 300);
    }
    if (mode !== "normal" || optionsOnly || (block.commit ?? "debounce") === "debounce") {
      const element = inputElement.current ?? textarea.current;
      if (element) unregisterFlush.current = registerPendingFlush(element, () => { prepare.current(); return pendingSend.current ?? Promise.resolve(); });
    }
  };
  const endSpin = () => {
    if (!spinPending.current || !edited.current || timer.current) return;
    timer.current = setTimeout(() => { void sendDraft(timerValue.current); }, 300);
  };
  const commit = (value: string) => settle(value);
  const choose = (value: string) => { if (readOnly) return; accepted.current = value; pendingAccepted.current = value === initialDraft && !pendingAccepted.current ? null : { value }; change(value); void sendDraft(value); };
  const canSyncExternal = () => pendingAccepted.current === null;
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    unregisterFlush.current?.(); unregisterFlush.current = null;
    edited.current = false;
    spinPending.current = false;
    change(initialDraft);
    finish();
    if (block.on_cancel) void data.act(`${pointer}/on_cancel`, null);
  };
  return { sendDraft, markChanged, commit, cancel, endSpin, choose, canSyncExternal };
}
