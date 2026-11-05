import { History, type BlobStore } from "./history.ts";
import { answerPermission, enqueue, initialState, reduceMessage, reserveRequest, type Attachment, type Item, type State } from "./reducer.ts";
import { decodeLines, encodeMessage } from "./transport.ts";
import { agentError } from "./errors.ts";
import { cleanReplay, GUIDE_TAG } from "./guide.ts";

export type Spec = { name: string; command: string; args: string[]; env: Record<string, string>; auth_methods?: string[] };
type InstallerCheckpoint = { stdout: string };
type ProcessSnapshot = { handle: string; after: number; checkpoint: State | InstallerCheckpoint | null; cwd: string; services: Record<string, string | null>; exit: unknown | null };
type ProcessPort = {
  attach(params: { key: string }): Promise<ProcessSnapshot | null>;
  start(params: { key: string; permission: string; cwd_permission: string; spec: Omit<Spec, "auth_methods">; services?: string[] }): Promise<{ status?: string; handle?: string; cwd?: string; services?: Record<string, string | null> }>;
  read(params: { handle: string; after: number; max_bytes: number }): Promise<{ bytes: number[]; next: number; stderr_tail: number[]; exit: { code: number | null } | null }>;
  ack(params: { handle: string; after: number; checkpoint: State | InstallerCheckpoint | null }): Promise<unknown>;
  write(params: { handle: string; bytes: Uint8Array; checkpoint: State }): Promise<unknown>;
  stop(params: { handle: string }): Promise<unknown>;
  file_uri(key: string): Promise<string>;
  onReady(listener: (handle: string) => void): () => void;
  onServicesChanged(listener: (handle: string) => void): unknown;
};
type Prepared = { text: string | null; images: { name: string; mime: string; bytes: Uint8Array }[]; ticket: string };
type SessionInfo = { sessionId: string; cwd: string; title?: string; updatedAt?: string };
export type SessionView = { phase: State["phase"]; items: Item[]; stream_id: string | null; text: string; busy: boolean; tool: string | null; queued: { id: string; text: string; attachments: { id: string; name: string; mime: string }[] }[]; permissions: State["permissions"]; controls: State["controls"]; authMethods: State["authMethods"]; failure: State["failure"]; sessionId: string | null; canListSessions: boolean; sessions: SessionInfo[]; sessionsLoading: boolean; sessionError: State["sessionError"]; switching: boolean; configuring: boolean };
export type Host = {
  process: ProcessPort;
  blobs: BlobStore;
  instructions(): Promise<string>;
  prepare(requestId: string, count: number, bytes: number): Promise<Prepared>;
  commit(ticket: string): Promise<void>;
  publish(view: SessionView): void;
  uuid(): string;
  now(): string;
};
export type Upload = { name: string; mime: string; bytes: Uint8Array };
export type SendInput = { id: string; text: string; attachments: Upload[] };

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(binary);
}

/** Owns one ACP process. Every read, checkpoint, and write is serialized. */
export class AgentSession {
  private readonly host: Host;
  private readonly history: History;
  private state: State = initialState();
  private handle: string | null = null;
  private after = 0;
  private cwd = "";
  private tools: string | null = null;
  private spec: Spec | null = null;
  private tasks: Promise<unknown> = Promise.resolve();
  private checkpointKeys: string[] = [];
  private sessions: SessionInfo[] = [];
  private sessionsLoading = false;
  private listError: State["sessionError"] = null;
  private listWanted = false;

  constructor(host: Host) {
    this.host = host;
    this.history = new History(host.blobs);
    host.process.onReady((handle) => { if (handle === this.handle) this.background(this.serial(() => this.drain())); });
    host.process.onServicesChanged((handle) => { if (handle === this.handle) this.background(this.serial(() => this.servicesChanged())); });
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tasks.catch(() => undefined).then(task);
    this.tasks = next;
    return next;
  }

  private redact(text: string): string {
    for (const address of [this.tools, this.state.servicesUsed]) if (address) text = text.split(address).join("[도구 주소]");
    return text;
  }

  private background(task: Promise<unknown>): void {
    void task.catch((error: unknown) => {
      const problem = error as { id?: unknown; code?: unknown; message?: unknown } | null;
      const reason = this.redact(typeof problem?.message === "string" ? problem.message : String(error));
      const failure = typeof problem?.id === "string" && typeof problem.code === "string"
        ? { id: problem.id, code: problem.code, message: reason, reason }
        : { id: "AGENT_ACP_PROTOCOL_FAILED", reason };
      this.state = { ...this.state, phase: "failed", failure };
      this.publish();
    });
  }

