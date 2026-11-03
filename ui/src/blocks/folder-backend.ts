import type { CoreError, CoreEvent, FileOpResult, FolderEntry } from "../contract/contract";
import { SHELL_FILE_COPY_REPLY_INVALID, SHELL_FILE_LIST_REPLY_INVALID, SHELL_FILE_MOVE_REPLY_INVALID, SHELL_FILE_PATH_REPLY_INVALID, SHELL_FILE_REMOVE_REPLY_INVALID, SHELL_FILE_STORAGE_LIST_REPLY_INVALID, SHELL_FILE_STORAGE_RENAME_REVISION_MISSING, SHELL_FILE_STORAGE_REMOVE_REVISION_MISSING } from "../contract/shell-errors";
import { toCoreError } from "../core/core-transport";
import type { ShellStore } from "../core/shell-store";
import type { EditorAddress } from "./file-editor-session";

export interface FolderCapabilities {
  createFile: boolean;
  createDirectory: boolean;
  rename: boolean;
  move: boolean;
  copy: boolean;
  duplicate: boolean;
  trash: boolean;
  permanentDelete: boolean;
  reveal: boolean;
  absolutePath: boolean;
  relativePath: boolean;
  properties: boolean;
}
export interface FolderOperationResult {
  path: string;
  error?: CoreError;
}

export interface FolderItem extends FolderEntry {
  revision?: string;
}

export interface FolderActions {
  createFile?: (parent: string, name: string) => Promise<void>;
  createDirectory?: (parent: string, name: string) => Promise<void>;
  rename?: (item: FolderItem, name: string) => Promise<void>;
  move?: (paths: string[], destination: string) => Promise<FolderOperationResult[]>;
  copy?: (paths: string[], destination: string) => Promise<FolderOperationResult[]>;
  trash?: (paths: string[]) => Promise<FolderOperationResult[]>;
  permanentDelete?: (paths: string[]) => Promise<FolderOperationResult[]>;
  reveal?: (path: string) => Promise<void>;
  absolutePath?: (path: string) => Promise<string>;
  relativePath?: (path: string) => Promise<string>;
  properties?: (item: FolderItem) => Array<{ label: string; value: string }>;
}

export interface FolderBackend {
  kind: "files" | "collection";
  /** Stable identity for this device grant or account/app storage collection. */
  identity: string;
  rootPath?: string;
  appId?: string;
  entry?: string;
  prefix?: string;
  capabilities: FolderCapabilities;
  actions: FolderActions;
  list(parent: string): Promise<FolderItem[]>;
  editorAddress(path: string): EditorAddress;
  matchesEvent(event: CoreEvent): boolean;
}

function capabilities(actions: FolderActions): FolderCapabilities {
  return {
    createFile: Boolean(actions.createFile),
    createDirectory: Boolean(actions.createDirectory),
    rename: Boolean(actions.rename),
    move: Boolean(actions.move),
    copy: Boolean(actions.copy),
    duplicate: Boolean(actions.copy),
    trash: Boolean(actions.trash),
    permanentDelete: Boolean(actions.permanentDelete),
    reveal: Boolean(actions.reveal),
    absolutePath: Boolean(actions.absolutePath),
    relativePath: Boolean(actions.relativePath),
    properties: Boolean(actions.properties),
  };
}

function asResults(results: FileOpResult[]): FolderOperationResult[] {
  return results.map((result) => "error" in result
    ? { path: result.path, error: result.error }
    : { path: result.path });
}

