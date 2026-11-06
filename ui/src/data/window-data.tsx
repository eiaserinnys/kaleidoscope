import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { DraftAttachment } from "../blocks/agent-attachments";
import type { AppDefinition, Binding, BindingValue, CoreError, DataView, EventModifiers, MediaPlayback, MediaRef, PickFilesSpec, SaveFileSpec, ShellSnapshot, SourceStatus } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { applyClientChatEnvelope, emptyClientChatState, type ClientChatAttachment, type ClientChatEnvelope, type ClientChatState } from "./client-chat";
import * as shellErrors from "../contract/shell-errors";
import { CLIENT_OUTPUT_MAX_BYTES } from "../contract/limits";
import { toCoreError } from "../core/core-transport";
import { shareStructure, useShellSelector, type ShellStore } from "../core/shell-store";
import { ClientRuntime } from "../runtime/client-runtime";
import { useBlockRenderProbe } from "../render/render-probe";
import { isWindowVisible, useWindowStateValue } from "./window-state";
import { itemPath, useItemScope, type ItemScope } from "./item-scope";
import { hasRepeatLocator, resolveActionScope, type ActionRead } from "./action-scope";
import { trackWindowAction } from "../share/action-context";
import { checkAppLink } from "./app-link";
import { DefaultFolderPreparation } from "./default-folder";

const loading: BindingValue = { status: "loading" };
const emptySources: Record<string, SourceStatus> = {};
const lifecycle = new WeakMap<ShellStore, Map<string, Promise<void>>>();
type PlaybackLease = { request: Promise<MediaPlayback>; users: number; closed: boolean };
type ChatRetry = { id: string; text: string; attachments: DraftAttachment[]; failed: boolean };
type ChatDraft = { text: string; attachments: DraftAttachment[]; retry: ChatRetry | null; restored: ReadonlySet<string>; error: CoreError | null };
const emptyChatDraft: ChatDraft = { text: "", attachments: [], retry: null, restored: new Set(), error: null };

type BindingKind =
  | { kind: "state" | "client" | "expr" | "message" | "item" | "parent_item"; key: string }
  | { kind: "message_item"; path: string }
  | { kind: "literal" };

function bindingKind(binding: Binding): BindingKind {
  if (binding === null || typeof binding !== "object" || Array.isArray(binding)) return { kind: "literal" };
  const entries = Object.entries(binding);
  if (entries.length === 1 && entries[0][0] === "message" && entries[0][1] !== null
      && typeof entries[0][1] === "object" && !Array.isArray(entries[0][1])) {
    const messageEntries = Object.entries(entries[0][1]);
    if (messageEntries.length === 1 && messageEntries[0][0] === "item" && typeof messageEntries[0][1] === "string") {
      return { kind: "message_item", path: messageEntries[0][1] };
    }
  }
  if (entries.length !== 1 || typeof entries[0][1] !== "string") return { kind: "literal" };
  const [kind, key] = entries[0];
  if (kind === "state" || kind === "client" || kind === "expr" || kind === "message" || kind === "item" || kind === "parent_item") {
    return { kind, key };
  }
  return { kind: "literal" };
}

