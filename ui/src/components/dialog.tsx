import { useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./primitives";
import { LoaderCircle } from "./icons";
import { ownerOf, registerOverlay } from "../share/overlay-owner";
import { preserveWindowActionFocus, windowActionActive } from "../share/action-context";
import { bookmarkTarget, dialogActionFocus, dialogFirstFocus, focusBookmark, focusRescued, holdsUserFocus, lastFocusInWindow, type FocusBookmark } from "./focus-rescue";

const interactiveSelector = 'button, a[href], input, textarea, select, label, summary, iframe, [tabindex], [contenteditable], .cm-editor';

export function Dialog({ host, title, body, ok, danger, showCancel = true, cancelLabel = "취소", onCancel, onConfirm, overlayClassName = "", inertSelector = ":scope > .ks-data-window-body, :scope > .ks-data-window-notice", windowModal = false, active = true, userConsent = false, windowId, busy = false, rootProps, ownerAnchor, noticeSlotRef }: { ownerAnchor?: Element | null; rootProps?: import("../comments/block-root").BlockRootProps; noticeSlotRef?: (element: HTMLDivElement | null) => void; host: HTMLElement; title: string; body?: ReactNode; ok: string; danger?: boolean; showCancel?: boolean; cancelLabel?: string; onCancel: () => void; onConfirm: (event: MouseEvent<HTMLButtonElement>) => void; overlayClassName?: string; inertSelector?: string; windowModal?: boolean; active?: boolean; userConsent?: boolean; windowId?: string; busy?: boolean }) {
  const titleId = useId();
  const bodyId = useId();
  const root = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const opener = useRef<FocusBookmark | null>(null);
  const rememberedFocus = useRef<HTMLElement | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const hasContent = body != null;
  // 보이는 높이가 있고 내용이 넘칠 때만 스크롤 칸이 Tab 초점을 받는다. 높이 0인 칸에서 Tab이 멈추면 고리가 보이지 않는다.
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const measure = () => setScrollable(element.clientHeight > 0 && element.scrollHeight > element.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const content = element.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [hasContent]);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const wasBusy = useRef(busy);
  const onKey = (event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault" | "stopPropagation">) => {
    const native = event as KeyboardEvent;
    const owner = windowId ?? ownerOf(host);
    const targetOwner = native.target instanceof Element ? ownerOf(native.target) : undefined;
    // 다른 창에서 누른 키는 이 창의 대화상자를 닫지 않는다. 쉘 전체 대화상자처럼 임자가 없는 경우는 지금처럼 둔다.
    if (owner) {
      if (targetOwner && targetOwner !== owner) return;
      if (!targetOwner) {
        // 창이 아닌 쉘 단추나 태스크바에서 누른 키는 이 창의 것이 아니다.
        if (native.target !== document.body && native.target !== document.documentElement) return;
        // 초점이 바닥에 있으면 맨 위 창의 대화상자만 받는다.
        const frame = host.closest<HTMLElement>(".ks-window-frame");
        if (frame && !frame.classList.contains("ks-window-frame-active")) return;
      }
    }
    if (native.isTrusted === false && targetOwner && windowActionActive(targetOwner) && targetOwner !== owner) return;
    if (event.key === "Escape") { event.preventDefault(); if (windowModal) event.stopPropagation(); if (!busyRef.current) onCancelRef.current(); return; }
    if (event.key !== "Tab" || !root.current) return;
    // 브라우저 Tab 순서와 같게 스크롤 칸과 details 요약도 초점 대상으로 센다.
    const focusable = [...root.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])')];
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
    const foreign = previous !== null && !host.contains(previous) && holdsUserFocus(previous);
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
    // 진행이 끝나면 초점을 대화상자로 되돌리되, 이 대화상자가 맡은 자리 밖에서 쓰는 초점은 가져오지 않는다.
    const focused = document.activeElement;
    if (finished && !windowModal && !root.current?.contains(focused) && (focused === document.body || host.contains(focused))) {
      if (root.current) dialogActionFocus(root.current)?.focus();
    }
  }, [busy, host, windowModal]);
  const heading = <div className="ks-dialog-title" id={titleId} title={windowModal ? title : undefined}>{title}</div>;
  const content = body != null ? <div className="ks-dialog-body" id={windowModal ? bodyId : undefined}>{body}</div> : null;
  return createPortal(<div className={`ks-dialog-overlay ${overlayClassName}`} data-ks-overlay data-ks-user-consent={userConsent || undefined} ref={overlay}
    onMouseDown={(event) => {
      // 오른쪽 누름이나 틀 밖까지 끈 선택은 click이 오지 않으므로 기억한 초점은 다음 누름까지만 산다.
      rememberedFocus.current = null;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!busy && !windowModal && target === event.currentTarget) { event.preventDefault(); onCancel(); return; }
      if (target === event.currentTarget) return;
      const interactive = target.closest(interactiveSelector);
      if (interactive && event.currentTarget.contains(interactive)) return;
      // 읽고 복사할 글은 끌어 고를 수 있게 두고, 눌렀다 뗄 때만 초점을 되돌린다.
      if (getComputedStyle(target).userSelect !== "none") {
        const active = document.activeElement;
        if (active instanceof HTMLElement && root.current?.contains(active)) rememberedFocus.current = active;
        return;
      }
      event.preventDefault();
    }}
    onClick={() => {
      const element = rememberedFocus.current;
      rememberedFocus.current = null;
      if (element?.isConnected && window.getSelection()?.isCollapsed) element.focus({ preventScroll: true });
    }}>
    <div {...rootProps} className="ks-dialog" role="dialog" aria-modal={windowModal ? active : true} aria-labelledby={titleId} aria-describedby={windowModal && body != null ? bodyId : undefined} tabIndex={windowModal ? -1 : undefined} onKeyDown={windowModal ? onKey : undefined} ref={root}>
      {heading}{content != null ? <div className="ks-dialog-scroll" tabIndex={scrollable ? 0 : undefined} ref={scroll}>{content}</div> : null}
      {noticeSlotRef ? <div className="ks-dialog-notice-slot" ref={noticeSlotRef} /> : null}
      <div className="ks-dialog-actions">{showCancel ? <Button aria-disabled={busy || undefined} onClick={() => { if (!busyRef.current) onCancel(); }}>{cancelLabel}</Button> : null}<span className={`ks-dialog-confirm${danger ? " is-danger" : ""}`}><Button aria-disabled={busy || undefined} aria-label={ok} aria-busy={busy || undefined} className={busy ? "is-progress" : undefined} onClick={(event) => { if (!busyRef.current) onConfirm(event); }} variant={danger ? "default" : "emphasis"}><span>{ok}</span>{busy ? <span className="ks-button-progress" aria-hidden="true"><LoaderCircle size="control" /></span> : null}</Button></span></div>
    </div>
  </div>, host);
}
