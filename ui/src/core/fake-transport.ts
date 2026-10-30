import type {
  AppDefinition,
  AppWindow,
  AgentInfo,
  AgentItem,
  AgentModel,
  AgentUpdate,
  AgentUpload,
  ConversationItem, ConversationModel, ConversationThread, ConversationUpload,
  CoreError,
  CoreEvent,
  CoreReply,
  CoreRequest,
  FileEntry,
  Grant,
  LinkStatus,
  PcAccess,
  Rect,
  ShellSnapshot,
  WebPage,
  VisibleView,
  StorageEntryDecl,
} from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { SHARE_TEXT_MAX_BYTES } from "../contract/limits";
import { toCoreError, type CoreTransport } from "./core-transport";
import { createFakeData, type FakeDataSeed } from "./fake-data";

export interface FakeTransportSeed {
  snapshot: ShellSnapshot;
  folder: { root_path: string; root_name: string } | null;
  files: Record<string, string>;
  conversation?: FakeConversationSeed;
  agents?: Record<string, FakeAgentSeed>;
  agentModels?: AgentModel[];
  agentGetDelayMs?: number;
  agentGetError?: string;
  agentSendError?: string;
  agentSendDelayMs?: number;
  updateRestartError?: string;
  data?: FakeDataSeed;
  storage?: Array<{ window_id: string; entry: string; content: JsonValue }>;
  storageWriteDelayMs?: number;
  webUnavailable?: boolean;
  media?: Record<string, string>;
}

export interface FakeConversationSeed {
  thread: ConversationThread | null;
  items: ConversationItem[];
  older?: ConversationItem[];
  olderPages?: ConversationItem[][];
  models: ConversationModel[];
  loginRequired?: boolean;
  conflict?: boolean;
  delayMs?: number;
  draft?: { request_id: string; text: string; attachments: ConversationUpload[]; failed: boolean };
}

export interface FakeAgentSeed {
  agent: AgentInfo | null;
  items: AgentItem[];
  models: AgentModel[];
}

export interface FakeTransport extends CoreTransport {
  getFiles(): Record<string, string>;
  subscribeFiles(listener: () => void): () => void;
  getWebViews(): FakeWebViewSnapshot[];
  subscribeWebViews(listener: () => void): () => void;
  getWebPlaces(): Array<{ window_id: string; bounds: Rect | null }>;
  getWebAttachCount(windowId: string): number;
  /** Test and harness controls; the real core does not expose these methods. */
  setLink(status: LinkStatus): void;
  emit(event: CoreEvent): void;
  getShareCalls(): Array<{ window_id: string; view: VisibleView }>;
  getCalls(): CoreRequest[];
  failNextStorageWrite(message: string): void;
  getOpenedAttachments(): Array<{ workspace_id: string; item_id: string; index: number }>;
}

export interface FakeWebViewSnapshot {
  windowId: string;
  page: WebPage;
  bounds: Rect | null;
}

interface FakeFile {
  text: string;
  revision: string;
}

/** 가짜 코어의 파일 목록이 모든 항목에 주는 바뀐 시각. */
const FAKE_MODIFIED = "2026-10-30T01:00:00Z";
const FAKE_PC_ROOTS: FileEntry[] = [
  { name: "문서", path: "documents", kind: "dir", size: 0, modified: "", root_kind: "known" },
  { name: "다운로드", path: "downloads", kind: "dir", size: 0, modified: "", root_kind: "known" },
  { name: "로컬 디스크 (C:)", path: "C", kind: "dir", size: 0, modified: "", root_kind: "volume" },
];

interface FakeWebView {
  page: WebPage;
  history: string[];
  historyIndex: number;
  bounds: Rect | null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fail(code: CoreError["code"], message: string, details: string[] = []): never {
  throw { code, message, details } satisfies CoreError;
}

function legacyAgentWorkspaceId(request: { workspace_id?: string; window_id?: string }): string {
  if (request.window_id) return fail("unavailable", "새 대화 제공자는 아직 사용할 수 없습니다");
  if (!request.workspace_id) return fail("invalid_request", "workspace_id가 필요합니다");
  return request.workspace_id;
}

function legacyAgentAttachment(request: { item_id?: string; index?: number }): [string, number] {
  if (request.item_id === undefined || request.index === undefined) {
    return fail("invalid_request", "첨부 식별자가 필요합니다");
  }
  return [request.item_id, request.index];
}

function validRelativePath(path: string, allowEmpty = false): boolean {
  if (path === "") return allowEmpty;
  return !path.startsWith("/")
    && !path.endsWith("/")
    && path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[\\:\0]/.test(part));
}

