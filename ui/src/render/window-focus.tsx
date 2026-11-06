import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { ShellStore } from "../core/shell-store";
import { useShellSelector } from "../core/shell-store";
import { isWindowTop } from "../data/window-state";
import { bookmarkTarget, clearRescuedFocus, contentRescueTarget, firstContentFocus, firstFocus, focusBookmark, focusContainer, focusRescued, isContentFocus, isUnclaimedFocus, rememberWindowFocus, usableFocus, writableControlSelector } from "../components/focus-rescue";
import { preserveWindowActionFocus } from "../share/action-context";
import { revealStackControl } from "./focus-scroll";
import { isCommenting } from "../comments/session";

export function WindowFocus({ host, store, windowId }: { host: RefObject<HTMLDivElement | null>; store: ShellStore; windowId: string }) {
  const top = useShellSelector(store, (snapshot) => isWindowTop(snapshot, windowId));
  const updateTop = useRef<(top: boolean) => void>(() => undefined);
  const waiting = useRef<{ pane: HTMLElement; kind: "entry" | "restore" } | null>(null);
  useEffect(() => {
    const content = host.current;
    if (!content) return;
    const body = content.querySelector<HTMLElement>(".ks-data-window-body") ?? content;
    const bodyUnavailable = () => Boolean(body.closest("[hidden], [inert]"));
    const scope = content.closest<HTMLElement>(".ks-window-frame") ?? content;
    const windowContent = content.closest<HTMLElement>(".ks-window-content") ?? content;
    const commenting = () => isCommenting(windowId) || Boolean(content.closest(".ks-window[data-commenting]"));
    let focused: HTMLElement | null = null;
    let focusedDialog = false;
    let focusedItem: HTMLElement | null = null;
    let focusedRemove = false;
    let focusPath: Array<{ ancestor: HTMLElement; controlIndex: number }> = [];
    let bookmark = focusBookmark(null, body);
    // StrictMode가 효과를 다시 붙일 때처럼 이 인스턴스가 붙기 전에 초점을 받은 내용 칸을 이어받는다.
    const seeded = document.activeElement;
    let lastContent: HTMLElement | null = seeded instanceof HTMLElement && body.contains(seeded) && isContentFocus(seeded) ? seeded : null;
    let inContent = false;
    let pointer = false;
    let focusFrame = 0;
    let tabMove = false;
    let onTop = false;
    let moving = false;
    const visibleControls = (within: ParentNode) => Array.from(within.querySelectorAll<HTMLElement>('button, input:not([type="hidden"]), textarea, select, a[href], [tabindex]'))
      .filter((element) => element.tabIndex >= 0 && usableFocus(element) && !element.matches('.ks-split-handle, [role="separator"]'));
    const move = (target: HTMLElement) => {
      moving = true;
      focusRescued(target, pointer ? { preventScroll: true } : undefined);
      moving = false;
    };
    const stopWaiting = () => { waiting.current = null; };
    const onPointer = (event: PointerEvent) => {
      pointer = true; tabMove = false;
      if (event.isTrusted) { stopWaiting(); clearRescuedFocus(); }
    };
    const onKey = (event: KeyboardEvent) => {
      pointer = false;
      tabMove = event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey;
      if (event.isTrusted) { stopWaiting(); clearRescuedFocus(); }
    };
    const onKeyUp = () => { tabMove = false; };
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (waiting.current && !moving && target !== waiting.current.pane) stopWaiting();
      if (commenting()) { stopWaiting(); return; }
      if (!(target instanceof HTMLElement) || !scope.contains(target)) return;
      const fromTab = tabMove; tabMove = false;
      cancelAnimationFrame(focusFrame);
      if (fromTab && content.contains(target)) focusFrame = requestAnimationFrame(() => {
        if (document.activeElement === target) revealStackControl(target);
      });
      if (target === content || target.classList.contains("ks-window-content")) return;
      focused = target;
      focusedDialog = Boolean(target.closest(".ks-dialog-overlay"));
      focusedRemove = target.classList.contains("ks-list-remove");
      inContent = body.contains(target);
      if (!inContent) return;
      if (isContentFocus(target)) lastContent = target;
      rememberWindowFocus(windowContent, target);
      bookmark = focusBookmark(target, body);
      focusedItem = null;
      for (let item: HTMLElement | null = target; item && body.contains(item); item = item.parentElement) {
        if (item.matches('[role="option"], [role="listitem"], [role="row"][data-focus-index]') || item.parentElement?.matches('.ks-repeat-content')) {
          focusedItem = item; break;
        }
      }
      focusPath = [];
      for (let ancestor = target.parentElement; ancestor && body.contains(ancestor); ancestor = ancestor.parentElement) {
        focusPath.push({ ancestor, controlIndex: visibleControls(ancestor).indexOf(target) });
      }
    };
    const collectionTarget = (changes: MutationRecord[]): HTMLElement | undefined => {
      const collection = inContent ? focusPath.find(({ ancestor }) => ancestor.matches('.ks-repeat-content, .ks-agent-attachment-list, [role="list"], [role="listbox"], [role="table"]')) : undefined;
      if (!collection || !focusedItem || focusedItem.isConnected) return;
      const group = collection.ancestor;
      const removableList = group.matches('.ks-list[role="list"]');
      const visible = visibleControls(body);
      let anchor: Node = group;
      if (body.contains(group)) {
        if (removableList) {
          const items = Array.from(group.querySelectorAll<HTMLElement>('[role="listitem"][data-list-index]'));
          const index = Number(focusedItem.dataset.listIndex);
          const item = items.find((candidate) => Number(candidate.dataset.listIndex) >= index) ?? items.at(-1);
          const target = item?.querySelector<HTMLElement>(focusedRemove ? ".ks-list-remove" : "button");
          if (usableFocus(target ?? null)) return target!;
        }
        const addedControl = changes.some((change) => body.contains(change.target)
          && Array.from(change.addedNodes).some((node) => visible.some((control) => node.contains(control))));
        if (addedControl && !removableList) return;
        const controls = visibleControls(group);
        if (controls.length) return controls[Math.max(0, collection.controlIndex)] ?? controls[controls.length - 1];
      } else {
        const parent = focusPath.find(({ ancestor }) => body.contains(ancestor))?.ancestor;
        if (!parent) return;
        const added = changes.filter((change) => change.target === parent).flatMap((change) => Array.from(change.addedNodes));
        anchor = added.find((node) => parent.contains(node)) ?? parent;
      }
      if (removableList) {
        return visible.filter((element) => Boolean(element.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1)
          ?? visible.find((element) => Boolean(anchor.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) && !anchor.contains(element))
          ?? focusContainer(body);
      }
      const addedControl = changes.some((change) => body.contains(change.target)
        && Array.from(change.addedNodes).some((node) => visible.some((control) => node.contains(control))));
      if (addedControl) return;
      return visible.find((element) => element.classList.contains("ks-agent-chat-input"))
        ?? visible.filter((element) => Boolean(element.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1)
        ?? focusContainer(body);
    };
    const start = () => {
      const active = document.activeElement;
      if (!onTop || commenting() || bodyUnavailable() || !document.hasFocus() || preserveWindowActionFocus(windowId) || (active instanceof Element && scope.contains(active))) return;
      if (active instanceof HTMLElement && ((active.matches(writableControlSelector) && usableFocus(active))
        || (active.matches("iframe") && usableFocus(active)) || active.closest("[data-ks-overlay]"))) return;
      const target = usableFocus(focused) && !focused.matches('.ks-split-handle, [role="separator"]') && body.contains(focused) ? focused : firstFocus(body) ?? focusContainer(body);
      move(target);
      if (!firstContentFocus(body)) waiting.current = { pane: body, kind: "entry" };
    };
    updateTop.current = (value) => { onTop = value; if (value) start(); else stopWaiting(); };
    const observer = new MutationObserver((changes) => {
      if (commenting()) { stopWaiting(); return; }
      const active = document.activeElement;
      const unavailable = focused && (!focused.isConnected || !scope.contains(focused)
        || focused.matches(":disabled") || focused.closest("[hidden], [inert]"));
      if (onTop && focused && !focusedDialog && unavailable && !bodyUnavailable()) {
        const lost = active === document.body || active === focused || (active instanceof Element && scope.contains(active) && isUnclaimedFocus(active));
        if (lost && !preserveWindowActionFocus(windowId)) {
          const target = inContent
            ? collectionTarget(changes) ?? bookmarkTarget(bookmark, body)
            : contentRescueTarget(lastContent, bookmark, body);
          focused = null;
          move(target);
          if (bookmark.pane?.isConnected && !firstContentFocus(bookmark.pane)) waiting.current = { pane: bookmark.pane, kind: "restore" };
        }
      }
      if (waiting.current && onTop && !bodyUnavailable() && isUnclaimedFocus(document.activeElement)) {
        const target = firstContentFocus(waiting.current.pane);
        if (target) { stopWaiting(); move(target); }
        else if (waiting.current.kind === "entry" && document.activeElement === waiting.current.pane) {
          const control = firstFocus(waiting.current.pane);
          if (control) move(control);
        }
      }
    });
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onKeyUp, true);
    observer.observe(scope, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "hidden", "inert"] });
    return () => {
      updateTop.current = () => undefined;
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keyup", onKeyUp, true);
      observer.disconnect();
    };
  }, [host, store, windowId]);
  useEffect(() => { updateTop.current(top); }, [top]);
  return null;
}
