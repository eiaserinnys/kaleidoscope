import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./primitives";

export function Dialog({ host, title, body, ok, danger, showCancel = true, cancelLabel = "취소", onCancel, onConfirm, overlayClassName = "", inertSelector = ":scope > .ks-data-window-body, :scope > .ks-data-window-notice" }: { host: HTMLElement; title: string; body?: ReactNode; ok: string; danger?: boolean; showCancel?: boolean; cancelLabel?: string; onCancel: () => void; onConfirm: () => void; overlayClassName?: string; inertSelector?: string }) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const restore = useRef(true);
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = host.querySelectorAll<HTMLElement>(inertSelector);
    background.forEach((element) => { element.setAttribute("inert", ""); });
    root.current?.querySelector<HTMLButtonElement>(".ks-dialog-confirm button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); return; }
      if (event.key !== "Tab" || !root.current) return;
      const focusable = [...root.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      background.forEach((element) => { element.removeAttribute("inert"); });
      if (restore.current) previous?.focus();
    };
  }, [host, onCancel, inertSelector]);
  return createPortal(<div className={`ks-dialog-overlay ${overlayClassName}`} data-ks-overlay onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <div className="ks-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={root}>
      <div className="ks-dialog-title" id={titleId}>{title}</div>
      {body != null ? <div className="ks-dialog-body">{body}</div> : null}
      <div className="ks-dialog-actions">{showCancel ? <Button onClick={onCancel}>{cancelLabel}</Button> : null}<span className={`ks-dialog-confirm${danger ? " is-danger" : ""}`}><Button onClick={() => { restore.current = false; onConfirm(); }} variant={danger ? "default" : "emphasis"}>{ok}</Button></span></div>
    </div>
  </div>, host);
}
