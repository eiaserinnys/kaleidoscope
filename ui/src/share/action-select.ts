import { flushSync } from "react-dom";
import type { CoreError, WindowAction } from "../contract/contract";
import * as errors from "../contract/shell-errors";
import { pointerClick, setInputValue } from "./action-events";
import { overlayOwner, ownedOverlays } from "./overlay-owner";
import { selectOptions, selectRegisteredOption } from "./select-options";

export function clickElement(element: HTMLElement, gesture: "click" | "double_click" = "click"): void {
  const rect = element.getBoundingClientRect();
  pointerClick(element, rect.left + rect.width / 2, rect.top + rect.height / 2, gesture);
}

export function selectElement(windowId: string, element: HTMLElement, choice: Extract<WindowAction, { kind: "select" }>["choice"]): CoreError | undefined {
  const unsupported = () => errors.SHELL_WINDOW_CONTROL_ACTION_UNSUPPORTED({ target: "선택", action: "select" });
  if (element instanceof HTMLInputElement && ["range", "color"].includes(element.type)) {
    if (choice.by !== "value" || (typeof choice.value !== "number" && typeof choice.value !== "string")) return errors.SHELL_WINDOW_CONTROL_OPTION_NOT_FOUND({ choice: String(choice.value) });
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
    setInputValue(element, String(choice.value));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
    return;
  }
  const metadata = selectOptions(element);
  let items: { label: string; value: unknown; disabled?: boolean; element?: HTMLElement }[];
  if (metadata) items = metadata;
  else if (element instanceof HTMLSelectElement) items = [...element.options].map((option) => ({ label: option.label, value: option.value, disabled: option.disabled, element: option }));
  else {
    const parent = element.getAttribute("role") === "tab" ? element.closest('[role="tablist"]') : element;
    if (!parent) return unsupported();
    const selector = element.getAttribute("role") === "tab" ? '[role="tab"]' : '[role="option"]';
    items = [...parent.querySelectorAll<HTMLElement>(selector)].map((item) => ({ label: item.getAttribute("aria-label") ?? item.textContent?.trim() ?? "", value: item.getAttribute("data-value") ?? item.getAttribute("value") ?? item.textContent?.trim(), disabled: item.getAttribute("aria-disabled") === "true", element: item }));
  }
  const matches = items.map((item, index) => ({ item, index })).filter(({ item }) => choice.by === "label" ? item.label === choice.value : JSON.stringify(item.value) === JSON.stringify(choice.value));
  if (!matches.length) return errors.SHELL_WINDOW_CONTROL_OPTION_NOT_FOUND({ choice: String(choice.value) });
  if (matches.length > 1) return errors.SHELL_WINDOW_CONTROL_OPTION_AMBIGUOUS({ choice: String(choice.value) });
  const { item, index } = matches[0];
  if (item.disabled) return errors.SHELL_WINDOW_CONTROL_TARGET_DISABLED({ target: item.label });
  if (element instanceof HTMLSelectElement) { setInputValue(element, String(item.value)); element.dispatchEvent(new Event("change", { bubbles: true })); return; }
  if (metadata) {
    if (selectRegisteredOption(element, index)) return;
    const group = element.closest<HTMLElement>(".ks-data-segmented");
    if (group) { const target = group.querySelectorAll<HTMLButtonElement>("button")[index]; if (target) clickElement(target); else return unsupported(); return; }
    flushSync(() => clickElement(element));
    const menu = ownedOverlays(windowId).find((overlay) => overlayOwner(overlay)?.anchor === element && overlay.getAttribute("role") === "menu");
    const target = menu?.querySelectorAll<HTMLElement>('[role="menuitem"]')[index];
    if (!target) return unsupported();
    clickElement(target); return;
  }
  if (item.element) { clickElement(item.element); return; }
  return unsupported();
}
