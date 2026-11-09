// 초점을 가진 요소가 사라져 쉘이 대신 옮긴 초점을 표시한다.
// 스스로 초점을 옮기려던 부품(늦은 응답 뒤 새 행으로 가는 트리 등)은 이 초점을
// 사용자가 고른 초점으로 보지 않고 가져갈 수 있다. 사용자가 다른 요소로 옮기면 그 요소는 표시가 없다.
import { ownerOf } from "../share/overlay-owner";
import { preserveWindowActionFocus } from "../share/action-context";
const rescued = new WeakSet<Element>();
const lastWindowFocus = new WeakMap<HTMLElement, HTMLElement>();

// 쉘이 대신 옮기는 초점에 링을 그릴지 정하려고 마지막 입력 방식을 기억한다.
// 키보드로 창을 열었거나 탭으로 들어왔을 때만 링을 그리고, 포인터로 열었거나 아직 입력이 없으면 그리지 않는다.
let keyboardInput = false;
const modifierKeys = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock"]);

/** 키보드로 조작했다는 것을 기록한다. 쉘이 먼저 가로채 문서까지 오지 않는 단축키도 이 함수로 알린다. */
export function noteKeyboardInput() {
  keyboardInput = true;
}

document.addEventListener("keydown", (event) => { if (!modifierKeys.has(event.key)) noteKeyboardInput(); }, true);
document.addEventListener("pointerdown", () => { keyboardInput = false; }, true);

type FocusOptionsWithVisibility = FocusOptions & { focusVisible?: boolean };

export const writableControlSelector = 'textarea:not(:disabled):not([readonly]), input:not(:disabled):not([readonly]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="range"]):not([type="color"]):not([type="file"]), select:not(:disabled), [contenteditable]:not([contenteditable="false"])';

const controlSelector = 'button, input:not([type="hidden"]), textarea, select, a[href], [tabindex], [contenteditable], iframe, canvas';
const contentSelector = `[role="option"][tabindex="0"], [role="treeitem"][tabindex="0"], [role="row"][tabindex="0"], [role="gridcell"][tabindex="0"], ${writableControlSelector}, iframe, canvas[tabindex]`;
const paneSelector = '.ks-split-pane, [role="tabpanel"], .ks-data-window-body';

export function usableFocus(element: HTMLElement | null): element is HTMLElement {
  return Boolean(element?.isConnected && !element.matches(':disabled, [aria-disabled="true"]')
    && !element.closest('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]')
    && (typeof element.checkVisibility !== "function" || element.checkVisibility({ visibilityProperty: true })));
}

function restorableFocus(element: HTMLElement | null): element is HTMLElement {
  return Boolean(element?.isConnected && !element.matches(":disabled")
    && !element.closest("[hidden], [inert]")
    && (typeof element.checkVisibility !== "function" || element.checkVisibility({ visibilityProperty: true })));
}

/** 사용자가 직접 조작하던 내용 칸인가: 목록과 트리와 표의 현재 칸, 쓰기 입력, iframe, canvas. */
export function isContentFocus(element: HTMLElement): boolean {
  return element.matches(contentSelector);
}

export function firstContentFocus(within: HTMLElement): HTMLElement | undefined {
  return Array.from(within.querySelectorAll<HTMLElement>(contentSelector)).find((element) =>
    usableFocus(element) && !element.closest('[data-ks-user-consent]') && !element.matches('.ks-split-handle, [role="separator"]') && !element.closest('.ks-toolbar, .ks-data-toolbar, [role="toolbar"]'));
}

export function firstFocus(within: HTMLElement): HTMLElement | undefined {
  return firstContentFocus(within) ?? Array.from(within.querySelectorAll<HTMLElement>(controlSelector))
    .find((element) => usableFocus(element) && !element.closest('[data-ks-user-consent]') && !element.matches('.ks-button-emphasis, .ks-split-handle, [role="separator"]') && (element.tabIndex >= 0 || element.isContentEditable));
}

/** 대화상자 바닥 단추 줄에서 초점을 받을 단추: 취소가 있으면 그 단추, 없으면 확정 단추. */
export function dialogActionFocus(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(".ks-dialog-actions > button:not(:disabled):not([aria-disabled=\"true\"]), .ks-dialog-confirm button:not(:disabled):not([aria-disabled=\"true\"])");
}

/** 진행 표시로 막혀 있지만 초점은 그대로 두어야 하는 대화상자 단추인가. */
export function busyDialogAction(element: HTMLElement | null): element is HTMLElement {
  return Boolean(element?.matches('.ks-dialog-actions button[aria-disabled="true"], .ks-dialog-confirm button[aria-disabled="true"]')
    && !element.closest('[hidden], [inert]'));
}

