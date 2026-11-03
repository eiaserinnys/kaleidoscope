import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
import type { CoreError } from "../contract/contract";
import * as shellErrors from "../contract/shell-errors";
import { Menu, type MenuEntry } from "./menu";
import { Button, Notice } from "./primitives";

type MenuEvent = MouseEvent | ReactMouseEvent<HTMLElement>;
type MenuState = { anchor: HTMLElement; point: { x: number; y: number }; entries: MenuEntry[] };
type MenuOptions = { anchor?: HTMLElement; anchorPoint?: { x: number; y: number }; includeText?: boolean; keyboard?: boolean };
let current: MenuState | null = null;
const listeners = new Set<() => void>();
const errors = new Set<(error: CoreError) => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const setMenu = (next: MenuState | null) => { current = next; listeners.forEach((listener) => listener()); };
const closeMenu = () => setMenu(null);
const reportError = (error: CoreError) => errors.forEach((listener) => listener(error));
const reasonText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

export async function writeMenuClipboard(text: string, itemLabel: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (reason) { reportError(shellErrors.SHELL_MENU_CLIPBOARD_WRITE_FAILED({ item: itemLabel, reason: reasonText(reason) })); return false; }
}

async function readMenuClipboard(): Promise<string | null> {
  try { return await navigator.clipboard.readText(); }
  catch (reason) { reportError(shellErrors.SHELL_MENU_CLIPBOARD_READ_FAILED({ reason: reasonText(reason) })); return null; }
}

function textEntries(target: HTMLElement): MenuEntry[] {
  const input = target.closest("input, textarea");
  const field = input instanceof HTMLTextAreaElement || (input instanceof HTMLInputElement && ["text", "search", "url", "email", "tel", "password", "number"].includes(input.type)) ? input : null;
  const editable = target.closest<HTMLElement>("[contenteditable]");
  const editor = target.closest<HTMLElement>(".cm-editor");
  const view = editor ? EditorView.findFromDOM(editor) : null;
  const content = view?.contentDOM ?? (editable?.isContentEditable ? editable : null);
  const selection = window.getSelection();
  const selectedText = view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : selection?.toString() ?? "";
  if (!field && !content) {
    if (!selectedText || !selection?.rangeCount || !selection.getRangeAt(0).intersectsNode(target)) return [];
    return [{ id: "text-copy", label: "복사", shortcut: "Ctrl+C", onSelect: () => { void writeMenuClipboard(selectedText, "복사"); } }];
  }
  const readonly = field ? field.readOnly || field.disabled : view ? view.state.facet(EditorState.readOnly) : false;
  const password = field instanceof HTMLInputElement && field.type === "password";
  const capturedRange = !field && !view && selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  const restoreContent = () => {
    if (capturedRange && selection) { selection.removeAllRanges(); selection.addRange(capturedRange); }
  };
  const remove = () => {
    if (view) view.dispatch(view.state.replaceSelection(""));
    else { restoreContent(); document.execCommand("delete"); }
  };
  const insert = (text: string) => {
    if (view) view.dispatch(view.state.replaceSelection(text));
    else { restoreContent(); document.execCommand("insertText", false, text); }
  };
  const copy: MenuEntry = { id: "text-copy", label: "복사", shortcut: "Ctrl+C", disabled: !selectedText || password, onSelect: () => { void writeMenuClipboard(selectedText, "복사"); } };
  const all: MenuEntry = { id: "text-all", label: "모두 선택", shortcut: "Ctrl+A", onSelect: () => {
    if (view) view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    else if (field) field.select();
    else { const range = document.createRange(); range.selectNodeContents(content!); selection?.removeAllRanges(); selection?.addRange(range); }
  } };
  if (readonly) return [copy, all];
  return [
    { id: "text-cut", label: "잘라내기", shortcut: "Ctrl+X", disabled: !selectedText || password, onSelect: () => { void writeMenuClipboard(selectedText, "잘라내기").then((ok) => { if (ok) remove(); }); } },
    copy,
    { id: "text-paste", label: "붙여넣기", shortcut: "Ctrl+V", onSelect: () => { void readMenuClipboard().then((text) => { if (text !== null) insert(text); }); } },
    { id: "text-separator", type: "separator" }, all,
  ];
}

export function openContextMenu(event: MenuEvent, siteEntries: MenuEntry[], options: MenuOptions = {}): void {
  event.preventDefault();
  const origin = event.target;
  const target = options.anchor ?? (origin instanceof HTMLElement ? origin : origin instanceof Element ? origin.closest<HTMLElement>("button") ?? origin.parentElement : null);
  if (!target) { closeMenu(); return; }
  const text = options.includeText === false ? [] : textEntries(target);
  const entries: MenuEntry[] = text.length && siteEntries.length ? [...text, { id: "context-separator", type: "separator" }, ...siteEntries] : [...text, ...siteEntries];
  if (!entries.length) { closeMenu(); return; }
  const rect = target.getBoundingClientRect();
  const keyboard = options.keyboard ?? event.detail === -1;
  const point = options.anchorPoint ?? (keyboard ? { x: rect.left, y: rect.bottom } : { x: event.clientX, y: event.clientY });
  const anchor = options.anchor ?? target.closest<HTMLElement>(".cm-content, [contenteditable='true'], [contenteditable='plaintext-only']") ?? target;
  setMenu({ anchor, point, entries });
}

export function openFrameContextMenu(frame: HTMLIFrameElement, data: { x: number; y: number; text: string }): void {
  const rect = frame.getBoundingClientRect();
  openContextMenu(new MouseEvent("contextmenu", { cancelable: true }), [
    { id: "frame-copy", label: "복사", shortcut: "Ctrl+C", onSelect: () => { void writeMenuClipboard(data.text, "복사"); } },
  ], { anchor: frame, anchorPoint: { x: rect.left + data.x, y: rect.top + data.y }, includeText: false });
}

export function ContextMenuHost({ onError }: { onError?: (error: CoreError) => void }) {
  const menu = useSyncExternalStore(subscribe, () => current, () => null);
  const [error, setError] = useState<CoreError | null>(null);
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => { if (!event.defaultPrevented) openContextMenu(event, []); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))) return;
      const target = document.activeElement;
      if (!(target instanceof HTMLElement)) return;
      event.preventDefault();
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left, clientY: rect.bottom, detail: -1 }));
    };
    const report = (value: CoreError) => { if (onError) onError(value); else setError(value); };
    errors.add(report); document.addEventListener("contextmenu", onContextMenu); document.addEventListener("keydown", onKeyDown);
    return () => { errors.delete(report); document.removeEventListener("contextmenu", onContextMenu); document.removeEventListener("keydown", onKeyDown); closeMenu(); };
  }, [onError]);
  return <>{menu ? <Menu anchor={menu.anchor} anchorPoint={menu.point} items={menu.entries} onClose={closeMenu} /> : null}{error ? <Notice role="alert" errorId={error.id} actions={[<Button key="close" onClick={() => setError(null)}>닫기</Button>]}>{error.message}</Notice> : null}</>;
}
