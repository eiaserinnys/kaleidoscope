import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Block, FileEntry } from "../contract/contract";
import { toCoreError } from "../core/core-transport";
import { Button, IconButton, StatusText } from "../components/primitives";
import type { BlockContext } from "./block-context";
import { SplitPaneContext } from "./split-pane-context";

type FileTreeBlockData = Extract<Block, { type: "file_tree" }>;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function FileTreeBlock({ block, context }: { block: FileTreeBlockData; context: BlockContext }) {
  const pane = useContext(SplitPaneContext);
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
  const currentRoot = useRef<string | null>(grant?.root_path ?? null);

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
                {isDirectory ? <Chevron expanded={isExpanded} /> : <FileIcon />}
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
    <div className="ks-file-tree">
      {pane?.collapsed ? (
        <IconButton aria-label="목록 펼치기" onClick={pane.toggle}><Chevron expanded={false} /></IconButton>
      ) : !grant ? (
        <div className="ks-file-tree-ungranted">
          <Button onClick={pickFolder}>{permissionLabel} 고르기</Button>
          {actionError ? <span className="ks-inline-error" role="alert">{actionError}</span> : null}
        </div>
      ) : (
        <>
          <div className="ks-file-tree-header">
            <span className="ks-file-tree-root-name" title={grant.root_name}>{grant.root_name}</span>
            {pane ? <IconButton aria-label="목록 접기" onClick={pane.toggle}><Chevron expanded={false} /></IconButton> : null}
            <IconButton aria-label="폴더 바꾸기" onClick={pickFolder}>
              <FolderChangeIcon />
            </IconButton>
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

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg aria-hidden="true" className={`ks-chevron${expanded ? " is-expanded" : ""}`} viewBox="0 0 16 16">
      <path d="m5.5 3.5 4.5 4.5-4.5 4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg aria-hidden="true" className="ks-file-icon" viewBox="0 0 16 16">
      <path d="M4 1.75h5l3 3v9.5H4z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.2" />
      <path d="M9 1.75v3h3" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.2" />
    </svg>
  );
}

function FolderChangeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M1.75 4.25h4l1.5 1.5h7v7.5h-12.5z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.2" />
      <path d="M5 9.1a2.6 2.6 0 0 1 4.6-1.5l.8.8M10 6.9v1.9H8.1M11 10.9a2.6 2.6 0 0 1-4.6 1.5l-.8-.8M6 13.1v-1.9h1.9" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.1" />
    </svg>
  );
}
