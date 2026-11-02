import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

export type TextInputCancelReason = "blur" | "escape";

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "onBlur" | "onChange" | "onKeyDown" | "size" | "value"> {
  size?: "compact";
  persistent?: boolean;
  commitOnBlur?: boolean;
  cancelOnBlur?: boolean;
  syncWhileFocused?: boolean;
  cancelOnEscape?: boolean;
  selectBeforeExtension?: boolean;
  value: string;
  onEdit?: (value: string) => void;
  onCommit: (value: string) => void;
  onCancel: (reason?: TextInputCancelReason) => void | string;
}

export function TextInput({ size, value, persistent = false, commitOnBlur = true, cancelOnBlur = false, syncWhileFocused = false, cancelOnEscape = false, selectBeforeExtension = false, onEdit, onCommit, onCancel, onFocus, ...props }: TextInputProps) {
  const [draft, setDraft] = useState(value);
  const finished = useRef(false);
  const focused = useRef(false);
  const baseline = useRef(value);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = inputRef.current;
    if (persistent || !input) return;
    if (!selectBeforeExtension) {
      input.select();
      return;
    }
    const dot = input.value.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
  }, [persistent, selectBeforeExtension]);
  useEffect(() => { if (persistent && (!focused.current || syncWhileFocused)) setDraft(value); }, [persistent, syncWhileFocused, value]);
  const finish = () => {
    if (!persistent && finished.current) return;
    if (!persistent) finished.current = true;
    if (!persistent && draft.trim().length === 0) onCancel(); else { baseline.current = draft; onCommit(draft); }
  };
  const cancel = (reason: TextInputCancelReason) => {
    if (!persistent && finished.current) return;
    if (!persistent) finished.current = true;
    const restored = onCancel(reason);
    if (persistent) setDraft(typeof restored === "string" ? restored : baseline.current);
  };
  return <input {...props} autoFocus={!persistent} className={`ks-text-input${size === "compact" ? " ks-text-input-compact" : ""}`}
    ref={inputRef} value={draft}
    onFocus={(event) => {
      focused.current = true;
      baseline.current = value;
      onFocus?.(event);
    }}
    onBlur={() => { focused.current = false; if (commitOnBlur) finish(); else if (cancelOnBlur) cancel("blur"); }}
    onChange={(event) => { setDraft(event.currentTarget.value); onEdit?.(event.currentTarget.value); }}
    onKeyDown={(event) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); finish(); }
      else if (event.key === "Escape" && (cancelOnEscape || !persistent || draft !== baseline.current)) { event.preventDefault(); event.stopPropagation(); cancel("escape"); }
    }} />;
}
