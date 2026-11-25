import { useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./primitives";
import { LoaderCircle } from "./icons";
import { ownerOf, registerOverlay } from "../share/overlay-owner";
import { preserveWindowActionFocus, windowActionActive } from "../share/action-context";
import { bookmarkTarget, dialogActionFocus, dialogFirstFocus, focusBookmark, focusRescued, holdsUserFocus, lastFocusInWindow, type FocusBookmark } from "./focus-rescue";

const interactiveSelector = 'button, a[href], input, textarea, select, label, summary, iframe, [tabindex], [contenteditable], .cm-editor';

export function Dialog({ host, title, body, ok, danger, showCancel = true, cancelLabel = "취소", onCancel, onConfirm, overlayClassName = "", inertSelector = ":scope > .ks-data-window-body, :scope > .ks-data-window-notice", windowModal = false, active = true, userConsent = false, surfaceFocus = false, windowId, busy = false, confirmDisabled = false, rootProps, ownerAnchor, noticeSlotRef }: { ownerAnchor?: Element | null; rootProps?: import("../comments/block-root").BlockRootProps; noticeSlotRef?: (element: HTMLDivElement | null) => void; host: HTMLElement; title: string; body?: ReactNode; ok: string; danger?: boolean; showCancel?: boolean; cancelLabel?: string; onCancel: () => void; onConfirm: (event: MouseEvent<HTMLButtonElement>) => void; overlayClassName?: string; inertSelector?: string; windowModal?: boolean; active?: boolean; userConsent?: boolean; surfaceFocus?: boolean; windowId?: string; busy?: boolean; /** 확정 단추를 잠근다. 누르기와 Enter가 막히고 취소, 닫기, Esc는 그대로다. */ confirmDisabled?: boolean }) {
  const titleId = useId();
  const bodyId = useId();
  const root = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const opener = useRef<FocusBookmark | null>(null);
  const openerRow = useRef<{ list: HTMLElement; index: number } | null>(null);
  const rememberedFocus = useRef<HTMLElement | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const [compactClose, setCompactClose] = useState(() => !showCancel && host.classList.contains("ks-data-window") && host.clientHeight > 0 && host.clientHeight <= 300);
  const compactCloseRef = useRef(compactClose);
  const restoreCloseFocus = useRef(false);
  const hasContent = body != null;
  // 제목 줄의 닫기는 실제 DOM 순서도 바꿔 Tab이 보이는 순서대로 움직이게 한다.
  useLayoutEffect(() => {
    if (showCancel || !host.classList.contains("ks-data-window")) return;
    const update = (height: number) => {
      const next = height > 0 && height <= 300;
      if (next === compactCloseRef.current) return;
      compactCloseRef.current = next;
      restoreCloseFocus.current = Boolean(root.current?.querySelector(".ks-dialog-confirm")?.contains(document.activeElement));
      setCompactClose(next);
    };
    update(host.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => update(entries[0].contentRect.height));
    observer.observe(host);
    return () => observer.disconnect();
  }, [host, showCancel]);
  useLayoutEffect(() => {
    if (!restoreCloseFocus.current) return;
    restoreCloseFocus.current = false;
    root.current?.querySelector<HTMLElement>(".ks-dialog-confirm button")?.focus({ preventScroll: true });
  }, [compactClose]);
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
    // 같은 창에 대화상자가 겹치면 문서 키를 맨 위 대화상자만 처리한다.
    const dialogs = [...host.children].filter((element) => element.classList.contains("ks-dialog-overlay"));
    if (dialogs.at(-1) !== overlay.current) return;
    if (event.key === "Escape") { event.preventDefault(); if (windowModal) event.stopPropagation(); if (!busyRef.current) onCancelRef.current(); return; }
    if (event.key !== "Tab" || !root.current) return;
    // 브라우저 Tab 순서와 같게 스크롤 칸과 details 요약도 초점 대상으로 센다.
    const focusable = [...root.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]')].filter((element) => element.tabIndex >= 0);
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
    // 다른 대화상자 안에서 열었다면 닫을 때 그 안의 연 요소로 돌아간다.
    const parentDialog = previous?.closest<HTMLElement>(".ks-dialog");
    // 앱 설정은 창 본문의 형제이므로 설정에서 연 대화상자는 설정 안에서 연 요소를 찾는다.
    const settings = ownerAnchor?.closest<HTMLElement>(".ks-app-settings");
    const content = parentDialog && host.contains(parentDialog) ? parentDialog : settings && host.contains(settings) ? settings : host.querySelector<HTMLElement>(":scope > .ks-data-window-body") ?? host;
    if (!windowModal && !opener.current) {
      const target = previous === document.body ? lastFocusInWindow(host) : previous;
      opener.current = focusBookmark(target, content);
      const row = target?.closest<HTMLElement>('[role="option"][data-focus-index]');
      const list = row?.closest<HTMLElement>('.ks-list[role="listbox"]');
      if (row && list && content.contains(list)) openerRow.current = { list, index: Number(row.dataset.focusIndex) };
    }
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
        const row = openerRow.current;
        const neighbor = !opener.current.element?.isConnected && row?.list.isConnected && content.contains(row.list)
          ? row.list.querySelector<HTMLElement>(`[role="option"][data-focus-index="${row.index}"]`)
            ?? row.list.querySelector<HTMLElement>(`[role="option"][data-focus-index="${row.index - 1}"]`)
          : null;
        focusRescued(neighbor && !neighbor.matches(":disabled") ? neighbor : bookmarkTarget(opener.current, content), { preventScroll: true });
      }
    };
  }, [host, inertSelector, windowModal]);
  useLayoutEffect(() => {
    const owner = windowId ?? ownerOf(host);
    if (windowModal && active && (!owner || !preserveWindowActionFocus(owner))) {
      // 창 대화상자는 보통 첫 조작으로 초점을 옮긴다. 대화상자 틀에 두면 다시 그려질 때
      // 초점이 열었던 단추로 돌아갔다가 틀에 남아, 키보드로 바로 조작할 수 없게 된다.
      // 실행 허용처럼 틀 자체가 안전을 지키는 대화상자는 틀에 둔다(Enter로 허용하지 않는다).
      const target = surfaceFocus ? root.current : root.current ? dialogFirstFocus(root.current) : null;
      target?.focus({ preventScroll: true });
    }
  }, [windowModal, active, host, surfaceFocus]);
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
  const confirm = <span className={`ks-dialog-confirm${danger ? " is-danger" : ""}`}><Button aria-disabled={busy || undefined} aria-label={ok} aria-busy={busy || undefined} className={busy ? "is-progress" : undefined} disabled={confirmDisabled} onClick={(event) => { if (!busyRef.current && !confirmDisabled) onConfirm(event); }} variant={danger ? "default" : "emphasis"}><span>{ok}</span>{busy ? <span className="ks-button-progress" aria-hidden="true"><LoaderCircle size="control" /></span> : null}</Button></span>;
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
      {compactClose ? <div className="ks-dialog-heading">{heading}{confirm}</div> : heading}{content != null ? <div className="ks-dialog-scroll" tabIndex={scrollable ? 0 : undefined} ref={scroll}>{content}</div> : null}
      {noticeSlotRef ? <div className="ks-dialog-notice-slot" ref={noticeSlotRef} /> : null}
      {!compactClose ? <div className="ks-dialog-actions">{showCancel ? <Button aria-disabled={busy || undefined} onClick={() => { if (!busyRef.current) onCancel(); }}>{cancelLabel}</Button> : null}{confirm}</div> : null}
    </div>
  </div>, host);
}
