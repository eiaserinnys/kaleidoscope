import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Block, FileEntry } from "../contract/contract";
import { toCoreError } from "../core/core-transport";
import { Button, IconButton, StatusText } from "../components/primitives";
import { ChevronRight, FilePlus, FileText, FolderOpen, PanelLeftClose, PanelLeftOpen } from "../components/icons";
import { TextInput } from "../components/text-input";
import type { BlockContext } from "./block-context";
import { SplitPaneContext } from "./split-pane-context";

type FileTreeBlockData = Extract<Block, { type: "file_tree" }>;

interface CreatingFile {
  directory: string;
  initialName: string;
  error: string | null;
  attempt: number;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function FileTreeBlock({ block, context }: { block: FileTreeBlockData; context: BlockContext }) {
  const pane = useContext(SplitPaneContext);
  const treeRef = useRef<HTMLDivElement>(null);
  const restoreToggleFocus = useRef(false);
  useLayoutEffect(() => {
    if (!restoreToggleFocus.current) return;
    restoreToggleFocus.current = false;
    treeRef.current?.querySelector<HTMLButtonElement>(pane?.collapsed ? ".ks-file-tree-expand button" : ".ks-file-tree-collapse button")?.focus();
  }, [pane?.collapsed]);
  const togglePane = () => {
    restoreToggleFocus.current = true;
    pane?.toggle();
  };
  const { snapshot, store, window, definition } = context;
  const permission = block.root.permission;
  const grant = snapshot.device.grants.find((item) => item.window_id === window.id && item.permission === permission) ?? null;
  const rootPath = grant?.root_path ?? null;
  const permissionLabel = definition.permissions.find((item) => item.module === "files" && item.id === permission)?.label ?? permission;
  const selectedValue = window.state[block.selected.state];
  const selectedPath = typeof selectedValue === "string" ? selectedValue : null;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [entriesByDirectory, setEntriesByDirectory] = useState<Record<string, FileEntry[]>>({});
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState<CreatingFile | null>(null);
  const currentRoot = useRef<string | null>(grant?.root_path ?? null);
  const canCreate = definition.permissions.some((item) => item.module === "files" && item.id === permission && item.access === "readwrite");

  const loadDirectory = useCallback(async (directory: string) => {
    if (rootPath === null) return;
    setLoadingDirectories((current) => new Set(current).add(directory));
    setErrors((current) => {
      const next = { ...current };
      delete next[directory];
      return next;
    });
    try {
      const reply = await store.call({
        op: "files.list",
        window_id: window.id,
        permission,
        dir: directory,
      });
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
    setActionError(null);
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

  const pickFolder = async () => {
    setActionError(null);
    try {
      await store.call({ op: "files.pick_folder", window_id: window.id, permission });
    } catch (error) {
      setActionError(toCoreError(error).message);
    }
  };

  const selectFile = async (path: string) => {
    setActionError(null);
    try {
      const state = { ...window.state, [block.on_select.set_state]: path };
      await store.call({ op: "window.set_state", window_id: window.id, state });
    } catch (error) {
      setActionError(toCoreError(error).message);
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
        for (let index = 0; index < parts.length; index += 1) {
          next.add(parts.slice(0, index + 1).join("/"));
        }
      }
      return next;
    });
    if (!Object.hasOwn(entriesByDirectory, directory)) await loadDirectory(directory);
    setCreating({ directory, initialName: "", error: null, attempt: 0 });
  };

  const commitCreate = async (name: string) => {
    if (!creating) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setCreating(null);
      return;
    }
    const fileName = block.extensions.length > 0
      && !block.extensions.some((extension) => extensionOf(trimmed) === extension.toLowerCase())
      ? `${trimmed}.${block.extensions[0]}`
      : trimmed;
    const path = creating.directory ? `${creating.directory}/${fileName}` : fileName;
    const destination = creating.directory;
    try {
      await store.call({ op: "files.write", window_id: window.id, permission, path, text: "" });
      setCreating(null);
      await loadDirectory(destination);
      await selectFile(path);
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

  const visible = (entry: FileEntry) => entry.kind === "dir"
    || block.extensions.length === 0
    || block.extensions.some((extension) => extensionOf(entry.name) === extension.toLowerCase());

  const renderDirectory = (directory: string): ReactNode => (
    <>
      {creating?.directory === directory ? (
        <div className="ks-file-tree-entry" role="treeitem">
          <div className="ks-file-tree-row ks-file-tree-create-row">
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
        const isSelected = !isDirectory && selectedPath === entry.path;
        return (
          <div
            aria-expanded={isDirectory ? isExpanded : undefined}
            className="ks-file-tree-entry"
            key={entry.path}
            role="treeitem"
          >
            <button
              aria-current={isSelected ? "page" : undefined}
              className={`ks-file-tree-row${isSelected ? " is-selected" : ""}`}
              onClick={() => isDirectory ? toggleDirectory(entry.path) : void selectFile(entry.path)}
              type="button"
            >
              <span aria-hidden="true" className={`ks-file-tree-icon${isDirectory ? " is-directory" : ""}`}>
                {isDirectory
                  ? <ChevronRight className={`ks-chevron${isExpanded ? " is-expanded" : ""}`} size="inline" />
                  : <FileText size="inline" />}
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
            <IconButton aria-label="폴더 바꾸기" onClick={pickFolder}>
              <FolderOpen />
            </IconButton>
            {pane ? <span className="ks-file-tree-collapse"><IconButton aria-label="목록 접기" onClick={togglePane}><PanelLeftClose /></IconButton></span> : null}
          </div>
          <div aria-label="파일 목록" className="ks-file-tree-list" role="tree">
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
