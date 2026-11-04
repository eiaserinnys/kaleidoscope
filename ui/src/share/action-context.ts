import { ownerOf } from "./overlay-owner";

type ActionContext = { windowId: string; preserveFocus: boolean; pending: number; waiters: Set<() => void> };
const contexts = new Map<string, ActionContext>();

export function beginWindowAction(windowId: string): () => void {
  const active = document.activeElement;
  const context: ActionContext = { windowId, preserveFocus: active instanceof Element && ownerOf(active) !== windowId, pending: 0, waiters: new Set() };
  contexts.set(windowId, context);
  return () => { if (contexts.get(windowId) === context) contexts.delete(windowId); };
}

export function windowActionActive(windowId: string): boolean { return contexts.has(windowId); }
export function preserveWindowActionFocus(windowId: string): boolean { return contexts.get(windowId)?.preserveFocus ?? false; }

export function trackWindowAction<T>(windowId: string, task: Promise<T>): Promise<T> {
  const context = contexts.get(windowId);
  if (!context) return task;
  context.pending += 1;
  return task.finally(() => {
    context.pending -= 1;
    if (!context.pending) for (const notify of context.waiters) notify();
  });
}

export function waitForWindowActionCalls(windowId: string): Promise<void> {
  const context = contexts.get(windowId);
  if (!context || !context.pending) return Promise.resolve();
  return new Promise((resolve) => {
    const notify = () => { context.waiters.delete(notify); resolve(); };
    context.waiters.add(notify);
  });
}
