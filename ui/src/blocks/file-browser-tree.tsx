import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { FileEntry } from "../contract/contract";
import { toCoreError } from "../core/core-transport";
import { Button, IconButton, StatusText } from "../components/primitives";
import { ChevronRight, FilePlus, FileText, FolderOpen, PanelLeftClose, PanelLeftOpen } from "../components/icons";
import { TextInput } from "../components/text-input";
import type { BlockContext } from "./block-context";
import { SplitPaneContext } from "./split-pane-context";

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
  onSelect: (path: string) => void | Promise<unknown>;
  canCreate: boolean;
  mode?: "files" | "folders";
  fileIcon?: (entry: FileEntry) => ReactNode;
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

export function FileBrowserTree({
  context,
  permission,
  permissionLabel,
  extensions,
  selectedPath,
  onSelect,
  canCreate,
  mode = "files",
  fileIcon = () => <FileText size="inline" />,
  onFileDoubleClick,
  onFileEnter,
  onFileContextMenu,
  actionError: externalActionError,
  onActionError,
}: FileBrowserTreeProps) {
  const pane = useContext(SplitPaneContext);
  const treeRef = useRef<HTMLDivElement>(null);
  const restoreToggleFocus = useRef(false);
  const { snapshot, store, window } = context;
  const grant = snapshot.device.grants.find((item) => item.window_id === window.id && item.permission === permission) ?? null;
  const rootPath = grant?.root_path ?? null;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [entriesByDirectory, setEntriesByDirectory] = useState<Record<string, FileEntry[]>>({});
  const entriesByDirectoryRef = useRef(entriesByDirectory);
  entriesByDirectoryRef.current = entriesByDirectory;
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [localActionError, setLocalActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState<CreatingFile | null>(null);
  const currentRoot = useRef<string | null>(grant?.root_path ?? null);
  const actionError = externalActionError ?? localActionError;

  const reportActionError = (error: string | null) => {
    setLocalActionError(error);
    onActionError?.(error);
  };

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
      const reply = await store.call({ op: "files.list", window_id: window.id, permission, dir: directory });
      if (reply.op === "files.list" && currentRoot.current === rootPath) {
        setEntriesByDirectory((current) => ({ ...current, [directory]: reply.entries }));
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
  }, [permission, rootPath, store, window.id]);

  useEffect(() => {
    currentRoot.current = grant?.root_path ?? null;
    setEntriesByDirectory({});
    setErrors({});
    setLoadingDirectories(new Set());
    reportActionError(null);
    setCreating(null);
    if (grant) {
      setExpanded(new Set([""]));
      void loadDirectory("");
    } else {
      setExpanded(new Set());
    }
  }, [rootPath, loadDirectory]);

  useEffect(() => {
    if (rootPath === null) return;
    const refreshExpanded = () => {
      for (const directory of expanded) void loadDirectory(directory);
    };
    globalThis.window.addEventListener("focus", refreshExpanded);
    return () => globalThis.window.removeEventListener("focus", refreshExpanded);
  }, [expanded, loadDirectory, rootPath]);

  useEffect(() => {
    if (mode !== "folders" || !rootPath || !selectedPath) return;
    const parts = selectedPath.split("/");
    const ancestors = [""];
    for (let index = 0; index < parts.length - 1; index += 1) ancestors.push(parts.slice(0, index + 1).join("/"));
    setExpanded((current) => new Set([...current, ...ancestors]));
    void (async () => {
      for (const directory of ancestors) {
        if (!Object.hasOwn(entriesByDirectoryRef.current, directory)) await loadDirectory(directory);
      }
      requestAnimationFrame(() => {
        const selected = [...(treeRef.current?.querySelectorAll<HTMLElement>("[data-folder-path]") ?? [])]
          .find((entry) => entry.dataset.folderPath === selectedPath);
        selected?.scrollIntoView?.({ block: "nearest" });
      });
    })();
  }, [loadDirectory, mode, rootPath, selectedPath]);

  const pickFolder = async () => {
    reportActionError(null);
    try {
      await store.call({ op: "files.pick_folder", window_id: window.id, permission });
    } catch (error) {
      reportActionError(toCoreError(error).message);
    }
  };

  const beginCreate = async () => {
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
  };

  const commitCreate = async (name: string) => {
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
  };

  const selectFile = async (path: string) => {
    reportActionError(null);
    try {
      await onSelect(path);
    } catch (error) {
      reportActionError(toCoreError(error).message);
    }
  };

  const selectFolder = async (path: string) => {
    reportActionError(null);
    try {
      await onSelect(path);
    } catch (error) {
      reportActionError(toCoreError(error).message);
    }
  };

  const toggleDirectory = (path: string) => {
    const isOpen = expanded.has(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (isOpen) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!isOpen) void loadDirectory(path);
  };

  const visible = (entry: FileEntry) => mode === "folders" ? entry.kind === "dir" : entry.kind === "dir"
    || extensions.length === 0
    || extensions.some((extension) => extensionOf(entry.name) === extension.toLowerCase());

  const visiblePaths: string[] = [];
  const collectVisible = (directory: string) => {
    for (const entry of (entriesByDirectory[directory] ?? []).filter(visible)) {
      visiblePaths.push(entry.path);
      if (entry.kind === "dir" && expanded.has(entry.path)) collectVisible(entry.path);
    }
  };
  collectVisible("");

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || !onFileEnter) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const entry = target.closest<HTMLElement>("[data-file-path]");
    const path = entry?.dataset.filePath;
    if (!path || !(target instanceof HTMLElement)) return;
    event.preventDefault();
    onFileEnter(target, path);
  };

  const renderDirectory = (directory: string): ReactNode => (
    <>
      {creating?.directory === directory ? (
        <div className="ks-file-tree-entry" role="treeitem">
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
        </div>
      ) : null}
      {(entriesByDirectory[directory] ?? []).filter(visible).map((entry) => {
        const isDirectory = entry.kind === "dir";
        const isExpanded = expanded.has(entry.path);
        const isSelected = mode === "folders" ? isDirectory && selectedPath === entry.path : !isDirectory && selectedPath === entry.path;
        return (
          <div
            aria-expanded={isDirectory ? isExpanded : undefined}
            aria-setsize={visiblePaths.length}
            aria-posinset={visiblePaths.indexOf(entry.path) + 1}
            aria-selected={mode === "folders" ? isSelected : undefined}
            className="ks-file-tree-entry"
            data-folder-path={mode === "folders" && isDirectory ? entry.path : undefined}
            data-file-path={isDirectory ? undefined : entry.path}
            key={entry.path}
            role="treeitem"
          >
            <button
              aria-current={isSelected ? "page" : undefined}
              className={`ks-row ks-file-tree-row${isSelected ? " is-selected" : ""}`}
              onClick={(event) => {
                if (isDirectory) {
                  if (mode === "folders") {
                    if (selectedPath !== entry.path) {
                      void selectFolder(entry.path);
                      if (!isExpanded) toggleDirectory(entry.path);
                    } else {
                      toggleDirectory(entry.path);
                    }
                  } else if (event.detail !== 2) toggleDirectory(entry.path);
                } else {
                  void selectFile(entry.path);
                }
              }}
              onContextMenu={isDirectory || !onFileContextMenu ? undefined : (event) => {
                event.preventDefault();
                void selectFile(entry.path);
                onFileContextMenu(event.currentTarget, entry.path);
              }}
              onDoubleClick={isDirectory ? undefined : (event) => onFileDoubleClick?.(event.currentTarget, entry.path)}
              type="button"
            >
              <span aria-hidden="true" className={`ks-file-tree-icon${isDirectory ? " is-directory" : ""}`}>
                {isDirectory
                  ? <ChevronRight className={`ks-chevron${isExpanded ? " is-expanded" : ""}`} size="inline" />
                  : fileIcon(entry)}
              </span>
              <span className="ks-file-tree-name">{entry.name}</span>
            </button>
            {isDirectory && isExpanded ? (
              <div className="ks-file-tree-children" role="group">
                {loadingDirectories.has(entry.path) && !entriesByDirectory[entry.path]
                  ? <StatusText>불러오는 중</StatusText>
                  : null}
                {errors[entry.path] ? <span className="ks-inline-error" role="alert">{errors[entry.path]}</span> : null}
                {renderDirectory(entry.path)}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );

  return (
    <div className={`ks-file-tree${pane?.collapsed ? " is-collapsed" : ""}`} ref={treeRef}>
      {pane?.collapsed ? (
        <span className="ks-file-tree-expand"><IconButton aria-label="목록 펼치기" onClick={togglePane}><PanelLeftOpen /></IconButton></span>
      ) : !grant ? (
        <div className="ks-file-tree-ungranted">
          <Button onClick={pickFolder}>{permissionLabel} 고르기</Button>
          {actionError ? <span className="ks-inline-error" role="alert">{actionError}</span> : null}
        </div>
      ) : (
        <>
          <div className="ks-file-tree-header">
            <span className="ks-file-tree-root-name" title={grant.root_name}>{grant.root_name}</span>
            {canCreate ? <IconButton aria-label="새 파일" onClick={() => void beginCreate()}><FilePlus /></IconButton> : null}
            <IconButton aria-label="폴더 바꾸기" onClick={pickFolder}><FolderOpen /></IconButton>
            {pane ? <span className="ks-file-tree-collapse"><IconButton aria-label="목록 접기" onClick={togglePane}><PanelLeftClose /></IconButton></span> : null}
          </div>
      <div aria-label={mode === "folders" ? "폴더 목록" : "파일 목록"} className="ks-file-tree-list" onKeyDown={handleTreeKeyDown} role="tree">
            {loadingDirectories.has("") && !entriesByDirectory[""] ? <StatusText>불러오는 중</StatusText> : null}
            {errors[""] ? <span className="ks-inline-error" role="alert">{errors[""]}</span> : null}
            {renderDirectory("")}
          </div>
          {actionError ? <span className="ks-inline-error" role="alert">{actionError}</span> : null}
        </>
      )}
    </div>
  );
}