  attach(spec?: Spec): Promise<boolean> {
    return this.serial(async () => {
      if (spec) this.spec = spec;
      await this.history.load();
      const process = await this.host.process.attach({ key: "main" });
      if (!process) return false;
      this.handle = process.handle;
      this.after = process.after;
      this.cwd = process.cwd;
      this.tools = process.services.tools ?? null;
      this.state = (process.checkpoint as State | null) ?? { ...initialState(), generation: this.host.uuid(), sessionId: this.history.sessionId };
      this.sessionsLoading = Object.values(this.state.pending).some((request) => request.kind === "list");
      this.listWanted = !this.sessionsLoading;
      this.checkpointKeys = [this.state.streamKey, this.state.partialKey].filter((key): key is string => !!key);
      if (this.state.streamKey) {
        const bytes = await this.host.blobs.read(this.state.streamKey);
        if (!bytes) throw agentError("AGENT_RECONNECT_STREAM_NOT_FOUND");
        this.state.stream.text = new TextDecoder().decode(bytes);
      }
      if (this.state.partialKey) {
        const bytes = await this.host.blobs.read(this.state.partialKey);
        if (!bytes) throw agentError("AGENT_RECONNECT_PARTIAL_NOT_FOUND");
        this.state.partial = Array.from(bytes);
      }
      if (this.state.initialized && this.state.capabilities.http && this.state.servicesUsed !== this.tools) this.state.restartPending = true;
      this.publish();
      await this.drain();
      await this.refreshList();
      if (this.state.phase !== "failed") await this.pump();
      return true;
    });
  }

  start(spec: Spec): Promise<boolean> {
    return this.serial(async () => {
      this.spec = spec;
      await this.history.load();
      const started = await this.launch();
      if (started) { await this.drain(); await this.pump(); }
      return started;
    });
  }

  retry(): Promise<boolean> {
    return this.serial(async () => {
      if (this.handle) await this.host.process.stop({ handle: this.handle });
      this.handle = null;
      const started = await this.launch();
      if (started) { await this.drain(); await this.pump(); }
      return started;
    });
  }

  replace(spec: Spec): Promise<boolean> {
    return this.serial(async () => {
      if (this.handle) await this.host.process.stop({ handle: this.handle });
      this.handle = null;
      this.spec = spec;
      const started = await this.launch();
      if (started) { await this.drain(); await this.pump(); }
      return started;
    });
  }

  stop(): Promise<void> {
    return this.serial(async () => {
      if (this.handle) await this.host.process.stop({ handle: this.handle });
      this.handle = null;
    });
  }

  private async launch(): Promise<boolean> {
    if (!this.spec) throw agentError("AGENT_START_AGENT_NOT_SELECTED");
    const { name, command, args, env } = this.spec;
    const result = await this.host.process.start({ key: "main", permission: "run", cwd_permission: "work", spec: { name, command, args, env }, services: ["tools"] });
    if (result.status === "cancelled") return false;
    if (!result.handle) throw agentError("AGENT_START_HANDLE_MISSING");
    if (!result.cwd) throw agentError("AGENT_START_CWD_MISSING");
    this.handle = result.handle;
    this.cwd = result.cwd;
    this.after = 0;
    this.tools = result.services?.tools ?? null;
    await this.history.bind(JSON.stringify({ name, command, args, env: Object.fromEntries(Object.entries(env).sort()) }), this.cwd);
    this.state = { ...initialState(), generation: this.host.uuid(), sessionId: this.history.sessionId, queue: this.state.queue };
    this.publish();
    return true;
  }

