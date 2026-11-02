import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { FolderEntry } from "../contract/contract";
import { toCoreError } from "../core/core-transport";
import { Button, IconButton, StatusText } from "../components/primitives";
import { FilePlus, FileText, FolderOpen, PanelLeftClose, PanelLeftOpen } from "../components/icons";
import { TextInput } from "../components/text-input";
import { TreeView } from "../components/tree/tree-view";
import type { TreeActivation, TreeFocusController } from "../components/tree/tree-view";
import type { TreeNode, TreeRowModel } from "../components/tree/tree-model";
import type { BlockContext } from "./block-context";
import { SplitPaneContext } from "./split-pane-context";
import { patchWindowState, readWindowState, useWindowGrant, useWindowVisible } from "../data/window-state";
import { useShellSelector } from "../core/shell-store";
import { createFileFolderBackend, type FolderBackend } from "./folder-backend";
import { useFolderActions } from "./folder-actions";

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
  backend?: FolderBackend;
  backendLabel?: string;
  actionsEnabled?: boolean;
  selectedStateKey?: string;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

const defaultFileIcon = (_entry: FolderEntry) => <FileText size="inline" />;

export function FolderTreeHeader({ label, children }: { label: string; children?: ReactNode }) {
  return <div className="ks-file-tree-header">
    <span className="ks-file-tree-root-name" title={label}>{label}</span>
    {children}
  </div>;
}

