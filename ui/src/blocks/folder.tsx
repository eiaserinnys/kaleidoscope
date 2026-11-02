import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Block, FolderEntry } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { FileText } from "../components/icons";
import { TreeView, type TreeActivation } from "../components/tree/tree-view";
import type { TreeNode, TreeRowModel } from "../components/tree/tree-model";
import { NoItems } from "./data-view-common";
import { FileBrowserTree, FolderTreeError, FolderTreeHeader } from "./file-browser-tree";
import { useDormant, useOptionalWindowData } from "../data/window-data";
import { patchWindowState, useWindowStateValue, useWindowVisible } from "../data/window-state";
import { toCoreError } from "../core/core-transport";
import type { BlockContext } from "./block-context";
import { StatusText } from "../components/primitives";
import { IconButton } from "../components/primitives";
import { PanelLeftClose, PanelLeftOpen } from "../components/icons";
import { SplitPaneContext } from "./split-pane-context";
import { collectionFolderCapabilities, type FolderBackend } from "./folder-backend";
import { useShellSelector } from "../core/shell-store";

type FolderBlockData = Extract<Block, { type: "folder" }> & { legacyTreeRoot?: boolean };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function collectionTree(items: FolderEntry[], extensions: string[]): TreeNode[] {
  return items
    .filter((item) => !extensions.length || extensions.some((extension) => extension.toLowerCase() === item.ext))
    .map((item) => ({
      id: `doc:${item.path}`,
      label: item.name,
      data: item,
      selectable: true,
      currentOnSelection: true,
      leading: <FileText size="inline" />,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "ko"));
}

export function FolderBlock({ block, context, pointer }: { block: FolderBlockData; context: BlockContext; pointer: string }) {
  const data = useOptionalWindowData();
  const selectedValue = useWindowStateValue(context, block.selected?.state ?? null);
  const selected = typeof selectedValue === "string" ? selectedValue : null;
  const legacy = Boolean(block.legacyTreeRoot);
  const windowVisible = useWindowVisible(context);
  useDormant(pointer, !windowVisible);

  const selectItem = useCallback((path: string, item: JsonValue) => {
    if (legacy) {
      const action = block.on_select;
      if (action && !Array.isArray(action) && "set_state" in action) return patchWindowState(context, { [action.set_state]: path });
      return;
    }
    if (!data) return;
    if (!block.on_select) return;
    return data.act(`${pointer}/on_select`, path, item);
  }, [block.on_select, context, data, legacy, pointer]);

  const onFileSelect = useCallback((path: string, entry?: FolderEntry) => {
    const item = entry ?? {
      name: path.split("/").at(-1) ?? path,
      path,
      kind: "file" as const,
      ext: extensionOf(path),
      size: 0,
      modified: "",
    };
    return selectItem(path, item as unknown as JsonValue);
  }, [selectItem]);

  if ("entry" in block.root) {
    return <CollectionFolder
      block={block}
      context={context}
      onSelect={selectItem}
      selected={selected}
    />;
  }

  const permission = block.root.permission;
  const permissionLabel = context.definition.permissions.find((item) => item.module === "files" && item.id === permission)?.label ?? permission;
  return <FileBrowserTree
    canCreate={legacy && context.definition.permissions.some((item) =>
      item.module === "files" && item.id === permission && item.access === "readwrite")}
    context={context}
    extensions={block.extensions ?? []}
    mode="files"
    onSelect={onFileSelect}
    permission={permission}
    permissionLabel={permissionLabel}
    readOnly={block.read_only && !legacy}
    selectedPath={selected}
  />;
}

function CollectionFolder({ block, context, onSelect, selected }: {
  block: FolderBlockData;
  context: BlockContext;
  onSelect: (path: string, item: JsonValue) => unknown;
  selected: string | null;
}) {
  const entry = "entry" in block.root ? block.root.entry : "";
  const windowVisible = useWindowVisible(context);
  const pane = useContext(SplitPaneContext);
  const treeRef = useRef<HTMLDivElement>(null);
  const restoreToggleFocus = useRef(false);
  const [items, setItems] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const nodes = useMemo(() => collectionTree(items, block.extensions ?? []), [items, block.extensions]);
  const treeNodes = useMemo(() => error
    ? [{ id: "collection-error", label: error, selectable: false, content: <FolderTreeError message={error} /> }, ...nodes]
    : nodes, [error, nodes]);
  const label = context.definition.storage?.entries.find((item) => item.id === entry)?.label ?? entry;
  const workspaceId = useShellSelector(context.store, (snapshot) => snapshot?.shared.desktops
    .find((desktop) => desktop.id === context.window.desktop_id)?.workspace_id ?? "");
  const storageEntry = context.definition.storage?.entries.find((item) => item.id === entry);
  const prefix = (storageEntry?.key ?? entry).replace("{workspace_id}", workspaceId);
  const backend = useMemo<FolderBackend>(() => {
    let bucketId = context.window.app_id;
    return {
      get identity() { return `storage:${bucketId}:${prefix}`; },
      capabilities: collectionFolderCapabilities(),
      list: async (parent) => {
        if (parent) return [];
        const reply = await context.store.call({ op: "storage.list", window_id: context.window.id, entry });
        if (reply.op !== "storage.list") throw new Error("문서 모음 응답이 올바르지 않습니다");
        bucketId = reply.result.bucket_id;
        return reply.result.items.map((item) => ({
          name: item.doc,
          path: item.doc,
          kind: "file" as const,
          ext: extensionOf(item.doc),
          size: Number(item.byte_size),
          modified: item.updated_at,
        }));
      },
    };
  }, [block.read_only, context.store, context.window.app_id, context.window.id, entry, prefix]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await backend.list(""));
    } catch (cause) {
      setError(toCoreError(cause).message);
    } finally {
      setLoading(false);
    }
  }, [backend]);

  const wasWindowVisible = useRef(false);
  const refreshPending = useRef(false);
  useEffect(() => {
    if (!windowVisible) {
      wasWindowVisible.current = false;
      return;
    }
    if (refreshPending.current || !wasWindowVisible.current) {
      wasWindowVisible.current = true;
      refreshPending.current = false;
      void refresh();
    }
    const onFocus = () => void refresh();
    globalThis.window.addEventListener("focus", onFocus);
    return () => globalThis.window.removeEventListener("focus", onFocus);
  }, [refresh, windowVisible]);

  useEffect(() => context.store.subscribeEvents((event) => {
    if (event.event !== "storage.update" || event.window_id !== context.window.id) return;
    const matchesEntry = event.update.kind === "changed"
      ? event.update.changed.item.entry_id === entry
      : event.update.kind === "moved" && event.update.moved.entry_id === entry;
    if (!matchesEntry) return;
    if (!windowVisible) {
      refreshPending.current = true;
      return;
    }
    void refresh();
  }), [context.store, context.window.id, entry, refresh, windowVisible]);

  useLayoutEffect(() => {
    if (!restoreToggleFocus.current) return;
    restoreToggleFocus.current = false;
    treeRef.current?.querySelector<HTMLButtonElement>(pane?.collapsed ? ".ks-file-tree-expand button" : ".ks-file-tree-collapse button")?.focus();
  }, [pane?.collapsed]);

  const togglePane = () => {
    restoreToggleFocus.current = true;
    pane?.toggle();
  };

  const activate = useCallback((row: TreeRowModel, _action: TreeActivation) => {
    const item = row.node.data as FolderEntry | undefined;
    if (!item || !block.on_select) return;
    void onSelect(item.path, item as unknown as JsonValue);
  }, [block.on_select, onSelect]);

  const selectedId = selected ? `doc:${selected}` : null;
  const emptyContent = loading ? <StatusText>불러오는 중</StatusText> : <NoItems />;
  return <div className={`ks-file-tree${pane?.collapsed ? " is-collapsed" : ""}`} ref={treeRef}>
    {pane?.collapsed ? <span className="ks-file-tree-expand"><IconButton aria-label="목록 펼치기" onClick={togglePane}><PanelLeftOpen /></IconButton></span> : <>
      <FolderTreeHeader label={label}>
        {pane ? <span className="ks-file-tree-collapse"><IconButton aria-label="목록 접기" onClick={togglePane}><PanelLeftClose /></IconButton></span> : null}
      </FolderTreeHeader>
      <TreeView
        className="ks-file-tree-list"
        emptyContent={emptyContent}
        expanded={EMPTY_EXPANDED}
        label={label}
        nodes={treeNodes}
        onActivate={activate}
        onExpandedChange={NO_EXPANSION}
        selectedId={selectedId}
      />
    </>}
  </div>;
}

const EMPTY_EXPANDED: ReadonlySet<string> = new Set();
const NO_EXPANSION = (_id: string, _expanded: boolean) => {};