function resolveBindingValue(
  binding: Binding,
  kind: BindingKind,
  definition: AppDefinition,
  pointer: string,
  scope: ItemScope | null | undefined,
  value: BindingValue,
  stateValue: JsonValue | undefined,
): BindingValue {
  switch (kind.kind) {
    case "client":
    case "expr":
      return value;
    case "state":
      return { status: "ready", value: stateValue ?? null };
    case "message": {
      const localeKey = definition.locale?.state;
      const defaultLocale = localeKey === undefined ? null : definition.state[localeKey];
      const selectedLocale = typeof stateValue === "string" ? stateValue : defaultLocale;
      const messageValue = (typeof selectedLocale === "string" ? definition.messages?.[selectedLocale]?.[kind.key] : undefined)
        ?? (typeof defaultLocale === "string" ? definition.messages?.[defaultLocale]?.[kind.key] : undefined)
        ?? undefined;
      if (typeof messageValue === "string") return { status: "ready", value: messageValue };
      const locale = typeof selectedLocale === "string" ? selectedLocale : typeof defaultLocale === "string" ? defaultLocale : "알 수 없음";
      const error = shellErrors.SHELL_MESSAGE_KEY_NOT_FOUND({ locale, key: kind.key });
      return { status: "failed", message: error.message, id: error.id, retry: [], details: [
        `pointer: ${pointer}`, `item_path: 고정 키`, `key: ${kind.key}`, `locale: ${locale}`,
      ] };
    }
    case "message_item": {
      const itemValue = itemPath(scope?.item, kind.path);
      const localeKey = definition.locale?.state;
      const defaultLocale = localeKey === undefined ? null : definition.state[localeKey];
      const selectedLocale = typeof stateValue === "string" ? stateValue : defaultLocale;
      const locale = typeof selectedLocale === "string" ? selectedLocale : typeof defaultLocale === "string" ? defaultLocale : "알 수 없음";
      const rowKey = scope ? String(scope.key) : "없음";
      const commonDetails = [`pointer: ${pointer}`, `item_path: ${kind.path}`, `item_key: ${rowKey}`, `locale: ${locale}`];
      if (itemValue === null || itemValue === undefined) {
        const error = shellErrors.SHELL_MESSAGE_ITEM_KEY_MISSING({ path: kind.path });
        return { status: "failed", message: error.message, id: error.id, retry: [], details: [...commonDetails, "key: 없음"] };
      }
      if (typeof itemValue !== "string") {
        const error = shellErrors.SHELL_MESSAGE_ITEM_KEY_NOT_STRING({ path: kind.path });
        return { status: "failed", message: error.message, id: error.id, retry: [], details: [...commonDetails, `key: ${JSON.stringify(itemValue)}`] };
      }
      const messageValue = (typeof selectedLocale === "string" ? definition.messages?.[selectedLocale]?.[itemValue] : undefined)
        ?? (typeof defaultLocale === "string" ? definition.messages?.[defaultLocale]?.[itemValue] : undefined)
        ?? undefined;
      if (typeof messageValue === "string") return { status: "ready", value: messageValue };
      const error = shellErrors.SHELL_MESSAGE_KEY_NOT_FOUND({ locale, key: itemValue });
      return { status: "failed", message: error.message, id: error.id, retry: [], details: [...commonDetails, `key: ${itemValue}`] };
    }
    case "item":
      return { status: "ready", value: itemPath(scope?.item, kind.key) };
    case "parent_item":
      return { status: "ready", value: itemPath(scope?.parent_item, kind.key) };
    case "literal":
      return { status: "ready", value: binding as JsonValue };
  }
}

export function recoveryVisible(snapshot: ShellSnapshot | null, windowId: string) {
  if (!snapshot || !isWindowVisible(snapshot, windowId)) return false;
  const window = snapshot.shared.windows.find((item) => item.id === windowId);
  return !!window && !snapshot.shared.windows.some((item) => item.desktop_id === window.desktop_id && !item.minimized && item.maximized && item.z > window.z);
}