function makeBackend(args: Omit<FolderBackend, "capabilities">): FolderBackend {
  return { ...args, capabilities: capabilities(args.actions) };
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function createFileFolderBackend({
  store,
  windowId,
  permission,
  appId,
  rootPath,
  writable,
  scope,
  readOnly,
}: {
  store: ShellStore;
  windowId: string;
  permission: string;
  appId: string;
  rootPath: string;
  writable: boolean;
  scope: "folder" | "pc";
  readOnly: boolean;
}): FolderBackend {
  const canWrite = writable && scope === "folder" && !readOnly;
  const list: FolderBackend["list"] = async (directory) => {
    const reply = await store.call({ op: "files.list", window_id: windowId, permission, dir: directory });
    if (reply.op !== "files.list") throw SHELL_FILE_LIST_REPLY_INVALID();
    return reply.entries.map((entry) => ({ ...entry, ext: extensionOf(entry.name) }));
  };
  const actions: FolderActions = {
    relativePath: async (path) => path,
    properties: (item) => [
      { label: "이름", value: item.name },
      { label: "종류", value: item.kind === "dir" ? "폴더" : item.ext ? `${item.ext.toUpperCase()} 파일` : "파일" },
      { label: "크기", value: item.kind === "dir" ? "—" : `${item.size.toLocaleString("ko-KR")}바이트` },
      { label: "수정 시각", value: item.modified || "—" },
    ],
  };
  actions.reveal = async (path) => { await store.call({ op: "files.reveal", window_id: windowId, permission, path }); };
  actions.absolutePath = async (path) => {
    const reply = await store.call({ op: "files.path", window_id: windowId, permission, path });
    if (reply.op !== "files.path") throw SHELL_FILE_PATH_REPLY_INVALID();
    return reply.text;
  };
  if (canWrite) {
    actions.createFile = async (parent, name) => {
      await store.call({ op: "files.write", window_id: windowId, permission, path: parent ? `${parent}/${name}` : name, text: "" });
    };
    actions.createDirectory = async (parent, name) => {
      await store.call({ op: "files.mkdir", window_id: windowId, permission, parent, name });
    };
    actions.rename = async (item, name) => {
      await store.call({ op: "files.rename", window_id: windowId, permission, path: item.path, name });
    };
    actions.move = async (paths, destination) => {
      const reply = await store.call({ op: "files.move", window_id: windowId, permission, paths, destination });
      if (reply.op !== "files.move") throw SHELL_FILE_MOVE_REPLY_INVALID();
      return asResults(reply.results);
    };
    actions.copy = async (paths, destination) => {
      const reply = await store.call({ op: "files.copy", window_id: windowId, permission, paths, destination });
      if (reply.op !== "files.copy") throw SHELL_FILE_COPY_REPLY_INVALID();
      return asResults(reply.results);
    };
    actions.trash = async (paths) => {
      const reply = await store.call({ op: "files.remove", window_id: windowId, permission, paths, permanent: false });
      if (reply.op !== "files.remove") throw SHELL_FILE_REMOVE_REPLY_INVALID();
      return asResults(reply.results);
    };
    actions.permanentDelete = async (paths) => {
      const reply = await store.call({ op: "files.remove", window_id: windowId, permission, paths, permanent: true });
      if (reply.op !== "files.remove") throw SHELL_FILE_REMOVE_REPLY_INVALID();
      return asResults(reply.results);
    };
  }
  return makeBackend({
    kind: "files",
    identity: scope === "pc" ? `pc:${appId}:${permission}` : `file:${rootPath}`,
    rootPath,
    actions,
    list,
    editorAddress: (path) => ({ kind: "file", root: rootPath, path }),
    matchesEvent: (event) => event.event === "files.changed" && event.root === rootPath,
  });
}

export function createCollectionFolderBackend({
  store,
  windowId,
  entry,
  appId,
  prefix,
  markdown,
  readOnly,
}: {
  store: ShellStore;
  windowId: string;
  entry: string;
  appId: string;
  prefix: string;
  markdown: boolean;
  readOnly: boolean;
}): FolderBackend {
  let bucketId: string | null = null;
  const list: FolderBackend["list"] = async (parent) => {
    if (parent) return [];
    const reply = await store.call({ op: "storage.list", window_id: windowId, entry });
    if (reply.op !== "storage.list") throw SHELL_FILE_STORAGE_LIST_REPLY_INVALID();
    bucketId = reply.result.bucket_id;
    return reply.result.items.map((item) => {
      const name = item.doc.split("/").at(-1) ?? item.doc;
      return {
        name,
        path: item.doc,
        kind: "file" as const,
        ext: extensionOf(name),
        size: Number(item.byte_size),
        modified: item.updated_at,
        revision: item.revision,
      };
    });
  };
  const actions: FolderActions = {};
  actions.relativePath = async (path) => path;
  actions.properties = (item) => [
    { label: "이름", value: item.name },
    { label: "종류", value: item.ext ? `${item.ext.toUpperCase()} 문서` : "문서" },
    { label: "크기", value: `${item.size.toLocaleString("ko-KR")}바이트` },
    { label: "수정 시각", value: item.modified || "—" },
  ];
  if (markdown && !readOnly) {
    actions.createFile = async (parent, name) => {
      const doc = parent ? `${parent}/${name}` : name;
      await store.call({ op: "storage.write", window_id: windowId, entry, doc, content: "" });
    };
    actions.rename = async (item, name) => {
      const slash = item.path.lastIndexOf("/");
      const to = slash >= 0 ? `${item.path.slice(0, slash + 1)}${name}` : name;
      if (!item.revision) throw SHELL_FILE_STORAGE_RENAME_REVISION_MISSING();
      await store.call({ op: "storage.move", window_id: windowId, entry, from: item.path, to, expected_revision: item.revision });
    };
    actions.permanentDelete = async (paths) => {
      const items = await list("");
      const results: FolderOperationResult[] = [];
      for (const path of paths) {
        const item = items.find((candidate) => candidate.path === path);
        if (!item?.revision) {
          results.push({ path, error: SHELL_FILE_STORAGE_REMOVE_REVISION_MISSING() });
          continue;
        }
        try {
          await store.call({ op: "storage.reset", window_id: windowId, entry, doc: path, expected_revision: item.revision });
          results.push({ path });
        } catch (cause) {
          results.push({ path, error: toCoreError(cause) });
        }
      }
      return results;
    };
  }
  return makeBackend({
    kind: "collection",
    identity: `storage:${appId}:${prefix}`,
    appId,
    entry,
    prefix,
    actions,
    list,
    editorAddress: (doc) => ({ kind: "document", store, windowId, entry, doc }),
    matchesEvent: (event) => {
      if (event.event !== "storage.update") return false;
      if (event.update.kind === "snapshot") return event.window_id === windowId;
      return event.update.kind === "changed"
        ? (bucketId === null || event.update.changed.bucket_id === bucketId) && event.update.changed.item.entry_id === entry
        : (bucketId === null || event.update.moved.bucket_id === bucketId) && event.update.moved.entry_id === entry;
    },
  });
}
