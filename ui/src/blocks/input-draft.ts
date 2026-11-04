import { useCallback, type RefObject } from "react";
import type { Block } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
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
export function useInputDraft({ block, pointer, data, readOnly, initialDraft, toEventValue, change, finish, send, prepare, timer, timerValue, unregisterFlush, inputElement, textarea, edited }: {
  block: Input; pointer: string; data: ReturnType<typeof useWindowData>; readOnly: boolean; initialDraft: string;
  toEventValue: (value: string) => JsonValue; change: (value: string) => void; finish: (sync?: boolean) => void;
  send: (value: string, coalesce?: boolean) => Promise<void>; prepare: Ref<() => void>;
  timer: Ref<ReturnType<typeof setTimeout> | null>; timerValue: Ref<string>; unregisterFlush: Ref<(() => void) | null>;
  inputElement: Ref<HTMLInputElement | null>; textarea: Ref<HTMLTextAreaElement | null>; edited: Ref<boolean>;
}) {
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
  return { sendDraft, markChanged, commit, cancel };
}
