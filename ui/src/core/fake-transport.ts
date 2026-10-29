import type {
  AppDefinition,
  AppWindow,
  AgentInfo,
  AgentItem,
  AgentModel,
  AgentUpdate,
  CoreError,
  CoreEvent,
  CoreReply,
  CoreRequest,
  FileEntry,
  Grant,
  LinkStatus,
  ShellSnapshot,
} from "../contract/contract";
import { toCoreError, type CoreTransport } from "./core-transport";

export interface FakeTransportSeed {
  snapshot: ShellSnapshot;
  folder: { root_path: string; root_name: string } | null;
  files: Record<string, string>;
  agents?: Record<string, FakeAgentSeed>;
  agentModels?: AgentModel[];
  agentGetDelayMs?: number;
  agentGetError?: string;
  agentSendError?: string;
  agentSendDelayMs?: number;
}

export interface FakeAgentSeed {
  agent: AgentInfo | null;
  items: AgentItem[];
  models: AgentModel[];
}

export interface FakeTransport extends CoreTransport {
  getFiles(): Record<string, string>;
  subscribeFiles(listener: () => void): () => void;
  /** Test and harness controls; the real core does not expose these methods. */
  setLink(status: LinkStatus): void;
  emit(event: CoreEvent): void;
}

interface FakeFile {
  text: string;
  revision: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fail(code: CoreError["code"], message: string, details: string[] = []): never {
  throw { code, message, details } satisfies CoreError;
}

function validRelativePath(path: string, allowEmpty = false): boolean {
  if (path === "") return allowEmpty;
  return !path.startsWith("/")
    && !path.endsWith("/")
    && path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[\\:\0]/.test(part));
}

