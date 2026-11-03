import type { AppDefinition, Binding, BindingValue, ClientActionContext, ClientLifecycle, EventModifiers, PickFilesSpec, SaveFileSpec } from "../contract/contract";
import type { ItemScope } from "../data/item-scope";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { CLIENT_PING_TIMEOUT_SECS } from "../contract/limits";
import type { ShellStore } from "../core/shell-store";
import { isCoreError, toCoreError } from "../core/core-transport";
import type { WindowData } from "../data/window-data";
import { isWindowVisible } from "../data/window-state";
import { clientSource, sandboxErrors } from "../blocks/sandbox-frame";
import { registerSandboxFlush } from "../blocks/sandbox-flush";
import { BrowserFiles } from "./client-files";
import { ClientHostServices } from "./client-host-services";
import { processRequest } from "./client-process";
import * as shellErrors from "../contract/shell-errors";

type Client = NonNullable<AppDefinition["client"]>;
const escapePointer = (value: string) => value.replace(/~/g, "~0").replace(/\//g, "~1");
const runtimes = new WeakMap<ShellStore, Map<string, ClientRuntime>>();

export async function clientShare(store: ShellStore, windowId: string, visual: boolean): Promise<{ text: string; image?: string } | null> {
  return runtimes.get(store)?.get(windowId)?.share(visual) ?? null;
}

export class ClientRuntime {
  private frame: HTMLIFrameElement | null = null;
  private token = "";
  private stopped = false;
  private loaded = false;
  private ready = false;
  private lastPong = 0;
  private ping?: ReturnType<typeof setInterval>;
  private pingVisible = false;
  private unsubscribeVisibility?: () => void;
  private unregister?: () => void;
  private pending = new Map<string, (ok: boolean) => void>();
  private revisions: Record<string, string | null> = {};
  private pendingRevisions: Record<string, string | null> = {};
  private ownWrites: Record<string, string> = {};
  private unsubscribeStorage?: () => void;
  private writes: Promise<unknown> = Promise.resolve();
  private patch: Record<string, JsonValue> = {};
  private patchFrame: number | null = null;
  private previousInputs: Record<string, string> = {};
  private surfaces = new Map<string, { message: Record<string, unknown>; sent: boolean; sentVisible?: boolean }>();
  private files = new BrowserFiles();
  private hostServices: ClientHostServices;
  private blobFiles = new Set<string>();
  private stopping?: Promise<void>;
  private shareText = "";
  private shareImage = "";
  private observer?: ResizeObserver;
  private lifecycleFrame: number | null = null;
  private lastLifecycle = "";
  private closingNotified = false;
  private host: HTMLElement | null = null;
  private snapshots = new Map<string, (image: string) => void>();

  constructor(private store: ShellStore, private data: WindowData, private definition: AppDefinition, private client: Client) {
    this.hostServices = new ClientHostServices(client, store, data.windowId, this.files, () => this.isHostVisible());
  }

  async start() {
    try {
      const reply = await this.store.call({ op: "data.media", window_id: this.data.windowId, media: { asset: this.client.entry.id, version: this.client.entry.version } });
      if (this.stopped) return;
      if (reply.op !== "data.media") throw shellErrors.SHELL_CLIENT_SCRIPT_ASSET_REPLY_INVALID();
      if (reply.media.mime.split(";")[0] !== "text/javascript") throw shellErrors.SHELL_CLIENT_SCRIPT_ASSET_INVALID();
      const script = new TextDecoder().decode(Uint8Array.from(atob(reply.media.data_base64), (char) => char.charCodeAt(0)));
      this.token = crypto.randomUUID();
      const state = this.state();
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("allow", "autoplay");
      frame.setAttribute("title", "클라이언트 런타임");
      frame.srcdoc = clientSource(script, { token: this.token, state, stateKeys: this.client.state_keys, storageEntries: this.client.storage_entries, inputs: this.inputs(), capabilities: this.client.capabilities ?? [], actions: this.client.actions, processEnabled: this.client.process_permissions !== undefined, errors: sandboxErrors() });
      frame.addEventListener("load", () => {
        if (this.loaded) { this.ready = false; this.token = ""; this.data.failClient(shellErrors.SHELL_CLIENT_FRAME_NAVIGATED()); void this.stop(); }
        else this.loaded = true;
      });
      let container = document.querySelector<HTMLDivElement>(".ks-client-frames");
      if (!container) { container = document.createElement("div"); container.className = "ks-client-frames"; container.setAttribute("aria-hidden", "true"); document.body.append(container); }
      this.frame = frame;
      let windows = runtimes.get(this.store);
      if (!windows) { windows = new Map(); runtimes.set(this.store, windows); }
      windows.set(this.data.windowId, this);
      window.addEventListener("message", this.receive);
      this.unsubscribeStorage = this.store.subscribeEvents((event) => {
        if (event.event === "process.ready" && event.window_id === this.data.windowId && this.client.process_permissions !== undefined) this.send({ type: "ks-process-ready", handle: event.handle });
        if (event.event !== "storage.update" || event.window_id !== this.data.windowId) return;
        for (const entry of this.client.storage_entries) {
          if (
            event.update.kind === "snapshot" ||
            (event.update.kind === "changed" && event.update.changed.item.entry_id === entry) ||
            (event.update.kind === "moved" && event.update.moved.entry_id === entry)
          ) {
            void this.syncStorage(entry);
          }
        }
      });
      container.append(frame);
      this.unregister = registerSandboxFlush(this.data.windowId, this.prepareClose);
      this.unsubscribeVisibility = this.store.subscribe(this.syncPingVisibility);
      this.syncPingVisibility();
      this.observeHost(this.data.clientHost);
      window.addEventListener("focus", this.scheduleLifecycle);
      window.addEventListener("blur", this.scheduleLifecycle);
      document.addEventListener("visibilitychange", this.onDocumentVisibilityChange);
    } catch (error) { if (!this.stopped) this.data.failClient(toCoreError(error)); }
  }

  private syncPingVisibility = () => {
    this.scheduleLifecycle();
    const visible = isWindowVisible(this.store.getSnapshot(), this.data.windowId);
    if (visible === this.pingVisible) return;
    this.pingVisible = visible;
    if (!visible) {
      this.hostServices.releaseWakeLock();
      if (this.ping) clearInterval(this.ping);
      this.ping = undefined;
      return;
    }
    // 숨겨진 동안의 시간은 응답 제한에 포함하지 않는다.
    this.lastPong = Date.now();
    let lastTick = this.lastPong;
    const interval = CLIENT_PING_TIMEOUT_SECS * 500;
    this.ping = setInterval(() => {
      const now = Date.now();
      // 호스트가 긴 작업으로 타이머를 제때 실행하지 못한 시간은 앱의 응답 대기에 넣지 않는다.
      // 브라우저의 50ms 미만 타이머 흔들림은 정상 간격으로 취급한다.
      if (now - lastTick > interval + 50) this.lastPong = now;
      lastTick = now;
      if (now - this.lastPong > CLIENT_PING_TIMEOUT_SECS * 1000) { this.data.failClient(shellErrors.SHELL_CLIENT_UNRESPONSIVE()); void this.stop(); return; }
      this.send({ type: "ks-client-ping" });
    }, interval);
  };

  private onDocumentVisibilityChange = () => {
    if (document.visibilityState !== "visible") this.hostServices.releaseWakeLock();
    else this.scheduleLifecycle();
  };

  private isHostVisible() {
    return document.visibilityState === "visible" && isWindowVisible(this.store.getSnapshot(), this.data.windowId) && !this.data.clientDormant;
  }

  observeHost(host: HTMLElement | null) {
    this.observer?.disconnect();
    this.host = host;
    if (host && typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(this.scheduleLifecycle);
      this.observer.observe(host);
    }
    this.scheduleLifecycle();
  }

  scheduleLifecycle = () => {
    if (!this.ready || this.lifecycleFrame !== null) return;
    this.lifecycleFrame = requestAnimationFrame(() => { this.lifecycleFrame = null; this.sendLifecycle("change"); });
  };

  private sendLifecycle(phase: ClientLifecycle["phase"]) {
    if (!this.ready) return;
    const snapshot = this.store.getSnapshot();
    const current = snapshot?.shared.windows.find((item) => item.id === this.data.windowId);
    const visible = isWindowVisible(snapshot, this.data.windowId) && !this.data.clientDormant;
    if (!visible) this.hostServices.releaseWakeLock();
    for (const [id, surface] of this.surfaces) this.syncSurfaceVisibility(id, surface);
    const focused = visible && document.hasFocus() && !!current && !snapshot?.shared.windows.some((item) => item.desktop_id === current.desktop_id && !item.minimized && item.z > current.z);
    const rect = this.host?.getBoundingClientRect();
    const lifecycle: ClientLifecycle = { visible, focused, viewport: { width: rect?.width ?? 0, height: rect?.height ?? 0, coarse_pointer: window.matchMedia?.("(pointer: coarse)").matches ?? false }, phase };
    const signature = JSON.stringify({ visible, focused, viewport: lifecycle.viewport });
    if (phase === "change" && signature === this.lastLifecycle) return;
    this.lastLifecycle = signature;
    this.send({ type: "ks-client-lifecycle", lifecycle });
  }

  private state() {
    const state = this.store.getSnapshot()?.shared.windows.find((window) => window.id === this.data.windowId)?.state ?? {};
    return Object.fromEntries(this.client.state_keys.filter((key) => key in state).map((key) => [key, state[key]]));
  }

  private inputs() {
    const state = this.store.getSnapshot()?.shared.windows.find((window) => window.id === this.data.windowId)?.state ?? {};
    return Object.fromEntries(Object.entries(this.client.inputs).map(([name, binding]) => [name, this.input(name, binding, state)]));
  }

  private input(name: string, binding: Binding, state: Record<string, JsonValue>): BindingValue {
    if (binding && typeof binding === "object" && !Array.isArray(binding)) {
      if (Object.keys(binding).length === 1 && "state" in binding && typeof binding.state === "string") return { status: "ready", value: state[binding.state] ?? null };
      if (Object.keys(binding).length === 1 && "expr" in binding && typeof binding.expr === "string") return this.data.getValue(`/client/inputs/${escapePointer(name)}`);
    }
    return { status: "ready", value: binding as JsonValue };
  }

  sync() {
    if (!this.frame) return;
    const inputs = this.inputs();
    const signatures = Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, JSON.stringify(value)]));
    const changed = Object.keys(signatures).filter((name) => signatures[name] !== this.previousInputs[name]);
    if (changed.length) {
      this.previousInputs = signatures;
      this.send({ type: "ks-client-inputs", inputs, changed });
    }
    this.send({ type: "ks-sandbox-state-sync", state: this.state() });
  }

  action(name: string, event: JsonValue, item?: JsonValue, args?: JsonValue, scope?: ItemScope, modifiers?: EventModifiers) {
    if (!this.client.actions.includes(name) || !this.frame) return false;
    const context: ClientActionContext = { event, ...(item === undefined ? {} : { item }), ...(args === undefined ? {} : { args }), ...(scope ? { parent_item: scope.parent_item, key: scope.key, index: scope.index } : {}), ...(modifiers === undefined ? {} : { modifiers }) };
    this.send({ type: "ks-client-action", name, context });
    return true;
  }

  async pick(spec: PickFilesSpec, scope?: ItemScope): Promise<boolean> {
    try {
      const result = this.store.nativeFiles
        ? await this.store.call({ op: "files.pick", window_id: this.data.windowId, accept: spec.accept, multiple: spec.multiple ?? false })
        : await this.files.pick(spec.accept, spec.multiple ?? false);
      for (const file of result.files) this.hostServices.registerFile(file);
      return this.action(spec.client, { cancelled: result.cancelled, files: result.files } as unknown as JsonValue, scope?.item, undefined, scope);
    } catch (error) { this.data.setNotice(toCoreError(error)); return false; }
  }

  async save(spec: SaveFileSpec, name: string, scope?: ItemScope): Promise<boolean> {
    try {
      const native = this.store.nativeFiles ? await this.store.call({ op: "export.begin", window_id: this.data.windowId, suggested_name: name, mime: spec.mime }) : null;
      const result = native ? { cancelled: native.cancelled, ...(native.sink_id ? { sink: native.sink_id } : {}) } : await this.files.save(name, spec.mime);
      return this.action(spec.client, result as JsonValue, scope?.item, undefined, scope);
    } catch (error) { this.data.setNotice(toCoreError(error)); return false; }
  }

  surface(message: { phase: string; id: string; generation: number; canvas?: OffscreenCanvas; css_width?: number; css_height?: number; dpr?: number; visible?: boolean }) {
    const current = this.surfaces.get(message.id);
    if (message.phase === "attach") {
      this.surfaces.set(message.id, { message: { ...message }, sent: false });
      if (this.ready) this.sendSurface(message.id);
    } else if (current && current.message.generation === message.generation) {
      if (message.phase === "detach") {
        if (current.sent) this.send({ type: "ks-client-surface", ...message });
        this.surfaces.delete(message.id);
      } else if (message.phase === "visibility") {
        current.message.visible = message.visible;
        this.syncSurfaceVisibility(message.id, current);
      } else {
        Object.assign(current.message, { css_width: message.css_width, css_height: message.css_height, dpr: message.dpr });
        if (current.sent) this.send({ type: "ks-client-surface", ...message });
      }
    }
  }

  private surfaceVisible(visible: unknown) {
    return !!visible && isWindowVisible(this.store.getSnapshot(), this.data.windowId) && !this.data.clientDormant;
  }

  private syncSurfaceVisibility(id: string, surface: { message: Record<string, unknown>; sent: boolean; sentVisible?: boolean }) {
    const visible = this.surfaceVisible(surface.message.visible);
    if (!surface.sent || surface.sentVisible === visible) return;
    surface.sentVisible = visible;
    this.send({ type: "ks-client-surface", phase: "visibility", id, generation: surface.message.generation, visible });
  }

  private sendSurface(id: string) {
    const surface = this.surfaces.get(id);
    if (!surface || surface.sent || !this.frame) return;
    surface.sentVisible = this.surfaceVisible(surface.message.visible);
    this.send({ type: "ks-client-surface", ...surface.message, visible: surface.sentVisible }, [surface.message.canvas as OffscreenCanvas]);
    surface.sent = true;
  }

  private send(message: object, transfer?: Transferable[]) {
    const target = this.frame?.contentWindow;
    if (target && this.token) transfer ? target.postMessage(message, "*", transfer) : target.postMessage(message, "*");
  }

  private reply(requestId: string, result?: unknown, error?: ReturnType<typeof toCoreError>, transfer?: Transferable[]) {
    this.send({ type: "ks-client-reply", requestId, result, error: error?.message, errorId: error?.id, errorCode: error?.code }, transfer);
  }

  private async syncStorage(entry: string) {
    try {
      const read = await this.store.call({ op: "storage.get", window_id: this.data.windowId, entry });
      if (this.ownWrites[entry] === JSON.stringify(read.result.content)) return;
      delete this.ownWrites[entry];
      this.pendingRevisions[entry] = read.result.revision;
      this.send({ type: "ks-sandbox-storage-sync", entry, content: read.result.content, revision: read.result.revision });
    } catch (error) { this.data.setNotice(toCoreError(error)); }
  }

  private receive = (event: MessageEvent) => {
    if (!this.token || event.source !== this.frame?.contentWindow || event.origin !== "null" || event.data?.token !== this.token) return;
    const message = event.data;
    // 인증된 프레임의 모든 메시지는 프레임이 동작 중이라는 증거다.
    this.lastPong = Date.now();
    if (message.type === "ks-sandbox-ready") { this.ready = true; this.sendLifecycle("ready"); this.sync(); for (const id of this.surfaces.keys()) this.sendSurface(id); for (const entry of this.client.storage_entries) void this.syncStorage(entry); }
    else if (message.type === "ks-client-pong") return;
    else if (message.type === "ks-sandbox-storage-applied" && this.client.storage_entries.includes(message.entry) && this.pendingRevisions[message.entry] === message.revision) {
      this.revisions[message.entry] = message.revision; delete this.pendingRevisions[message.entry];
    }
    else if (message.type === "ks-sandbox-share") {
      const text = typeof message.text === "string" ? message.text : "";
      const image = typeof message.imageBase64 === "string" ? message.imageBase64 : "";
      if (text !== this.shareText || image !== this.shareImage) {
        this.shareText = text; this.shareImage = image; this.data.notifyClientShare();
      }
    } else if (message.type === "ks-client-snapshot-result") {
      const finish = this.snapshots.get(message.requestId);
      if (finish) {
        this.snapshots.delete(message.requestId);
        const bytes = message.bytes instanceof ArrayBuffer ? new Uint8Array(message.bytes) : null;
        let binary = "";
        if (bytes && bytes.length <= 10 * 1024 * 1024) for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        finish(binary ? btoa(binary) : "");
      }
    }
    else if (message.type === "ks-client-publish" && message.patch && typeof message.patch === "object") {
      Object.assign(this.patch, message.patch);
      if (this.patchFrame === null) this.patchFrame = requestAnimationFrame(() => { this.patchFrame = null; const patch = this.patch; this.patch = {}; this.data.publishClient(patch); });
    } else if (message.type === "ks-client-notice" && typeof message.message === "string") {
      if (message.error) {
        const forwarded = { id: message.errorId, code: message.errorCode, message: message.message, details: [] };
        this.data.setNotice(isCoreError(forwarded) ? forwarded : shellErrors.SHELL_CLIENT_ACTION_FAILED({ reason: message.message }));
      } else this.data.setStatus(message.message);
    }
    else if (message.type === "ks-sandbox-flushed") { this.pending.get(message.requestId)?.(message.ok === true); this.pending.delete(message.requestId); }
    else if (message.type === "ks-client-process" && this.client.process_permissions !== undefined) {
      void processRequest(this.store, this.data.windowId, message.method, message.params).then((result) => this.reply(message.requestId, result)).catch((error) => this.reply(message.requestId, undefined, toCoreError(error)));
    }
    else if (message.type === "ks-client-command") {
      if (typeof message.name !== "string" || !Object.hasOwn(this.client.commands, message.name)) this.reply(message.requestId, undefined, shellErrors.SHELL_CLIENT_COMMAND_UNDECLARED({ name: String(message.name) }));
      else void this.store.call({ op: "client.command", window_id: this.data.windowId, name: message.name, event: message.event ?? null }).then(() => this.reply(message.requestId, null)).catch((error) => this.reply(message.requestId, undefined, toCoreError(error)));
    } else if (message.type === "ks-client-save-prompt") {
      const task = async () => {
        if (typeof message.suggested_name !== "string" || typeof message.mime !== "string") throw shellErrors.SHELL_CLIENT_SAVE_PROMPT_INPUT_INVALID();
        let fileId: string | null;
        if (this.store.nativeFiles) {
          const reply = await this.store.call({ op: "files.save_prompt", window_id: this.data.windowId, suggested_name: message.suggested_name, mime: message.mime });
          if (reply.op !== "files.save_prompt") throw shellErrors.SHELL_CLIENT_SAVE_PROMPT_REPLY_INVALID();
          fileId = reply.file_id;
        } else {
          const result = await this.files.savePrompt(message.suggested_name, message.mime);
          fileId = result.cancelled ? null : result.sink ?? null;
        }
        if (fileId) this.hostServices.registerFile({ id: fileId, name: message.suggested_name, mime: message.mime });
        this.reply(message.requestId, fileId);
      };
      void task().catch((error) => this.reply(message.requestId, undefined, toCoreError(error)));
    } else if (message.type === "ks-client-can-share") {
      if (!this.hostServices.hasCapability("share")) this.reply(message.requestId, undefined, shellErrors.SHELL_CLIENT_CAN_SHARE_CAPABILITY_UNDECLARED());
      else void this.hostServices.canShare(message.file_id).then((result) => this.reply(message.requestId, result)).catch(() => this.reply(message.requestId, false));
    } else if (message.type === "ks-client-share") {
      if (!this.hostServices.hasCapability("share")) this.reply(message.requestId, undefined, shellErrors.SHELL_CLIENT_SHARE_CAPABILITY_UNDECLARED());
      else void this.hostServices.share(message.file_id, message.title).then((result) => this.reply(message.requestId, result)).catch(() => this.reply(message.requestId, { status: "failed" }));
    } else if (message.type === "ks-client-keep-awake") {
      if (!this.hostServices.hasCapability("keep_awake")) this.reply(message.requestId, undefined, shellErrors.SHELL_CLIENT_KEEP_AWAKE_CAPABILITY_UNDECLARED());
      else void this.hostServices.keepAwake(message.enabled === true).then((result) => this.reply(message.requestId, result)).catch(() => this.reply(message.requestId, false));
    } else if (message.type === "ks-sandbox-state-set" && message.patch && typeof message.patch === "object") {
      const state = this.store.getSnapshot()?.shared.windows.find((window) => window.id === this.data.windowId)?.state ?? {};
      const patch = Object.fromEntries(Object.entries(message.patch).filter(([key]) => this.client.state_keys.includes(key))) as Record<string, JsonValue>;
      void this.store.call({ op: "window.set_state", window_id: this.data.windowId, state: { ...state, ...patch } }).catch((error) => this.data.setNotice(toCoreError(error)));
    } else if ((message.type === "ks-sandbox-storage-get" || message.type === "ks-sandbox-storage-set") && this.client.storage_entries.includes(message.entry)) {
      const task = this.writes.catch(() => undefined).then(async () => {
        if (message.type === "ks-sandbox-storage-get" || !(message.entry in this.revisions)) {
          const read = await this.store.call({ op: "storage.get", window_id: this.data.windowId, entry: message.entry });
          this.revisions[message.entry] = read.result.revision;
          if (message.type === "ks-sandbox-storage-get") return read.result.content;
        }
        this.ownWrites[message.entry] = JSON.stringify(message.content);
        let write;
        try { write = await this.store.call({ op: "storage.write", window_id: this.data.windowId, entry: message.entry, content: message.content, expected_revision: this.revisions[message.entry] }); }
        catch (error) { delete this.ownWrites[message.entry]; throw error; }
        this.revisions[message.entry] = write.revision;
        return message.content;
      });
      this.writes = task;
      void task.then((content) => this.send({ type: "ks-sandbox-storage-reply", requestId: message.requestId, content })).catch((reason) => { const error = toCoreError(reason); this.send({ type: "ks-sandbox-storage-reply", requestId: message.requestId, error: error.message, errorId: error.id, errorCode: error.code }); });
    } else if (message.type === "ks-client-asset-bytes") {
      if (!this.definition.assets?.some((asset) => asset.id === message.id)) this.reply(message.requestId, undefined, shellErrors.SHELL_CLIENT_ASSET_UNDECLARED({ asset_id: String(message.id) }));
      else void this.store.call({ op: "data.media", window_id: this.data.windowId, media: { asset: message.id } }).then((reply) => {
          const bytes = Uint8Array.from(atob(reply.media.data_base64), (char) => char.charCodeAt(0)).buffer;
          this.reply(message.requestId, bytes, undefined, [bytes]);
        }).catch((error) => this.reply(message.requestId, undefined, toCoreError(error)));
    } else if (message.type === "ks-client-http-read") {
      const task = async () => {
        if (!this.store.bytes) throw shellErrors.SHELL_CLIENT_HTTP_TRANSPORT_UNAVAILABLE();
        const body = new TextEncoder().encode(JSON.stringify({ permission: message.permission, path: message.path, query: message.query ?? {} })).buffer;
        const response = await this.store.bytes({ op: "client.http_read", window_id: this.data.windowId, handle: "" }, body);
        const length = new DataView(response).getUint32(0);
        const mime = new TextDecoder().decode(response.slice(4, 4 + length));
        const bytes = response.slice(4 + length);
        this.reply(message.requestId, { bytes, mime }, undefined, [bytes]);
      };
      void task().catch((error) => this.reply(message.requestId, undefined, toCoreError(error)));
    } else if (message.type === "ks-client-blob-put") {
      const task = async () => {
        if ((typeof message.fileId === "string") === (message.bytes instanceof ArrayBuffer)) throw shellErrors.SHELL_CLIENT_BLOB_INPUT_INVALID();
        if (typeof message.fileId === "string" && this.store.nativeFiles) {
          await this.store.call({ op: "client.blob_put", window_id: this.data.windowId, key: message.key, file_id: message.fileId });
        } else {
          if (!this.store.bytes) throw shellErrors.SHELL_CLIENT_BLOB_TRANSPORT_UNAVAILABLE();
          const bytes = typeof message.fileId === "string" ? await (this.blobFiles.has(message.fileId) ? this.store.bytes({ op: "files.read_bytes", window_id: this.data.windowId, handle: message.fileId }) : this.files.read(message.fileId)) : message.bytes;
          if (!(bytes instanceof ArrayBuffer)) throw shellErrors.SHELL_CLIENT_BLOB_BYTES_REQUIRED();
          await this.store.bytes({ op: "client.blob_put", window_id: this.data.windowId, handle: message.key }, bytes);
        }
        this.reply(message.requestId, null);
      };
      void task().catch((error) => this.reply(message.requestId, undefined, toCoreError(error)));
    } else if (message.type === "ks-client-blob-open") {
      void this.store.call({ op: "client.blob_open", window_id: this.data.windowId, key: message.key }).then(({ file }) => { if (file) { this.blobFiles.add(file.id); this.hostServices.registerFile(file); } this.reply(message.requestId, file); }).catch((error) => this.reply(message.requestId, undefined, toCoreError(error)));
    } else if (message.type === "ks-client-blob-remove") {
      void this.store.call({ op: "client.blob_remove", window_id: this.data.windowId, key: message.key }).then(() => this.reply(message.requestId, null)).catch((error) => this.reply(message.requestId, undefined, toCoreError(error)));
    } else if (message.type === "ks-client-blob-list") {
      void this.store.call({ op: "client.blob_list", window_id: this.data.windowId, prefix: message.prefix }).then(({ keys }) => this.reply(message.requestId, keys)).catch((error) => this.reply(message.requestId, undefined, toCoreError(error)));
    } else if (message.type === "ks-client-file-read") {
      const result = (this.store.nativeFiles || this.blobFiles.has(message.id)) && this.store.bytes ? this.store.bytes({ op: "files.read_bytes", window_id: this.data.windowId, handle: message.id }) : this.files.read(message.id);
      void result.then((bytes) => this.reply(message.requestId, bytes, undefined, [bytes])).catch((error) => this.reply(message.requestId, undefined, toCoreError(error)));
    } else if (message.type === "ks-client-file-write") {
      const result = this.store.nativeFiles && this.store.bytes ? this.store.bytes({ op: "export.write", window_id: this.data.windowId, handle: message.sink, offset: message.offset }, message.bytes) : this.files.write(message.sink, message.offset, message.bytes);
      void result.then(() => this.reply(message.requestId, null)).catch((error) => this.reply(message.requestId, undefined, toCoreError(error)));
    } else if (message.type === "ks-client-file-truncate") {
      if (!Number.isSafeInteger(message.size) || message.size < 0) { this.reply(message.requestId, undefined, shellErrors.SHELL_CLIENT_FILE_SIZE_INVALID({ size: String(message.size) })); return; }
      const result = this.store.nativeFiles
        ? this.store.call({ op: "export.truncate", window_id: this.data.windowId, sink_id: message.sink, size: message.size })
        : this.files.truncate(message.sink, message.size);
      void result.then(() => this.reply(message.requestId, null)).catch((error) => this.reply(message.requestId, undefined, toCoreError(error)));
    } else if (message.type === "ks-client-file-close" || message.type === "ks-client-file-abort") {
      const result = this.store.nativeFiles
        ? this.store.call({ op: message.type === "ks-client-file-close" ? "export.close" : "export.abort", window_id: this.data.windowId, sink_id: message.sink })
        : message.type === "ks-client-file-close" ? this.files.close(message.sink) : this.files.abort(message.sink);
      void result.then(() => { if (message.type === "ks-client-file-abort") this.hostServices.removeFile(message.sink); this.reply(message.requestId, null); }).catch((error) => this.reply(message.requestId, undefined, toCoreError(error)));
    }
  };

  private beginClosing() {
    this.hostServices.releaseWakeLock();
    if (this.ready && !this.closingNotified) {
      this.closingNotified = true;
      this.sendLifecycle("closing");
    }
  }

  private prepareClose = async () => {
    this.beginClosing();
    const ok = await this.flush();
    if (!ok && this.closingNotified) {
      this.closingNotified = false;
      this.lastLifecycle = "";
      this.sendLifecycle("change");
    }
    return ok;
  };

  flush = () => {
    if (!this.ready || !this.frame) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { this.pending.delete(requestId); resolve(false); }, 5000);
      this.pending.set(requestId, (ok) => { clearTimeout(timeout); resolve(ok); });
      this.send({ type: "ks-sandbox-flush", requestId });
    });
  };

  async share(visual: boolean): Promise<{ text: string; image?: string }> {
    const id = this.surfaces.keys().next().value as string | undefined;
    let image = "";
    if (visual && id && this.ready) image = await new Promise<string>((resolve) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { this.snapshots.delete(requestId); resolve(""); }, 1000);
      this.snapshots.set(requestId, (result) => { clearTimeout(timeout); resolve(result); });
      this.send({ type: "ks-client-snapshot", id, requestId });
    });
    return { text: this.shareText, ...(image || this.shareImage ? { image: image || this.shareImage } : {}) };
  }

  stop() {
    this.stopping ??= this.dispose();
    return this.stopping;
  }

  private async dispose() {
    this.stopped = true;
    const windows = runtimes.get(this.store);
    if (windows?.get(this.data.windowId) === this) windows.delete(this.data.windowId);
    for (const finish of this.snapshots.values()) finish("");
    this.snapshots.clear();
    this.beginClosing();
    await this.flush();
    this.hostServices.dispose();
    await this.files.dispose().catch((error) => this.data.setNotice(toCoreError(error)));
    if (this.store.nativeFiles || this.blobFiles.size) await this.store.call({ op: "client.release", window_id: this.data.windowId }).catch((error) => this.data.setNotice(toCoreError(error)));
    this.unregister?.();
    this.unsubscribeStorage?.();
    this.unsubscribeVisibility?.();
    if (this.ping) clearInterval(this.ping);
    if (this.patchFrame !== null) cancelAnimationFrame(this.patchFrame);
    if (this.lifecycleFrame !== null) cancelAnimationFrame(this.lifecycleFrame);
    this.observer?.disconnect();
    window.removeEventListener("focus", this.scheduleLifecycle);
    window.removeEventListener("blur", this.scheduleLifecycle);
    document.removeEventListener("visibilitychange", this.onDocumentVisibilityChange);
    window.removeEventListener("message", this.receive);
    const container = this.frame?.parentElement;
    this.frame?.remove();
    if (container && !container.children.length) container.remove();
    this.frame = null; this.token = "";
  }
}
