import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./primitives";

export function Dialog({ host, title, body, ok, danger, showCancel = true, cancelLabel = "취소", onCancel, onConfirm, overlayClassName = "", inertSelector = ":scope > .ks-data-window-body, :scope > .ks-data-window-notice", windowModal = false, active = true }: { host: HTMLElement; title: string; body?: ReactNode; ok: string; danger?: boolean; showCancel?: boolean; cancelLabel?: string; onCancel: () => void; onConfirm: () => void; overlayClassName?: string; inertSelector?: string; windowModal?: boolean; active?: boolean }) {
  const titleId = useId();
  const bodyId = useId();
  const root = useRef<HTMLDivElement>(null);
  const restore = useRef(true);
  const onKey = (event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault" | "stopPropagation">) => {
    if (event.key === "Escape") { event.preventDefault(); if (windowModal) event.stopPropagation(); onCancel(); return; }
    if (event.key !== "Tab" || !root.current) return;
    const focusable = [...root.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || (windowModal && document.activeElement === root.current))) { event.preventDefault(); last.focus(windowModal ? { preventScroll: true } : undefined); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(windowModal ? { preventScroll: true } : undefined); }
  };
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = host.querySelectorAll<HTMLElement>(inertSelector);
    background.forEach((element) => { element.setAttribute("inert", ""); });
    if (!windowModal) root.current?.querySelector<HTMLButtonElement>(".ks-dialog-confirm button")?.focus();
    if (!windowModal) document.addEventListener("keydown", onKey);
    return () => {
      if (!windowModal) document.removeEventListener("keydown", onKey);
      const focusedInside = root.current?.contains(document.activeElement);
      background.forEach((element) => { element.removeAttribute("inert"); });
      if (windowModal) {
        if (focusedInside) {
          const target = previous && host.contains(previous) ? previous : background[0];
          target?.focus({ preventScroll: true });
        }
      } else if (restore.current) previous?.focus();
    };
  }, [host, onCancel, inertSelector, windowModal]);
  useLayoutEffect(() => {
    if (windowModal && active) root.current?.focus({ preventScroll: true });
  }, [windowModal, active]);
  const heading = <div className="ks-dialog-title" id={titleId} title={windowModal ? title : undefined}>{title}</div>;
  const content = body != null ? <div className="ks-dialog-body" id={windowModal ? bodyId : undefined}>{body}</div> : null;
  return createPortal(<div className={`ks-dialog-overlay ${overlayClassName}`} data-ks-overlay onMouseDown={(event) => { if (!windowModal && event.target === event.currentTarget) onCancel(); }}>
    <div className="ks-dialog" role="dialog" aria-modal={windowModal ? active : true} aria-labelledby={titleId} aria-describedby={windowModal && body != null ? bodyId : undefined} tabIndex={windowModal ? -1 : undefined} onKeyDown={windowModal ? onKey : undefined} ref={root}>
      {heading}{content != null ? <div className="ks-dialog-scroll" tabIndex={windowModal ? 0 : undefined}>{content}</div> : null}
      <div className="ks-dialog-actions">{showCancel ? <Button onClick={onCancel}>{cancelLabel}</Button> : null}<span className={`ks-dialog-confirm${danger ? " is-danger" : ""}`}><Button onClick={() => { if (!windowModal) restore.current = false; onConfirm(); }} variant={danger ? "default" : "emphasis"}>{ok}</Button></span></div>
    </div>
  </div>, host);
}
