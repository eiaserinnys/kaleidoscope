import type { AppWindow, Grant, ShellSnapshot } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { useShellSelector, type ShellStore } from "../core/shell-store";
import type { WindowIdentity } from "../blocks/block-context";

export interface WindowStateTarget {
  store: ShellStore;
  window: Pick<WindowIdentity, "id">;
}

export function isWindowVisible(snapshot: ShellSnapshot | null | undefined, windowId: string): boolean {
  if (!snapshot || !snapshot.device.active_workspace_id) return false;
  const window = snapshot.shared.windows.find((item) => item.id === windowId);
  if (!window || window.minimized) return false;
  const desktop = snapshot.shared.desktops.find((item) => item.id === window.desktop_id);
  return desktop?.workspace_id === snapshot.device.active_workspace_id
    && snapshot.device.active_desktop_ids[desktop.workspace_id] === desktop.id;
}

export function isWindowTop(snapshot: ShellSnapshot | null | undefined, windowId: string): boolean {
  if (!snapshot || !isWindowVisible(snapshot, windowId)) return false;
  const current = snapshot.shared.windows.find((item) => item.id === windowId);
  return !!current && !snapshot.shared.windows.some((item) => item.desktop_id === current.desktop_id && !item.minimized && item.z > current.z);
}

export function useWindowVisible(context: WindowStateTarget): boolean {
  return useShellSelector(context.store, (snapshot) => isWindowVisible(snapshot, context.window.id));
}

export function useWindowStateValue(context: WindowStateTarget, key: string | null): unknown {
  return useShellSelector(context.store, (snapshot) =>
    key === null ? null : snapshot?.shared.windows.find((window) => window.id === context.window.id)?.state[key] ?? null,
  );
}

export function useWindowGrant(context: WindowStateTarget, permission: string): Grant | undefined {
  return useShellSelector(context.store, (snapshot) =>
    snapshot?.device.grants.find((grant) => grant.window_id === context.window.id && grant.permission === permission),
  );
}

export function useWindowGrants(context: WindowStateTarget): Grant[] {
  return useShellSelector(context.store, (snapshot) =>
    snapshot?.device.grants.filter((grant) => grant.window_id === context.window.id) ?? [],
    sameReferences,
  );
}

function sameReferences<T>(left: T[], right: T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function readWindowState(context: WindowStateTarget): AppWindow["state"] {
  return context.store.getSnapshot()?.shared.windows.find((window) => window.id === context.window.id)?.state ?? {};
}

type PendingPatch = {
  patch: Record<string, JsonValue>;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};
const pendingPatches = new WeakMap<ShellStore, Map<string, PendingPatch>>();
const pendingWrites = new WeakMap<ShellStore, Map<string, Set<Promise<boolean>>>>();

function trackWrite(store: ShellStore, windowId: string, request: Promise<unknown>): void {
  let windows = pendingWrites.get(store);
  if (!windows) { windows = new Map(); pendingWrites.set(store, windows); }
  let writes = windows.get(windowId);
  if (!writes) { writes = new Set(); windows.set(windowId, writes); }
  const tracked: Promise<boolean> = request.then(() => true, () => false);
  writes.add(tracked);
  void tracked.then((saved) => { if (saved) writes!.delete(tracked); });
}

/** 창 상태 쓰기 요청이 모두 응답할 때까지 기다리고, 하나라도 실패하면 false를 돌려준다. */
export async function settleWindowStateWrites(store: ShellStore, windowId: string): Promise<boolean> {
  await Promise.resolve();
  const writes = pendingWrites.get(store)?.get(windowId);
  if (!writes) return true;
  let saved = true;
  while (writes.size) {
    const current = [...writes];
    const results = await Promise.all(current);
    current.forEach((write) => writes.delete(write));
    if (results.some((ok) => !ok)) saved = false;
  }
  return saved;
}

export function patchWindowState(context: WindowStateTarget, patch: Record<string, JsonValue>): Promise<unknown> {
  const windows = pendingPatches.get(context.store) ?? new Map<string, PendingPatch>();
  pendingPatches.set(context.store, windows);
  const existing = windows.get(context.window.id);
  if (existing) {
    Object.assign(existing.patch, patch);
    return existing.promise;
  }
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  const pending = { patch: { ...patch }, promise, resolve, reject };
  windows.set(context.window.id, pending);
  queueMicrotask(() => {
    windows.delete(context.window.id);
    const request = context.store.call({
      op: "window.patch_state",
      window_id: context.window.id,
      patch: pending.patch,
    });
    trackWrite(context.store, context.window.id, request);
    request.then(pending.resolve, pending.reject);
  });
  return promise;
}