function enqueue(store: ShellStore, id: string, task: () => Promise<void>) {
  let queues = lifecycle.get(store);
  if (!queues) { queues = new Map(); lifecycle.set(store, queues); }
  const next = (queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(task);
  queues.set(id, next);
  const cleanup = () => { if (queues?.get(id) === next) queues.delete(id); };
  void next.then(cleanup, cleanup);
  return next;
}

export class WindowData {
  readonly defaultFolders = new DefaultFolderPreparation();
  clientHost: HTMLElement | null = null;
  clientDormant = false;
  setClientHost = (host: HTMLElement | null) => { this.clientHost = host; this.runtime?.observeHost(host); };
  setClientDormant = (dormant: boolean) => { this.clientDormant = dormant; this.runtime?.scheduleLifecycle(); };
  readonly mediaCache = new Map<string, Promise<string>>();
  private readonly playbackCache = new Map<string, PlaybackLease>();
  acquirePlayback = (media: MediaRef, generation: number) => {
    const key = JSON.stringify([media, generation]);
    let lease = this.playbackCache.get(key);
    if (!lease) {
      const request = this.store.call({ op: "data.media.open", window_id: this.windowId, media }).then((reply) => reply.playback);
      lease = { request, users: 0, closed: false };
      this.playbackCache.set(key, lease);
      const entry = lease;
      void request.catch(() => { if (this.playbackCache.get(key) === entry) this.playbackCache.delete(key); });
    }
    const entry = lease;
    entry.users += 1;
    return { request: entry.request, release: () => {
      entry.users -= 1;
      if (entry.users === 0) this.closePlayback(key, entry);
    } };
  };
  private closePlayback(key: string, lease: PlaybackLease) {
    if (lease.closed) return;
    lease.closed = true;
    if (this.playbackCache.get(key) === lease) this.playbackCache.delete(key);
    void lease.request.then((playback) => {
      if (playback.kind === "stream") return this.store.call({ op: "data.media.close", window_id: this.windowId, handle: playback.handle });
    }).catch(() => undefined);
  }
  private clearPlayback() {
    for (const [key, lease] of this.playbackCache) this.closePlayback(key, lease);
  }
  private values: DataView["values"] = {};
  private clientValues: Record<string, BindingValue> = {};
  private clientChatValues = new Map<string, ClientChatState>();
  private pendingClientChatValues = new Map<string, ClientChatState>();
  private clientChatFrames = new Map<string, number>();
  private clientChatListeners = new Map<string, Set<() => void>>();
  private chatDrafts = new Map<string, ChatDraft>();
  private chatDraftListeners = new Map<string, Set<() => void>>();
  private sources: DataView["sources"] = emptySources;
  private sourceMeta: NonNullable<DataView["source_meta"]> = {};
  private listeners = new Map<string, Set<() => void>>();
  private sourceListeners = new Set<() => void>();
  private noticeListeners = new Set<() => void>();
  private notice: string | null = null;
  private noticeProblem: CoreError | string | null = null;
  private noticeOwner: object | null = null;
  private noticeId: string | null = null;
  private noticeRole: "alert" | "status" = "alert";
  private statusSequence = 0;
  private unsubscribe?: () => void;
  private unsubscribeLink?: () => void;
  private active = false;
  private pending: DataView[] = [];
  private inputSettlers = new Set<() => Promise<void> | null>();
  private inputSequence = 0;
  holdInput = (settle: () => Promise<void> | null) => {
    this.inputSettlers.add(settle);
    return () => { this.inputSettlers.delete(settle); };
  };
  private initialized = false;
  private attached = false;
  private mounts = 0;
  private ready: Promise<void> = Promise.resolve();
  private runtime: ClientRuntime | null = null;
  private clientFailed = false;
  private clientGeneration = 0;
  private clientListeners = new Set<() => void>();
  private mediaGeneration = 0;
  private mediaListeners = new Set<() => void>();
  private shareListeners = new Set<() => void>();
  private shareSequence = 0;
  private dormantPointers = new Set<string>();
  private dormantInstances = new Map<string, Map<object, boolean>>();
  private dormantListeners = new Set<() => void>();
  private dormantScheduled = false;
  private restarting = false;
  private surfaceGeneration = 0;
  private surfaces = new Map<string, { id: string; generation: number; canvas: OffscreenCanvas; css_width: number; css_height: number; dpr: number; visible: boolean }>();

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
      try { encoded = JSON.stringify(value); } catch { this.setNotice(shellErrors.SHELL_CLIENT_OUTPUT_SERIALIZE_FAILED({ name })); continue; }
      if (encoded === undefined) { this.setNotice(shellErrors.SHELL_CLIENT_OUTPUT_SERIALIZE_FAILED({ name })); continue; }
      if (new TextEncoder().encode(encoded).byteLength > CLIENT_OUTPUT_MAX_BYTES) { this.setNotice(shellErrors.SHELL_CLIENT_OUTPUT_TOO_LARGE({ name, limit: "1MB" })); continue; }
      const previous = this.clientValues[name];
      if (previous?.status === "ready" && JSON.stringify(previous.value) === encoded) continue;
      this.clientValues[name] = { status: "ready", value: previous?.status === "ready" ? shareStructure(previous.value, value) : value };
      this.listeners.get(`@client/${name}`)?.forEach((listener) => listener());
    }
  };
  getClientChat = (channel: string) => this.clientChatValues.get(channel) ?? emptyClientChatState;
  getChatDraft = (key: string) => this.chatDrafts.get(key) ?? emptyChatDraft;
  subscribeChatDraft = (key: string, listener: () => void) => {
    let group = this.chatDraftListeners.get(key);
    if (!group) { group = new Set(); this.chatDraftListeners.set(key, group); }
    group.add(listener);
    return () => { group?.delete(listener); if (!group?.size) this.chatDraftListeners.delete(key); };
  };
  updateChatDraft = (key: string, update: (draft: ChatDraft) => ChatDraft) => {
    const current = this.getChatDraft(key);
    const next = update(current);
    if (next === current) return;
    this.chatDrafts.set(key, next);
    this.chatDraftListeners.get(key)?.forEach((listener) => listener());
  };
  takeClientChatAttachment = (channel: string, requestId: string): ClientChatAttachment | undefined => {
    const state = this.getClientChat(channel);
    const attachment = state.attachments.get(requestId);
    if (!attachment) return undefined;
    const attachments = new Map(state.attachments);
    attachments.delete(requestId);
    this.clientChatValues.set(channel, { ...state, attachments });
    return attachment;
  };
  subscribeClientChat = (channel: string, listener: () => void) => {
    let listeners = this.clientChatListeners.get(channel);
    if (!listeners) { listeners = new Set(); this.clientChatListeners.set(channel, listeners); }
    listeners.add(listener);
    return () => { listeners?.delete(listener); if (!listeners?.size) this.clientChatListeners.delete(channel); };
  };
  publishClientChat = (channel: string, envelope: ClientChatEnvelope) => {
    if (!(this.definition.client?.channels ?? []).includes(channel)) return;
    const current = this.pendingClientChatValues.get(channel) ?? this.clientChatValues.get(channel) ?? emptyClientChatState;
    this.pendingClientChatValues.set(channel, applyClientChatEnvelope(current, envelope));
    if (this.clientChatFrames.has(channel)) return;
    const frame = requestAnimationFrame(() => {
      this.clientChatFrames.delete(channel);
      const next = this.pendingClientChatValues.get(channel);
      this.pendingClientChatValues.delete(channel);
      if (!next) return;
      this.clientChatValues.set(channel, next);
      this.clientChatListeners.get(channel)?.forEach((listener) => listener());
    });
    this.clientChatFrames.set(channel, frame);
  };
  private resetClientChats() {
    const channels = new Set([
      ...(this.definition.client?.channels ?? []),
      ...this.clientChatValues.keys(),
      ...this.pendingClientChatValues.keys(),
      ...this.clientChatFrames.keys(),
      ...this.clientChatListeners.keys(),
    ]);
    const generations = new Map<string, number>();
    for (const channel of channels) {
      generations.set(channel, Math.max(
        this.clientChatValues.get(channel)?.generation ?? 0,
        this.pendingClientChatValues.get(channel)?.generation ?? 0,
      ) + 1);
    }
    this.clientChatFrames.forEach((frame) => cancelAnimationFrame(frame));
    this.clientChatFrames.clear();
    this.pendingClientChatValues.clear();
    for (const channel of channels) {
      this.clientChatValues.set(channel, { ...emptyClientChatState, generation: generations.get(channel)! });
      this.clientChatListeners.get(channel)?.forEach((listener) => listener());
    }
  }
  requestClientAction = (name: string, event: unknown, transfer?: Transferable[]) => {
    if (!this.runtime) return Promise.reject(shellErrors.SHELL_CLIENT_ACTION_FAILED({ reason: "클라이언트 실행이 준비되지 않았습니다" }));
    return this.runtime.requestAction(name, event, transfer);
  };
  subscribeSources = (listener: () => void) => { this.sourceListeners.add(listener); return () => this.sourceListeners.delete(listener); };
  getSources = () => this.sources;
  getSourceMeta = () => this.sourceMeta;
  subscribeNotice = (listener: () => void) => { this.noticeListeners.add(listener); return () => this.noticeListeners.delete(listener); };
  getNotice = () => this.notice;
  getNoticeId = () => this.noticeId;
  getNoticeRole = () => this.noticeRole;
  getStatusSequence = () => this.statusSequence;
  setNotice = (problem: CoreError | string | null, owner: object | null = null) => {
    this.noticeProblem = problem;
    this.noticeOwner = owner;
    this.notice = typeof problem === "string" ? problem : problem?.message ?? null;
    this.noticeId = typeof problem === "string" ? null : problem?.id ?? null;
    this.noticeRole = "alert";
    this.noticeListeners.forEach((listener) => listener());
  };
  setOwnedNotice = (problem: CoreError | string, owner: object) => {
    if (this.notice === null || this.noticeOwner === owner) this.setNotice(problem, owner);
  };
  clearNoticeIf = (problem: CoreError | string, owner?: object) => { if (this.noticeProblem === problem && (!owner || this.noticeOwner === owner)) this.setNotice(null); };
  setStatus = (message: string) => { this.noticeProblem = null; this.noticeOwner = null; this.notice = message; this.noticeId = null; this.noticeRole = "status"; this.statusSequence += 1; this.noticeListeners.forEach((listener) => listener()); };
  getClientFailed = () => this.clientFailed;
  failClient = (problem: CoreError) => { this.clientFailed = true; this.setNotice(problem); };
  subscribeClient = (listener: () => void) => { this.clientListeners.add(listener); return () => this.clientListeners.delete(listener); };
  getClientGeneration = () => this.clientGeneration;
  subscribeMedia = (listener: () => void) => { this.mediaListeners.add(listener); return () => this.mediaListeners.delete(listener); };
  getMediaGeneration = () => this.mediaGeneration;
  subscribeClientShare = (listener: () => void) => { this.shareListeners.add(listener); return () => this.shareListeners.delete(listener); };
  getClientShareSequence = () => this.shareSequence;
  notifyClientShare = () => { this.shareSequence += 1; this.shareListeners.forEach((listener) => listener()); };
  restartClient = async () => {
    if (this.restarting || !this.definition.client) return;
    this.restarting = true;
    const previous = this.runtime; this.runtime = null;
    if (previous) await previous.stop();
    if (!this.active) { this.restarting = false; return; }
    this.resetClientChats();
    this.surfaces.clear();
    this.clientFailed = false; this.setNotice(null);
    this.publishClient(Object.fromEntries(Object.entries(this.definition.client.outputs).map(([name, output]) => [name, output.default])));
    const runtime = new ClientRuntime(this.store, this, this.definition, this.definition.client);
    this.runtime = runtime; this.clientGeneration += 1; this.clientListeners.forEach((listener) => listener());
    this.startRuntime(runtime); this.restarting = false;
  };

  private startRuntime(runtime: ClientRuntime) {
    const generation = this.mediaGeneration;
    void runtime.start().then(() => {
      if (this.active && this.runtime === runtime && this.clientFailed && generation !== this.mediaGeneration) void this.restartClient();
    });
  }

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
    const connectedKey = () => {
      const link = this.store.getSnapshot()?.link;
      return link?.state === "connected" ? `${link.mode}:${link.server_url}` : null;
    };
    let previousLink = connectedKey();
    let pendingMedia = false;
    this.unsubscribeLink = this.store.subscribe(() => {
      const nextLink = connectedKey();
      if (nextLink && nextLink !== previousLink) pendingMedia = true;
      if (nextLink && pendingMedia && recoveryVisible(this.store.getSnapshot(), this.windowId)) {
        pendingMedia = false;
        this.mediaCache.clear();
        this.clearPlayback();
        this.mediaGeneration += 1;
        this.mediaListeners.forEach((listener) => listener());
        if (this.initialized && this.definition.client && (this.clientFailed || !this.runtime)) void this.restartClient();
      }
      previousLink = nextLink;
    });
    this.unsubscribe = this.store.subscribeEvents((event) => {
      if (event.event !== "data.update" || event.window_id !== this.windowId) return;
      if (!this.initialized) this.pending.push(event.view); else this.merge(event.view);
    });
    this.ready = enqueue(this.store, this.windowId, async () => {
      if (!this.active || mount !== this.mounts) return;
      try {
        await this.defaultFolders.prepare(this.store, this.windowId, this.definition, () => this.active && mount === this.mounts);
        if (!this.active || mount !== this.mounts) return;
        const reply = await this.store.call({ op: "data.attach", window_id: this.windowId, dormant: [...this.dormantPointers] });
        if (!this.active || mount !== this.mounts) return;
        this.attached = true;
        this.merge(reply.view);
        this.initialized = true;
        this.pending.forEach((view) => this.merge(view));
        this.pending = [];
        if (this.definition.client) {
          const runtime = new ClientRuntime(this.store, this, this.definition, this.definition.client);
          this.runtime = runtime;
          for (const surface of this.surfaces.values()) runtime.surface({ phase: "attach", ...surface });
          this.startRuntime(runtime);
        }
      } catch (error) { if (this.active) this.setNotice(toCoreError(error)); }
    });
    const onFocus = () => {
      const names = Object.entries(this.definition.sources ?? {}).filter(([, source]) => source.kind === "file" || source.kind === "folder").map(([name]) => name);
      if (names.length) void this.refresh(names);
    };
    globalThis.window.addEventListener("focus", onFocus);
    return () => {
      this.active = false;
      this.attached = false;
      this.mediaCache.clear();
      this.clearPlayback();
      this.unsubscribe?.();
      this.unsubscribeLink?.();
      globalThis.window.removeEventListener("focus", onFocus);
      const runtime = this.runtime; this.runtime = null;
      enqueue(this.store, this.windowId, async () => { if (runtime) await runtime.stop(); await this.store.call({ op: "data.detach", window_id: this.windowId }).catch(() => undefined); });
    };
  }

  syncClient = () => this.runtime?.sync();

  retry = async () => {
    await this.ready;
    if (!this.active) return;
    await enqueue(this.store, this.windowId, async () => {
      if (!this.active) return;
      const alreadyAttached = this.attached;
      const wasInitialized = this.initialized;
      this.initialized = false;
      this.pending = [];
      try {
        const reply = await this.store.call({ op: "data.attach", window_id: this.windowId, dormant: [...this.dormantPointers] });
        this.merge(reply.view);
        this.attached = true;
        this.initialized = true;
        if (alreadyAttached) await this.store.call({ op: "data.detach", window_id: this.windowId });
      } catch (error) {
        this.initialized = wasInitialized;
        throw error;
      } finally {
        if (this.initialized) {
          this.pending.forEach((view) => this.merge(view));
          this.pending = [];
        }
      }
    });
  };

  setDormant = (pointer: string, dormant: boolean) => {
    if (this.dormantPointers.has(pointer) === dormant) return;
    if (dormant) this.dormantPointers.add(pointer);
    else this.dormantPointers.delete(pointer);
    this.dormantListeners.forEach((listener) => listener());
    if (!this.active || this.dormantScheduled) return;
    this.dormantScheduled = true;
    const mount = this.mounts;
    queueMicrotask(() => {
      this.dormantScheduled = false;
      void this.ready.then(async () => {
        if (!this.active || mount !== this.mounts || !this.initialized) return;
        try { await this.store.call({ op: "data.dormant", window_id: this.windowId, dormant: [...this.dormantPointers] }); }
        catch (error) { if (this.active && mount === this.mounts) this.setNotice(toCoreError(error)); }
      });
    });
  };

  setInstanceDormant = (pointer: string, instance: object, dormant: boolean | null) => {
    let group = this.dormantInstances.get(pointer);
    if (!group) { group = new Map(); this.dormantInstances.set(pointer, group); }
    if (dormant === null) group.delete(instance); else group.set(instance, dormant);
    this.setDormant(pointer, [...group.values()].every(Boolean));
    if (!group.size) this.dormantInstances.delete(pointer);
    this.dormantListeners.forEach((listener) => listener());
  };

  subscribeDormant = (listener: () => void) => { this.dormantListeners.add(listener); return () => this.dormantListeners.delete(listener); };
  isDormant = (pointer: string, instance?: object) => {
    const contains = (prefix: string) => pointer === prefix || pointer.startsWith(`${prefix}/`);
    if ([...this.dormantPointers].some(contains)) return true;
    return instance !== undefined && [...this.dormantInstances].some(([prefix, group]) => contains(prefix) && group.get(instance) === true);
  };

  attachSurface = (id: string, canvas: OffscreenCanvas, css_width: number, css_height: number, dpr: number, visible: boolean) => {
    const previous = this.surfaces.get(id);
    if (previous) this.runtime?.surface({ phase: "detach", id, generation: previous.generation });
    const surface = { id, generation: ++this.surfaceGeneration, canvas, css_width, css_height, dpr, visible };
    this.surfaces.set(id, surface); this.runtime?.surface({ phase: "attach", ...surface });
    return surface.generation;
  };
  setSurfaceVisible = (id: string, generation: number, visible: boolean) => {
    const surface = this.surfaces.get(id);
    if (!surface || surface.generation !== generation || surface.visible === visible) return;
    surface.visible = visible;
    this.runtime?.surface({ phase: "visibility", id, generation, visible });
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
    if (current && typeof current === "object" && ("client" in current || "pick_files" in current || "save_file" in current || "copy_text" in current)) return current as Record<string, unknown>;
    return null;
  }

  /** 동작 때 바인딩을 푼다. `read`가 있으면 상태와 식 값을 그 읽기에서, 없으면 지금 화면이 든 값에서 가져온다. */
  private resolveLocal(pointer: string, binding: Binding, scope?: ItemScope | null, read?: ActionRead): BindingValue {
    const kind = bindingKind(binding);
    const state = read ? read.state : this.store.getSnapshot()?.shared.windows.find((window) => window.id === this.windowId)?.state;
    const stateKey = kind.kind === "state" ? kind.key : kind.kind === "message" || kind.kind === "message_item" ? this.definition.locale?.state : undefined;
    const stateValue = stateKey === undefined ? undefined : state?.[stateKey];
    const value = kind.kind === "client"
      ? this.getValue(`@client/${kind.key}`)
      : kind.kind === "expr"
        ? read?.view.values[pointer] ?? this.getValue(pointer)
        : loading;
    return resolveBindingValue(binding, kind, this.definition, pointer, scope, value, stateValue);
  }

  private localBinding(pointer: string, binding: Binding, scope?: ItemScope, read?: ActionRead): JsonValue {
    const resolved = this.resolveLocal(pointer, binding, scope, read);
    return resolved.status === "ready" ? resolved.value : null;
  }

  /** 단일 로컬 동작이 쓰는 바인딩(copy_text, open_url, save_file의 suggested_name). 없으면 undefined. */
  private localActionBinding(pointer: string): Binding | undefined {
    const action = this.localAction(pointer);
    if (action) {
      if (action.save_file) return (action.save_file as SaveFileSpec).suggested_name;
      if ("copy_text" in action) return action.copy_text as Binding;
      return undefined;
    }
    const definition = this.definitionAt(pointer);
    if (definition && typeof definition === "object" && !Array.isArray(definition) && "open_url" in definition) return definition.open_url as Binding;
    return undefined;
  }

  /** 입력이 아닌 동작 시점에 현재 값을 한 번 읽어야 하는가: repeat 항목 범위가 있거나 식/상태 바인딩을 읽는 로컬 동작이다. */
  private needsRead(pointer: string, scope?: ItemScope): boolean {
    if (hasRepeatLocator(scope)) return true;
    const binding = this.localActionBinding(pointer);
    if (binding === undefined) return false;
    const kind = bindingKind(binding).kind;
    return kind === "expr" || kind === "state";
  }

  private actionLabel(pointer: string, scope?: ItemScope): string | null {
    const parent = pointer.slice(0, pointer.lastIndexOf("/"));
    const definition = this.definitionAt(parent);
    if (!definition || typeof definition !== "object" || !("label" in definition)) return null;
    const label = this.localBinding(`${parent}/label`, (definition as { label: Binding }).label, scope);
    return typeof label === "string" && label ? label : null;
  }

  act = (pointer: string, event: JsonValue, item?: JsonValue, modifiers?: EventModifiers, scope?: ItemScope, options?: { input?: boolean }) =>
    trackWindowAction(this.windowId, this.actInternal(pointer, event, item, modifiers, scope, options));

  private actInternal = async (pointer: string, event: JsonValue, item?: JsonValue, modifiers?: EventModifiers, scope?: ItemScope, options?: { input?: boolean }) => {
    const label = this.actionLabel(pointer, scope);
    try {
      if (!options?.input) {
        const pending: Promise<void>[] = [];
        for (const settle of this.inputSettlers) {
          try {
            const result = settle();
            if (result) pending.push(result);
          } catch (error) { pending.push(Promise.reject(error)); }
        }
        if (pending.length) await Promise.allSettled(pending);
        const reached = this.store.reached(this.inputSequence);
        if (reached) await reached;
      }
      // 입력 응답 뒤에도 계산값 이벤트는 늦을 수 있다. 코어가 이미 든 현재 값을 이 동작에서만 한 번 읽는다.
      let read: ActionRead | undefined;
      if (!options?.input && this.needsRead(pointer, scope)) {
        await this.ready;
        const reply = await this.store.call({ op: "data.read", window_id: this.windowId });
        read = { state: reply.state, view: reply.view };
        if (scope) scope = resolveActionScope(scope, (at, binding, local) => this.resolveLocal(at, binding, local, read));
      }
      if (scope) item = scope.item;
      const action = this.localAction(pointer);
      if (action) {
        if (typeof action.client === "string") return this.runtime?.action(action.client, event, item, action.args as JsonValue | undefined, scope, modifiers) ?? false;
        if (action.pick_files) return await this.runtime?.pick(action.pick_files as PickFilesSpec, scope) ?? false;
        if (action.save_file) {
          const spec = action.save_file as SaveFileSpec;
          const raw = this.localBinding(`${pointer}${Array.isArray(this.definitionAt(pointer)) ? "/0" : ""}/save_file/suggested_name`, spec.suggested_name, scope, read);
          return await this.runtime?.save(spec, typeof raw === "string" ? raw : "", scope) ?? false;
        }
        if ("copy_text" in action) {
          const arrayPrefix = Array.isArray(this.definitionAt(pointer)) ? "/0" : "";
          const raw = this.localBinding(`${pointer}${arrayPrefix}/copy_text`, action.copy_text as Binding, scope, read);
          if (typeof raw !== "string") throw shellErrors.SHELL_COPY_TEXT_NOT_TEXT();
          if (raw.length === 0) throw shellErrors.SHELL_COPY_TEXT_EMPTY();
          try {
            await navigator.clipboard.writeText(raw);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw shellErrors.SHELL_COPY_TEXT_WRITE_FAILED({ reason });
          }
          return true;
        }
      }
      const openUrl = this.definitionAt(pointer);
      if (openUrl && typeof openUrl === "object" && !Array.isArray(openUrl) && "open_url" in openUrl) {
        const raw = this.localBinding(`${pointer}/open_url`, openUrl.open_url as Binding, scope, read);
        if (typeof raw !== "string") throw shellErrors.SHELL_OPEN_URL_NOT_TEXT();
        if (raw.length === 0) throw shellErrors.SHELL_OPEN_URL_EMPTY();
        await this.store.call({ op: "external.open", window_id: this.windowId, url: checkAppLink(raw) });
        return true;
      }
      await this.ready;
      const reply = await this.store.call({ op: "data.act", window_id: this.windowId, pointer, event, ...(item === undefined ? {} : { item }), ...(modifiers === undefined ? {} : { modifiers }) });
      if (options?.input) this.inputSequence = Math.max(this.inputSequence, reply.sequence);
      return true;
    } catch (error) {
      const problem = toCoreError(error);
      this.setNotice(label ? { ...problem, message: `${label}: ${problem.message}` } : problem);
      return false;
    }
  };
  refresh = async (sources: string[]) => {
    try { await this.ready; await this.store.call({ op: "data.refresh", window_id: this.windowId, sources }); }
    catch (error) { this.setNotice(toCoreError(error)); }
  };
  more = async (source: string) => {
    try { await this.ready; return (await this.store.call({ op: "data.more", window_id: this.windowId, source })).started; }
    catch (error) { this.setNotice(toCoreError(error)); return false; }
  };
  login = async (permission: string) => {
    try { await this.store.call({ op: "connection.login", window_id: this.windowId, permission }); }
    catch (error) { this.setNotice(toCoreError(error)); }
  };
}