  send(input: SendInput): Promise<void> {
    return this.serial(async () => {
      if (!input.id) throw agentError("AGENT_PROMPT_REQUEST_ID_MISSING");
      if (!input.text.trim() && !input.attachments.length) throw agentError("AGENT_PROMPT_CONTENT_EMPTY");
      if (Array.from(input.text).length > 20000) throw agentError("AGENT_PROMPT_TEXT_TOO_LONG");
      if (input.attachments.length > 10) throw agentError("AGENT_PROMPT_TOO_MANY_ATTACHMENTS");
      let total = 0;
      for (const upload of input.attachments) {
        if (!upload.name.trim()) throw agentError("AGENT_PROMPT_ATTACHMENT_NAME_EMPTY");
        if (upload.bytes.length > 20 * 1024 * 1024) throw agentError("AGENT_PROMPT_ATTACHMENT_TOO_LARGE");
        total += upload.bytes.length;
      }
      if (total > 30 * 1024 * 1024) throw agentError("AGENT_PROMPT_ATTACHMENTS_TOTAL_TOO_LARGE");
      if (!this.handle || (this.state.phase !== "ready" && this.state.phase !== "responding") || Object.values(this.state.pending).some((request) => request.kind === "switch" || request.kind === "new_user")) throw agentError("AGENT_PROMPT_SEND_NOT_READY");
      const attachments: Attachment[] = [];
      for (let index = 0; index < input.attachments.length; index++) {
        const upload = input.attachments[index];
        const id = `${input.id}-${index}`;
        const key = `attachments/${id}`;
        await this.host.blobs.put(key, upload.bytes);
        attachments.push({ id, key, name: upload.name, mime: upload.mime, size: upload.bytes.length });
      }
      this.state = enqueue(this.state, { id: input.id, text: input.text, attachments });
      await this.checkpoint();
      this.publish();
      this.background(this.serial(() => this.pump()));
    });
  }

  answer(id: string | number, option: string | null): Promise<void> {
    return this.serial(async () => { await this.recordAnswer(id, option); await this.checkpoint(); this.publish(); await this.pump(); });
  }

  private async recordAnswer(id: string | number, option: string | null): Promise<void> {
    const permission = this.state.permissions.find((entry) => entry.rpcId === id);
    const next = answerPermission(this.state, id, option);
    const label = permission?.options.find((entry) => entry.id === option)?.label ?? "취소됨";
    await this.history.append([{ id: `permission-${permission!.id}`, kind: "notice", text: `${permission!.title}: ${label}`, at: this.host.now(), attachments: [] }]);
    this.state = next;
  }