export function FolderTreeError({ message }: { message: string }) {
  return <span className="ks-inline-error" role="alert">{message}</span>;
}

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
  backend: providedBackend,
  backendLabel,
  actionsEnabled = false,
  selectedStateKey,
}: FileBrowserTreeProps) {
  const pane = useContext(SplitPaneContext);
  const treeRef = useRef<HTMLDivElement>(null);
  const focusController = useRef<TreeFocusController | null>(null);
  const restoreToggleFocus = useRef(false);
  const { store, window } = context;
  const grant = useWindowGrant(context, permission) ?? null;
  const windowVisible = useWindowVisible(context);
  const pcAccess = useShellSelector(store, (snapshot) => scope === "pc" && Boolean(snapshot?.device.pc_access.some(
    (item) => item.app_id === window.app_id && item.permission === permission,
  )));
  const declaration = context.definition.permissions.find((item) => item.module === "files" && item.id === permission);
  const permissionAccess = declaration?.module === "files" ? declaration.access : undefined;
  const rootPath = scope === "pc" ? pcAccess ? "" : null : grant?.root_path ?? null;
  const backend = useMemo(() => providedBackend ?? createFileFolderBackend({
    store,
    windowId: window.id,
    permission,
    appId: window.app_id,
    rootPath: rootPath ?? "",
    writable: permissionAccess === "readwrite",
    scope,
    readOnly,
  }), [permission, permissionAccess, providedBackend, readOnly, rootPath, scope, store, window.id]);
  const collection = backend.kind === "collection";
  const activeRoot = collection ? "" : rootPath;
  const hasRoot = collection || (scope === "pc" ? pcAccess : grant !== null);
  const rootName = backendLabel ?? (scope === "pc" ? permissionLabel : grant?.root_name ?? "");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [entriesByDirectory, setEntriesByDirectory] = useState<Record<string, FolderEntry[]>>({});
  const entriesByDirectoryRef = useRef(entriesByDirectory);
  entriesByDirectoryRef.current = entriesByDirectory;
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [localActionError, setLocalActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState<CreatingFile | null>(null);
  const currentRoot = useRef<string>(`${backend.identity}\0${activeRoot ?? "<none>"}`);
  const staleDirectories = useRef(new Set<string>());
  const refreshPending = useRef(false);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
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
    if (activeRoot === null) return;
    setLoadingDirectories((current) => new Set(current).add(directory));
    setErrors((current) => {
      const next = { ...current };
      delete next[directory];
      return next;
    });
    try {
      const entries = await backend.list(directory);
      if (currentRoot.current === `${backend.identity}\0${activeRoot}`) {
        setEntriesByDirectory((current) => ({ ...current, [directory]: entries }));
      }
    } catch (error) {
      if (currentRoot.current === `${backend.identity}\0${activeRoot}`) {
        setErrors((current) => ({ ...current, [directory]: toCoreError(error).message }));
      }
    } finally {
      if (currentRoot.current === `${backend.identity}\0${activeRoot}`) {
        setLoadingDirectories((current) => {
          const next = new Set(current);
          next.delete(directory);
          return next;
        });
      }
    }
  }, [activeRoot, backend]);

  useEffect(() => {
    currentRoot.current = `${backend.identity}\0${activeRoot ?? "<none>"}`;
    setEntriesByDirectory({});
    setErrors({});
    setLoadingDirectories(new Set());
    reportActionError(null);
    setCreating(null);
    staleDirectories.current.clear();
    refreshPending.current = false;
    if (activeRoot !== null) {
      setExpanded(new Set([""]));
      void loadDirectory("");
    } else {
      setExpanded(new Set());
    }
  }, [activeRoot, backend.identity, loadDirectory]);

  const refreshExpanded = useCallback(() => {
    if (activeRoot === null) return;
    for (const directory of expanded) {
      staleDirectories.current.delete(directory);
      void loadDirectory(directory);
    }
    refreshPending.current = false;
  }, [activeRoot, expanded, loadDirectory]);
  const prepareDirectory = useCallback(async (directory: string) => {
    if (activeRoot === null) return;
    const directories = [""];
    if (directory) {
      const parts = directory.split("/");
      for (let index = 0; index < parts.length; index += 1) directories.push(parts.slice(0, index + 1).join("/"));
    }
    setExpanded((current) => new Set([...current, ...directories]));
    await Promise.all(directories.filter((item) => !Object.hasOwn(entriesByDirectoryRef.current, item) || staleDirectories.current.has(item)).map((item) => {
      staleDirectories.current.delete(item);
      return loadDirectory(item);
    }));
  }, [activeRoot, loadDirectory]);
  const wasWindowVisible = useRef(windowVisible);

  useEffect(() => {
    if (!windowVisible) {
      wasWindowVisible.current = false;
      return;
    }
    if (!wasWindowVisible.current || refreshPending.current) {
      wasWindowVisible.current = true;
      refreshExpanded();
    }
    globalThis.window.addEventListener("focus", refreshExpanded);
    return () => globalThis.window.removeEventListener("focus", refreshExpanded);
  }, [refreshExpanded, windowVisible]);

  useEffect(() => store.subscribeEvents((event) => {
    if (!backend.matchesEvent(event)) return;
    if (collection) {
      if (event.event !== "storage.update" || event.update.kind === "snapshot") return;
      const update = event.update;
      if (selectedStateKey) {
        const stored = readWindowState(context)[selectedStateKey];
        const selected = typeof stored === "string" ? stored : null;
        let next = selected;
        if (update.kind === "moved" && next === update.moved.from_doc) next = update.moved.to_doc;
        if (update.kind === "changed" && !update.changed.item.exists) {
          const prefix = backend.prefix ? `${backend.prefix}/` : "";
          const doc = update.changed.item.key.startsWith(prefix) ? update.changed.item.key.slice(prefix.length) : null;
          if (doc !== null && next === doc) next = null;
        }
        if (next !== selected) void patchWindowState(context, { [selectedStateKey]: next });
      }
      if (!windowVisible) {
        refreshPending.current = true;
        staleDirectories.current.add("");
      } else {
        staleDirectories.current.delete("");
        void loadDirectory("");
      }
      return;
    }
    if (event.event !== "files.changed") return;
    const changes = event.changes;
    const isUnder = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
    const remap = (path: string, from: string, to: string) => isUnder(path, from) ? `${to}${path.slice(from.length)}` : path;
    if (selectedStateKey) {
      const stored = readWindowState(context)[selectedStateKey];
      const selected = typeof stored === "string" ? stored : null;
      let next = selected;
      for (const change of changes) {
        if (!change.from) continue;
        if (change.to) next = next === null ? null : remap(next, change.from, change.to);
        else if (next !== null && isUnder(next, change.from)) next = null;
      }
      if (next !== selected) void patchWindowState(context, { [selectedStateKey]: next });
    }
    const movedDirectories = changes.filter((change) => {
      if (!change.from || !change.to) return false;
      return Object.values(entriesByDirectoryRef.current).some((items) => items.some((item) => item.path === change.from && item.kind === "dir"));
    });
    for (const move of movedDirectories) {
      if (!move.from || !move.to) continue;
      setExpanded((current) => new Set([...current].map((path) => remap(path, move.from!, move.to!))));
      setEntriesByDirectory((current) => {
        const next = Object.fromEntries(Object.entries(current).map(([directory, entries]) => [
          remap(directory, move.from!, move.to!),
          entries.map((item) => ({ ...item, path: remap(item.path, move.from!, move.to!) })),
        ]));
        entriesByDirectoryRef.current = next;
        return next;
      });
      staleDirectories.current = new Set([...staleDirectories.current].map((path) => remap(path, move.from!, move.to!)));
    }
    const parents = new Set<string>();
    for (const change of changes) {
      for (const path of [change.from, change.to]) {
        if (path === undefined) continue;
        const slash = path.lastIndexOf("/");
        const parent = slash < 0 ? "" : path.slice(0, slash);
        parents.add(parent);
      }
    }
    if (!windowVisible) {
      refreshPending.current = true;
      for (const directory of parents) staleDirectories.current.add(directory);
      return;
    }
    for (const directory of parents) {
      if (expandedRef.current.has(directory)) {
        staleDirectories.current.delete(directory);
        void loadDirectory(directory);
      } else staleDirectories.current.add(directory);
    }
  }), [backend, collection, context, loadDirectory, selectedStateKey, store, windowVisible]);

  useEffect(() => {
    if (collection || mode !== "folders" || !hasRoot || (scope === "folder" && !rootPath) || !selectedPath) return;
    const parts = selectedPath.split("/");
    const ancestors = [""];
    for (let index = 0; index < parts.length - 1; index += 1) ancestors.push(parts.slice(0, index + 1).join("/"));
    setExpanded((current) => new Set([...current, ...ancestors]));
    void (async () => {
      for (const directory of ancestors) {
        if (!Object.hasOwn(entriesByDirectoryRef.current, directory)) await loadDirectory(directory);
      }
    })();
  }, [collection, hasRoot, loadDirectory, mode, rootPath, scope, selectedPath]);

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
    if (open && (!Object.hasOwn(entriesByDirectory, path) || staleDirectories.current.has(path))) {
      staleDirectories.current.delete(path);
      void loadDirectory(path);
    }
  }, [entriesByDirectory, loadDirectory]);

  const refreshDirectory = useCallback((directory: string) => {
    if (activeRoot === null) return;
    staleDirectories.current.delete(directory);
    void loadDirectory(directory);
  }, [activeRoot, loadDirectory]);
  const openItem = useCallback((item: FolderEntry) => {
    if (item.kind === "dir" && !collection) setDirectoryExpanded(item.path, !expandedRef.current.has(item.path));
    else void selectFile(item.path, item);
  }, [collection, selectFile, setDirectoryExpanded]);
  const isExpanded = useCallback((path: string) => expandedRef.current.has(path), []);
  const actions = useFolderActions({
    enabled: actionsEnabled,
    store,
    backend,
    extensions,
    host: () => treeRef.current?.closest<HTMLElement>(".ks-data-window") ?? treeRef.current,
    refreshDirectory,
    prepareDirectory,
    openItem,
    isExpanded,
    getFocusController: () => focusController.current,
  });

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
        id: `error:${directory}`, label: errors[directory], selectable: false, content: <FolderTreeError message={errors[directory]} />,
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
        if (actionsEnabled && actions.inlineEdit?.kind === "rename" && actions.inlineEdit.path === entry.path) {
          rows.push({
            id: collection ? `doc:${entry.path}` : entry.path,
            label: `이름 바꾸기 ${entry.name}`,
            expandable: entry.kind === "dir",
            selectable: false,
            interactiveContent: true,
            content: actions.inlineRow(directory, entry.path),
            children: !collection && entry.kind === "dir" ? buildDirectory(entry.path) : [],
          });
          continue;
        }
        const isDirectory = entry.kind === "dir";
        const nodeId = collection ? `doc:${entry.path}` : entry.path;
        rows.push({
          id: nodeId,
          label: entry.name,
          expandable: isDirectory,
          selectable: collection ? true : mode === "folders" ? isDirectory : !isDirectory,
          ariaSelectable: mode === "folders",
          currentOnSelection: true,
          leading: isDirectory ? undefined : fileIcon(entry),
          data: { entry, filePath: isDirectory ? undefined : entry.path, folderPath: mode === "folders" && isDirectory ? entry.path : undefined },
          rowClassName: actionsEnabled && actions.isCutPath(entry.path) ? "is-cut" : undefined,
          children: !collection && isDirectory ? buildDirectory(entry.path) : [],
        });
      }
      if (actionsEnabled && actions.inlineEdit?.kind !== "rename" && actions.inlineEdit?.directory === directory) {
        rows.push({
          id: `folder-edit:${directory}`,
          label: actions.inlineEdit.initialName,
          selectable: false,
          interactiveContent: true,
          content: actions.inlineRow(directory),
        });
      }
      if (actionsEnabled && !collection && directory && expanded.has(directory) && Object.hasOwn(entriesByDirectory, directory)
        && entriesByDirectory[directory].length === 0
        && !(actions.inlineEdit && actions.inlineEdit.directory === directory)) {
        rows.push({
          id: `empty:${directory}`,
          label: "비어 있음",
          selectable: false,
          data: { directoryPath: directory },
          content: <div className="ks-file-tree-empty"><span aria-hidden="true" className="ks-file-tree-icon" /><span className="ks-view-meta">비어 있음</span></div>,
        });
      }
      return rows;
    };
    const root: TreeNode[] = [];
    if (loadingDirectories.has("") && !Object.hasOwn(entriesByDirectory, "")) root.push({
      id: "loading:", label: "불러오는 중", selectable: false, content: <StatusText>불러오는 중</StatusText>,
    });
    if (errors[""]) root.push({ id: "error:", label: errors[""], selectable: false, content: <FolderTreeError message={errors[""]} /> });
    return [...root, ...buildDirectory("")];
  }, [actions, actionsEnabled, collection, commitCreate, creating, entriesByDirectory, errors, expanded, fileIcon, loadingDirectories, mode, visible]);

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

  const contextMenu = useCallback((row: TreeRowModel | null, target: HTMLElement, point: { x: number; y: number }, focus: TreeFocusController) => {
    if (actionsEnabled) {
      actions.onContextMenu(row, target, point, focus);
      return;
    }
    if (!row) return;
    const entry = (row.node.data as { entry?: FolderEntry } | undefined)?.entry;
    if (!entry || entry.kind === "dir" || !onFileContextMenu) return;
    void selectFile(entry.path, entry);
    onFileContextMenu(target, entry.path);
  }, [actions, actionsEnabled, onFileContextMenu, selectFile]);

  const commandKeyDown = useCallback((row: TreeRowModel | null, event: KeyboardEvent<HTMLElement>, focus: TreeFocusController) => {
    return actionsEnabled ? actions.commandKeyDown(row, event, focus) : false;
  }, [actions, actionsEnabled]);

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
          {actionError ? <FolderTreeError message={actionError} /> : null}
        </div>
      ) : (
        <>
          <FolderTreeHeader label={rootName}>
            {(canCreate || (actionsEnabled && backend.capabilities.createFile)) ? <IconButton aria-label="새 파일" onClick={() => actionsEnabled ? void actions.beginCreateFile("", focusController.current) : void beginCreate()}><FilePlus /></IconButton> : null}
            {!collection && scope === "folder" ? <IconButton aria-label="폴더 바꾸기" onClick={pickFolder}><FolderOpen /></IconButton> : null}
            {pane ? <span className="ks-file-tree-collapse"><IconButton aria-label="목록 접기" onClick={togglePane}><PanelLeftClose /></IconButton></span> : null}
          </FolderTreeHeader>
          <TreeView
            className="ks-file-tree-list"
            expanded={expanded}
            label={mode === "folders" ? "폴더 목록" : "파일 목록"}
            nodes={nodes}
            emptyContent={actionsEnabled && collection && backend.capabilities.createFile
              ? <Button onClick={() => actions.beginCreateFile("", focusController.current)}>새 문서</Button>
              : undefined}
            onActivate={activate}
            onContextMenu={actionsEnabled || onFileContextMenu ? contextMenu : undefined}
            onCommandKeyDown={actionsEnabled ? commandKeyDown : undefined}
            onDoubleClick={onFileDoubleClick ? doubleClick : undefined}
            onExpandedChange={setDirectoryExpanded}
            onFocusController={(controller) => { focusController.current = controller; }}
            menuTargetId={actions.menuTargetId}
            selectedId={collection && selectedPath ? `doc:${selectedPath}` : selectedPath}
          />
          {actionError ? <FolderTreeError message={actionError} /> : null}
          {actionsEnabled ? actions.noticeNode : null}
        </>
      )}
      {actionsEnabled ? actions.menuElement : null}
      {actionsEnabled ? actions.dialogElement : null}
    </div>
  );
}
