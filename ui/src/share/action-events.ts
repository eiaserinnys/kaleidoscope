import { EditorView } from "@codemirror/view";
import type { WindowAction } from "../contract/contract";

export function pointerClick(element: HTMLElement, x: number, y: number, gesture: "click" | "double_click" = "click"): void {
  const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 };
  const Pointer = window.PointerEvent ?? window.MouseEvent;
  for (let detail = 1; detail <= (gesture === "double_click" ? 2 : 1); detail += 1) {
    const pointer = { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true, detail };
    element.dispatchEvent(new Pointer("pointerover", { ...pointer, buttons: 0 }));
    element.dispatchEvent(new Pointer("pointerenter", { ...pointer, bubbles: false, buttons: 0 }));
    element.dispatchEvent(new MouseEvent("mouseover", { ...base, detail, buttons: 0 }));
    element.dispatchEvent(new MouseEvent("mouseenter", { ...base, bubbles: false, detail, buttons: 0 }));
    const down = element.dispatchEvent(new Pointer("pointerdown", { ...pointer, buttons: 1 }));
    if (down) element.dispatchEvent(new MouseEvent("mousedown", { ...base, detail, buttons: 1 }));
    const up = element.dispatchEvent(new Pointer("pointerup", { ...pointer, buttons: 0 }));
    if (up) element.dispatchEvent(new MouseEvent("mouseup", { ...base, detail, buttons: 0 }));
    element.dispatchEvent(new MouseEvent("click", { ...base, detail, buttons: 0 }));
  }
  if (gesture === "double_click") element.dispatchEvent(new MouseEvent("dblclick", { ...base, detail: 2, buttons: 0 }));
}

export function setInputValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

export function typeText(element: HTMLElement, action: Extract<WindowAction, { kind: "type" }>): boolean {
  const editor = EditorView.findFromDOM(element);
  if (editor) {
    const end = editor.state.doc.length;
    editor.dispatch({ changes: { from: action.mode === "replace" ? 0 : end, to: end, insert: action.text }, userEvent: "input.type" });
    return true;
  }
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
  if (element instanceof HTMLInputElement && !["text", "search", "url", "email", "tel", "password", "number"].includes(element.type)) return false;
  setInputValue(element, action.mode === "replace" ? action.text : element.value + action.text);
  return true;
}

const validKeys = new Set(["Enter", "Escape", "Tab", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Backspace", "Delete"]);
const modifiers = new Set(["Control", "Alt", "Meta", "Shift"]);
export function parseKey(input: string): KeyboardEventInit | null {
  const parts = input.split("+"); const key = parts.pop()!;
  if (!validKeys.has(key) || parts.some((part) => !modifiers.has(part)) || new Set(parts).size !== parts.length) return null;
  return { key: key === "Space" ? " " : key, code: key === "Space" ? "Space" : key, ctrlKey: parts.includes("Control"), altKey: parts.includes("Alt"), metaKey: parts.includes("Meta"), shiftKey: parts.includes("Shift"), bubbles: true, cancelable: true, composed: true };
}

export function sendKey(element: HTMLElement, init: KeyboardEventInit): void {
  const accepted = element.dispatchEvent(new KeyboardEvent("keydown", init));
  element.dispatchEvent(new KeyboardEvent("keyup", init));
  const button = element.matches('button, input[type="button"], input[type="submit"], input[type="reset"], a[href], [role="button"]');
  if (accepted && button && (init.key === "Enter" || init.key === " ")) element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, detail: 0 }));
}
