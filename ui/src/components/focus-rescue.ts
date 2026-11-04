// 초점을 가진 요소가 사라져 쉘이 대신 옮긴 초점을 표시한다.
// 스스로 초점을 옮기려던 부품(늦은 응답 뒤 새 행으로 가는 트리 등)은 이 초점을
// 사용자가 고른 초점으로 보지 않고 가져갈 수 있다. 사용자가 다른 요소로 옮기면 그 요소는 표시가 없다.
import { ownerOf } from "../share/overlay-owner";
import { preserveWindowActionFocus } from "../share/action-context";
const rescued = new WeakSet<Element>();

export const writableControlSelector = 'textarea:not(:disabled):not([readonly]), input:not(:disabled):not([readonly]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="range"]):not([type="color"]):not([type="file"]), select:not(:disabled), [contenteditable]:not([contenteditable="false"])';

export function focusRescued(element: HTMLElement, options?: FocusOptions) {
  const owner = ownerOf(element);
  if (owner && preserveWindowActionFocus(owner)) return;
  rescued.add(element);
  element.addEventListener("blur", () => rescued.delete(element), { once: true });
  element.focus(options);
}

/** 초점이 아직 사용자 것으로 정해지지 않았는가: 문서 본문이거나 쉘이 대신 옮긴 요소. */
export function isUnclaimedFocus(active: Element | null) {
  return !active || active === document.body || rescued.has(active);
}
