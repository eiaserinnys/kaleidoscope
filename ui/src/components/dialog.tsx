import { useId, useLayoutEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./primitives";
import { LoaderCircle } from "./icons";
import { ownerOf, registerOverlay } from "../share/overlay-owner";
import { preserveWindowActionFocus, windowActionActive } from "../share/action-context";
import { bookmarkTarget, dialogActionFocus, dialogFirstFocus, focusBookmark, focusRescued, lastFocusInWindow, usableFocus, writableControlSelector, type FocusBookmark } from "./focus-rescue";

export function Dialog({ host, title, body, ok, danger, showCancel = true, cancelLabel = "취소", onCancel, onConfirm, overlayClassName = "", inertSelector = ":scope > .ks-data-window-body, :scope > .ks-data-window-notice", windowModal = false, active = true, userConsent = false, windowId, busy = false, rootProps, ownerAnchor, noticeSlotRef }: { ownerAnchor?: Element | null; rootProps?: import("../comments/block-root").BlockRootProps; noticeSlotRef?: (element: HTMLDivElement | null) => void; host: HTMLElement; title: string; body?: ReactNode; ok: string; danger?: boolean; showCancel?: boolean; cancelLabel?: string; onCancel: () => void; onConfirm: (event: MouseEvent<HTMLButtonElement>) => void; overlayClassName?: string; inertSelector?: string; windowModal?: boolean; active?: boolean; userConsent?: boolean; windowId?: string; busy?: boolean }) {
  const titleId = useId();
  const bodyId = useId();
  const root = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const opener = useRef<FocusBookmark | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const wasBusy = useRef(busy);
  const onKey = (event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault" | "stopPropagation">) => {
    const native = event as KeyboardEvent;
    const owner = windowId ?? ownerOf(host);
    const targetOwner = native.target instanceof Element ? ownerOf(native.target) : undefined;
    if (native.isTrusted === false && targetOwner && windowActionActive(targetOwner) && targetOwner !== owner) return;
    if (event.key === "Escape") { event.preventDefault(); if (windowModal) event.stopPropagation(); if (!busyRef.current) onCancelRef.current(); return; }
    if (event.key !== "Tab" || !root.current) return;
    const focusable = [...root.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || (windowModal && document.activeElement === root.current))) { event.preventDefault(); last.focus(windowModal ? { preventScroll: true } : undefined); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(windowModal ? { preventScroll: true } : undefined); }
  };
  useLayoutEffect(() => {
    const owner = windowId ?? ownerOf(host);
    if (overlay.current && owner) return registerOverlay(overlay.current, owner, ownerAnchor ?? host);
  }, [host, windowId, ownerAnchor]);
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const content = host.querySelector<HTMLElement>(":scope > .ks-data-window-body") ?? host;
    if (!windowModal && !opener.current) opener.current = focusBookmark(previous === document.body ? lastFocusInWindow(host) : previous, content);
    const background = host.querySelectorAll<HTMLElement>(inertSelector);
    background.forEach((element) => { element.setAttribute("inert", ""); });
    const owner = windowId ?? ownerOf(host);
    // 에이전트가 새 창을 열어 대화상자가 뜰 때 다른 창에 입력 중이면 그 초점을 가져오지 않는다.
    const foreign = previous !== null && !host.contains(previous) && ((previous.matches(writableControlSelector) && usableFocus(previous))
      || (previous.matches("iframe") && usableFocus(previous)) || Boolean(previous.closest("[data-ks-overlay]")));
    if (!windowModal && !foreign && (!owner || !preserveWindowActionFocus(owner))) {
      const target = root.current ? dialogFirstFocus(root.current) : null;
      if (target) focusRescued(target);
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
      } else if (opener.current && (focusedInside || document.activeElement === document.body)) {
        focusRescued(bookmarkTarget(opener.current, content), { preventScroll: true });
      }
    };
  }, [host, inertSelector, windowModal]);
  useLayoutEffect(() => {
    const owner = windowId ?? ownerOf(host);
    if (windowModal && active && (!owner || !preserveWindowActionFocus(owner))) root.current?.focus({ preventScroll: true });
  }, [windowModal, active]);
  useLayoutEffect(() => {
    const finished = wasBusy.current && !busy;
    wasBusy.current = busy;
    // 진행이 끝났다고 다른 창에 입력 중인 사용자의 초점을 가져오지 않는다.
    if (finished && !windowModal && document.activeElement === document.body) {
      if (root.current) dialogActionFocus(root.current)?.focus();
    }
  }, [busy, windowModal]);
  const heading = <div className="ks-dialog-title" id={titleId} title={windowModal ? title : undefined}>{title}</div>;
  const content = body != null ? <div className="ks-dialog-body" id={windowModal ? bodyId : undefined}>{body}</div> : null;
  return createPortal(<div className={`ks-dialog-overlay ${overlayClassName}`} data-ks-overlay data-ks-user-consent={userConsent || undefined} ref={overlay} onMouseDown={(event) => { if (!busy && !windowModal && event.target === event.currentTarget) { event.preventDefault(); onCancel(); } }}>
    <div {...rootProps} className="ks-dialog" role="dialog" aria-modal={windowModal ? active : true} aria-labelledby={titleId} aria-describedby={windowModal && body != null ? bodyId : undefined} tabIndex={windowModal ? -1 : undefined} onKeyDown={windowModal ? onKey : undefined} ref={root}>
      {heading}{content != null ? <div className="ks-dialog-scroll" tabIndex={windowModal ? 0 : undefined}>{content}</div> : null}
      {noticeSlotRef ? <div className="ks-dialog-notice-slot" ref={noticeSlotRef} /> : null}
      <div className="ks-dialog-actions">{showCancel ? <Button aria-disabled={busy || undefined} onClick={() => { if (!busyRef.current) onCancel(); }}>{cancelLabel}</Button> : null}<span className={`ks-dialog-confirm${danger ? " is-danger" : ""}`}><Button aria-disabled={busy || undefined} aria-label={ok} aria-busy={busy || undefined} className={busy ? "is-progress" : undefined} onClick={(event) => { if (!busyRef.current) onConfirm(event); }} variant={danger ? "default" : "emphasis"}><span>{ok}</span>{busy ? <span className="ks-button-progress" aria-hidden="true"><LoaderCircle size="control" /></span> : null}</Button></span></div>
    </div>
  </div>, host);
}
