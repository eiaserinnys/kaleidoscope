import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import type { CoreError, CoreEvent, ShellSnapshot } from "../contract/contract";
import { toCoreError, type CoreTransport } from "./core-transport";
import { useBlockRenderProbe } from "../render/render-probe";

export interface ShellStore {
  call: CoreTransport["call"];
  getSnapshot(): ShellSnapshot | null;
  getError(): CoreError | null;
  subscribe(listener: () => void): () => void;
  subscribeEvents(listener: (event: CoreEvent) => void): () => void;
  ready: Promise<void>;
  dispose(): void;
  nativeFiles?: boolean;
  bytes?: CoreTransport["bytes"];
}

export function createShellStore(transport: CoreTransport): ShellStore {
  let snapshot: ShellSnapshot | null = null;
  let error: CoreError | null = null;
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(event: CoreEvent) => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const unsubscribe = transport.subscribe((event: CoreEvent) => {
    if (event.event === "state.changed") {
      snapshot = shareShellSnapshot(snapshot, event.snapshot);
      error = null;
      notify();
    } else {
      for (const listener of eventListeners) listener(event);
    }
  });

  const ready = transport.call({ op: "state.get" }).then((reply) => {
    if (reply.op !== "state.get") throw { code: "io", message: "코어 상태 응답이 올바르지 않습니다", details: [] } satisfies CoreError;
    snapshot = shareShellSnapshot(snapshot, reply.snapshot);
    error = null;
    notify();
  }).catch((reason: unknown) => {
    error = toCoreError(reason);
    notify();
  });

  return {
    nativeFiles: transport.nativeFiles,
    bytes: transport.bytes?.bind(transport),
    call: transport.call.bind(transport) as CoreTransport["call"],
    getSnapshot: () => snapshot,
    getError: () => error,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeEvents(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    ready,
    dispose: unsubscribe,
  };
}

export function useShellSnapshot(store: ShellStore): ShellSnapshot | null {
  return useShellSelector(store, (snapshot) => snapshot);
}

export function useShellSelector<T>(store: ShellStore, select: (snapshot: ShellSnapshot | null) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  useBlockRenderProbe();
  return useSyncExternalStoreWithSelector(store.subscribe, store.getSnapshot, store.getSnapshot, select, equal);
}

export function shareShellSnapshot(previous: ShellSnapshot | null, next: ShellSnapshot): ShellSnapshot {
  if (!previous) return next;
  const previousVersions = new Map(previous.shared.app_versions.map((item) => [`${item.app_id}\0${item.version}`, item]));
  const versions = next.shared.app_versions.map((item) => {
    const old = previousVersions.get(`${item.app_id}\0${item.version}`);
    return old ? shareStructure(old, item) : item;
  });
  const appVersions = versions.length === previous.shared.app_versions.length &&
    versions.every((item, index) => item === previous.shared.app_versions[index])
    ? previous.shared.app_versions
    : versions;
  const shared = shareObjectStructure(previous.shared, next.shared, { app_versions: appVersions });
  return shareObjectStructure(previous, next, { shared });
}

export function shareStructure<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  if (!previous || !next || typeof previous !== "object" || typeof next !== "object") return next;
  if (Array.isArray(previous) && Array.isArray(next)) {
    const keyed = previous.every((item) => item && typeof item === "object" && "id" in item) &&
      next.every((item) => item && typeof item === "object" && "id" in item);
    const previousById = keyed ? new Map(previous.map((item) => [(item as { id: unknown }).id, item])) : undefined;
    let changed = previous.length !== next.length;
    const result = next.map((item, index) => {
      const old = previousById?.get((item as { id: unknown }).id) ?? (!keyed ? previous[index] : undefined);
      const value = old === undefined ? item : shareStructure(old, item);
      if (value !== previous[index]) changed = true;
      return value;
    });
    return (changed ? result : previous) as T;
  }
  if (Array.isArray(previous) || Array.isArray(next)) return next;
  return shareObjectStructure(previous, next) as T;
}

function shareObjectStructure<T extends object>(previous: T, next: T, overrides?: Record<string, unknown>): T {
  const oldObject = previous as Record<string, unknown>;
  const newObject = next as Record<string, unknown>;
  const oldKeys = Object.keys(oldObject);
  const newKeys = Object.keys(newObject);
  let changed = oldKeys.length !== newKeys.length;
  const result: Record<string, unknown> = {};
  for (const key of newKeys) {
    const exists = Object.hasOwn(oldObject, key);
    const value = overrides && Object.hasOwn(overrides, key)
      ? overrides[key]
      : exists ? shareStructure(oldObject[key], newObject[key]) : newObject[key];
    result[key] = value;
    if (!exists || value !== oldObject[key]) changed = true;
  }
  return (changed ? result : previous) as T;
}