/** 쓰기 입력, 프레임, 덮개처럼 다른 창이 가져가면 안 되는 초점인가. */
export function holdsUserFocus(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return (element.matches(writableControlSelector) && usableFocus(element))
    || (element.matches("iframe") && usableFocus(element))
    || Boolean(element.closest("[data-ks-overlay]"));
}

/** 대화상자가 열리거나 다시 초점을 받을 때 갈 곳: 본문의 쓰기 입력, 없으면 바닥 단추. */
export function dialogFirstFocus(root: HTMLElement): HTMLElement | null {
  const input = [...root.querySelectorAll<HTMLElement>(`.ks-dialog-body :is(${writableControlSelector})`)]
    .find((element) => !element.closest("[hidden], [inert]")
      && (typeof element.checkVisibility !== "function" || element.checkVisibility({ visibilityProperty: true })));
  return input ?? dialogActionFocus(root);
}

export function focusContainer(element: HTMLElement): HTMLElement {
  if (!element.hasAttribute("tabindex")) element.tabIndex = -1;
  element.classList.add("ks-focus-rescue-empty");
  element.addEventListener("blur", () => element.classList.remove("ks-focus-rescue-empty"), { once: true });
  return element;
}

export type FocusBookmark = { element: HTMLElement | null; pane: HTMLElement | null };

export function focusBookmark(element: HTMLElement | null, content: HTMLElement): FocusBookmark {
  const pane = element?.closest<HTMLElement>(paneSelector);
  return { element, pane: pane && content.contains(pane) ? pane : content };
}

const splitHandleSelector = '.ks-split-handle, [role="separator"]';

export function bookmarkTarget(bookmark: FocusBookmark, content: HTMLElement): HTMLElement {
  if (restorableFocus(bookmark.element) && content.contains(bookmark.element) && !bookmark.element.matches(splitHandleSelector)) return bookmark.element;
  if (bookmark.pane?.isConnected && content.contains(bookmark.pane)) {
    if (bookmark.pane.querySelector(".ks-data-skeleton") && !firstContentFocus(bookmark.pane)) return focusContainer(bookmark.pane);
    return firstContentFocus(bookmark.pane) ?? firstFocus(bookmark.pane) ?? focusContainer(bookmark.pane);
  }
  return firstFocus(content) ?? focusContainer(content);
}

/** 본문 밖(알림, 창 머리)에서 초점을 잃었을 때: 지나온 단추가 아니라 마지막 내용 초점으로 돌아간다. */
export function contentRescueTarget(lastContent: HTMLElement | null, bookmark: FocusBookmark, content: HTMLElement): HTMLElement {
  if (usableFocus(lastContent) && content.contains(lastContent)) return lastContent;
  const pane = bookmark.pane?.isConnected && content.contains(bookmark.pane) ? bookmark.pane : content;
  return firstContentFocus(pane) ?? focusContainer(content);
}

export function clearRescuedFocus() {
  if (document.activeElement) rescued.delete(document.activeElement);
}

export function rememberWindowFocus(content: HTMLElement, target: HTMLElement) {
  lastWindowFocus.set(content, target);
}

export function lastFocusInWindow(host: HTMLElement): HTMLElement | null {
  const content = host.closest<HTMLElement>(".ks-window-content")
    ?? host.closest<HTMLElement>(".ks-window")?.querySelector<HTMLElement>(".ks-window-content")
    ?? host;
  return lastWindowFocus.get(content) ?? null;
}

export function restoreWindowFocus(content: HTMLElement) {
  if (!content.isConnected || !document.hasFocus()) return;
  const body = content.querySelector<HTMLElement>(".ks-data-window-body") ?? content;
  const last = lastWindowFocus.get(content) ?? null;
  const owner = ownerOf(content);
  if (owner && preserveWindowActionFocus(owner)) return;
  const target = usableFocus(last) && !last.matches('.ks-split-handle, [role="separator"]') && body.contains(last) ? last : firstFocus(body) ?? focusContainer(body);
  focusRescued(target, { preventScroll: true });
}

export function focusRescued(element: HTMLElement, options?: FocusOptionsWithVisibility) {
  const owner = ownerOf(element);
  if (owner && preserveWindowActionFocus(owner)) return;
  rescued.add(element);
  element.addEventListener("blur", () => rescued.delete(element), { once: true });
  element.focus({ ...options, focusVisible: options?.focusVisible ?? keyboardInput } as FocusOptions);
}

/** 초점이 아직 사용자 것으로 정해지지 않았는가: 문서 본문이거나 쉘이 대신 옮긴 요소. */
export function isUnclaimedFocus(active: Element | null) {
  return !active || active === document.body || rescued.has(active);
}
