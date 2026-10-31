import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "onBlur" | "onChange" | "onKeyDown" | "size" | "value"> {
  size?: "compact";
  persistent?: boolean;
  commitOnBlur?: boolean;
  syncWhileFocused?: boolean;
  cancelOnEscape?: boolean;
  value: string;
  onEdit?: (value: string) => void;
  onCommit: (value: string) => void;
  onCancel: () => void | string;
}

export function TextInput({ size, value, persistent = false, commitOnBlur = true, syncWhileFocused = false, cancelOnEscape = false, onEdit, onCommit, onCancel, onFocus, ...props }: TextInputProps) {
  const [draft, setDraft] = useState(value);
  const finished = useRef(false);
  const focused = useRef(false);
  const baseline = useRef(value);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!persistent) inputRef.current?.select(); }, [persistent]);
  useEffect(() => { if (persistent && (!focused.current || syncWhileFocused)) setDraft(value); }, [persistent, syncWhileFocused, value]);
  const finish = () => {
    if (!persistent && finished.current) return;
    if (!persistent) finished.current = true;
    if (!persistent && draft.trim().length === 0) onCancel(); else { baseline.current = draft; onCommit(draft); }
  };
  const cancel = () => {
    if (!persistent && finished.current) return;
    if (!persistent) finished.current = true;
    const restored = onCancel();
    if (persistent) setDraft(typeof restored === "string" ? restored : baseline.current);
  };
  return <input {...props} autoFocus={!persistent} className={`ks-text-input${size === "compact" ? " ks-text-input-compact" : ""}`}
    ref={inputRef} value={draft}
    onFocus={(event) => { focused.current = true; baseline.current = value; onFocus?.(event); }}
    onBlur={() => { focused.current = false; if (commitOnBlur) finish(); }}
    onChange={(event) => { setDraft(event.currentTarget.value); onEdit?.(event.currentTarget.value); }}
    onKeyDown={(event) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); finish(); }
      else if (event.key === "Escape" && (cancelOnEscape || !persistent || draft !== baseline.current)) { event.preventDefault(); event.stopPropagation(); cancel(); }
    }} />;
}