const DataContext = createContext<{ data: WindowData } | null>(null);
const WindowDataContext = createContext<WindowData | null>(null);

export function WindowDataProvider({ store, windowId, definition, children }: { store: ShellStore; windowId: string; definition: AppDefinition; children: ReactNode }) {
  const data = useMemo(() => new WindowData(store, windowId, definition), [store, windowId, definition]);
  const context = useMemo(() => ({ data }), [data]);
  useEffect(() => data.mount(), [data]);
  return <WindowDataContext.Provider value={data}>
    <DataContext.Provider value={context}><ClientRuntimeSync data={data} />{children}</DataContext.Provider>
  </WindowDataContext.Provider>;
}

function ClientRuntimeSync({ data }: { data: WindowData }) {
  const state = useShellSelector(data.store, (snapshot) => snapshot?.shared.windows.find((window) => window.id === data.windowId)?.state);
  useEffect(() => { data.syncClient(); }, [data, state]);
  return null;
}

export function useOptionalWindowData(): WindowData | null {
  const value = useContext(WindowDataContext);
  const scope = useItemScope();
  return useMemo(() => {
    if (!value || !scope) return value;
    const proxy = Object.create(value) as WindowData;
    proxy.act = (pointer, event, item, modifiers, localScope, options) => value.act(pointer, event, item, modifiers, localScope ?? scope, options);
    return proxy;
  }, [value, scope]);
}

