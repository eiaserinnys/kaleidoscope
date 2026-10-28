import type {
  AppDefinition,
  AppWindow,
  CoreError,
  CoreEvent,
  CoreReply,
  CoreRequest,
  FileEntry,
  Grant,
  ShellSnapshot,
} from "../contract/contract";
import { toCoreError, type CoreTransport } from "./core-transport";

export interface FakeTransportSeed {
  snapshot: ShellSnapshot;
  folder: { root_path: string; root_name: string } | null;
  files: Record<string, string>;
}

export interface FakeTransport extends CoreTransport {
  getFiles(): Record<string, string>;
  subscribeFiles(listener: () => void): () => void;
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

  for (const [path, text] of Object.entries(seed.files)) {
    files.set(path, { text, revision: `fake-revision-${revisionNumber++}` });
  }

  const emitState = () => {
    const event: CoreEvent = { event: "state.changed", snapshot: clone(snapshot) };
    for (const listener of eventListeners) listener(event);
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
  };
}
