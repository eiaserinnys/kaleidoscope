import { useRef, useState, type InputHTMLAttributes } from "react";

export interface TextInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "onBlur" | "onChange" | "onKeyDown" | "value"
> {
  value: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

export function TextInput({ value, onCommit, onCancel, ...props }: TextInputProps) {
  const [draft, setDraft] = useState(value);
  const finished = useRef(false);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    if (draft.trim().length === 0) onCancel();
    else onCommit(draft);
  };

  const cancel = () => {
    if (finished.current) return;
    finished.current = true;
    onCancel();
  };

  return (
    <input
      {...props}
      autoFocus
      className="ks-text-input"
      onBlur={finish}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
      value={draft}
    />
  );
}
