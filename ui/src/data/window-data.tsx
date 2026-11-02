import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { AppDefinition, Binding, BindingValue, DataView, PickFilesSpec, SaveFileSpec, SourceStatus } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { CLIENT_OUTPUT_MAX_BYTES } from "../contract/limits";
import { toCoreError } from "../core/core-transport";
import { shareStructure, useShellSelector, type ShellStore } from "../core/shell-store";
import { ClientRuntime } from "../runtime/client-runtime";
import { useBlockRenderProbe } from "../render/render-probe";
import { useWindowStateValue } from "./window-state";

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
  private clientValues: Record<string, BindingValue> = {};
  private sources: DataView["sources"] = emptySources;
  private sourceMeta: NonNullable<DataView["source_meta"]> = {};
  private listeners = new Map<string, Set<() => void>>();
  private sourceListeners = new Set<() => void>();
  private noticeListeners = new Set<() => void>();
  private notice: string | null = null;
  private noticeRole: "alert" | "status" = "alert";
  private unsubscribe?: () => void;
  private active = false;
  private pending: DataView[] = [];
  private initialized = false;
  private mounts = 0;
  private ready: Promise<void> = Promise.resolve();
  private runtime: ClientRuntime | null = null;
  private clientFailed = false;
  private clientGeneration = 0;
  private clientListeners = new Set<() => void>();
  private shareListeners = new Set<() => void>();
  private shareSequence = 0;
  private dormantPointers = new Set<string>();
  private restarting = false;
  private surfaceGeneration = 0;
  private surfaces = new Map<string, { id: string; generation: number; canvas: OffscreenCanvas; css_width: number; css_height: number; dpr: number }>();

  constructor(readonly store: ShellStore, readonly windowId: string, readonly definition: AppDefinition) {
    for (const [name, output] of Object.entries(definition.client?.outputs ?? {})) this.clientValues[name] = { status: "ready", value: output.default };
  }

  subscribeValue = (pointer: string, listener: () => void) => {
    let group = this.listeners.get(pointer);
    if (!group) { group = new Set(); this.listeners.set(pointer, group); }
    group.add(listener);
    return () => { group?.delete(listener); if (!group?.size) this.listeners.delete(pointer); };
  };
  getValue = (pointer: string) => pointer.startsWith("@client/") ? this.clientValues[pointer.slice(8)] ?? loading : this.values[pointer] ?? loading;
  publishClient = (patch: Record<string, JsonValue>) => {
    for (const [name, value] of Object.entries(patch)) {
      if (!Object.hasOwn(this.definition.client?.outputs ?? {}, name)) continue;
      let encoded: string | undefined;
      try { encoded = JSON.stringify(value); } catch { this.setNotice(`클라이언트 출력을 읽을 수 없습니다: ${name}`); continue; }
      if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > CLIENT_OUTPUT_MAX_BYTES) { this.setNotice(`클라이언트 출력이 올바르지 않거나 너무 큽니다: ${name}`); continue; }
      const previous = this.clientValues[name];
      if (previous?.status === "ready" && JSON.stringify(previous.value) === encoded) continue;
      this.clientValues[name] = { status: "ready", value };
      this.listeners.get(`@client/${name}`)?.forEach((listener) => listener());
    }
  };
  subscribeSources = (listener: () => void) => { this.sourceListeners.add(listener); return () => this.sourceListeners.delete(listener); };
  getSources = () => this.sources;
  getSourceMeta = () => this.sourceMeta;
  subscribeNotice = (listener: () => void) => { this.noticeListeners.add(listener); return () => this.noticeListeners.delete(listener); };
  getNotice = () => this.notice;
  getNoticeRole = () => this.noticeRole;
  setNotice = (message: string | null) => { this.notice = message; this.noticeRole = "alert"; this.noticeListeners.forEach((listener) => listener()); };
  setStatus = (message: string) => { this.notice = message; this.noticeRole = "status"; this.noticeListeners.forEach((listener) => listener()); };
  getClientFailed = () => this.clientFailed;
  failClient = (message: string) => { this.clientFailed = true; this.setNotice(message); };
  subscribeClient = (listener: () => void) => { this.clientListeners.add(listener); return () => this.clientListeners.delete(listener); };
  getClientGeneration = () => this.clientGeneration;
  subscribeClientShare = (listener: () => void) => { this.shareListeners.add(listener); return () => this.shareListeners.delete(listener); };
  getClientShareSequence = () => this.shareSequence;
  notifyClientShare = () => { this.shareSequence += 1; this.shareListeners.forEach((listener) => listener()); };
  restartClient = async () => {
    if (this.restarting || !this.definition.client) return;
    this.restarting = true;
    const previous = this.runtime; this.runtime = null;
    if (previous) await previous.stop();
    this.surfaces.clear();
    this.clientFailed = false; this.setNotice(null);
    this.publishClient(Object.fromEntries(Object.entries(this.definition.client.outputs).map(([name, output]) => [name, output.default])));
    const runtime = new ClientRuntime(this.store, this, this.definition, this.definition.client);
    this.runtime = runtime; this.clientGeneration += 1; this.clientListeners.forEach((listener) => listener());
    void runtime.start(); this.restarting = false;
  };

  private merge(view: DataView) {
    for (const [pointer, value] of Object.entries(view.values)) {
      const shared = shareStructure(this.values[pointer], value);
      if (shared === this.values[pointer]) continue;
      this.values[pointer] = shared;
      this.listeners.get(pointer)?.forEach((listener) => listener());
    }
    if (Object.keys(view.sources).length || Object.keys(view.source_meta ?? {}).length) {
      this.sources = { ...this.sources, ...view.sources };
      this.sourceMeta = { ...this.sourceMeta, ...view.source_meta };
      this.sourceListeners.forEach((listener) => listener());
    }
    this.runtime?.sync();
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
        if (this.definition.client) {
          const runtime = new ClientRuntime(this.store, this, this.definition, this.definition.client);
          this.runtime = runtime;
          for (const surface of this.surfaces.values()) runtime.surface({ phase: "attach", ...surface });
          void runtime.start();
        }
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
      const runtime = this.runtime; this.runtime = null;
      enqueue(this.store, this.windowId, async () => { if (runtime) await runtime.stop(); await this.store.call({ op: "data.detach", window_id: this.windowId }).catch(() => undefined); });
    };
  }

  syncClient = () => this.runtime?.sync();

  setDormant = (pointer: string, dormant: boolean) => {
    if (dormant) this.dormantPointers.add(pointer);
    else this.dormantPointers.delete(pointer);
  };

  attachSurface = (id: string, canvas: OffscreenCanvas, css_width: number, css_height: number, dpr: number) => {
    const surface = { id, generation: ++this.surfaceGeneration, canvas, css_width, css_height, dpr };
    this.surfaces.set(id, surface); this.runtime?.surface({ phase: "attach", ...surface });
    return surface.generation;
  };
  resizeSurface = (id: string, generation: number, css_width: number, css_height: number, dpr: number) => {
    const surface = this.surfaces.get(id);
    if (!surface || surface.generation !== generation) return;
    Object.assign(surface, { css_width, css_height, dpr });
    this.runtime?.surface({ phase: "resize", id, generation, css_width, css_height, dpr });
  };
  detachSurface = (id: string, generation: number) => {
    if (this.surfaces.get(id)?.generation !== generation) return;
    this.surfaces.delete(id); this.runtime?.surface({ phase: "detach", id, generation });
  };

  private definitionAt(pointer: string): unknown {
    let current: unknown = this.definition;
    for (const part of pointer.split("/").slice(1)) {
      if (!current || typeof current !== "object") return null;
      current = (current as Record<string, unknown>)[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    }
    return current;
  }

  private localAction(pointer: string): Record<string, unknown> | null {
    let current = this.definitionAt(pointer);
    if (Array.isArray(current)) current = current.length === 1 ? current[0] : null;
    if (current && typeof current === "object" && ("client" in current || "pick_files" in current || "save_file" in current)) return current as Record<string, unknown>;
    return null;
  }

  private localBinding(pointer: string, binding: Binding): JsonValue {
    if (binding && typeof binding === "object" && !Array.isArray(binding)) {
      if ("state" in binding && typeof binding.state === "string") return this.store.getSnapshot()?.shared.windows.find((window) => window.id === this.windowId)?.state[binding.state] ?? null;
      if ("client" in binding && typeof binding.client === "string") { const value = this.getValue(`@client/${binding.client}`); return value.status === "ready" ? value.value : null; }
      if ("expr" in binding && typeof binding.expr === "string") { const value = this.getValue(pointer); return value.status === "ready" ? value.value : null; }
    }
    return binding as JsonValue;
  }

  act = async (pointer: string, event: JsonValue, item?: JsonValue) => {
    try {
      const action = this.localAction(pointer);
      if (action) {
        if (typeof action.client === "string") return this.runtime?.action(action.client, event, item, action.args as JsonValue | undefined) ?? false;
        if (action.pick_files) return await this.runtime?.pick(action.pick_files as PickFilesSpec) ?? false;
        if (action.save_file) {
          const spec = action.save_file as SaveFileSpec;
          const raw = this.localBinding(`${pointer}${Array.isArray(this.definitionAt(pointer)) ? "/0" : ""}/save_file/suggested_name`, spec.suggested_name);
          return await this.runtime?.save(spec, typeof raw === "string" ? raw : "") ?? false;
        }
      }
      await this.ready;
      await this.store.call({ op: "data.act", window_id: this.windowId, pointer, event, ...(item === undefined ? {} : { item }) });
      return true;
    } catch (error) { this.setNotice(toCoreError(error).message); return false; }
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

const DataContext = createContext<{ data: WindowData } | null>(null);

export function WindowDataProvider({ store, windowId, definition, children }: { store: ShellStore; windowId: string; definition: AppDefinition; children: ReactNode }) {
  const data = useMemo(() => new WindowData(store, windowId, definition), [store, windowId, definition]);
  const context = useMemo(() => ({ data }), [data]);
  useEffect(() => data.mount(), [data]);
  return <DataContext.Provider value={context}><ClientRuntimeSync data={data} />{children}</DataContext.Provider>;
}

function ClientRuntimeSync({ data }: { data: WindowData }) {
  const state = useShellSelector(data.store, (snapshot) => snapshot?.shared.windows.find((window) => window.id === data.windowId)?.state);
  useEffect(() => { data.syncClient(); }, [data, state]);
  return null;
}

export function useWindowData(): WindowData {
  const value = useContext(DataContext);
  if (!value) throw new Error("창 데이터가 연결되지 않았습니다");
  return value.data;
}

export function useOptionalWindowData(): WindowData | null {
  return useContext(DataContext)?.data ?? null;
}

export function useDormant(pointer: string, dormant: boolean) {
  const data = useOptionalWindowData();
  useEffect(() => {
    data?.setDormant(pointer, dormant);
    return () => data?.setDormant(pointer, true);
  }, [data, dormant, pointer]);
}

export function useBinding(pointer: string, binding: Binding): BindingValue {
  useBlockRenderProbe();
  const context = useContext(DataContext);
  if (!context) throw new Error("창 데이터가 연결되지 않았습니다");
  const localName = binding !== null && typeof binding === "object" && !Array.isArray(binding) && Object.keys(binding).length === 1 && "client" in binding && typeof binding.client === "string" ? binding.client : null;
  const isExpression = binding !== null && typeof binding === "object" && !Array.isArray(binding) && Object.keys(binding).length === 1 && "expr" in binding && typeof binding.expr === "string";
  const key = localName !== null ? `@client/${localName}` : isExpression ? pointer : "@static";
  const stateKey = binding !== null && typeof binding === "object" && !Array.isArray(binding) && Object.keys(binding).length === 1 && "state" in binding && typeof binding.state === "string" ? binding.state : null;
  const stateValue = useWindowStateValue({ store: context.data.store, window: { id: context.data.windowId } }, stateKey);
  const value = useSyncExternalStore((listener) => context.data.subscribeValue(key, listener), () => context.data.getValue(key), () => loading);
  if (localName !== null) return value;
  if (binding !== null && typeof binding === "object" && !Array.isArray(binding)) {
    if (stateKey !== null) return { status: "ready", value: stateValue as JsonValue ?? null };
    if (isExpression) return value;
  }
  return { status: "ready", value: binding as JsonValue };
}
