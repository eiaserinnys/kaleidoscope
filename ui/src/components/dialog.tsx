import { useId, useLayoutEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./primitives";
import { ownerOf, registerOverlay } from "../share/overlay-owner";
import { preserveWindowActionFocus, windowActionActive } from "../share/action-context";
import { writableControlSelector } from "./focus-rescue";

export function Dialog({ host, title, body, ok, danger, showCancel = true, cancelLabel = "취소", onCancel, onConfirm, overlayClassName = "", inertSelector = ":scope > .ks-data-window-body, :scope > .ks-data-window-notice", windowModal = false, active = true, userConsent = false, windowId, busy = false }: { host: HTMLElement; title: string; body?: ReactNode; ok: string; danger?: boolean; showCancel?: boolean; cancelLabel?: string; onCancel: () => void; onConfirm: (event: MouseEvent<HTMLButtonElement>) => void; overlayClassName?: string; inertSelector?: string; windowModal?: boolean; active?: boolean; userConsent?: boolean; windowId?: string; busy?: boolean }) {
  const titleId = useId();
  const bodyId = useId();
  const root = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const restore = useRef(true);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const wasBusy = useRef(busy);
  const onKey = (event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault" | "stopPropagation">) => {
    const native = event as KeyboardEvent;
    const owner = windowId ?? ownerOf(host);
    const targetOwner = native.target instanceof Element ? ownerOf(native.target) : undefined;
    if (native.isTrusted === false && targetOwner && windowActionActive(targetOwner) && targetOwner !== owner) return;
    if (event.key === "Escape") { event.preventDefault(); if (windowModal) event.stopPropagation(); if (!busyRef.current) onCancel(); return; }
    if (event.key !== "Tab" || !root.current) return;
    const focusable = [...root.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || (windowModal && document.activeElement === root.current))) { event.preventDefault(); last.focus(windowModal ? { preventScroll: true } : undefined); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(windowModal ? { preventScroll: true } : undefined); }
  };
  useLayoutEffect(() => {
    const owner = windowId ?? ownerOf(host);
    if (overlay.current && owner) return registerOverlay(overlay.current, owner, host);
  }, [host, windowId]);
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = host.querySelectorAll<HTMLElement>(inertSelector);
    background.forEach((element) => { element.setAttribute("inert", ""); });
    const owner = windowId ?? ownerOf(host);
    if (!windowModal && (!owner || !preserveWindowActionFocus(owner))) {
      const input = [...(root.current?.querySelectorAll<HTMLElement>(`.ks-dialog-body :is(${writableControlSelector})`) ?? [])]
        .find((element) => !element.closest("[hidden], [inert]")
          && (typeof element.checkVisibility !== "function" || element.checkVisibility({ visibilityProperty: true })));
      const target = input ?? root.current?.querySelector<HTMLElement>(showCancel ? ".ks-dialog-actions > button" : ".ks-dialog-confirm button");
      target?.focus();
    }
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
  }, [host, onCancel, inertSelector, windowModal, showCancel]);
  useLayoutEffect(() => {
    const owner = windowId ?? ownerOf(host);
    if (windowModal && active && (!owner || !preserveWindowActionFocus(owner))) root.current?.focus({ preventScroll: true });
  }, [windowModal, active]);
  useLayoutEffect(() => {
    const finished = wasBusy.current && !busy;
    wasBusy.current = busy;
    if (finished && !windowModal && !root.current?.contains(document.activeElement)) {
      root.current?.querySelector<HTMLElement>(showCancel ? ".ks-dialog-actions > button" : ".ks-dialog-confirm button")?.focus();
    }
  }, [busy, showCancel, windowModal]);
  const heading = <div className="ks-dialog-title" id={titleId} title={windowModal ? title : undefined}>{title}</div>;
  const content = body != null ? <div className="ks-dialog-body" id={windowModal ? bodyId : undefined}>{body}</div> : null;
  return createPortal(<div className={`ks-dialog-overlay ${overlayClassName}`} data-ks-overlay data-ks-user-consent={userConsent || undefined} ref={overlay} onMouseDown={(event) => { if (!busy && !windowModal && event.target === event.currentTarget) onCancel(); }}>
    <div className="ks-dialog" role="dialog" aria-modal={windowModal ? active : true} aria-labelledby={titleId} aria-describedby={windowModal && body != null ? bodyId : undefined} tabIndex={windowModal ? -1 : undefined} onKeyDown={windowModal ? onKey : undefined} ref={root}>
      {heading}{content != null ? <div className="ks-dialog-scroll" tabIndex={windowModal ? 0 : undefined}>{content}</div> : null}
      <div className="ks-dialog-actions">{showCancel ? <Button disabled={busy} onClick={onCancel}>{cancelLabel}</Button> : null}<span className={`ks-dialog-confirm${danger ? " is-danger" : ""}`}><Button disabled={busy} onClick={(event) => { if (!windowModal) restore.current = false; onConfirm(event); }} variant={danger ? "default" : "emphasis"}>{ok}</Button></span></div>
    </div>
  </div>, host);
}