export function useWindowData(): WindowData {
  const value = useOptionalWindowData();
  if (!value) throw shellErrors.SHELL_WINDOW_DATA_CONTEXT_MISSING();
  return value;
}

export function useChatDraft(key: string) {
  const data = useWindowData();
  const subscribe = useCallback((listener: () => void) => data.subscribeChatDraft(key, listener), [data, key]);
  const snapshot = useCallback(() => data.getChatDraft(key), [data, key]);
  const draft = useSyncExternalStore(subscribe, snapshot, snapshot);
  const setDraft = useCallback<Dispatch<SetStateAction<string>>>((value) => data.updateChatDraft(key, (current) => ({ ...current, text: typeof value === "function" ? value(current.text) : value })), [data, key]);
  const setAttachments = useCallback<Dispatch<SetStateAction<DraftAttachment[]>>>((value) => data.updateChatDraft(key, (current) => ({ ...current, attachments: typeof value === "function" ? value(current.attachments) : value })), [data, key]);
  const setError = useCallback<Dispatch<SetStateAction<CoreError | null>>>((value) => data.updateChatDraft(key, (current) => ({ ...current, error: typeof value === "function" ? value(current.error) : value })), [data, key]);
  const updateComposer = useCallback((update: (current: ChatDraft) => ChatDraft) => data.updateChatDraft(key, update), [data, key]);
  return { draft: draft.text, attachments: draft.attachments, error: draft.error, setDraft, setAttachments, setError, updateComposer, getComposer: snapshot };
}

