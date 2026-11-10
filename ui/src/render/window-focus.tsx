import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { ShellStore } from "../core/shell-store";
import { useShellSelector } from "../core/shell-store";
import { isWindowTop } from "../data/window-state";
import { bookmarkTarget, busyDialogAction, clearRescuedFocus, contentRescueTarget, dialogActionFocus, dialogFirstFocus, firstContentFocus, firstFocus, focusBookmark, focusContainer, focusRescued, holdsUserFocus, isContentFocus, isUnclaimedFocus, rememberWindowFocus, usableFocus } from "../components/focus-rescue";
import { preserveWindowActionFocus } from "../share/action-context";
import { revealStackControl } from "./focus-scroll";
import { isCommenting } from "../comments/session";

export function WindowFocus({ host, store, windowId }: { host: RefObject<HTMLDivElement | null>; store: ShellStore; windowId: string }) {
  const topZ = useShellSelector(store, (snapshot) =>
    isWindowTop(snapshot, windowId)
      ? snapshot?.shared.windows.find((window) => window.id === windowId)?.z ?? 0
      : -1,
  );
  const top = topZ >= 0;
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
    let focusedDialogElement: HTMLElement | null = null;
    let focusedItem: HTMLElement | null = null;
    let focusedRemove = false;
    let focusPath: Array<{ ancestor: HTMLElement; childIndex: number; controlIndex: number; swapIndex: number }> = [];
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
    // 초점을 받을 수 있는 조작. 프로그램으로 초점을 받는 tabIndex=-1도 들어간다.
    const focusableControls = (within: ParentNode) => Array.from(within.querySelectorAll<HTMLElement>('button, input:not([type="hidden"]), textarea, select, a[href], [tabindex]'))
      .filter((element) => usableFocus(element) && !element.matches('.ks-split-handle, [role="separator"]'));
    const tabbableControls = (controls: HTMLElement[]) => controls.filter((element) => element.tabIndex >= 0);
    // 기존 복구 경로(모음, 북마크, 본문 밖)는 Tab 순서에 드는 조작만 고른다.
    const visibleControls = (within: ParentNode) => tabbableControls(focusableControls(within));
    const move = (target: HTMLElement, stay?: boolean) => {
      moving = true;
      focusRescued(target, (stay ?? pointer) ? { preventScroll: true } : undefined);
      moving = false;
    };
    const isControl = (element: HTMLElement) => element.matches('button, input:not([type="hidden"]), textarea, select, a[href], [tabindex]') && element.tabIndex >= 0;
    // 사라진 조작과 같은 자리에 새 조작이 생기면 그것이 사용자가 이어서 다루려던 조작이다. 이때 문서
    // 첫 내용 초점으로 가면 칸이 맨 위로 튄다. 새 조작은 화면 값이 두 번에 나뉘어 와서 초점 쥔 조작이
    // 사라지는 알림보다 앞선 알림에서 생길 수 있으므로, 초점을 받은 뒤 생긴 노드를 모아 두고 사라지는
    // 알림에서 그 모음으로 판정한다. 모음은 초점이 바뀔 때 비우고 WeakSet이라 노드를 붙잡지 않는다.
    // 같은 자리의 새 조작은 트리 행처럼 Tab 순서에 들지 않아도(tabIndex=-1) 받는다.
    let addedSinceFocus = new WeakSet<Node>();
    const addedAfterFocus = (target: HTMLElement) => {
      for (let node: HTMLElement | null = target; node && body.contains(node); node = node.parentElement) {
        if (addedSinceFocus.has(node)) return true;
      }
      return false;
    };
    const swapTarget = (): HTMLElement | undefined => {
      if (!focused || focused.isConnected || !isControl(focused)) return undefined;
      // 사라진 조작에 되돌아갈 조작 표시가 있으면, 같은 자리에 새로 생긴 덩어리 안에서 그 조작을 먼저 고른다.
      // 반복 key가 바뀌면 구역 항목째 다시 만들어져 초점을 쥔 조작이 사라지므로, 모음 복구보다 앞서 판정한다.
      const returnSelector = focused.getAttribute("data-focus-return");
      if (returnSelector) {
        for (const { ancestor, childIndex } of focusPath) {
          if (!body.contains(ancestor) || childIndex < 0) continue;
          const child = ancestor.children[childIndex];
          if (!(child instanceof HTMLElement) || !addedAfterFocus(child)) continue;
          const target = focusableControls(child).find((element) => element.matches(returnSelector) && !element.matches(".ks-button-emphasis"));
          if (target) return target;
          break;
        }
      }
      // 사라진 조작이 속한 모음 항목까지 사라졌으면 기존 모음 복구가 맡는다.
      if (focusedItem && !focusedItem.isConnected) return undefined;
      for (const { ancestor, swapIndex } of focusPath) {
        if (!body.contains(ancestor) || swapIndex < 0) continue;
        const controls = focusableControls(ancestor);
        const target = controls[Math.max(0, swapIndex)] ?? controls[controls.length - 1];
        if (target && !target.matches(".ks-button-emphasis") && addedAfterFocus(target)) return target;
      }
      return undefined;
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
    // 창 안의 초점을 이어받아 둔다. 초점이 사라졌을 때 이 기록으로 복구 대상을 찾는다.
    const capture = (target: HTMLElement) => {
      addedSinceFocus = new WeakSet();
      const fromTab = tabMove; tabMove = false;
      cancelAnimationFrame(focusFrame);
      if (fromTab && content.contains(target)) focusFrame = requestAnimationFrame(() => {
        if (document.activeElement === target) revealStackControl(target);
      });
      focused = target;
      focusedDialog = Boolean(target.closest(".ks-dialog-overlay"));
      focusedDialogElement = focusedDialog ? target.closest<HTMLElement>(".ks-dialog") : null;
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
      let child: Element = target;
      for (let ancestor = target.parentElement; ancestor && body.contains(ancestor); ancestor = ancestor.parentElement) {
        const controls = focusableControls(ancestor);
        focusPath.push({ ancestor, childIndex: Array.prototype.indexOf.call(ancestor.children, child), controlIndex: tabbableControls(controls).indexOf(target), swapIndex: controls.indexOf(target) });
        child = ancestor;
      }
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (waiting.current && !moving && target !== waiting.current.pane) stopWaiting();
      if (commenting()) { stopWaiting(); return; }
      if (!(target instanceof HTMLElement) || !scope.contains(target)) return;
      if (target === content || target.classList.contains("ks-window-content")) return;
      capture(target);
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
      if (!onTop || commenting() || !document.hasFocus() || preserveWindowActionFocus(windowId) || (active instanceof Element && scope.contains(active))) return;
      // 다른 창에 입력하거나 덮개 안에 있으면 초점을 가져오지 않는다. 대화상자 창이 열려도 마찬가지다.
      if (holdsUserFocus(active)) return;
      // 대화상자가 열리면 본문이 inert라 초점을 받을 수 없다. 창으로 돌아오면 열린 대화상자 안으로 초점을 되돌린다.
      if (bodyUnavailable()) {
        const dialog = Array.from(content.querySelectorAll<HTMLElement>(":scope > .ks-dialog-overlay > .ks-dialog")).at(-1);
        if (!dialog) return;
        const current = usableFocus(focused) ? focused : busyDialogAction(focused) ? focused : null;
        const target = current && dialog.contains(current) ? current : dialogFirstFocus(dialog);
        if (target && (usableFocus(target) || busyDialogAction(target))) move(target);
        return;
      }
      const target = usableFocus(focused) && !focused.matches('.ks-split-handle, [role="separator"]') && body.contains(focused) ? focused : firstFocus(body) ?? focusContainer(body);
      move(target);
      if (!firstContentFocus(body)) waiting.current = { pane: body, kind: "entry" };
    };
    updateTop.current = (value) => { onTop = value; if (value) start(); else stopWaiting(); };
    const observer = new MutationObserver((changes) => {
      const addedNow = changes.filter((change) => body.contains(change.target))
        .flatMap((change) => Array.from(change.addedNodes)).filter((node): node is HTMLElement => node instanceof HTMLElement);
      for (const node of addedNow) addedSinceFocus.add(node);
      if (commenting()) { stopWaiting(); return; }
      const active = document.activeElement;
      const unavailable = focused && (!focused.isConnected || !scope.contains(focused)
        || focused.matches(":disabled") || focused.closest("[hidden], [inert]"));
      if (onTop && focused && !focusedDialog && unavailable && !bodyUnavailable()) {
        const lost = active === document.body || active === focused || (active instanceof Element && scope.contains(active) && isUnclaimedFocus(active));
        if (lost && !preserveWindowActionFocus(windowId)) {
          const swap = inContent ? swapTarget() : undefined;
          const target = swap ?? (inContent
            ? collectionTarget(changes) ?? bookmarkTarget(bookmark, body)
            : contentRescueTarget(lastContent, bookmark, body));
          focused = null;
          move(target, swap ? true : undefined);
          if (bookmark.pane?.isConnected && !firstContentFocus(bookmark.pane)) waiting.current = { pane: bookmark.pane, kind: "restore" };
        }
      }
      // 대화상자 안의 알림 단추처럼 대화상자는 살아 있는데 초점 요소만 사라지면, 창 본문이 아니라 그 대화상자의 첫 조작으로 옮긴다.
      if (onTop && focused && focusedDialog && !focused.isConnected && focusedDialogElement?.isConnected) {
        const lost = active === document.body || active === focused || (active instanceof Element && scope.contains(active) && isUnclaimedFocus(active));
        if (lost && !preserveWindowActionFocus(windowId)) {
          const target = dialogActionFocus(focusedDialogElement);
          if (usableFocus(target ?? null)) {
            focused = null;
            focusedDialog = false;
            focusedDialogElement = null;
            move(target!);
          }
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
    // StrictMode가 효과를 다시 붙였거나 창 조작 뒤에 다시 붙었을 때, 이 인스턴스가 붙기 전에
    // 이미 창 안에 있던 초점을 이어받는다. 이어받지 않으면 그 초점이 사라져도 복구하지 못한다.
    if (!commenting() && seeded instanceof HTMLElement && seeded !== content
      && !seeded.classList.contains("ks-window-content") && seeded.isConnected && scope.contains(seeded)) capture(seeded);
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
  useEffect(() => { updateTop.current(top); }, [top, topZ]);
  return null;
}
