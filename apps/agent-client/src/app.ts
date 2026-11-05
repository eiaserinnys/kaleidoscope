import { AgentSession, type Host, type SendInput, type SessionView, type Spec } from "./session.ts";
import { agentError } from "./errors.ts";
import { cleanTitle } from "./guide.ts";

type Agent = Spec & { id: string };
type Program = { name: string; winget: string; url: string };
type Action = { event?: any; item?: any; parent_item?: any };
type MessageInput = { request_id: string; text: string };
type MessageResult = { status: "accepted" } | { status: "not_ready"; reason: string };
function sessionTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date().toDateString() === date.toDateString();
  return new Intl.DateTimeFormat("ko-KR", today
    ? { hour: "2-digit", minute: "2-digit", hour12: false }
    : { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
type Bridge = {
  process: Host["process"];
  files: { grant(id: string): string | null; on_grant(id: string, listener: (name: string | null) => void): void; pick_folder(id: string): Promise<string | null>; read(id: string): Promise<ArrayBuffer> };
  blobs: { put(params: { key: string; bytes: ArrayBuffer }): Promise<void>; open(params: { key: string }): Promise<{ id: string } | null>; remove(params: { key: string }): Promise<void> };
  host: { instructions(kind: string): Promise<{ text: string }> };
  context: { prepare(params: unknown): Promise<any>; commit(ticket: string): Promise<void> };
  chat: { publish(channel: string, envelope: unknown): void };
  getStorage(entry: string): Promise<unknown>;
  setStorage(entry: string, value: unknown): Promise<void>;
  getState(key: string): unknown;
  setState(key: string, value: unknown): void;
  onStorageChange(entry: string, listener: (value: unknown) => void, onError?: (error: unknown) => void): void;
  onLifecycle(listener: (event: { phase: string }) => unknown): void;
  onMessage(listener: (message: MessageInput) => Promise<MessageResult>): void;
  handle(name: string, listener: (context: Action) => unknown): void;
  publish(value: Record<string, unknown>): void;
};

export class AppClient {
  private readonly client: Bridge;
  private readonly defaults: Agent[];
  private readonly session: AgentSession;
  private agents: Agent[] = [];
  private programs: Record<string, Program> = {};
  private installing = false;
  private startingAfterInstall = false;
  private selected: Agent | null = null;
  private folder: string | null = null;
  private stage: "loading" | "agents" | "folder" | "session" | "error" = "loading";
  private view: SessionView | null = null;
  private retry = false;
  private choosingFolder = false;
  private restoring = false;
  private storageReady = false;
  private storageFailure = false;
  private finishInitial: () => void = () => {};
  private readonly initialReady = new Promise<void>((resolve) => { this.finishInitial = resolve; });
  private storageTask: Promise<void> | null = null;
  private restoreTask: Promise<void> | null = null;
  private error: { id: string | null; message: string; details: string[] } | null = null;
  private lastItems: SessionView["items"] | null = null;
  private lastQueue = "";
  private lastStream = "";
  private lastActivity = "";
  private lastOutputs = "";
  private historyOpen = false;
  private switchRequested: "new" | "load" | null = null;

  constructor(client: Bridge, defaults: Agent[]) {
    this.client = client;
    this.defaults = defaults;
    const host: Host = {
      process: client.process,
      blobs: {
        put: async (key, bytes) => { await client.blobs.put({ key, bytes: Uint8Array.from(bytes).buffer }); },
        read: async (key) => { const file = await client.blobs.open({ key }); return file ? new Uint8Array(await client.files.read(file.id)) : null; },
        remove: async (key) => { await client.blobs.remove({ key }); },
      },
      instructions: async () => (await client.host.instructions("app_authoring")).text,
      prepare: async (requestId, count, bytes) => client.context.prepare({ request_id: requestId, channel: "conversation", attachments: { count, bytes } }),
      commit: async (ticket) => client.context.commit(ticket),
      publish: (view) => this.receive(view), uuid: () => crypto.randomUUID(), now: () => new Date().toISOString(),
    };
    this.session = new AgentSession(host);
    client.onStorageChange("programs", (value) => { this.programs = value as Record<string, Program>; this.update(); });
    client.onStorageChange("agents", (value) => { void this.acceptAgents(value).finally(() => this.finishInitial()); }, (error) => { this.storageFailure = true; this.showError(error); this.finishInitial(); });
    client.onLifecycle((event) => { if (event.phase === "ready") this.update(); });
    client.files.on_grant("work", (folder) => { this.folder = folder; this.update(); if (folder && this.restoring && !this.choosingFolder) void this.startRestore(); });
    client.onMessage((message) => this.receiveMessage(message));
    client.handle("choose_agent", ({ item }) => this.chooseAgent(String(item?.id ?? "")));
    client.handle("back_agent", () => this.backAgent());
    client.handle("pick_folder", () => this.pickFolder());
    client.handle("retry", () => this.retryStart());
    client.handle("install", () => this.install());
    client.handle("reset_agents", () => this.resetAgents());
    client.handle("authenticate", ({ item }) => this.session.authenticate(String(item?.id ?? "")));
    client.handle("configure", ({ item, event }) => this.session.configure(String(item?.id ?? ""), event));
    client.handle("settings_agent", ({ event }) => this.settingsAgent(String(event ?? "")));
    client.handle("answer", ({ item, parent_item }) => this.session.answer(parent_item?.rpcId, item?.id ?? null));
    client.handle("cancel", () => this.session.cancel());
    client.handle("send", ({ event }) => this.submit({ id: event.request_id, text: event.text, attachments: event.attachments.map((file: any) => ({ name: file.name, mime: file.mime, bytes: new Uint8Array(file.bytes) })) }));
    client.handle("attachment", ({ event }) => this.attachment(event));
    client.handle("new_session", () => this.switchSession(null));
    client.handle("open_history", () => { this.historyOpen = true; this.update(); return this.session.listSessions(); });
    client.handle("close_history", () => { this.historyOpen = false; this.update(); });
    client.handle("select_session", ({ event }) => {
      if (event === this.view?.sessionId) { this.historyOpen = false; this.update(); return; }
      return this.switchSession(String(event));
    });
  }

  private switchSession(id: string | null): Promise<void> {
    if (!this.view || this.view.busy || this.view.switching || this.view.configuring || this.switchRequested) return Promise.resolve();
    this.historyOpen = false;
    this.switchRequested = id ? "load" : "new";
    this.update();
    return (id ? this.session.loadSession(id) : this.session.newSession()).catch((error) => {
      this.switchRequested = null;
      this.update();
      throw error;
    });
  }

  private async acceptAgents(value: unknown): Promise<void> {
    this.agents = value as Agent[];
    if (this.storageReady) {
      if (this.storageFailure) {
        this.storageFailure = false;
        this.error = null;
        this.stage = this.view ? "session" : this.selected ? "folder" : "agents";
      }
      this.update();
      return;
    }
    this.storageReady = true;
    this.storageFailure = false;
    this.error = null;
    const selected = this.client.getState("agent_id");
    this.selected = this.agents.find((agent) => agent.id === selected) ?? (this.agents.length === 1 ? this.agents[0] : null);
    this.folder = this.client.files.grant("work");
    this.stage = this.selected ? "folder" : "agents";
    this.restoring = !!this.selected;
    this.update();
    if (this.selected && this.folder) await this.startRestore();
  }

  private startRestore(): Promise<void> {
    this.restoreTask = this.restore();
    return this.restoreTask;
  }

  private submit(input: SendInput): Promise<void> { return this.session.send(input); }

  private async receiveMessage(message: MessageInput): Promise<MessageResult> {
    await this.initialReady;
    await this.storageTask;
    await this.restoreTask;
    const phase = this.view?.phase;
    if (this.stage === "session" && (phase === "ready" || phase === "responding")) {
      await this.submit({ id: message.request_id, text: message.text, attachments: [] });
      return { status: "accepted" };
    }
    const reason = this.installing || this.canInstall()
      ? "에이전트 창에서 프로그램 설치를 마친 뒤 다시 보내세요"
      : this.stage === "error" || (this.stage === "session" && phase === "failed")
        ? "에이전트 창의 오류를 확인한 뒤 다시 보내세요"
        : this.stage === "session" && phase === "login"
          ? "에이전트 창에서 로그인한 뒤 다시 보내세요"
          : this.stage === "session" && (!phase || phase === "starting")
            ? "에이전트가 시작되는 중입니다. 시작된 뒤 다시 보내세요"
            : "에이전트 창에서 에이전트와 작업 폴더를 고른 뒤 다시 보내세요";
    return { status: "not_ready", reason };
  }

  private async retryStorage(): Promise<void> {
    this.stage = "loading";
    this.update();
    try { await this.acceptAgents(await this.client.getStorage("agents")); }
    catch (error) { this.storageFailure = true; this.showError(error); }
  }

  private async restore(): Promise<void> {
    if (!this.restoring || !this.selected || !this.folder) return;
    this.restoring = false;
    this.stage = "session";
    this.update();
    try {
      const [attached, installer] = await Promise.all([
        this.session.attach(this.selected), this.client.process.attach({ key: "install" }),
      ]);
      if (!attached) {
        if (installer) {
          const programs = this.programs[this.selected.command] ? this.programs : await this.client.getStorage("programs") as Record<string, Program>;
          this.programs = programs;
          this.installing = true;
          this.update();
          void this.finishInstall(programs[this.selected.command], installer.handle, installer.after, installer.checkpoint as { stdout: string } | null)
            .catch((error) => this.showError(error));
        } else {
          const started = await this.session.start(this.selected);
          if (!started) { this.stage = "folder"; this.retry = true; this.update(); }
        }
      }
    } catch (error) { this.showError(error); }
  }

  private async chooseAgent(id: string): Promise<void> {
    this.selected = this.agents.find((agent) => agent.id === id) ?? null;
    if (!this.selected) return;
    this.client.setState("agent_id", id);
    this.restoring = false;
    this.retry = false;
    this.stage = "folder";
    this.update();
  }

  private async backAgent(): Promise<void> {
    await this.session.stop();
    this.selected = null;
    this.client.setState("agent_id", null);
    this.view = null;
    this.error = null;
    this.retry = false;
    this.stage = "agents";
    this.update();
  }

  private async pickFolder(): Promise<void> {
    this.choosingFolder = true;
    try {
      const folder = await this.client.files.pick_folder("work");
      if (!folder || !this.selected) return;
      const replace = this.stage === "session";
      this.folder = folder;
      this.stage = "session";
      this.restoring = false;
      this.view = null;
      this.retry = false;
      this.error = null;
      this.update();
      const started = replace ? await this.session.replace(this.selected) : await this.session.start(this.selected);
      if (!started) { this.stage = "folder"; this.retry = true; this.update(); }
    } catch (error) { this.showError(error); }
    finally { this.choosingFolder = false; }
  }

  private async retryStart(installed?: Program): Promise<void> {
    if (this.storageFailure || !this.selected) { this.storageTask = this.retryStorage(); await this.storageTask; return; }
    this.stage = "session";
    this.error = null;
    this.retry = false;
    this.update();
    try { if (!await this.session.retry()) { this.startingAfterInstall = false; this.stage = "folder"; this.retry = true; this.update(); } }
    catch (error) {
      this.startingAfterInstall = false;
      if (installed && (error as { id?: string })?.id === "PROCESS_START_COMMAND_NOT_FOUND") {
        this.showError(agentError("AGENT_INSTALL_COMMAND_STILL_MISSING", installed.name, this.selected.command));
      } else this.showError(error);
    }
  }

  private async install(): Promise<void> {
    const program = this.selected && this.programs[this.selected.command];
    if (!program || !this.canInstall()) return;
    try {
      const result = await this.client.process.start({ key: "install", permission: "install", cwd_permission: "work", spec: {
        name: `${program.name} 설치 프로그램`, command: "winget", args: ["install", "--id", program.winget, "--exact", "--source", "winget", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"], env: {},
      } });
      if (result.status === "cancelled") return;
      if (!result.handle) throw agentError("AGENT_START_HANDLE_MISSING");
      this.installing = true;
      this.update();
      await this.finishInstall(program, result.handle, 0, null);
    } catch (error) {
      if ((error as { id?: string })?.id === "PROCESS_START_COMMAND_NOT_FOUND") this.showError(agentError("AGENT_INSTALL_WINGET_NOT_FOUND", program.name, program.url));
      else this.showError(error);
    } finally {
      this.installing = false;
      this.update();
    }
  }

  private async finishInstall(program: Program, handle: string, after: number, checkpoint: { stdout: string } | null): Promise<void> {
    try {
      const { code, output } = await this.readInstaller(handle, after, checkpoint);
      if (code === 0) {
        this.installing = false;
        this.startingAfterInstall = true;
        await this.retryStart(program);
        return;
      }
      const unsigned = code === null ? null : code >>> 0;
      const id = unsigned === 0x8A15003A || unsigned === 0x8A15010F ? "AGENT_INSTALL_BLOCKED_BY_POLICY"
        : unsigned === 0x8A15010C ? "AGENT_INSTALL_CANCELLED_BY_USER" : "AGENT_INSTALL_FAILED";
      const hex = unsigned === null ? "알 수 없음" : `0x${unsigned.toString(16).toUpperCase().padStart(8, "0")}`;
      this.showError(agentError(id, program.name, program.url, hex, output));
    } finally {
      this.installing = false;
      this.update();
    }
  }

  private async readInstaller(handle: string, after: number, checkpoint: { stdout: string } | null): Promise<{ code: number | null; output: string }> {
    let stdout = checkpoint?.stdout ?? "", queue = Promise.resolve(), done = false;
    const decoder = new TextDecoder();
    return new Promise((resolve, reject) => {
      const read = async () => {
        if (done) return;
        try {
          for (;;) {
            const result = await this.client.process.read({ handle, after, max_bytes: 65536 });
            stdout = (stdout + decoder.decode(Uint8Array.from(result.bytes), { stream: true })).slice(-65536);
            if (result.next !== after) { after = result.next; await this.client.process.ack({ handle, after, checkpoint: { stdout } }); }
            if (result.bytes.length) continue;
            if (result.exit) {
              done = true;
              unsubscribe();
              const stderr = new TextDecoder().decode(Uint8Array.from(result.stderr_tail));
              const output = (stderr || stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? "출력이 없습니다";
              resolve({ code: result.exit.code, output });
            }
            return;
          }
        } catch (error) { done = true; unsubscribe(); reject(error); }
      };
      const schedule = () => { queue = queue.then(read); };
      const unsubscribe = this.client.process.onReady((ready) => { if (ready === handle) schedule(); });
      schedule();
    });
  }

  private canInstall(): boolean {
    const failureId = this.error?.id ?? this.view?.failure?.id;
    return !this.installing && failureId === "PROCESS_START_COMMAND_NOT_FOUND" && !!this.selected && !!this.programs[this.selected.command] && /Windows/i.test(navigator.userAgent);
  }

  private async settingsAgent(id: string): Promise<void> {
    const agent = this.agents.find((entry) => entry.id === id);
    if (!agent || agent.id === this.selected?.id) return;
    this.selected = agent;
    this.client.setState("agent_id", id);
    this.view = null;
    this.update();
    try { if (!await this.session.replace(agent)) { this.stage = "folder"; this.retry = true; this.update(); } }
    catch (error) { this.showError(error); }
  }

  private async resetAgents(): Promise<void> {
    try { await this.client.setStorage("agents", this.defaults); await this.acceptAgents(this.defaults); }
    catch (error) { this.showError(error); }
  }

  private async attachment(event: { request_id: string; attachment_id: string }): Promise<void> {
    const bytes = await this.session.attachment(`attachments/${event.attachment_id}`);
    const item = this.view?.items.flatMap((entry) => entry.attachments).find((entry) => entry.id === event.attachment_id)
      ?? this.view?.queued.flatMap((entry) => entry.attachments).find((entry) => entry.id === event.attachment_id);
    if (!bytes) throw agentError("AGENT_ATTACHMENT_READ_NOT_FOUND", item?.name ?? "첨부 파일");
    this.client.chat.publish("conversation", { kind: "attachment", request_id: event.request_id, mime: item?.mime ?? "application/octet-stream", bytes: Uint8Array.from(bytes).buffer });
  }

  private receive(view: SessionView): void {
    const previous = this.view;
    this.view = view;
    if (previous?.switching && !view.switching) {
      if (this.switchRequested === "load" && view.sessionError) this.historyOpen = true;
      this.switchRequested = null;
    }
    if (!this.historyOpen && view.sessionError && view.sessionError !== previous?.sessionError && view.sessionError.id === "AGENT_SESSION_NEW_FAILED") {
      this.client.chat.publish("conversation", { kind: "error", error: { ...view.sessionError, code: "local_agent_failed", details: [] } });
    }
    if (view.phase !== "starting") this.startingAfterInstall = false;
    const queue = JSON.stringify(view.queued);
    if (this.lastItems !== view.items || this.lastQueue !== queue) {
      this.client.chat.publish("conversation", { kind: "snapshot", items: view.items, stream_id: view.stream_id, text: view.text, busy: view.busy, tool: view.tool, queued: view.queued });
      this.lastItems = view.items;
      this.lastQueue = queue;
      this.lastStream = `${view.stream_id ?? ""}:${view.text}`;
      this.lastActivity = `${view.busy}:${view.tool ?? ""}`;
    } else {
      const stream = `${view.stream_id ?? ""}:${view.text}`;
      if (stream !== this.lastStream && view.stream_id) this.client.chat.publish("conversation", { kind: "event", event: { kind: "text", stream_id: view.stream_id, text: view.text } });
      const activity = `${view.busy}:${view.tool ?? ""}`;
      if (activity !== this.lastActivity) this.client.chat.publish("conversation", { kind: "event", event: { kind: "activity", busy: view.busy, tool: view.tool } });
      this.lastStream = stream;
      this.lastActivity = activity;
    }
    if (view.failure && view.phase === "failed" && (previous?.phase === "ready" || previous?.phase === "responding")) {
      this.client.chat.publish("conversation", { kind: "error", error: {
        id: view.failure.id, code: view.failure.code ?? "local_agent_failed", message: this.failureMessage(view.failure), details: [],
      } });
    }
    if (view.failure && view.phase === "ready" && previous?.phase === "responding") {
      this.client.chat.publish("conversation", { kind: "error", error: {
        id: view.failure.id, code: view.failure.code ?? "local_agent_failed", message: `에이전트 응답을 받지 못했습니다. 다시 보내세요. 원인: ${view.failure.reason}`, details: [],
      } });
    }
    this.update();
  }

  private failureMessage(failure: NonNullable<SessionView["failure"]>): string {
    return failure.message ?? (failure.id === "AGENT_LOGIN_AUTHENTICATE_FAILED"
      ? `에이전트 ${this.selected?.name ?? ""} 로그인이 완료되지 않았습니다. 에이전트에서 로그인을 마친 뒤 다시 시도하세요. 원인: ${failure.reason}`
      : `에이전트 ${this.selected?.name ?? ""}의 응답을 읽지 못했습니다. 에이전트 프로그램을 업데이트한 뒤 다시 시도하세요. 원인: ${failure.reason}`);
  }

  private showError(reason: unknown): void {
    const error = reason as { id?: string; message?: string; details?: string[] };
    this.error = { id: error?.id ?? null, message: error?.message ?? String(reason), details: error?.details ?? [] };
    this.stage = "error";
    this.update();
  }

  private update(): void {
    const phase = this.view?.phase;
    const chat = this.stage === "session" && (phase === "ready" || phase === "responding");
    const failure = this.view?.failure;
    let message = this.error?.message ?? "";
    if (failure && !this.error) message = this.failureMessage(failure);
    const program = this.selected && this.programs[this.selected.command];
    const missing = (this.error?.id ?? failure?.id) === "PROCESS_START_COMMAND_NOT_FOUND" && !!program;
    const unsupported = missing && !/Windows/i.test(navigator.userAgent);
    if (missing && program) message = unsupported
      ? agentError("AGENT_INSTALL_UNSUPPORTED_PLATFORM", this.selected!.name, program.name, program.url).message
      : `${this.selected?.name}을(를) 시작하려면 ${program.name}이(가) 필요합니다.`;
    const controls = (this.view?.controls ?? []).map((control) => ({ ...control, is_select: control.kind === "select", is_boolean: control.kind === "boolean", checked: control.value === true }));
    const output = {
      show_start: !chat,
      show_loading: this.stage === "loading", show_agents: this.stage === "agents" && this.agents.length > 0,
      show_empty: this.stage === "agents" && this.agents.length === 0, show_folder: this.stage === "folder",
      show_starting: this.installing || (this.stage === "session" && (!phase || phase === "starting")), show_login: this.stage === "session" && phase === "login",
      show_failed: !this.installing && !this.canInstall() && (this.stage === "error" || (this.stage === "session" && phase === "failed")), show_install: this.canInstall(),
      show_installing: this.installing, show_install_label: this.installing || this.startingAfterInstall,
      install_label: program ? `${program.name} 설치` : "", install_message: this.installing && program ? `${program.name} 설치 중` : " ", show_chat: chat,
      show_retry: this.retry && (this.stage === "folder" || this.stage === "error" || (this.stage === "session" && phase === "failed")), show_back: this.agents.length > 1,
      show_selected: !!this.selected && this.stage !== "agents" && this.stage !== "loading",
      show_single: !!this.selected && this.agents.length <= 1,
      show_picked_folder: !!this.folder && (this.stage !== "folder" || this.retry) && this.stage !== "agents" && this.stage !== "loading",
      show_login_error: phase === "login" && !!failure,
      show_pick_folder: this.stage === "folder" && !this.retry,
      agents: this.agents.map(({ id, name }) => ({ id, label: name })), agent_options: this.agents.map(({ id, name }) => ({ value: id, label: name })),
      selected: this.selected?.id ?? null, agent_label: this.selected?.name ?? "",
      folder_label: this.folder ?? "폴더 선택", window_title: chat ? this.selected?.name ?? "에이전트" : "에이전트", window_meta: chat ? this.folder : null,
      settings_available: chat, busy: !!this.view?.busy, controls,
      history_open: this.historyOpen, session_switching: !!(this.switchRequested || this.view?.switching), session_ready: !(this.switchRequested || this.view?.switching), session_buttons_busy: !!(this.view?.busy || this.view?.switching || this.view?.configuring || this.switchRequested),
      history_disabled: !!(this.view?.busy || this.view?.switching || this.view?.configuring || this.switchRequested || !this.view?.canListSessions),
      history_description: this.view?.canListSessions ? null : "이 에이전트는 지난 세션 목록을 주지 않습니다",
      history_items: (this.view?.sessions ?? []).map((session) => ({ key: session.sessionId, title: cleanTitle(session.title ?? "") || session.sessionId.slice(0, 8), meta: sessionTime(session.updatedAt) })),
      history_selected: this.view?.sessionId ?? null, history_loading: !!this.view?.sessionsLoading && !this.view.sessions.length,
      history_unsupported: !!this.view && !this.view.canListSessions,
      history_empty: !!this.view && this.view.canListSessions && !this.view.sessionsLoading && !this.view.sessionError && this.view.sessions.length === 0,
      history_has_items: !!this.view?.sessions.length, history_no_items: !this.view?.sessions.length, history_has_error: !!this.view?.sessionError,
      history_list_error: this.view?.sessionError?.id === "AGENT_SESSION_LIST_FAILED", history_other_error: !!this.view?.sessionError && this.view.sessionError.id !== "AGENT_SESSION_LIST_FAILED",
      history_error_message: this.view?.sessionError?.message ?? "", history_error_id: this.view?.sessionError?.id ?? null,
      permissions: this.view?.permissions ?? [], auth_methods: this.view?.authMethods ?? [],
      has_error: !!(this.error || failure), error_message: message, error_id: unsupported ? "AGENT_INSTALL_UNSUPPORTED_PLATFORM" : this.error?.id ?? failure?.id ?? null,
    };
    const signature = JSON.stringify(output);
    if (signature !== this.lastOutputs) { this.lastOutputs = signature; this.client.publish(output); }
  }
}
