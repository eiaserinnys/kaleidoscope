import type { AppWindow, Grant } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { useShellSelector, type ShellStore } from "../core/shell-store";
import type { WindowIdentity } from "../blocks/block-context";

export interface WindowStateTarget {
  store: ShellStore;
  window: Pick<WindowIdentity, "id">;
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

export function patchWindowState(context: WindowStateTarget, patch: Record<string, JsonValue>): Promise<unknown> {
  return context.store.call({
    op: "window.set_state",
    window_id: context.window.id,
    state: { ...readWindowState(context), ...patch },
  });
}