  cancel(): Promise<void> {
    return this.serial(async () => {
      for (const permission of this.state.permissions) await this.recordAnswer(permission.rpcId, null);
      await this.checkpoint();
      await this.pump();
      if (this.state.phase === "responding" && this.state.sessionId) await this.write({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: this.state.sessionId } }, this.state);
    });
  }

  authenticate(id: string): Promise<void> {
    return this.serial(async () => { await this.request("authenticate", "authenticate", { methodId: id }); this.publish(); });
  }

  configure(id: string, value: string | boolean): Promise<void> {
    return this.serial(async () => {
      if (!this.state.sessionId || this.state.phase !== "ready") return;
      await this.configureNow(id, value);
    });
  }

  listSessions(): Promise<void> {
    return this.serial(async () => {
      if (Object.values(this.state.pending).some((request) => request.kind === "list")) return;
      this.listWanted = true;
      await this.refreshList();
    });
  }

  private async refreshList(): Promise<void> {
    if (!this.listWanted || !this.handle || !this.state.capabilities.list || this.state.phase !== "ready" || Object.values(this.state.pending).some((request) => request.kind === "list" || request.kind === "switch" || request.kind === "new_user")) return;
    this.listWanted = false;
    this.sessions = [];
    this.sessionsLoading = true;
    this.listError = null;
    this.state = { ...this.state, sessionError: null };
    await this.request("list", "session/list", { cwd: this.cwd });
    this.publish();
  }

  newSession(): Promise<void> { return this.switchSession(null); }
  loadSession(sessionId: string): Promise<void> { return this.switchSession(sessionId); }

  private switchSession(sessionId: string | null): Promise<void> {
    return this.serial(async () => {
      if (!this.handle || this.state.phase !== "ready" || this.state.queue.length || Object.values(this.state.pending).some((request) => request.kind !== "list")) return;
      const mcpServers = this.state.capabilities.http && this.tools ? [{ type: "http", name: "kaleidoscope", url: this.tools, headers: [] }] : [];
      this.listError = null;
      await this.request(sessionId ? "switch" : "new_user", sessionId ? "session/load" : "session/new", {
        cwd: this.cwd, mcpServers, ...(sessionId ? { sessionId, _control: sessionId } : {}),
      });
      this.publish();
    });
  }

  private async configureNow(id: string, value: string | boolean): Promise<void> {
    const params = id === "__legacy_model" ? { sessionId: this.state.sessionId, modelId: value }
      : id === "__legacy_mode" ? { sessionId: this.state.sessionId, modeId: value }
      : { sessionId: this.state.sessionId, configId: id, value };
    await this.request("configure", id === "__legacy_model" ? "session/set_model" : id === "__legacy_mode" ? "session/set_mode" : "session/set_config_option", { ...params, _control: { id, value } });
    this.publish();
  }

  async attachment(key: string): Promise<Uint8Array | null> { return this.host.blobs.read(key); }

  private async servicesChanged(): Promise<void> {
    const process = await this.host.process.attach({ key: "main" });
    if (!process || process.handle !== this.handle) return;
    this.tools = process.services.tools ?? null;
    if (this.state.initialized && this.state.capabilities.http && this.state.servicesUsed !== this.tools) {
      this.state.restartPending = true;
      await this.checkpoint();
      await this.pump();
    }
  }

  private async checkpoint(): Promise<void> {
    if (this.handle) {
      const checkpoint = await this.compact(this.state);
      await this.host.process.ack({ handle: this.handle, after: this.after, checkpoint });
      await this.releaseCheckpointFiles(checkpoint);
    }
  }

  private async releaseCheckpointFiles(checkpoint: State): Promise<void> {
    const current = [checkpoint.streamKey, checkpoint.partialKey].filter((key): key is string => !!key);
    const old = this.checkpointKeys.filter((key) => !current.includes(key));
    this.checkpointKeys = current;
    if (this.host.blobs.remove) for (const key of old) {
      await this.host.blobs.remove(key).catch((error) => console.warn("임시 응답 파일 정리 실패", error));
    }
  }

  private async compact(state: State): Promise<State> {
    const result = { ...state, streamKey: null as string | null, partialKey: null as string | null };
    const streamBytes = new TextEncoder().encode(state.stream.text);
    if (streamBytes.length > 65536) {
      result.streamKey = `transient/stream-${this.after}`;
      await this.host.blobs.put(result.streamKey, streamBytes);
      result.stream = { ...state.stream, text: "" };
    }
    if (state.partial.length > 65536) {
      result.partialKey = `transient/partial-${this.after}`;
      await this.host.blobs.put(result.partialKey, Uint8Array.from(state.partial));
      result.partial = [];
    }
    return result;
  }

  private async write(message: unknown, state: State): Promise<void> {
    if (!this.handle) throw agentError("AGENT_PROCESS_HANDLE_MISSING");
    const checkpoint = await this.compact(state);
    await this.host.process.write({ handle: this.handle, bytes: encodeMessage(message), checkpoint });
    this.state = state;
    await this.releaseCheckpointFiles(checkpoint);
  }

  private async request(kind: string, method: string, parameters: Record<string, unknown>): Promise<void> {
    const { _control, ...params } = parameters;
    const [next, id] = reserveRequest(this.state, kind, _control ?? null);
    await this.write({ jsonrpc: "2.0", id, method, params }, next);
  }

  private async drain(): Promise<void> {
    if (!this.handle) return;
    for (;;) {
      const result = await this.host.process.read({ handle: this.handle, after: this.after, max_bytes: 65536 });
      if (!result.bytes.length) {
        if (result.exit) {
          if (this.state.stream.id && this.state.stream.text) {
            await this.history.append([{ id: this.state.stream.id, kind: "assistant", text: `${this.state.stream.text}\n\n(응답 중단됨)`, at: this.host.now(), attachments: [] }]);
          }
          const error = agentError("AGENT_PROCESS_EXITED", this.spec?.name ?? "프로그램");
          this.state = { ...this.state, stream: { id: null, text: "" }, permissions: [], tools: [], phase: "failed", failure: { id: error.id, code: error.code, message: error.message, reason: error.message } };
          await this.checkpoint();
          this.publish();
        }
        return;
      }
      const decoded = decodeLines(this.state.partial, Uint8Array.from(result.bytes));
      this.state = { ...this.state, partial: decoded.partial };
      for (let index = 0; index < decoded.messages.length; index++) {
        const message = decoded.messages[index] as { id?: string | number; error?: { message?: string }; result?: { sessions?: SessionInfo[]; nextCursor?: string } };
        const request = message.id === undefined ? undefined : this.state.pending[String(message.id)];
        if (request?.kind === "list") {
          const pending = { ...this.state.pending };
          delete pending[String(message.id)];
          this.state = { ...this.state, pending };
          if (message.error) {
            const error = agentError("AGENT_SESSION_LIST_FAILED", this.redact(message.error.message ?? "ACP 오류"));
            this.listError = { id: error.id, message: error.message };
            this.sessionsLoading = false;
          } else {
            this.sessions = [...this.sessions, ...(message.result?.sessions ?? []).filter((entry) => entry.cwd === this.cwd)]
              .sort((a, b) => (Date.parse(b.updatedAt ?? "") || 0) - (Date.parse(a.updatedAt ?? "") || 0));
            this.sessionsLoading = !!message.result?.nextCursor;
            if (message.result?.nextCursor) await this.request("list", "session/list", { cwd: this.cwd, cursor: message.result.nextCursor });
          }
          this.publish();
          continue;
        }
        const replayItems = this.state.replayItems ?? [];
        this.state = reduceMessage(this.state, message, `stream-${this.state.generation}-${this.after}-${index}`);
        if (this.state.sessionError) this.state = { ...this.state, sessionError: { ...this.state.sessionError, message: this.redact(this.state.sessionError.message) } };
        if (this.state.failure) this.state = { ...this.state, failure: { ...this.state.failure, reason: this.redact(this.state.failure.reason) } };
        if (request && !message.error && request.kind === "initialize" && this.spec?.auth_methods) {
          this.state = { ...this.state, authMethods: this.state.authMethods.filter((method) => this.spec!.auth_methods!.includes(method.id)) };
        }
        if (request && !message.error && (request.kind === "new" || request.kind === "load")) {
          await this.history.setSession(this.state.sessionId);
          this.listWanted = true;
          const restoreControls = Object.entries(this.history.controls).filter(([id, value]) => this.state.controls.some((control) => control.id === id && (control.kind === "boolean" ? typeof value === "boolean" : control.options.some((option) => option.value === value)))).map(([id, value]) => ({ id, value }));
          this.state = { ...this.state, restoreControls };
        }
        if (request && !message.error && (request.kind === "switch" || request.kind === "new_user") && this.state.sessionId) {
          await this.history.replace(this.state.sessionId, request.kind === "switch" ? cleanReplay(replayItems) : []);
          this.listWanted = true;
        }
        if (request?.kind === "prompt" && (request.params as { refreshList?: boolean } | null)?.refreshList) this.listWanted = true;
        if (request && !message.error && request.kind === "configure") {
          const control = request.params as { id: string; value: string | boolean };
          await this.history.setControl(control.id, control.value);
        }
      }
      if (this.state.completed.length) {
        await this.history.append(this.state.completed);
        this.state = { ...this.state, completed: [] };
      }
      this.after = result.next;
      await this.checkpoint();
      this.publish();
      if (result.exit) continue;
      await this.refreshList();
      if (!result.exit) await this.pump();
      // 다음 읽기를 줄 끝으로 보내 연속 응답 사이에도 보내기와 조작을 접수한다.
      this.background(this.serial(() => this.drain()));
      return;
    }
  }

  private async pump(): Promise<void> {
    if (!this.handle) return;
    if (this.state.contextTicket) {
      await this.host.commit(this.state.contextTicket);
      this.state = { ...this.state, contextTicket: null };
      await this.checkpoint();
    }
    while (this.state.outbox.length) {
      const [message, ...rest] = this.state.outbox;
      await this.write(message, { ...this.state, outbox: rest });
    }
    if (Object.values(this.state.pending).some((request) => request.kind !== "list")) return;
    if (this.state.phase === "starting") {
      if (!this.state.initialized) {
        await this.request("initialize", "initialize", { protocolVersion: 1, clientCapabilities: {} });
        return;
      }
      const mcpServers = this.state.capabilities.http && this.tools ? [{ type: "http", name: "kaleidoscope", url: this.tools, headers: [] }] : [];
      this.state = { ...this.state, servicesUsed: this.state.capabilities.http ? this.tools : null };
      if (this.state.sessionId && this.state.capabilities.loadSession && !this.state.needsNew) {
        await this.request("load", "session/load", { sessionId: this.state.sessionId, cwd: this.cwd, mcpServers });
      } else {
        if (this.state.sessionId) await this.history.append([{ id: `resume-${this.state.sessionId}`, kind: "notice", text: "앞 대화를 이어받지 못했습니다. 새 세션을 시작합니다.", at: this.host.now(), attachments: [] }]);
        await this.request("new", "session/new", { cwd: this.cwd, mcpServers });
      }
      return;
    }
    if (this.state.phase !== "ready") return;
    if (this.state.restartPending) {
      await this.host.process.stop({ handle: this.handle });
      this.handle = null;
      if (await this.launch()) await this.pump();
      return;
    }
    if (this.state.restoreControls.length) {
      const [control, ...rest] = this.state.restoreControls;
      this.state = { ...this.state, restoreControls: rest };
      await this.configureNow(control.id, control.value);
      return;
    }
    if (!this.state.queue.length || !this.state.sessionId) return;
    const [queued, ...queue] = this.state.queue;
    const prepared = await this.host.prepare(queued.id, queued.attachments.length, queued.attachments.reduce((sum, item) => sum + item.size, 0));
    const content: Record<string, unknown>[] = [];
    if (queued.text) content.push({ type: "text", text: queued.text });
    if (prepared.text) content.push({ type: "text", text: prepared.text });
    const allAttachments: Array<{ id: string; name: string; mime: string; key: string; bytes?: Uint8Array }> = [
      ...queued.attachments, ...prepared.images.map((image, index) => ({ ...image, id: `visual-${index}`, key: "" })),
    ];
    for (const attachment of allAttachments) {
      const bytes = attachment.bytes ?? await this.host.blobs.read(attachment.key);
      if (!bytes) throw agentError("AGENT_ATTACHMENT_READ_NOT_FOUND", attachment.name);
      if (this.state.capabilities.image && attachment.mime.startsWith("image/")) content.push({ type: "image", mimeType: attachment.mime, data: base64(bytes) });
      else {
        const key = attachment.key || `attachments/${queued.id}-${attachment.id}`;
        if (!attachment.key) await this.host.blobs.put(key, bytes);
        content.push({ type: "resource_link", name: attachment.name, mimeType: attachment.mime, uri: await this.host.process.file_uri(key) });
      }
    }
    if (!this.state.guideSent) {
      const guide = await this.host.instructions();
      const tools = this.state.capabilities.http && this.tools ? "MCP 도구가 연결되어 있습니다." : "현재 MCP 도구를 사용할 수 없습니다.";
      content.push({ type: "text", text: `<${GUIDE_TAG}>\n${guide}\n${tools}\n</${GUIDE_TAG}>` });
    }
    const item: Item = { id: queued.id, kind: "user", text: queued.text, at: this.host.now(), attachments: queued.attachments.map(({ id, name, mime }) => ({ id, name, mime })) };
    await this.history.append([item]);
    const refreshList = this.state.refreshAfterFirstPrompt === true;
    this.state = { ...this.state, queue, guideSent: true, refreshAfterFirstPrompt: false, contextTicket: prepared.ticket };
    await this.request("prompt", "session/prompt", { sessionId: this.state.sessionId, prompt: content, _control: { refreshList } });
    await this.host.commit(prepared.ticket);
    this.state = { ...this.state, contextTicket: null };
    await this.checkpoint();
    this.publish();
  }

  private publish(): void {
    this.host.publish({ phase: this.state.phase, items: this.history.items, stream_id: this.state.stream.id, text: this.state.stream.text,
      busy: this.state.phase === "responding" || (this.state.phase === "ready" && this.state.queue.length > 0), tool: this.state.tools.at(-1)?.title ?? null,
      queued: this.state.queue.map((item) => ({ ...item, attachments: item.attachments.map(({ id, name, mime }) => ({ id, name, mime })) })),
      permissions: this.state.permissions, controls: this.state.controls, authMethods: this.state.authMethods, failure: this.state.failure,
      sessionId: this.state.sessionId, canListSessions: !!this.state.capabilities.list, sessions: this.sessions,
      sessionsLoading: this.sessionsLoading, sessionError: this.listError ?? this.state.sessionError ?? null,
      switching: Object.values(this.state.pending).some((request) => request.kind === "switch" || request.kind === "new_user"),
      configuring: Object.values(this.state.pending).some((request) => request.kind === "configure") });
  }
}
