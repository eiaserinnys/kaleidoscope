import { AgentSession, type Host, type SessionView, type Spec } from "./session.ts";

type Agent = Spec & { id: string };
type Action = { event?: any; item?: any; parent_item?: any };
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
  onStorageChange(entry: string, listener: (value: unknown) => void): void;
  onLifecycle(listener: (event: { phase: string }) => unknown): void;
  handle(name: string, listener: (context: Action) => unknown): void;
  publish(value: Record<string, unknown>): void;
};

export class AppClient {
  private readonly client: Bridge;
  private readonly defaults: Agent[];
  private readonly session: AgentSession;
  private agents: Agent[] = [];
  private selected: Agent | null = null;
  private folder: string | null = null;
  private stage: "loading" | "agents" | "folder" | "session" | "error" = "loading";
  private view: SessionView | null = null;
  private retry = false;
  private choosingFolder = false;
  private restoring = false;
  private error: { id: string | null; message: string } | null = null;
  private lastItems: SessionView["items"] | null = null;
  private lastQueue = "";
  private lastStream = "";
  private lastActivity = "";
  private lastOutputs = "";

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
    client.onLifecycle((event) => event.phase === "ready" ? this.initialize() : undefined);
    client.onStorageChange("agents", (value) => { this.agents = value as Agent[]; this.update(); });
    client.files.on_grant("work", (folder) => { this.folder = folder; this.update(); if (folder && this.restoring && !this.choosingFolder) void this.restore(); });
    client.handle("choose_agent", ({ item }) => this.chooseAgent(String(item?.id ?? "")));
    client.handle("back_agent", () => this.backAgent());
    client.handle("pick_folder", () => this.pickFolder());
    client.handle("retry", () => this.retryStart());
    client.handle("reset_agents", () => this.resetAgents());
    client.handle("authenticate", ({ item }) => this.session.authenticate(String(item?.id ?? "")));
    client.handle("configure", ({ item, event }) => this.session.configure(String(item?.id ?? ""), event));
    client.handle("settings_agent", ({ event }) => this.settingsAgent(String(event ?? "")));
    client.handle("answer", ({ item, parent_item }) => this.session.answer(parent_item?.rpcId, item?.id ?? null));
    client.handle("cancel", () => this.session.cancel());
    client.handle("send", ({ event }) => this.session.send({ id: event.request_id, text: event.text, attachments: event.attachments.map((file: any) => ({ name: file.name, mime: file.mime, bytes: new Uint8Array(file.bytes) })) }));
    client.handle("attachment", ({ event }) => this.attachment(event));
  }

  private async initialize(): Promise<void> {
    this.stage = "loading";
    this.update();
    try {
      this.agents = await this.client.getStorage("agents") as Agent[];
      const selected = this.client.getState("agent_id");
      this.selected = this.agents.find((agent) => agent.id === selected) ?? (this.agents.length === 1 ? this.agents[0] : null);
      this.folder = this.client.files.grant("work");
      this.stage = this.selected ? "folder" : "agents";
      this.restoring = !!this.selected;
      this.update();
      if (this.selected && this.folder) await this.restore();
    } catch (error) { this.showError(error); }
  }

  private async restore(): Promise<void> {
    if (!this.restoring || !this.selected || !this.folder) return;
    this.restoring = false;
    this.stage = "session";
    this.update();
    try {
      const attached = await this.session.attach(this.selected);
      if (!attached) {
        const started = await this.session.start(this.selected);
        if (!started) { this.stage = "folder"; this.retry = true; this.update(); }
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

  private async retryStart(): Promise<void> {
    if (!this.selected) { await this.initialize(); return; }
    this.stage = "session";
    this.error = null;
    this.retry = false;
    this.update();
    try { if (!await this.session.retry()) { this.stage = "folder"; this.retry = true; this.update(); } }
    catch (error) { this.showError(error); }
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
    try { await this.client.setStorage("agents", this.defaults); await this.initialize(); }
    catch (error) { this.showError(error); }
  }

  private async attachment(event: { request_id: string; attachment_id: string }): Promise<void> {
    const bytes = await this.session.attachment(`attachments/${event.attachment_id}`);
    if (!bytes) throw Object.assign(new Error("첨부 파일을 찾지 못했습니다. 파일을 다시 보내세요."), { id: "AGENT_ATTACHMENT_NOT_FOUND", code: "not_found" });
    const item = this.view?.items.flatMap((entry) => entry.attachments).find((entry) => entry.id === event.attachment_id)
      ?? this.view?.queued.flatMap((entry) => entry.attachments).find((entry) => entry.id === event.attachment_id);
    this.client.chat.publish("conversation", { kind: "attachment", request_id: event.request_id, mime: item?.mime ?? "application/octet-stream", bytes: Uint8Array.from(bytes).buffer });
  }

  private receive(view: SessionView): void {
    this.view = view;
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
    this.update();
  }

  private showError(reason: unknown): void {
    const error = reason as { id?: string; message?: string };
    this.error = { id: error?.id ?? null, message: error?.message ?? String(reason) };
    this.stage = "error";
    this.update();
  }

  private update(): void {
    const phase = this.view?.phase;
    const chat = this.stage === "session" && (phase === "ready" || phase === "responding");
    const failure = this.view?.failure;
    let message = this.error?.message ?? "";
    if (failure) message = failure.id === "AGENT_LOGIN_AUTHENTICATE_FAILED"
      ? `에이전트 ${this.selected?.name ?? ""} 로그인이 완료되지 않았습니다. 에이전트에서 로그인을 마친 뒤 다시 시도하세요. 원인: ${failure.reason}`
      : `에이전트 ${this.selected?.name ?? ""}의 응답을 읽지 못했습니다. 에이전트 프로그램을 업데이트한 뒤 다시 시도하세요. 원인: ${failure.reason}`;
    const controls = (this.view?.controls ?? []).map((control) => ({ ...control, is_select: control.kind === "select", is_boolean: control.kind === "boolean", checked: control.value === true }));
    const output = {
      show_loading: this.stage === "loading", show_agents: this.stage === "agents" && this.agents.length > 0,
      show_empty: this.stage === "agents" && this.agents.length === 0, show_folder: this.stage === "folder",
      show_starting: this.stage === "session" && (!phase || phase === "starting"), show_login: this.stage === "session" && phase === "login",
      show_failed: this.stage === "error" || (this.stage === "session" && phase === "failed"), show_chat: chat,
      show_retry: this.retry, show_back: this.agents.length > 1,
      agents: this.agents.map(({ id, name }) => ({ id, label: name })), agent_options: this.agents.map(({ id, name }) => ({ value: id, label: name })),
      selected: this.selected?.id ?? null, agent_label: this.agents.length > 1 ? `← ${this.selected?.name ?? ""}` : this.selected?.name ?? "",
      folder_label: this.folder ?? "폴더 선택", window_title: this.selected?.name ?? "에이전트", window_meta: this.folder,
      settings_available: chat, busy: !!this.view?.busy, controls,
      permissions: this.view?.permissions ?? [], auth_methods: this.view?.authMethods ?? [],
      has_error: !!(this.error || failure), error_message: message, error_id: this.error?.id ?? failure?.id ?? null,
    };
    const signature = JSON.stringify(output);
    if (signature !== this.lastOutputs) { this.lastOutputs = signature; this.client.publish(output); }
  }
}
