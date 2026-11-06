import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import { SHELL_STATE_REPLY_INVALID, SHELL_WINDOW_CONTROL_CONSENT_BLOCKED } from "../contract/shell-errors";
import type { CoreError, CoreEvent, ShellSnapshot } from "../contract/contract";
import { toCoreError, type CoreTransport } from "./core-transport";
import { useBlockRenderProbe } from "../render/render-probe";
import { startUiTiming } from "../profiler/ui-timing";
import { isResponding } from "../profiler/chat-responding";
import { trackWindowAction, windowActionActive } from "../share/action-context";

export interface ShellStore {
  call: CoreTransport["call"];
  iconCache: Map<string, Promise<{ url: string; mask: boolean } | null>>;
  getSnapshot(): ShellSnapshot | null;
  getError(): CoreError | null;
  reached(sequence: number): Promise<void> | null;
  subscribe(listener: () => void): () => void;
  subscribeEvents(listener: (event: CoreEvent) => void): () => void;
  getInstallConsent(windowId: string): InstallConsent | undefined;
  subscribeInstallConsent(windowId: string, listener: () => void): () => void;
  ready: Promise<void>;
  dispose(): void;
  nativeFiles?: boolean;
  bytes?: CoreTransport["bytes"];
}

export type InstallConsent = Extract<CoreEvent, { event: "app.install_permission" | "store.server_permission" }>;