export function createFakeTransport(seed: FakeTransportSeed): FakeTransport {
  let snapshot = clone(seed.snapshot);
  const files = new Map<string, FakeFile>();
  const eventListeners = new Set<(event: CoreEvent) => void>();
  const fileListeners = new Set<() => void>();
  let revisionNumber = 1;
  const models = clone(seed.agentModels ?? [
    { preset: "gemini-4-argon", label: "Argon" },
    { preset: "claude-opus-5.5", label: "Opus" },
    { preset: "codex-6.1-sol", label: "Sol 6.1" },
  ]);
  const agents = new Map<string, FakeAgentSeed>(
    Object.entries(seed.agents ?? {}).map(([workspaceId, session]) => [workspaceId, clone(session)]),
  );
  const nextAgentIds = new Map<string, number>();

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

  const addAgentItem = (workspaceId: string, kind: AgentItem["kind"], text: string) => {
    const session = agentFor(workspaceId);
    const id = (nextAgentIds.get(workspaceId) ?? session.items.length) + 1;
    nextAgentIds.set(workspaceId, id);
    const item: AgentItem = { id: String(id), kind, text, at: new Date().toISOString() };
    session.items.push(item);
    emitAgent(workspaceId, { kind: "item", item });
  };

  const setAgentActivity = (workspaceId: string, busy: boolean, tool: string | null) => {
    const session = agentFor(workspaceId);
    if (session.agent) session.agent = { ...session.agent, busy, tool };
    emitAgent(workspaceId, { kind: "activity", busy, tool });
  };

  const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

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

  const permissionFor = (windowId: string, permission: string) => {
    const window = findWindow(windowId);
    const definition = definitionFor(window);
    const declaration = definition?.permissions.find((item) => item.id === permission && item.module === "files");
    if (!declaration) return fail("permission_denied", "앱이 선언하지 않은 파일 권한입니다");
    return { window, declaration };
  };

  const requireGrant = (windowId: string, permission: string): Grant => {
    const grant = snapshot.device.grants.find((item) => item.window_id === windowId && item.permission === permission);
    if (!grant) return fail("not_granted", "이 기기에서 폴더를 먼저 골라야 합니다");
    return grant;
  };

  const directoryExists = (directory: string): boolean => directory === ""
    || [...files.keys()].some((path) => path.startsWith(`${directory}/`));

  async function callRequest(request: CoreRequest): Promise<CoreReply> {
    switch (request.op) {
      case "state.get":
        return { op: "state.get", snapshot: clone(snapshot) };
      case "agent.get": {
        if (seed.agentGetDelayMs) await delay(seed.agentGetDelayMs);
        if (seed.agentGetError) return fail("server", seed.agentGetError);
        const session = agentFor(request.workspace_id);
        return {
          op: "agent.get",
          agent: clone(session.agent),
          items: clone(session.items),
          models: clone(session.models),
        };
      }
      case "agent.create": {
        const session = agentFor(request.workspace_id);
        if (session.agent) return { op: "agent.create", agent: clone(session.agent) };
        const model = session.models.find((item) => item.preset === request.model_preset);
        if (!model) return fail("invalid_request", "고를 수 없는 모델입니다");
        const agent: AgentInfo = {
          workspace_id: request.workspace_id,
          model_preset: model.preset,
          model_label: model.label,
          busy: false,
          tool: null,
          created_at: new Date().toISOString(),
        };
        session.agent = agent;
        emitAgent(request.workspace_id, { kind: "created", agent: clone(agent) });
        void streamReply(request.workspace_id, "안녕하십니까. 이 작업을 맡겠습니다.", null);
        return { op: "agent.create", agent: clone(agent) };
      }
      case "agent.send": {
        if (seed.agentSendDelayMs) await delay(seed.agentSendDelayMs);
        if (seed.agentSendError) return fail("server", seed.agentSendError);
        const session = agentFor(request.workspace_id);
        if (!session.agent) return fail("not_found", "이 작업의 PAS가 없습니다");
        addAgentItem(request.workspace_id, "user", request.text);
        void streamReply(request.workspace_id, "## 살펴볼 내용\n\n- 요청한 내용을 정리했습니다.\n- 다음 동작을 이어가겠습니다.", "문서 읽기");
        return { op: "agent.send" };
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
        return { op: "window.set_state", window: clone(updated) };
      }
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
      case "files.list": {
        permissionFor(request.window_id, request.permission);
        requireGrant(request.window_id, request.permission);
        if (!validRelativePath(request.dir, true) || !directoryExists(request.dir)) {
          return fail("not_found", "폴더를 찾을 수 없습니다");
        }
        const prefix = request.dir === "" ? "" : `${request.dir}/`;
        const entries = new Map<string, FileEntry>();
        for (const path of files.keys()) {
          if (!path.startsWith(prefix)) continue;
          const rest = path.slice(prefix.length);
          const [name, ...tail] = rest.split("/");
          if (!name || name.startsWith(".")) continue;
          if (tail.length > 0) {
            const directoryPath = `${prefix}${name}`;
            entries.set(directoryPath, { name, path: directoryPath, kind: "dir" });
          } else {
            entries.set(path, { name, path, kind: "file" });
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
        permissionFor(request.window_id, request.permission);
        requireGrant(request.window_id, request.permission);
        if (!validRelativePath(request.path)) return fail("invalid_request", "파일 경로가 올바르지 않습니다");
        const file = files.get(request.path);
        if (!file) return fail("not_found", "파일을 찾을 수 없습니다");
        return { op: "files.read", path: request.path, text: file.text, revision: file.revision };
      }
      case "files.write": {
        const { declaration } = permissionFor(request.window_id, request.permission);
        requireGrant(request.window_id, request.permission);
        if (declaration.access !== "readwrite") return fail("permission_denied", "읽기 전용 폴더입니다");
        if (!validRelativePath(request.path)) return fail("invalid_request", "파일 경로가 올바르지 않습니다");
        const current = files.get(request.path);
        if (request.expected_revision === undefined ? current !== undefined : !current || current.revision !== request.expected_revision) {
          return fail("conflict", "파일이 읽은 뒤에 바뀌었습니다");
        }
        const revision = `fake-revision-${revisionNumber++}`;
        files.set(request.path, { text: request.text, revision });
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
    subscribeFiles(listener) {
      fileListeners.add(listener);
      return () => fileListeners.delete(listener);
    },
    setLink(status) {
      snapshot = { ...snapshot, link: clone(status) };
      emitState();
    },
    emit,
  };
}
