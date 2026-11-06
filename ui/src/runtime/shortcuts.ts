import type { EventModifiers, KeypadButton, Shortcut } from "../contract/contract";
import type { BlockContext } from "../blocks/block-context";
import { isWindowVisible } from "../data/window-state";
import { ownerOf } from "../share/overlay-owner";
import { windowActionActive } from "../share/action-context";
import { isCommenting } from "../comments/session";

export function eventModifiers(event: Pick<MouseEvent, "shiftKey" | "altKey" | "ctrlKey" | "metaKey">): EventModifiers {
  return { shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey };
}

type Context = Pick<BlockContext, "store" | "window">;
type AppEntry = { context: Context; shortcuts: Shortcut[]; run: (index: number, modifiers: EventModifiers) => void };
type GridEntry = { context: Context; root: HTMLElement; buttons: KeypadButton[]; run: (button: KeypadButton) => void; pointerFocus: () => boolean; clearFocus: () => void };
type TourEntry = { context: Context; handlers: { previous: () => void; next: () => void; close: () => void } };
const tours = new Set<TourEntry>();
const apps = new Set<AppEntry>();
const grids = new Set<GridEntry>();

function topWindow(context: Context): boolean {
  if (isCommenting(context.window.id)) return false;
  const snapshot = context.store.getSnapshot();
  if (!isWindowVisible(snapshot, context.window.id)) return false;
  const current = snapshot?.shared.windows.find((item) => item.id === context.window.id);
  return !!current && !snapshot?.shared.windows.some((item) => item.desktop_id === current.desktop_id && !item.minimized && item.z > current.z);
}

function typing(target: Element | null): boolean {
  if (target?.closest("textarea, select, [contenteditable]:not([contenteditable='false']), .cm-editor")) return true;
  const input = target?.closest("input");
  return !!input && !["range", "checkbox"].includes(input.type);
}

function matches(event: KeyboardEvent, shortcut: Shortcut): boolean {
  if (event.code !== shortcut.code) return false;
  const primary = /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "meta" : "ctrl";
  const required = new Set(shortcut.modifiers.map((modifier) => modifier === "primary" ? primary : modifier));
  return event.shiftKey === required.has("shift") && event.altKey === required.has("alt") && event.ctrlKey === required.has("ctrl") && event.metaKey === required.has("meta");
}

export function hasVisibleShortcutOverlay(owner?: string, controlled = false): boolean {
  const overlays = document.querySelectorAll('[role="dialog"], [role="menu"], dialog[open]');
  return [...overlays].some((overlay) => (!controlled || ownerOf(overlay) === owner) && !overlay.closest('[hidden], [inert], [aria-hidden="true"]'));
}

function onKeyDown(event: KeyboardEvent) {
  const targetOwner = event.target instanceof Element ? ownerOf(event.target) : undefined;
  const controlled = !event.isTrusted && !!targetOwner && windowActionActive(targetOwner);
  if (event.key === "Tab") grids.forEach((entry) => { if (!controlled || entry.context.window.id === targetOwner) entry.clearFocus(); });
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.ks-window[data-commenting="true"] .ks-window-content')) return;
  if (event.defaultPrevented || event.isComposing || typing(target)) return;
  if (hasVisibleShortcutOverlay(targetOwner, controlled)) return;
  for (const tour of tours) {
    if (isCommenting(tour.context.window.id)) continue;
    if (controlled ? tour.context.window.id !== targetOwner : !topWindow(tour.context)) continue;
    if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      if (event.key === "ArrowLeft") tour.handlers.previous();
      else if (event.key === "ArrowRight" || event.key === "Enter") tour.handlers.next();
      else if (event.key === "Escape") tour.handlers.close();
      else return;
      event.preventDefault();
    }
    return;
  }
  for (const app of apps) {
    if (isCommenting(app.context.window.id)) continue;
    if (controlled ? app.context.window.id !== targetOwner : !topWindow(app.context)) continue;
    const index = app.shortcuts.findIndex((shortcut) => matches(event, shortcut));
    if (index >= 0) { event.preventDefault(); app.run(index, eventModifiers(event)); return; }
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const eligible = [...grids].filter((entry) => !isCommenting(entry.context.window.id) && (controlled ? entry.context.window.id === targetOwner : topWindow(entry.context)) && !entry.root.closest('[hidden], [inert], [aria-hidden="true"]'));
  const focusedGrid = target?.closest(".ks-keypad");
  const candidates = eligible.flatMap((entry) => {
    if (focusedGrid && focusedGrid !== entry.root) return [];
    const focusedButton = target?.closest("button");
    if (event.key === "Enter" && focusedButton && (!entry.root.contains(focusedButton) || !entry.pointerFocus())) return [];
    return entry.buttons.filter((button) => !button.disabled && button.shortcut).map((button) => ({ entry, button }));
  });
  const direct = candidates.filter(({ button }) => button.shortcut === event.key);
  const hits = direct.length ? direct : event.key.length === 1 ? candidates.filter(({ button }) => button.key.length === 1 && button.key === event.key) : [];
  if (hits.length !== 1) return;
  event.preventDefault(); hits[0].entry.run(hits[0].button);
}

function add<T>(set: Set<T>, entry: T): () => void {
  if (!apps.size && !grids.size && !tours.size) window.addEventListener("keydown", onKeyDown);
  set.add(entry);
  return () => { set.delete(entry); if (!apps.size && !grids.size && !tours.size) window.removeEventListener("keydown", onKeyDown); };
}

export function registerAppShortcuts(context: Context, shortcuts: Shortcut[], run: AppEntry["run"]) {
  return add(apps, { context, shortcuts, run });
}
export function registerGridShortcuts(context: Context, root: HTMLElement, buttons: KeypadButton[], run: GridEntry["run"], pointerFocus: GridEntry["pointerFocus"] = () => false, clearFocus: GridEntry["clearFocus"] = () => undefined) {
  return add(grids, { context, root, buttons, run, pointerFocus, clearFocus });
}

export function registerTourShortcuts(context: Context, handlers: TourEntry["handlers"]) {
  return add(tours, { context, handlers });
}
