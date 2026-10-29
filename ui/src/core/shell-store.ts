import { useSyncExternalStore } from "react";
import type { CoreError, CoreEvent, ShellSnapshot } from "../contract/contract";
import { toCoreError, type CoreTransport } from "./core-transport";

export interface ShellStore {
  call: CoreTransport["call"];
  getSnapshot(): ShellSnapshot | null;
  getError(): CoreError | null;
  subscribe(listener: () => void): () => void;
  subscribeEvents(listener: (event: CoreEvent) => void): () => void;
  ready: Promise<void>;
  dispose(): void;
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
      snapshot = event.snapshot;
      error = null;
      notify();
    } else {
      for (const listener of eventListeners) listener(event);
    }
  });

  const ready = transport.call({ op: "state.get" }).then((reply) => {
    if (reply.op !== "state.get") throw { code: "io", message: "코어 상태 응답이 올바르지 않습니다", details: [] } satisfies CoreError;
    snapshot = reply.snapshot;
    error = null;
    notify();
  }).catch((reason: unknown) => {
    error = toCoreError(reason);
    notify();
  });

  return {
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
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