export function createShellStore(transport: CoreTransport): ShellStore {
  let snapshot: ShellSnapshot | null = null;
  let error: CoreError | null = null;
  let sequence = 0;
  const waiters = new Set<{ sequence: number; resolve: () => void }>();
  const advance = (next: number) => {
    sequence = Math.max(sequence, next);
    for (const waiter of waiters) if (waiter.sequence <= sequence) waiter.resolve();
  };
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(event: CoreEvent) => void>();
  const installConsents = new Map<string, InstallConsent[]>();
  const consentListeners = new Map<string, Set<() => void>>();
  const setConsent = (windowId: string, requests: InstallConsent[]) => {
    const previous = installConsents.get(windowId)?.[0];
    if (requests.length) installConsents.set(windowId, requests);
    else installConsents.delete(windowId);
    if (previous !== requests[0]) consentListeners.get(windowId)?.forEach((listener) => listener());
  };
  const iconCache: ShellStore["iconCache"] = new Map();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const unsubscribe = transport.subscribe((event: CoreEvent) => {
    if (event.event === "state.changed") {
      for (const [windowId, requests] of installConsents) {
        const oldWindow = snapshot?.shared.windows.find((item) => item.id === windowId);
        const nextWindow = event.snapshot.shared.windows.find((item) => item.id === windowId);
        if (!nextWindow || (oldWindow && (oldWindow.app_id !== nextWindow.app_id || oldWindow.app_version !== nextWindow.app_version))) {
          setConsent(windowId, []);
          for (const request of requests) {
            if (request.event === "app.install_permission") {
              void transport.call({ op: "app.respond_install_permission", window_id: windowId, request_id: request.request_id, digest: request.digest, allow: false });
            } else {
              void transport.call({ op: "store.respond_server_permission", window_id: windowId, request_id: request.request_id, server: request.server, allow: false });
            }
          }
        }
      }
      const previousLink = snapshot?.link;
      const nextLink = event.snapshot.link;
      const previousServer = previousLink && "server_url" in previousLink ? previousLink.server_url : "";
      const nextServer = "server_url" in nextLink ? nextLink.server_url : "";
      if (previousServer !== nextServer || (nextLink.state === "unlinked" && previousLink?.state !== "unlinked")) {
        iconCache.clear();
        for (const [windowId, requests] of installConsents) {
          const remaining = requests.filter((request) => request.event !== "store.server_permission");
          for (const request of requests) if (request.event === "store.server_permission") {
            void transport.call({ op: "store.respond_server_permission", window_id: windowId, request_id: request.request_id, server: request.server, allow: false });
          }
          setConsent(windowId, remaining);
        }
      }
      snapshot = shareShellSnapshot(snapshot, event.snapshot);
      error = null;
      notify();
      advance(event.sequence);
    } else {
      if (event.event === "app.install_permission" || event.event === "store.server_permission") setConsent(event.window_id, [...(installConsents.get(event.window_id) ?? []), event]);
      for (const listener of eventListeners) listener(event);
    }
  });
  let disposed = false;
  let stopUiTiming: () => void = () => undefined;

  const ready = transport.call({ op: "state.get" }).then((reply) => {
    if (reply.op !== "state.get") throw SHELL_STATE_REPLY_INVALID();
    if (reply.sequence >= sequence) snapshot = shareShellSnapshot(snapshot, reply.snapshot);
    error = null;
    if (!disposed) stopUiTiming = startUiTiming((inputs, frames) => transport.call({ op: "profiler.report", inputs, frames }), isResponding);
    notify();
    advance(reply.sequence);
  }).catch((reason: unknown) => {
    error = toCoreError(reason);
    notify();
  });

  return {
    iconCache,
    nativeFiles: transport.nativeFiles,
    bytes: transport.bytes?.bind(transport),
    call: ((request: Parameters<CoreTransport["call"]>[0]) => {
      const windowId = "window_id" in request ? request.window_id : undefined;
      if (windowId && windowActionActive(windowId) && (
        request.op === "files.allow_pc" || request.op === "files.allow_default_folder" || request.op === "files.pick_folder" || request.op === "connection.login"
        || (request.op === "process.respond_permission" && request.allow)
        || (request.op === "app.respond_install_permission" && request.allow)
        || (request.op === "store.respond_server_permission" && request.allow)
      )) return Promise.reject(SHELL_WINDOW_CONTROL_CONSENT_BLOCKED());
      if (request.op === "app.respond_install_permission" || request.op === "store.respond_server_permission") {
        const requests = installConsents.get(request.window_id);
        if (requests) setConsent(request.window_id, requests.filter((item) => item.request_id !== request.request_id));
      }
      const result = transport.call(request);
      return windowId ? trackWindowAction(windowId, result) : result;
    }) as CoreTransport["call"],
    getSnapshot: () => snapshot,
    getError: () => error,
    reached(target) {
      if (sequence >= target) return null;
      return new Promise<void>((resolve) => {
        const waiter = { sequence: target, resolve: () => { clearTimeout(timer); waiters.delete(waiter); resolve(); } };
        const timer = setTimeout(waiter.resolve, 1000);
        waiters.add(waiter);
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeEvents(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    getInstallConsent: (windowId) => installConsents.get(windowId)?.[0],
    subscribeInstallConsent(windowId, listener) {
      const listeners = consentListeners.get(windowId) ?? new Set<() => void>();
      listeners.add(listener);
      consentListeners.set(windowId, listeners);
      return () => { listeners.delete(listener); if (!listeners.size) consentListeners.delete(windowId); };
    },
    ready,
    dispose() {
      disposed = true;
      stopUiTiming();
      unsubscribe();
    },
  };
}

export function useShellSelector<T>(store: ShellStore, select: (snapshot: ShellSnapshot | null) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  useBlockRenderProbe();
  return useSyncExternalStoreWithSelector(store.subscribe, store.getSnapshot, store.getSnapshot, select, equal);
}

export function shareShellSnapshot(previous: ShellSnapshot | null, next: ShellSnapshot): ShellSnapshot {
  if (!previous) return next;
  const previousVersions = new Map(previous.shared.app_versions.map((item) => [`${item.app_id}\0${item.version}`, item]));
  const versions = next.shared.app_versions.map((item) =>
    previousVersions.get(`${item.app_id}\0${item.version}`) ?? item,
  );
  const appVersions = versions.length === previous.shared.app_versions.length &&
    versions.every((item, index) => item === previous.shared.app_versions[index])
    ? previous.shared.app_versions
    : versions;
  const preferences = shareStructure(previous.shared.preferences, next.shared.preferences);
  const shared = shareObjectStructure(previous.shared, next.shared, { app_versions: appVersions, preferences });
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