function isFakeHttpAddress(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function createFakeTransport(seed: FakeTransportSeed): FakeTransport {
  let snapshot = clone(seed.snapshot);
  const files = new Map<string, FakeFile>();
  const storage = new Map<string, { content: JsonValue; revision: string }>();
  const eventListeners = new Set<(event: CoreEvent) => void>();
  const fileListeners = new Set<() => void>();
  const webListeners = new Set<() => void>();
  const webViews = new Map<string, FakeWebView>();
  const webAttachCounts = new Map<string, number>();
  const shareCalls: Array<{ window_id: string; view: VisibleView }> = [];
  const calls: CoreRequest[] = [];
  const webPlaces: Array<{ window_id: string; bounds: Rect | null }> = [];
  const pcOpenedFileGrants = new Set<string>();
  let revisionNumber = 1;
  let storageFailure: string | null = null;
  let windowNumber = 1;
  const conversation = seed.conversation ? clone(seed.conversation) : null;
  const conversationOlderPages = conversation?.olderPages ?? (conversation?.older?.length ? [conversation.older] : []);
  let conversationLoggedIn = !conversation?.loginRequired;
  let conversationWatching = false;
  const conversationAttachments = new Map<string, ConversationUpload>();
  const models = clone(seed.agentModels ?? [
    { preset: "gemini-4-argon", label: "Argon" },
    { preset: "claude-opus-5.5", label: "Opus" },
    { preset: "codex-6.1-sol", label: "Sol 6.1" },
  ]);
  const agents = new Map<string, FakeAgentSeed>(
    Object.entries(seed.agents ?? {}).map(([workspaceId, session]) => [workspaceId, clone(session)]),
  );
  const nextAgentIds = new Map<string, number>();
  const agentAttachments = new Map<string, AgentUpload>();
  const openedAttachments: Array<{ workspace_id: string; item_id: string; index: number }> = [];

  for (const [path, text] of Object.entries(seed.files)) {
    files.set(path, { text, revision: `fake-revision-${revisionNumber++}` });
  }

  const emitState = () => {
    const event: CoreEvent = { event: "state.changed", snapshot: clone(snapshot) };
    for (const listener of eventListeners) listener(event);
  };

  const emit = (event: CoreEvent) => {
    if (event.event === "state.changed") snapshot = clone(event.snapshot);
    for (const listener of eventListeners) listener(clone(event));
  };

  const agentFor = (workspaceId: string): FakeAgentSeed => {
    let session = agents.get(workspaceId);
    if (!session) {
      session = { agent: null, items: [], models: clone(models) };
      agents.set(workspaceId, session);
    }
    return session;
  };

  const emitAgent = (workspaceId: string, update: AgentUpdate) => {
    emit({ event: "agent.update", workspace_id: workspaceId, update });
  };

  const addAgentItem = (workspaceId: string, kind: AgentItem["kind"], text: string, attachments: AgentUpload[] = []) => {
    const session = agentFor(workspaceId);
    const id = (nextAgentIds.get(workspaceId) ?? session.items.length) + 1;
    nextAgentIds.set(workspaceId, id);
    const item: AgentItem = { id: String(id), kind, text, at: new Date().toISOString(), attachments: attachments.map(({ name, mime }) => ({ name, mime })) };
    attachments.forEach((attachment, index) => agentAttachments.set(JSON.stringify([workspaceId, item.id, index]), attachment));
    session.items.push(item);
    emitAgent(workspaceId, { kind: "item", item });
  };

  const setAgentActivity = (workspaceId: string, busy: boolean, tool: string | null) => {
    const session = agentFor(workspaceId);
    if (session.agent) session.agent = { ...session.agent, busy, tool };
    emitAgent(workspaceId, { kind: "activity", busy, tool });
  };

  const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

  const watchConversation = () => {
    if (!conversation?.thread || conversationWatching) return;
    conversationWatching = true;
    setTimeout(() => emit({ event: "conversation.update", thread_id: conversation.thread!.id, update: { kind: "snapshot", snapshot: { cursor: "1", busy: false, tool: null, stream_id: null, text: null, items: clone(conversation.items) } } }), 20);
  };

  const streamReply = async (workspaceId: string, text: string, tool: string | null) => {
    setAgentActivity(workspaceId, true, tool);
    for (const part of text.match(/[\s\S]{1,18}/g) ?? [text]) {
      await delay(45);
      emitAgent(workspaceId, { kind: "delta", text: part });
    }
    addAgentItem(workspaceId, "assistant", text);
    setAgentActivity(workspaceId, false, null);
  };

  const findWindow = (windowId: string): AppWindow => {
    const window = snapshot.shared.windows.find((item) => item.id === windowId);
    if (!window) return fail("not_found", "앱 창을 찾을 수 없습니다");
    return window;
  };

  const definitionFor = (window: AppWindow): AppDefinition | null => snapshot.shared.app_versions
    .find((version) => version.app_id === window.app_id && version.version === window.app_version)
    ?.definition ?? null;

  const storageEntry = (windowId: string, entry: string) => {
    const window = findWindow(windowId);
    const declaration = definitionFor(window)?.storage?.entries.find((item) => item.id === entry);
    if (!declaration) return fail("not_found", "저장 항목을 찾을 수 없습니다");
    const workspace = snapshot.shared.desktops.find((desktop) => desktop.id === window.desktop_id)?.workspace_id;
    const key = declaration.key.replace("{workspace_id}", workspace ?? "");
    return { window, declaration, key, id: JSON.stringify([window.app_id, key]) };
  };
  for (const item of seed.storage ?? []) {
    const { id } = storageEntry(item.window_id, item.entry);
    storage.set(id, { content: clone(item.content), revision: `fake-revision-${revisionNumber++}` });
  }
  const emitStorage = (appId: string, key: string, declaration: StorageEntryDecl, revision: string | null) => {
    for (const window of snapshot.shared.windows) {
      if (window.app_id !== appId) continue;
      const target = storageEntry(window.id, declaration.id);
      if (target.key !== key) continue;
      emit({ event: "storage.update", window_id: window.id, update: { kind: "changed", changed: {
        bucket_id: appId, item: { entry_id: declaration.id, key, kind: declaration.kind, revision, exists: revision !== null },
      } } });
    }
  };

  const data = createFakeData(seed.data ?? {}, findWindow, (window) => definitionFor(window) ?? undefined,
    async (windowId, state) => { await callRequest({ op: "window.set_state", window_id: windowId, state }); },
    (windowId, view) => emit({ event: "data.update", window_id: windowId, view }));

  const permissionFor = (windowId: string, permission: string) => {
    const window = findWindow(windowId);
    const definition = definitionFor(window);
    const declaration = definition?.permissions.find((item) => item.id === permission && item.module === "files");
    if (!declaration || declaration.module !== "files") return fail("permission_denied", "앱이 선언하지 않은 파일 권한입니다");
    return { window, declaration };
  };

  const requireGrant = (windowId: string, permission: string): Grant => {
    const { window, declaration } = permissionFor(windowId, permission);
    if (declaration.scope === "pc") {
      const access = snapshot.device.pc_access.find((item) => item.app_id === window.app_id && item.permission === permission);
      if (!access) return fail("not_granted", "이 PC의 파일 읽기를 먼저 허용해야 합니다");
      return { window_id: windowId, permission, root_path: "", root_name: declaration.label, granted_at: access.granted_at };
    }
    const grant = snapshot.device.grants.find((item) => item.window_id === windowId && item.permission === permission);
    if (!grant) return fail("not_granted", "이 기기에서 폴더를 먼저 골라야 합니다");
    return grant;
  };

  const grantKey = (windowId: string, permission: string) => JSON.stringify([windowId, permission]);

  const filePathForGrant = (grant: Grant, path: string, pcOpened = false): string => {
    let rooted = path;
    if (grant.root_path) rooted = path ? `${grant.root_path}/${path}` : grant.root_path;
    return pcOpened || files.has(rooted) ? rooted : path;
  };

  const directoryExists = (directory: string): boolean => directory === ""
    || [...files.keys()].some((path) => path.startsWith(`${directory}/`));

  const emitWebViews = () => {
    for (const listener of webListeners) listener();
  };

  const updateWindowState = (windowId: string, state: AppWindow["state"]) => {
    const window = findWindow(windowId);
    const updated = { ...window, state: clone(state), updated_at: new Date().toISOString() };
    snapshot = {
      ...snapshot,
      shared: {
        ...snapshot.shared,
        windows: snapshot.shared.windows.map((item) => item.id === windowId ? updated : item),
      },
    };
    emitState();
    return updated;
  };

  const appCurrentDefinition = (appId: string): AppDefinition | null => {
    const app = snapshot.shared.apps.find((item) => item.id === appId);
    return app
      ? snapshot.shared.app_versions.find((version) => version.app_id === appId && version.version === app.current_version)?.definition ?? null
      : null;
  };

  const emitWebPage = (windowId: string) => {
    const view = webViews.get(windowId);
    if (!view) return;
    emit({ event: "web.update", window_id: windowId, page: clone(view.page) });
    const window = snapshot.shared.windows.find((item) => item.id === windowId);
    const definition = window ? definitionFor(window) : null;
    const block = definition?.ui.type === "web_view" ? definition.ui : null;
    if (!window || !block?.on_navigate) return;
    const state = { ...window.state, [block.on_navigate.set_state]: view.page.url };
    updateWindowState(windowId, state);
  };

  const makeWebPage = (url: string, historyIndex: number, history: string[]): WebPage => ({
    url,
    title: "가짜 페이지",
    loading: false,
    can_go_back: historyIndex > 0,
    can_go_forward: historyIndex < history.length - 1,
  });

  const raiseWindow = (windowId: string): AppWindow => {
    const window = findWindow(windowId);
    const topZ = Math.max(0, ...snapshot.shared.windows
      .filter((item) => item.desktop_id === window.desktop_id)
      .map((item) => item.z));
    const updated = { ...window, z: topZ + 1, updated_at: new Date().toISOString() };
    snapshot = {
      ...snapshot,
      shared: {
        ...snapshot.shared,
        windows: snapshot.shared.windows.map((item) => item.id === windowId ? updated : item),
      },
    };
    emitState();
    return updated;
  };

  async function callRequest(request: CoreRequest): Promise<CoreReply> {
    calls.push(clone(request));
    switch (request.op) {
      case "share.set": {
        findWindow(request.window_id);
        if (snapshot.sharing.includes(request.window_id) === request.on) return { op: "share.set" };
        snapshot = { ...snapshot, sharing: request.on ? [...snapshot.sharing, request.window_id] : snapshot.sharing.filter((id) => id !== request.window_id) };
        emitState();
        return { op: "share.set" };
      }
      case "share.view":
        findWindow(request.window_id);
        if (!snapshot.sharing.includes(request.window_id)) return { op: "share.view" };
        if (new TextEncoder().encode(request.view.text).length > SHARE_TEXT_MAX_BYTES) return fail("invalid_request", "같이 보기 글이 너무 깁니다");
        shareCalls.push({ window_id: request.window_id, view: clone(request.view) });
        return { op: "share.view" };
      case "state.get":
        return { op: "state.get", snapshot: clone(snapshot) };
      case "data.attach":
        return { op: "data.attach", view: await data.attach(request.window_id) };
      case "data.detach":
        data.detach(request.window_id);
        return { op: "data.detach" };
      case "data.refresh":
        await data.refresh(request.window_id, request.sources ?? []);
        return { op: "data.refresh" };
      case "data.act":
        await data.act(request.window_id, request.pointer, request.event ?? null, request.item);
        return { op: "data.act" };
      case "data.media": {
        const url = seed.media?.[request.media.path];
        if (!url) return fail("not_found", "미디어를 찾을 수 없습니다");
        const response = await fetch(url);
        if (!response.ok) return fail("not_found", "미디어를 찾을 수 없습니다");
        const bytes = new Uint8Array(await response.arrayBuffer());
        const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
        return { op: "data.media", media: { mime: response.headers.get("content-type")?.split(";")[0] || "image/png", data_base64: encoded, width: null, height: null } };
      }
      case "connection.login":
        if (conversation) { if (conversation.delayMs) await delay(conversation.delayMs); conversationLoggedIn = true; return { op: "connection.login" }; }
        return fail("unavailable", "로그인을 사용할 수 없습니다");
      case "conversation.get": {
        if (!conversation) return fail("unavailable", "대화를 사용할 수 없습니다");
        if (conversation.delayMs) await delay(conversation.delayMs);
        if (!conversationLoggedIn) return fail("login_required", "로그인이 필요합니다");
        if (conversation.conflict) return fail("binding_conflict", "대화 연결이 충돌합니다");
        if (conversation.draft) emit({ event: "conversation.draft", window_id: request.window_id, ...conversation.draft });
        watchConversation();
        return { op: "conversation.get", thread: clone(conversation.thread), items: clone(conversation.items), cursor: "1", next_before: conversationOlderPages.length ? "older-0" : undefined, models: clone(conversation.models) };
      }
      case "conversation.history": {
        if (!conversation) return fail("unavailable", "대화를 사용할 수 없습니다");
        if (conversation.delayMs) await delay(conversation.delayMs);
        const page = Number(request.before.slice("older-".length));
        return { op: "conversation.history", items: clone(conversationOlderPages[page] ?? []), next_before: page + 1 < conversationOlderPages.length ? `older-${page + 1}` : undefined };
      }
      case "conversation.create": {
        if (!conversation) return fail("unavailable", "대화를 사용할 수 없습니다");
        if (conversation.delayMs) await delay(conversation.delayMs);
        if (!conversationLoggedIn) return fail("login_required", "로그인이 필요합니다");
        const model = conversation.models.find((item) => item.id === request.model && item.available);
        if (!model) return fail("invalid_request", "고를 수 없는 모델입니다");
        conversation.thread ??= { id: "fake-thread", external: { namespace: "fake", key: request.window_id }, title: "대화", model: { id: model.id, label: model.label }, created_at: new Date().toISOString(), archived: false };
        watchConversation();
        return { op: "conversation.create", thread: clone(conversation.thread) };
      }
      case "conversation.send": {
        if (!conversation?.thread) return fail("not_found", "대화가 없습니다");
        if (conversation.delayMs) await delay(conversation.delayMs);
        if (!conversationLoggedIn) return fail("login_required", "로그인이 필요합니다");
        const threadId = conversation.thread.id;
        const id = `fake-${conversation.items.length + 1}`;
        request.attachments.forEach((upload, index) => conversationAttachments.set(`${id}:${index}`, upload));
        const item: ConversationItem = { id, kind: "user", text: request.text, at: new Date().toISOString(), attachments: request.attachments.map((upload, index) => ({ id: String(index), name: upload.name, mime: upload.mime })) };
        conversation.items.push(item); conversation.draft = undefined;
        emit({ event: "conversation.update", thread_id: threadId, update: { kind: "item", item } });
        emit({ event: "conversation.update", thread_id: threadId, update: { kind: "activity", busy: true, tool: "문서 읽기" } });
        void (async () => {
          await delay(150);
          emit({ event: "conversation.update", thread_id: threadId, update: { kind: "text", stream_id: "fake-stream", text: "답변" } });
          await delay(150);
          emit({ event: "conversation.update", thread_id: threadId, update: { kind: "text", stream_id: "fake-stream", text: "답변을 준비했습니다." } });
          await delay(150);
          const answer: ConversationItem = { id: `fake-${conversation.items.length + 1}`, kind: "assistant", text: "답변을 준비했습니다.", at: new Date().toISOString(), attachments: [] };
          conversation.items.push(answer);
          emit({ event: "conversation.update", thread_id: threadId, update: { kind: "item", item: answer } });
          emit({ event: "conversation.update", thread_id: threadId, update: { kind: "activity", busy: false, tool: null } });
        })();
        return { op: "conversation.send" };
      }
      case "conversation.attachment": {
        const attachment = conversationAttachments.get(`${request.item_id}:${request.attachment_id}`);
        if (!attachment) return fail("not_found", "첨부를 찾을 수 없습니다");
        return { op: "conversation.attachment", ...attachment };
      }
      case "conversation.attachment_open": return { op: "conversation.attachment_open" };
      case "agent.get": {
        if (seed.agentGetDelayMs) await delay(seed.agentGetDelayMs);
        if (seed.agentGetError) return fail("server", seed.agentGetError);
        const session = agentFor(legacyAgentWorkspaceId(request));
        return {
          op: "agent.get",
          agent: clone(session.agent),
          items: clone(session.items),
          models: clone(session.models),
        };
      }
      case "agent.create": {
        const workspaceId = legacyAgentWorkspaceId(request);
        const session = agentFor(workspaceId);
        if (session.agent) return { op: "agent.create", agent: clone(session.agent) };
        const model = session.models.find((item) => item.preset === request.model_preset);
        if (!model) return fail("invalid_request", "고를 수 없는 모델입니다");
        const agent: AgentInfo = {
          workspace_id: workspaceId,
          model_preset: model.preset,
          model_label: model.label,
          busy: false,
          tool: null,
          created_at: new Date().toISOString(),
        };
        session.agent = agent;
        emitAgent(workspaceId, { kind: "created", agent: clone(agent) });
        void streamReply(workspaceId, "안녕하십니까. 이 작업을 맡겠습니다.", null);
        return { op: "agent.create", agent: clone(agent) };
      }
      case "agent.send": {
        if (seed.agentSendDelayMs) await delay(seed.agentSendDelayMs);
        if (seed.agentSendError) return fail("server", seed.agentSendError);
        const workspaceId = legacyAgentWorkspaceId(request);
        const session = agentFor(workspaceId);
        if (!session.agent) return fail("not_found", "이 작업의 PAS가 없습니다");
        addAgentItem(workspaceId, "user", request.text, request.attachments ?? []);
        void streamReply(workspaceId, "## 살펴볼 내용\n\n- 요청한 내용을 정리했습니다.\n- 다음 동작을 이어가겠습니다.", "문서 읽기");
        return { op: "agent.send" };
      }
      case "agent.attachment": {
        const workspaceId = legacyAgentWorkspaceId(request);
        const [itemId, index] = legacyAgentAttachment(request);
        const attachment = agentAttachments.get(JSON.stringify([workspaceId, itemId, index]));
        if (!attachment) return fail("not_found", "첨부를 찾을 수 없습니다");
        return { op: "agent.attachment", ...attachment };
      }
      case "agent.attachment_open": {
        const workspaceId = legacyAgentWorkspaceId(request);
        const [itemId, index] = legacyAgentAttachment(request);
        openedAttachments.push({ workspace_id: workspaceId, item_id: itemId, index });
        return { op: "agent.attachment_open" };
      }
      case "link.start": {
        const userCode = "K7PQ-4XMR";
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        snapshot = {
          ...snapshot,
          link: { state: "pairing", server_url: "https://kaleidoscope.example", user_code: userCode, expires_at: expiresAt },
        };
        emitState();
        return { op: "link.start", user_code: userCode, expires_at: expiresAt };
      }
      case "link.cancel": {
        if (snapshot.link.state === "pairing") {
          snapshot = { ...snapshot, link: { state: "unlinked" } };
          emitState();
        }
        return { op: "link.cancel" };
      }
      case "link.unlink":
        snapshot = { ...snapshot, link: { state: "unlinked" } };
        emitState();
        return { op: "link.unlink" };
      case "update.restart":
        if (seed.updateRestartError) return fail("io", seed.updateRestartError);
        return { op: "update.restart" };
      case "desktop.activate": {
        const desktop = snapshot.shared.desktops.find((item) => item.id === request.desktop_id);
        if (!desktop) return fail("not_found", "데스크톱을 찾을 수 없습니다");
        snapshot = {
          ...snapshot,
          device: {
            ...snapshot.device,
            active_workspace_id: desktop.workspace_id,
            active_desktop_ids: { ...snapshot.device.active_desktop_ids, [desktop.workspace_id]: desktop.id },
          },
        };
        emitState();
        return { op: "desktop.activate" };
      }
      case "window.raise":
        return { op: "window.raise", window: clone(raiseWindow(request.window_id)) };
      case "window.set_rect": {
        const window = findWindow(request.window_id);
        const updated: AppWindow = {
          ...window,
          rect: clone(request.rect),
          updated_at: new Date().toISOString(),
        };
        snapshot = {
          ...snapshot,
          shared: {
            ...snapshot.shared,
            windows: snapshot.shared.windows.map((item) => item.id === updated.id ? updated : item),
          },
        };
        emitState();
        return { op: "window.set_rect", window: clone(updated) };
      }
      case "window.set_state": {
        const window = findWindow(request.window_id);
        const definition = definitionFor(window);
        const declared = definition?.state ?? {};
        const unknownKeys = Object.keys(request.state).filter((key) => !Object.hasOwn(declared, key));
        if (unknownKeys.length > 0) {
          return fail("invalid_request", "선언되지 않은 창 상태 키입니다", unknownKeys);
        }
        const updated: AppWindow = { ...window, state: clone(request.state), updated_at: new Date().toISOString() };
        snapshot = {
          ...snapshot,
          shared: {
            ...snapshot.shared,
            windows: snapshot.shared.windows.map((item) => item.id === updated.id ? updated : item),
          },
        };
        emitState();
        await data.stateChanged(updated);
        return { op: "window.set_state", window: clone(updated) };
      }
      case "files.open": {
        const { window: explorerWindow, declaration: sourcePermission } = permissionFor(request.window_id, request.permission);
        const sourceDefinition = definitionFor(explorerWindow);
        if (sourceDefinition?.ui.type !== "explorer") return fail("invalid_request", "탐색기 창에서만 파일을 열 수 있습니다");
        const sourceGrant = requireGrant(request.window_id, request.permission);
        if (!validRelativePath(request.path)) return fail("invalid_request", "파일 경로가 올바르지 않습니다");
        if (directoryExists(request.path) && !files.has(request.path)) return fail("invalid_request", "폴더는 앱으로 열 수 없습니다");
        if (!files.has(request.path)) return fail("not_found", "파일을 찾을 수 없습니다");

        const targetDefinition = appCurrentDefinition(request.app_id);
        const opens = targetDefinition?.opens;
        if (!opens) return fail("invalid_request", "파일을 여는 앱이 아닙니다");
        const extensionStart = request.path.slice(request.path.lastIndexOf("/") + 1).lastIndexOf(".");
        const fileName = request.path.slice(request.path.lastIndexOf("/") + 1);
        const extension = extensionStart > 0 ? fileName.slice(extensionStart + 1).toLowerCase() : "";
        if (!opens.extensions.some((candidate) => candidate.toLowerCase() === extension)) {
          return fail("invalid_request", "이 앱은 파일 확장자를 열지 않습니다");
        }
        if (!targetDefinition.permissions.some((item) => item.module === "files" && item.id === opens.permission)) {
          return fail("invalid_request", "앱의 파일 권한을 찾을 수 없습니다");
        }
        const pcOpen = sourcePermission.scope === "pc";
        const parentSeparator = request.path.lastIndexOf("/");
        const openRootPath = pcOpen ? parentSeparator < 0 ? "" : request.path.slice(0, parentSeparator) : sourceGrant.root_path;
        const openRootName = pcOpen ? openRootPath.slice(openRootPath.lastIndexOf("/") + 1) : sourceGrant.root_name;
        const currentFile = pcOpen ? fileName : request.path;
        const candidates = snapshot.shared.windows
          .filter((item) => item.desktop_id === explorerWindow.desktop_id && item.app_id === request.app_id)
          .filter((item) => snapshot.device.grants.some((grant) =>
            grant.window_id === item.id && grant.permission === opens.permission && grant.root_path === openRootPath))
          .sort((left, right) => right.z - left.z);
        const existing = candidates[0];
        let opened: AppWindow;
        if (existing) {
          const state = { ...existing.state, [opens.state]: currentFile };
          const topZ = Math.max(0, ...snapshot.shared.windows
            .filter((item) => item.desktop_id === explorerWindow.desktop_id)
            .map((item) => item.z));
          opened = {
            ...existing,
            state,
            z: topZ + 1,
            updated_at: new Date().toISOString(),
          };
          snapshot = {
            ...snapshot,
            shared: {
              ...snapshot.shared,
              windows: snapshot.shared.windows.map((item) => item.id === opened.id ? opened : item),
            },
          };
          if (pcOpen) pcOpenedFileGrants.add(grantKey(existing.id, opens.permission));
        } else {
          const app = snapshot.shared.apps.find((item) => item.id === request.app_id);
          if (!app) return fail("not_found", "앱을 찾을 수 없습니다");
          const id = `fake-window-${windowNumber++}`;
          const topZ = Math.max(0, ...snapshot.shared.windows
            .filter((item) => item.desktop_id === explorerWindow.desktop_id)
            .map((item) => item.z));
          const at = new Date().toISOString();
          opened = {
            id,
            desktop_id: explorerWindow.desktop_id,
            app_id: app.id,
            app_version: app.current_version,
            rect: clone(request.rect ?? { x: 48, y: 48, width: 720, height: 520 }),
            z: topZ + 1,
            state: { ...clone(targetDefinition.state), [opens.state]: currentFile },
            created_at: at,
            updated_at: at,
          };
          const copiedGrant: Grant = {
            window_id: id,
            permission: opens.permission,
            root_path: openRootPath,
            root_name: openRootName,
            granted_at: at,
          };
          snapshot = {
            ...snapshot,
            shared: {
              ...snapshot.shared,
              windows: [...snapshot.shared.windows, opened],
            },
            device: { ...snapshot.device, grants: [...snapshot.device.grants, copiedGrant] },
          };
          if (pcOpen) pcOpenedFileGrants.add(grantKey(id, opens.permission));
        }
        emitState();
        return { op: "files.open", window: clone(opened) };
      }
      case "web.attach": {
        const window = findWindow(request.window_id);
        if (definitionFor(window)?.ui.type !== "web_view") return fail("invalid_request", "웹 화면이 없는 앱입니다");
        if (!isFakeHttpAddress(request.url)) return fail("invalid_request", "웹 주소는 http 또는 https여야 합니다");
        if (seed.webUnavailable) return fail("unavailable", "가짜 쉘에서 웹 화면을 사용할 수 없습니다");
        const current = webViews.get(request.window_id);
        if (current) return { op: "web.attach", page: clone(current.page) };
        const history = [request.url];
        const view: FakeWebView = {
          history,
          historyIndex: 0,
          page: makeWebPage(request.url, 0, history),
          bounds: null,
        };
        webViews.set(request.window_id, view);
        webAttachCounts.set(request.window_id, (webAttachCounts.get(request.window_id) ?? 0) + 1);
        emitWebViews();
        return { op: "web.attach", page: clone(view.page) };
      }
      case "web.navigate": {
        const view = webViews.get(request.window_id);
        if (!view) return fail("not_found", "웹 화면이 연결되지 않았습니다");
        if (!isFakeHttpAddress(request.url)) return fail("invalid_request", "웹 주소는 http 또는 https여야 합니다");
        view.history = [...view.history.slice(0, view.historyIndex + 1), request.url];
        view.historyIndex = view.history.length - 1;
        view.page = makeWebPage(request.url, view.historyIndex, view.history);
        emitWebPage(request.window_id);
        emitWebViews();
        return { op: "web.navigate" };
      }
      case "web.history": {
        const view = webViews.get(request.window_id);
        if (!view) return fail("not_found", "웹 화면이 연결되지 않았습니다");
        if (request.action === "back") {
          if (view.historyIndex === 0) return { op: "web.history" };
          view.historyIndex -= 1;
        } else if (request.action === "forward") {
          if (view.historyIndex >= view.history.length - 1) return { op: "web.history" };
          view.historyIndex += 1;
        }
        view.page = makeWebPage(view.history[view.historyIndex], view.historyIndex, view.history);
        emitWebPage(request.window_id);
        emitWebViews();
        return { op: "web.history" };
      }
      case "web.place": {
        const view = webViews.get(request.window_id);
        if (!view) return fail("not_found", "웹 화면이 연결되지 않았습니다");
        view.bounds = clone(request.bounds);
        webPlaces.push({ window_id: request.window_id, bounds: clone(request.bounds) });
        emitWebViews();
        return { op: "web.place" };
      }
      case "web.capture": {
        if (!webViews.has(request.window_id)) return fail("not_found", "웹 화면이 연결되지 않았습니다");
        return { op: "web.capture", image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/n7sAAAAASUVORK5CYII=" };
      }
      case "web.detach":
        webViews.delete(request.window_id);
        emitWebViews();
        return { op: "web.detach" };
      case "files.pick_folder": {
        permissionFor(request.window_id, request.permission);
        if (!seed.folder) return { op: "files.pick_folder", grant: null };
        const grant: Grant = {
          window_id: request.window_id,
          permission: request.permission,
          root_path: seed.folder.root_path,
          root_name: seed.folder.root_name,
          granted_at: new Date().toISOString(),
        };
        snapshot = {
          ...snapshot,
          device: {
            ...snapshot.device,
            grants: [
              ...snapshot.device.grants.filter((item) => !(item.window_id === grant.window_id && item.permission === grant.permission)),
              grant,
            ],
          },
        };
        emitState();
        return { op: "files.pick_folder", grant: clone(grant) };
      }
      case "files.allow_pc": {
        const { window, declaration } = permissionFor(request.window_id, request.permission);
        if (declaration.scope !== "pc") return fail("invalid_request", "내 PC 범위가 아닌 권한입니다");
        const existing = snapshot.device.pc_access.find((item) => item.app_id === window.app_id && item.permission === request.permission);
        if (existing) return { op: "files.allow_pc", access: clone(existing) };
        const access: PcAccess = {
          app_id: window.app_id,
          permission: request.permission,
          granted_at: new Date().toISOString(),
        };
        snapshot = {
          ...snapshot,
          device: { ...snapshot.device, pc_access: [...snapshot.device.pc_access, access] },
        };
        emitState();
        return { op: "files.allow_pc", access: clone(access) };
      }
      case "files.list": {
        const { declaration } = permissionFor(request.window_id, request.permission);
        const grant = requireGrant(request.window_id, request.permission);
        if (!validRelativePath(request.dir, true)) {
          return fail("not_found", "폴더를 찾을 수 없습니다");
        }
        if (declaration.scope === "pc" && request.dir === "") {
          return { op: "files.list", entries: clone(FAKE_PC_ROOTS) };
        }
        const pcOpened = pcOpenedFileGrants.has(grantKey(request.window_id, request.permission));
        const backingDirectory = pcOpened
          ? filePathForGrant(grant, request.dir, true)
          : request.dir;
        const exists = (declaration.scope === "pc" && FAKE_PC_ROOTS.some((entry) => entry.path === request.dir))
          || directoryExists(backingDirectory);
        if (!exists) return fail("not_found", "폴더를 찾을 수 없습니다");
        const prefix = backingDirectory === "" ? "" : `${backingDirectory}/`;
        const relativePrefix = request.dir === "" ? "" : `${request.dir}/`;
        const entries = new Map<string, FileEntry>();
        for (const path of files.keys()) {
          if (!path.startsWith(prefix)) continue;
          const rest = path.slice(prefix.length);
          const [name, ...tail] = rest.split("/");
          if (!name || name.startsWith(".")) continue;
          const relativePath = `${relativePrefix}${name}`;
          if (tail.length > 0) {
            const directoryPath = relativePath;
            entries.set(directoryPath, { name, path: directoryPath, kind: "dir", size: 0, modified: FAKE_MODIFIED });
          } else {
            const size = new TextEncoder().encode(files.get(path)?.text ?? "").length;
            entries.set(relativePath, { name, path: relativePath, kind: "file", size, modified: FAKE_MODIFIED });
          }
        }
        const ordered = [...entries.values()].sort((left, right) => {
          if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
          const leftName = left.name.toLowerCase();
          const rightName = right.name.toLowerCase();
          return leftName.localeCompare(rightName) || left.name.localeCompare(right.name);
        });
        return { op: "files.list", entries: ordered };
      }
      case "files.read": {
        const { declaration } = permissionFor(request.window_id, request.permission);
        if (declaration.scope === "pc") return fail("not_granted", "내 PC 권한으로 파일을 직접 읽을 수 없습니다");
        const grant = requireGrant(request.window_id, request.permission);
        if (!validRelativePath(request.path)) return fail("invalid_request", "파일 경로가 올바르지 않습니다");
        const pcOpened = pcOpenedFileGrants.has(grantKey(request.window_id, request.permission));
        const file = files.get(filePathForGrant(grant, request.path, pcOpened));
        if (!file) return fail("not_found", "파일을 찾을 수 없습니다");
        return { op: "files.read", path: request.path, text: file.text, revision: file.revision };
      }
      case "storage.get": {
        const { declaration, id } = storageEntry(request.window_id, request.entry);
        const item = storage.get(id);
        return { op: "storage.get", result: {
          kind: declaration.kind, content: clone(item ? item.content : declaration.default),
          revision: item?.revision ?? null, exists: item !== undefined,
        } };
      }
      case "storage.write": {
        const { window, declaration, key, id } = storageEntry(request.window_id, request.entry);
        if (seed.storageWriteDelayMs) await delay(seed.storageWriteDelayMs);
        if (storageFailure) { const message = storageFailure; storageFailure = null; return fail("server", message); }
        const current = storage.get(id);
        if ((request.expected_revision ?? null) !== (current?.revision ?? null)) return fail("conflict", "문서가 읽은 뒤에 바뀌었습니다");
        if (declaration.kind === "md" && typeof request.content !== "string") return fail("invalid_request", "마크다운 문서는 글이어야 합니다");
        if (typeof request.content === "string" && declaration.schema?.minLength && request.content.length < declaration.schema.minLength) return fail("invalid_request", "값을 입력해 주세요");
        if (current && JSON.stringify(current.content) === JSON.stringify(request.content)) return { op: "storage.write", revision: current.revision };
        const revision = `fake-revision-${revisionNumber++}`;
        storage.set(id, { content: clone(request.content), revision });
        emitStorage(window.app_id, key, declaration, revision);
        return { op: "storage.write", revision };
      }
      case "storage.reset": {
        const { window, declaration, key, id } = storageEntry(request.window_id, request.entry);
        const current = storage.get(id);
        if ((request.expected_revision ?? null) !== (current?.revision ?? null)) return fail("conflict", "문서가 읽은 뒤에 바뀌었습니다");
        storage.delete(id);
        emitStorage(window.app_id, key, declaration, null);
        return { op: "storage.reset", revision: null };
      }
      case "files.write": {
        const { declaration } = permissionFor(request.window_id, request.permission);
        const grant = requireGrant(request.window_id, request.permission);
        if (declaration.access !== "readwrite") return fail("permission_denied", "읽기 전용 폴더입니다");
        if (!validRelativePath(request.path)) return fail("invalid_request", "파일 경로가 올바르지 않습니다");
        const pcOpened = pcOpenedFileGrants.has(grantKey(request.window_id, request.permission));
        const path = filePathForGrant(grant, request.path, pcOpened);
        const current = files.get(path);
        if (request.expected_revision === undefined ? current !== undefined : !current || current.revision !== request.expected_revision) {
          return fail("conflict", "파일이 읽은 뒤에 바뀌었습니다");
        }
        const revision = `fake-revision-${revisionNumber++}`;
        files.set(path, { text: request.text, revision });
        for (const listener of fileListeners) listener();
        return { op: "files.write", path: request.path, revision };
      }
      default:
        return fail("invalid_request", "가짜 코어가 지원하지 않는 명령입니다");
    }
  }

  async function call<K extends CoreRequest["op"]>(request: Extract<CoreRequest, { op: K }>): Promise<Extract<CoreReply, { op: K }>> {
    try {
      return await callRequest(request) as Extract<CoreReply, { op: K }>;
    } catch (error) {
      throw toCoreError(error);
    }
  }

  return {
    call,
    subscribe(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    getFiles() {
      return Object.fromEntries([...files.entries()].map(([path, file]) => [path, file.text]));
    },
    getWebViews() {
      return [...webViews.entries()].map(([windowId, view]) => ({
        windowId,
        page: clone(view.page),
        bounds: clone(view.bounds),
      }));
    },
    subscribeWebViews(listener) {
      webListeners.add(listener);
      return () => webListeners.delete(listener);
    },
    getWebPlaces() {
      return clone(webPlaces);
    },
    getWebAttachCount(windowId) {
      return webAttachCounts.get(windowId) ?? 0;
    },
    subscribeFiles(listener) {
      fileListeners.add(listener);
      return () => fileListeners.delete(listener);
    },
    setLink(status) {
      snapshot = { ...snapshot, link: clone(status) };
      emitState();
    },
    emit,
    failNextStorageWrite(message) { storageFailure = message; },
    getShareCalls() { return clone(shareCalls); },
    getCalls() { return clone(calls); },
    getOpenedAttachments() { return clone(openedAttachments); },
  };
}
