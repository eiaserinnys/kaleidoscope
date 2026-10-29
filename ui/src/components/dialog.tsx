import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./primitives";

export function Dialog({ title, body, ok, danger, onCancel, onConfirm }: { title: string; body?: ReactNode; ok: string; danger?: boolean; onCancel: () => void; onConfirm: () => void }) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.current?.querySelector<HTMLButtonElement>(".ks-dialog-confirm button")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [onCancel]);
  return <div className="ks-dialog-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <div className="ks-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={root}>
      <div className="ks-dialog-title" id={titleId}>{title}</div>
      {body != null ? <div className="ks-dialog-body">{body}</div> : null}
      <div className="ks-dialog-actions"><Button onClick={onCancel}>취소</Button><span className={`ks-dialog-confirm${danger ? " is-danger" : ""}`}><Button onClick={onConfirm} variant={danger ? "default" : "emphasis"}>{ok}</Button></span></div>
    </div>
  </div>;
}
