import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FolderEntry } from "../contract/contract";
import { toCoreError } from "../core/core-transport";
import { Button, IconButton, StatusText } from "../components/primitives";
import { FilePlus, FileText, FolderOpen, PanelLeftClose, PanelLeftOpen } from "../components/icons";
import { TextInput } from "../components/text-input";
import { TreeView } from "../components/tree/tree-view";
import type { TreeActivation } from "../components/tree/tree-view";
import type { TreeNode, TreeRowModel } from "../components/tree/tree-model";
import type { BlockContext } from "./block-context";
import { SplitPaneContext } from "./split-pane-context";
import { useWindowGrant, useWindowVisible } from "../data/window-state";
import { useShellSelector } from "../core/shell-store";
import { fileFolderCapabilities, type FolderBackend } from "./folder-backend";

interface CreatingFile {
  directory: string;
  initialName: string;
  error: string | null;
  attempt: number;
}

export interface FileBrowserTreeProps {
  context: BlockContext;
  permission: string;
  permissionLabel: string;
  extensions: string[];
  selectedPath: string | null;
  onSelect: (path: string, entry?: FolderEntry) => void | Promise<unknown>;
  canCreate: boolean;
  readOnly?: boolean;
  mode?: "files" | "folders";
  scope?: "folder" | "pc";
  fileIcon?: (entry: FolderEntry) => ReactNode;
  onFileDoubleClick?: (anchor: HTMLElement, path: string) => void;
  onFileEnter?: (anchor: HTMLElement, path: string) => void;
  onFileContextMenu?: (anchor: HTMLElement, path: string) => void;
  actionError?: string | null;
  onActionError?: (error: string | null) => void;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

const defaultFileIcon = (_entry: FolderEntry) => <FileText size="inline" />;

export function FileBrowserTree({
  context,
  permission,
  permissionLabel,
  extensions,
  selectedPath,
  onSelect,
  canCreate,
  readOnly = false,
  mode = "files",
  scope = "folder",
  fileIcon = defaultFileIcon,
  onFileDoubleClick,
  onFileEnter,
  onFileContextMenu,
  actionError: externalActionError,
  onActionError,
}: FileBrowserTreeProps) {
  const pane = useContext(SplitPaneContext);
  const treeRef = useRef<HTMLDivElement>(null);
  const restoreToggleFocus = useRef(false);
  const { store, window } = context;
  const grant = useWindowGrant(context, permission) ?? null;
  const windowVisible = useWindowVisible(context);
  const pcAccess = useShellSelector(store, (snapshot) => scope === "pc" && Boolean(snapshot?.device.pc_access.some(
    (item) => item.app_id === window.app_id && item.permission === permission,
  )));
  const declaration = context.definition.permissions.find((item) => item.module === "files" && item.id === permission);
  const permissionAccess = declaration?.module === "files" ? declaration.access : undefined;
  const identity = scope === "pc"
    ? `pc:${window.app_id}:${permission}`
    : grant ? `file:${grant.root_path}` : `file:${permission}`;
  const backend = useMemo<FolderBackend>(() => ({
    identity,
    capabilities: fileFolderCapabilities(permissionAccess === "readwrite", scope, readOnly),
    list: async (directory) => {
      const reply = await store.call({ op: "files.list", window_id: window.id, permission, dir: directory });
      if (reply.op !== "files.list") throw new Error("파일 목록 응답이 올바르지 않습니다");
      return reply.entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        kind: entry.kind,
        ext: extensionOf(entry.name),
        size: entry.size,
        modified: entry.modified,
      }));
    },
  }), [identity, permission, permissionAccess, readOnly, scope, store, window.id]);
  const hasRoot = scope === "pc" ? pcAccess : grant !== null;
  const rootPath = scope === "pc" ? pcAccess ? "" : null : grant?.root_path ?? null;
  const rootName = scope === "pc" ? permissionLabel : grant?.root_name ?? "";
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [entriesByDirectory, setEntriesByDirectory] = useState<Record<string, FolderEntry[]>>({});
  const entriesByDirectoryRef = useRef(entriesByDirectory);
  entriesByDirectoryRef.current = entriesByDirectory;
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [localActionError, setLocalActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState<CreatingFile | null>(null);
  const currentRoot = useRef<string | null>(rootPath);
  const actionError = externalActionError ?? localActionError;

  const reportActionError = useCallback((error: string | null) => {
    setLocalActionError(error);
    onActionError?.(error);
  }, [onActionError]);

  useLayoutEffect(() => {
    if (!restoreToggleFocus.current) return;
    restoreToggleFocus.current = false;
    treeRef.current?.querySelector<HTMLButtonElement>(pane?.collapsed ? ".ks-file-tree-expand button" : ".ks-file-tree-collapse button")?.focus();
  }, [pane?.collapsed]);

  const togglePane = () => {
    restoreToggleFocus.current = true;
    pane?.toggle();
  };

  const loadDirectory = useCallback(async (directory: string) => {
    if (rootPath === null) return;
    setLoadingDirectories((current) => new Set(current).add(directory));
    setErrors((current) => {
      const next = { ...current };
      delete next[directory];
      return next;
    });
    try {
      const entries = await backend.list(directory);
      if (currentRoot.current === rootPath) {
        setEntriesByDirectory((current) => ({ ...current, [directory]: entries }));
      }
    } catch (error) {
      if (currentRoot.current === rootPath) {
        setErrors((current) => ({ ...current, [directory]: toCoreError(error).message }));
      }
    } finally {
      if (currentRoot.current === rootPath) {
        setLoadingDirectories((current) => {
          const next = new Set(current);
          next.delete(directory);
          return next;
        });
      }
    }
  }, [backend, rootPath]);

  useEffect(() => {
    currentRoot.current = rootPath;
    setEntriesByDirectory({});
    setErrors({});
    setLoadingDirectories(new Set());
    reportActionError(null);
    setCreating(null);
    if (rootPath !== null) {
      setExpanded(new Set([""]));
      void loadDirectory("");
    } else {
      setExpanded(new Set());
    }
  }, [rootPath, loadDirectory]);

  const refreshExpanded = useCallback(() => {
    if (rootPath === null) return;
    for (const directory of expanded) void loadDirectory(directory);
  }, [expanded, loadDirectory, rootPath]);
  const wasWindowVisible = useRef(windowVisible);

  useEffect(() => {
    if (!windowVisible) {
      wasWindowVisible.current = false;
      return;
    }
    if (!wasWindowVisible.current) {
      wasWindowVisible.current = true;
      refreshExpanded();
    }
    globalThis.window.addEventListener("focus", refreshExpanded);
    return () => globalThis.window.removeEventListener("focus", refreshExpanded);
  }, [refreshExpanded, windowVisible]);

  useEffect(() => {
    if (mode !== "folders" || !hasRoot || (scope === "folder" && !rootPath) || !selectedPath) return;
    const parts = selectedPath.split("/");
    const ancestors = [""];
    for (let index = 0; index < parts.length - 1; index += 1) ancestors.push(parts.slice(0, index + 1).join("/"));
    setExpanded((current) => new Set([...current, ...ancestors]));
    void (async () => {
      for (const directory of ancestors) {
        if (!Object.hasOwn(entriesByDirectoryRef.current, directory)) await loadDirectory(directory);
      }
    })();
  }, [hasRoot, loadDirectory, mode, rootPath, scope, selectedPath]);

  const pickFolder = async () => {
    reportActionError(null);
    try {
      await store.call({ op: "files.pick_folder", window_id: window.id, permission });
    } catch (error) {
      reportActionError(toCoreError(error).message);
    }
  };

  const beginCreate = useCallback(async () => {
    const separator = selectedPath?.lastIndexOf("/") ?? -1;
    const directory = separator > 0 ? selectedPath!.slice(0, separator) : "";
    setExpanded((current) => {
      const next = new Set(current);
      next.add("");
      if (directory) {
        const parts = directory.split("/");
        for (let index = 0; index < parts.length; index += 1) next.add(parts.slice(0, index + 1).join("/"));
      }
      return next;
    });
    const directories = [""];
    if (directory) {
      const parts = directory.split("/");
      for (let index = 0; index < parts.length; index += 1) directories.push(parts.slice(0, index + 1).join("/"));
    }
    await Promise.all(directories
      .filter((item) => !Object.hasOwn(entriesByDirectory, item))
      .map((item) => loadDirectory(item)));
    setCreating({ directory, initialName: "", error: null, attempt: 0 });
  }, [entriesByDirectory, loadDirectory, selectedPath]);

  const commitCreate = useCallback(async (name: string) => {
    if (!creating) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setCreating(null);
      return;
    }
    const fileName = extensions.length > 0
      && !extensions.some((extension) => extensionOf(trimmed) === extension.toLowerCase())
      ? `${trimmed}.${extensions[0]}`
      : trimmed;
    const path = creating.directory ? `${creating.directory}/${fileName}` : fileName;
    const destination = creating.directory;
    try {
      await store.call({ op: "files.write", window_id: window.id, permission, path, text: "" });
      setCreating(null);
      await loadDirectory(destination);
      await onSelect(path);
    } catch (error) {
      const coreError = toCoreError(error);
      setCreating((current) => current ? {
        ...current,
        initialName: name,
        error: coreError.code === "conflict" ? "같은 이름의 파일이 있습니다" : coreError.message,
        attempt: current.attempt + 1,
      } : current);
    }
  }, [creating, extensions, loadDirectory, onSelect]);

  const selectFile = useCallback(async (path: string, entry?: FolderEntry) => {
    reportActionError(null);
    try {
      await onSelect(path, entry);
    } catch (error) {
      reportActionError(toCoreError(error).message);
    }
  }, [onSelect, reportActionError]);

  const selectFolder = useCallback(async (path: string, entry?: FolderEntry) => {
    reportActionError(null);
    try {
      await onSelect(path, entry);
    } catch (error) {
      reportActionError(toCoreError(error).message);
    }
  }, [onSelect, reportActionError]);

  const setDirectoryExpanded = useCallback((path: string, open: boolean) => {
    setExpanded((current) => {
      if (current.has(path) === open) return current;
      const next = new Set(current);
      if (open) next.add(path); else next.delete(path);
      return next;
    });
    if (open && !Object.hasOwn(entriesByDirectory, path)) void loadDirectory(path);
  }, [entriesByDirectory, loadDirectory]);

  const visible = useCallback((entry: FolderEntry) => mode === "folders" ? entry.kind === "dir" : entry.kind === "dir"
    || extensions.length === 0
    || extensions.some((extension) => extensionOf(entry.name) === extension.toLowerCase()), [extensions, mode]);

  const nodes = useMemo(() => {
    const buildDirectory = (directory: string): TreeNode[] => {
      const rows: TreeNode[] = [];
      if (directory && loadingDirectories.has(directory) && !Object.hasOwn(entriesByDirectory, directory)) rows.push({
        id: `loading:${directory}`, label: "불러오는 중", selectable: false, content: <StatusText>불러오는 중</StatusText>,
      });
      if (directory && errors[directory]) rows.push({
        id: `error:${directory}`, label: errors[directory], selectable: false, content: <span className="ks-inline-error" role="alert">{errors[directory]}</span>,
      });
      if (creating?.directory === directory) rows.push({
        id: `creating:${directory}`,
        label: "새 파일 이름",
        selectable: false,
        interactiveContent: true,
        content: <div className="ks-file-tree-entry">
          <div className="ks-row ks-file-tree-row ks-file-tree-create-row">
            <span aria-hidden="true" className="ks-file-tree-icon"><FileText size="inline" /></span>
            <TextInput
              key={`${directory}:${creating.attempt}`}
              aria-label="새 파일 이름"
              onCancel={() => setCreating(null)}
              onCommit={(name) => void commitCreate(name)}
              value={creating.initialName}
            />
          </div>
          {creating.error ? <span className="ks-inline-error" role="alert">{creating.error}</span> : null}
        </div>,
      });
      for (const entry of (entriesByDirectory[directory] ?? []).filter(visible)) {
        const isDirectory = entry.kind === "dir";
        rows.push({
          id: entry.path,
          label: entry.name,
          expandable: isDirectory,
          selectable: mode === "folders" ? isDirectory : !isDirectory,
          ariaSelectable: mode === "folders",
          currentOnSelection: true,
          leading: isDirectory ? undefined : fileIcon(entry),
          data: { entry, filePath: isDirectory ? undefined : entry.path, folderPath: mode === "folders" && isDirectory ? entry.path : undefined },
          children: isDirectory ? buildDirectory(entry.path) : [],
        });
      }
      return rows;
    };
    const root: TreeNode[] = [];
    if (loadingDirectories.has("") && !Object.hasOwn(entriesByDirectory, "")) root.push({
      id: "loading:", label: "불러오는 중", selectable: false, content: <StatusText>불러오는 중</StatusText>,
    });
    if (errors[""]) root.push({ id: "error:", label: errors[""], selectable: false, content: <span className="ks-inline-error" role="alert">{errors[""]}</span> });
    return [...root, ...buildDirectory("")];
  }, [commitCreate, creating, entriesByDirectory, errors, fileIcon, loadingDirectories, mode, visible]);

  const activate = useCallback((row: TreeRowModel, action: TreeActivation) => {
    const entry = (row.node.data as { entry?: FolderEntry } | undefined)?.entry;
    if (!entry) return;
    if (entry.kind === "dir") {
      if (mode === "folders") {
        if (selectedPath !== entry.path) {
          void selectFolder(entry.path, entry);
          if (!row.expanded) setDirectoryExpanded(entry.path, true);
        } else setDirectoryExpanded(entry.path, !row.expanded);
      } else if (action.source === "enter" || action.detail !== 2) setDirectoryExpanded(entry.path, !row.expanded);
    } else if (action.source === "enter" && onFileEnter) onFileEnter(action.target, entry.path);
    else void selectFile(entry.path, entry);
  }, [mode, onFileEnter, selectFile, selectFolder, selectedPath, setDirectoryExpanded]);

  const contextMenu = useCallback((row: TreeRowModel, target: HTMLElement) => {
    const entry = (row.node.data as { entry?: FolderEntry } | undefined)?.entry;
    if (!entry || entry.kind === "dir" || !onFileContextMenu) return;
    void selectFile(entry.path, entry);
    onFileContextMenu(target, entry.path);
  }, [onFileContextMenu, selectFile]);

  const doubleClick = useCallback((row: TreeRowModel, target: HTMLElement) => {
    const entry = (row.node.data as { entry?: FolderEntry } | undefined)?.entry;
    if (entry?.kind === "file") onFileDoubleClick?.(target, entry.path);
  }, [onFileDoubleClick]);

  return (
    <div className={`ks-file-tree${pane?.collapsed ? " is-collapsed" : ""}`} ref={treeRef}>
      {pane?.collapsed ? (
        <span className="ks-file-tree-expand"><IconButton aria-label="목록 펼치기" onClick={togglePane}><PanelLeftOpen /></IconButton></span>
      ) : !hasRoot ? (
        <div className="ks-file-tree-ungranted">
          <Button onClick={pickFolder}>{permissionLabel} 고르기</Button>
          {actionError ? <span className="ks-inline-error" role="alert">{actionError}</span> : null}
        </div>
      ) : (
        <>
          <div className="ks-file-tree-header">
            <span className="ks-file-tree-root-name" title={rootName}>{rootName}</span>
            {canCreate ? <IconButton aria-label="새 파일" onClick={() => void beginCreate()}><FilePlus /></IconButton> : null}
            {scope === "folder" ? <IconButton aria-label="폴더 바꾸기" onClick={pickFolder}><FolderOpen /></IconButton> : null}
            {pane ? <span className="ks-file-tree-collapse"><IconButton aria-label="목록 접기" onClick={togglePane}><PanelLeftClose /></IconButton></span> : null}
          </div>
          <TreeView
            className="ks-file-tree-list"
            expanded={expanded}
            label={mode === "folders" ? "폴더 목록" : "파일 목록"}
            nodes={nodes}
            onActivate={activate}
            onContextMenu={onFileContextMenu ? contextMenu : undefined}
            onDoubleClick={onFileDoubleClick ? doubleClick : undefined}
            onExpandedChange={setDirectoryExpanded}
            selectedId={selectedPath}
          />
          {actionError ? <span className="ks-inline-error" role="alert">{actionError}</span> : null}
        </>
      )}
    </div>
  );
}