export function useDormant(pointer: string, dormant: boolean) {
  const data = useContext(WindowDataContext);
  const scope = useItemScope();
  useEffect(() => {
    if (scope) {
      data?.setInstanceDormant(pointer, scope.instance, dormant);
      return () => data?.setInstanceDormant(pointer, scope.instance, null);
    }
    data?.setDormant(pointer, dormant);
    return () => data?.setDormant(pointer, true);
  }, [data, dormant, pointer, scope?.instance]);
}

export function useBinding(pointer: string, binding: Binding): BindingValue {
  useBlockRenderProbe();
  const scope = useItemScope();
  const context = useContext(DataContext);
  if (!context) throw shellErrors.SHELL_CLIENT_BINDING_DATA_CONTEXT_MISSING();
  const kind = bindingKind(binding);
  const localName = kind.kind === "client" ? kind.key : null;
  const isExpression = kind.kind === "expr";
  const key = localName !== null ? `@client/${localName}` : isExpression ? pointer : "@static";
  const stateKey = kind.kind === "state" ? kind.key : null;
  const localeKey = kind.kind === "message" || kind.kind === "message_item" ? context.data.definition.locale?.state ?? null : null;
  const stateValue = useWindowStateValue({ store: context.data.store, window: { id: context.data.windowId } }, stateKey ?? localeKey);
  const value = useSyncExternalStore((listener) => context.data.subscribeValue(key, listener), () => context.data.getValue(key), () => loading);
  return resolveBindingValue(binding, kind, context.data.definition, pointer, scope, value, stateValue as JsonValue | undefined);
}
