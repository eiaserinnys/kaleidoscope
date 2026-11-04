import { flushSync } from "react-dom";
import type { CoreError, WindowAction, WindowGeometry } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { toCoreError } from "../core/core-transport";
import * as errors from "../contract/shell-errors";
import { beginWindowAction, waitForWindowActionCalls } from "./action-context";
import { parseKey, sendKey, typeText } from "./action-events";
import { pointElement } from "./action-point";
import { clickElement, selectElement } from "./action-select";
import { describeNumbered, forgetNumbered, resolveNumbered } from "./numbered";
import { inConsent, overlayOwner, ownedOverlays } from "./overlay-owner";
import { flushPending } from "./pending-flush";

type WindowEntry = { root: HTMLElement; store?: ShellStore; instance: string; sequence: number; viewId?: string; geometry?: WindowGeometry; focus?: WeakRef<HTMLElement> };
const windows = new Map<string, WindowEntry>();
type Observation = { view_id: string; text: string; settled: boolean; geometry?: WindowGeometry };
type ActionResult = { applied: boolean; error?: CoreError; before_text?: string; after?: Observation };

export function registerControlWindow(windowId: string, root: HTMLElement, store?: ShellStore): () => void {
  const entry: WindowEntry = { root, store, instance: crypto.randomUUID(), sequence: 0 };
  windows.set(windowId, entry);
  const focus = (event: FocusEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && (root.contains(target) || overlayOwner(target)?.windowId === windowId)) entry.focus = new WeakRef(target);
  };
  document.addEventListener("focusin", focus);
  return () => {
    document.removeEventListener("focusin", focus);
    if (windows.get(windowId) === entry) { windows.delete(windowId); forgetNumbered(windowId); }
  };
}

export function readWindowView(windowId: string): Observation {
  const entry = windows.get(windowId);
  if (!entry) throw errors.SHELL_WINDOW_CONTROL_REFERENCE_STALE({ target: "창" });
  const text = describeNumbered(windowId, entry.root).text;
  entry.viewId = `${entry.instance}:${++entry.sequence}`;
  entry.geometry = undefined;
  return { view_id: entry.viewId, text, settled: true };
}

export function setWindowViewGeometry(windowId: string, viewId: string, geometry: WindowGeometry): void {
  const entry = windows.get(windowId);
  if (entry?.viewId === viewId) entry.geometry = geometry;
}

function resolveError(reason: "stale" | "hidden" | "disabled" | "readonly" | "consent", target: number): CoreError {
  const arg = { target: String(target) };
  if (reason === "stale") return errors.SHELL_WINDOW_CONTROL_REFERENCE_STALE(arg);
  if (reason === "hidden") return errors.SHELL_WINDOW_CONTROL_TARGET_HIDDEN(arg);
  if (reason === "disabled") return errors.SHELL_WINDOW_CONTROL_TARGET_DISABLED(arg);
  if (reason === "readonly") return errors.SHELL_WINDOW_CONTROL_TARGET_READONLY(arg);
  return errors.SHELL_WINDOW_CONTROL_CONSENT_BLOCKED();
}

function unsupported(target: number | string, action: string): CoreError { return errors.SHELL_WINDOW_CONTROL_ACTION_UNSUPPORTED({ target: String(target), action }); }
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    setTimeout(finish, 100); requestAnimationFrame(finish);
  });
}

export async function executeWindowAction(windowId: string, viewId: string, action: WindowAction, requestId: string): Promise<ActionResult> {
  const entry = windows.get(windowId);
  if (!entry || entry.viewId !== viewId) return { applied: false, error: errors.SHELL_WINDOW_CONTROL_REFERENCE_STALE({ target: "판" }) };
  if (ownedOverlays(windowId).some((overlay) => inConsent(overlay))) return { applied: false, error: errors.SHELL_WINDOW_CONTROL_CONSENT_BLOCKED() };
  let element: HTMLElement | undefined;
  if ("target" in action && action.target !== undefined) {
    const resolved = resolveNumbered(windowId, action.target, action.kind === "type" || action.kind === "select");
    if ("reason" in resolved) return { applied: false, error: resolveError(resolved.reason, action.target) };
    element = resolved.element;
  } else if (action.kind === "key") {
    element = entry.focus?.deref();
    if (!element?.isConnected || (!entry.root.contains(element) && overlayOwner(element)?.windowId !== windowId)) return { applied: false, error: errors.SHELL_WINDOW_CONTROL_FOCUS_TARGET_MISSING() };
    if (inConsent(element)) return { applied: false, error: errors.SHELL_WINDOW_CONTROL_CONSENT_BLOCKED() };
  }
  const before_text = describeNumbered(windowId, entry.root, false).text;
  const end = beginWindowAction(windowId);
  let applied = false;
  try {
    let error: CoreError | undefined;
    if (action.kind === "click" && element) {
      if (!element.matches('button, a[href], input, [role="button"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [role="menuitem"], [role="treeitem"], [role="row"], [role="option"]')) error = unsupported(action.target, action.kind);
      else { flushSync(() => clickElement(element!, action.gesture)); applied = true; }
    } else if (action.kind === "type" && element) {
      flushSync(() => { applied = typeText(element!, action); });
      if (!applied) error = unsupported(action.target, action.kind);
    } else if (action.kind === "select" && element) {
      error = selectElement(windowId, element, action.choice); applied = !error;
    } else if (action.kind === "key" && element) {
      const key = parseKey(action.key);
      if (!key) error = errors.SHELL_WINDOW_CONTROL_KEY_INVALID({ key: action.key });
      else { flushSync(() => sendKey(element!, key)); applied = true; }
    } else if (action.kind === "scroll") {
      let target: HTMLElement | null = element ?? entry.root;
      while (target && target !== entry.root && target.scrollHeight <= target.clientHeight && target.scrollWidth <= target.clientWidth) target = target.parentElement;
      const amount = action.amount * (["up", "left"].includes(action.direction) ? -1 : 1);
      if (action.direction === "up" || action.direction === "down") (target ?? entry.root).scrollTop += amount;
      else (target ?? entry.root).scrollLeft += amount;
      applied = true;
    } else if (action.kind === "point") { error = await pointElement(entry.root, windowId, entry.geometry, action, requestId); applied = !error; }
    if (error) return { applied, error, before_text };
    const settled = await Promise.race([(async () => { if (element && (action.kind === "type" || action.kind === "key")) await flushPending(element); await nextFrame(); await nextFrame(); await waitForWindowActionCalls(windowId); return true; })(), new Promise<false>((resolve) => setTimeout(() => resolve(false), 2000))]);
    const after = readWindowView(windowId); after.settled = settled;
    return { applied, before_text, after };
  } catch (reason) { return { applied, before_text, error: toCoreError(reason) }; }
  finally { end(); }
}
