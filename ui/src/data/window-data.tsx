import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { AppDefinition, AppWindow, Binding, BindingValue, DataView, SourceStatus } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { toCoreError } from "../core/core-transport";
import type { ShellStore } from "../core/shell-store";

const loading: BindingValue = { status: "loading" };
const emptySources: Record<string, SourceStatus> = {};
const lifecycle = new WeakMap<ShellStore, Map<string, Promise<void>>>();

function enqueue(store: ShellStore, id: string, task: () => Promise<void>) {
  let queues = lifecycle.get(store);
  if (!queues) { queues = new Map(); lifecycle.set(store, queues); }
  const next = (queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(task);
  queues.set(id, next);
  void next.finally(() => { if (queues?.get(id) === next) queues.delete(id); });
  return next;
}

export class WindowData {
  readonly mediaCache = new Map<string, Promise<string>>();
  private values: DataView["values"] = {};
  private sources: DataView["sources"] = emptySources;
  private listeners = new Map<string, Set<() => void>>();
  private sourceListeners = new Set<() => void>();
  private noticeListeners = new Set<() => void>();
  private notice: string | null = null;
  private unsubscribe?: () => void;
  private active = false;
  private pending: DataView[] = [];
  private initialized = false;
  private mounts = 0;
  private ready: Promise<void> = Promise.resolve();

  constructor(readonly store: ShellStore, readonly windowId: string, readonly definition: AppDefinition) {}

  subscribeValue = (pointer: string, listener: () => void) => {
    let group = this.listeners.get(pointer);
    if (!group) { group = new Set(); this.listeners.set(pointer, group); }
    group.add(listener);
    return () => { group?.delete(listener); if (!group?.size) this.listeners.delete(pointer); };
  };
  getValue = (pointer: string) => this.values[pointer] ?? loading;
  subscribeSources = (listener: () => void) => { this.sourceListeners.add(listener); return () => this.sourceListeners.delete(listener); };
  getSources = () => this.sources;
  subscribeNotice = (listener: () => void) => { this.noticeListeners.add(listener); return () => this.noticeListeners.delete(listener); };
  getNotice = () => this.notice;
  setNotice = (message: string | null) => { this.notice = message; this.noticeListeners.forEach((listener) => listener()); };

  private merge(view: DataView) {
    for (const [pointer, value] of Object.entries(view.values)) {
      if (JSON.stringify(this.values[pointer]) === JSON.stringify(value)) continue;
      this.values[pointer] = value;
      this.listeners.get(pointer)?.forEach((listener) => listener());
    }
    if (Object.keys(view.sources).length) {
      this.sources = { ...this.sources, ...view.sources };
      this.sourceListeners.forEach((listener) => listener());
    }
  }

  mount() {
    // 같은 창 데이터가 다시 붙을 수 있다(React 개발 모드의 두 번 마운트 등). 붙이기 응답은 코어가 요청을 받은 때의
    // 모습이라, 응답을 기다리는 동안 온 이벤트가 더 새롭다. 붙이기마다 이벤트를 모아 두었다가 응답 뒤에 반영하고,
    // 이미 지나간 마운트의 붙이기는 부르지 않는다.
    const mount = ++this.mounts;
    this.active = true;
    this.initialized = false;
    this.pending = [];
    this.unsubscribe = this.store.subscribeEvents((event) => {
      if (event.event !== "data.update" || event.window_id !== this.windowId) return;
      if (!this.initialized) this.pending.push(event.view); else this.merge(event.view);
    });
    this.ready = enqueue(this.store, this.windowId, async () => {
      if (!this.active || mount !== this.mounts) return;
      try {
        const reply = await this.store.call({ op: "data.attach", window_id: this.windowId });
        if (!this.active || mount !== this.mounts) return;
        this.merge(reply.view);
        this.initialized = true;
        this.pending.forEach((view) => this.merge(view));
        this.pending = [];
      } catch (error) { if (this.active) this.setNotice(toCoreError(error).message); }
    });
    const onFocus = () => {
      const names = Object.entries(this.definition.sources ?? {}).filter(([, source]) => source.kind === "file" || source.kind === "folder").map(([name]) => name);
      if (names.length) void this.refresh(names);
    };
    globalThis.window.addEventListener("focus", onFocus);
    return () => {
      this.active = false;
      this.mediaCache.clear();
      this.unsubscribe?.();
      globalThis.window.removeEventListener("focus", onFocus);
      enqueue(this.store, this.windowId, async () => { await this.store.call({ op: "data.detach", window_id: this.windowId }).catch(() => undefined); });
    };
  }

  act = async (pointer: string, event: JsonValue, item?: JsonValue) => {
    try {
      await this.ready;
      await this.store.call({ op: "data.act", window_id: this.windowId, pointer, event, ...(item === undefined ? {} : { item }) });
    } catch (error) { this.setNotice(toCoreError(error).message); }
  };
  refresh = async (sources: string[]) => {
    try { await this.ready; await this.store.call({ op: "data.refresh", window_id: this.windowId, sources }); }
    catch (error) { this.setNotice(toCoreError(error).message); }
  };
  login = async (permission: string) => {
    try { await this.store.call({ op: "connection.login", window_id: this.windowId, permission }); }
    catch (error) { this.setNotice(toCoreError(error).message); }
  };
}

const DataContext = createContext<{ data: WindowData; state: AppWindow["state"] } | null>(null);

export function WindowDataProvider({ store, appWindow, definition, children }: { store: ShellStore; appWindow: AppWindow; definition: AppDefinition; children: ReactNode }) {
  const data = useMemo(() => new WindowData(store, appWindow.id, definition), [store, appWindow.id, appWindow.app_version]);
  useEffect(() => data.mount(), [data]);
  return <DataContext.Provider value={{ data, state: appWindow.state }}>{children}</DataContext.Provider>;
}

export function useWindowData(): WindowData {
  const value = useContext(DataContext);
  if (!value) throw new Error("창 데이터가 연결되지 않았습니다");
  return value.data;
}

export function useBinding(pointer: string, binding: Binding): BindingValue {
  const context = useContext(DataContext);
  if (!context) throw new Error("창 데이터가 연결되지 않았습니다");
  const value = useSyncExternalStore((listener) => context.data.subscribeValue(pointer, listener), () => context.data.getValue(pointer), () => loading);
  if (binding !== null && typeof binding === "object" && !Array.isArray(binding)) {
    if (Object.keys(binding).length === 1 && "state" in binding && typeof binding.state === "string") return { status: "ready", value: context.state[binding.state] ?? null };
    if (Object.keys(binding).length === 1 && "expr" in binding && typeof binding.expr === "string") return value;
  }
  return { status: "ready", value: binding as JsonValue };
}
