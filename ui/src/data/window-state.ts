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
    context.store.call({
      op: "window.set_state",
      window_id: context.window.id,
      state: { ...readWindowState(context), ...pending.patch },
    }).then(pending.resolve, pending.reject);
  });
  return promise;
}
