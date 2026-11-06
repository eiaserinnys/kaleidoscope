import { useCallback, useMemo } from "react";
import { useBlockRootProps, type BlockRootProps } from "../comments/block-root";
import type { Block, FolderEntry } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { useShellSelector } from "../core/shell-store";
import { useDormant, useOptionalWindowData } from "../data/window-data";
import { patchWindowState, useWindowStateValue, useWindowVisible } from "../data/window-state";
import type { BlockContext } from "./block-context";
import { createCollectionFolderBackend } from "./folder-backend";
import { FileBrowserTree } from "./file-browser-tree";

type FolderBlockData = Extract<Block, { type: "folder" }> & { legacyTreeRoot?: boolean };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function FolderBlock({ block, context, pointer }: { block: FolderBlockData; context: BlockContext; pointer: string }) {
  const rootProps = useBlockRootProps();
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
    if (!data || !block.on_select) return;
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
    return <CollectionFolder rootProps={rootProps} block={block} context={context} onSelect={selectItem} selected={selected} />;
  }

  const permission = block.root.permission;
  const permissionLabel = context.definition.permissions.find((item) => item.module === "files" && item.id === permission)?.label ?? permission;
  return <FileBrowserTree
    rootProps={rootProps}
    actionsEnabled={!legacy}
    canCreate={legacy && context.definition.permissions.some((item) =>
      item.module === "files" && item.id === permission && item.access === "readwrite")}
    context={context}
    extensions={block.extensions ?? []}
    header={block.header}
    mode="files"
    onSelect={onFileSelect}
    permission={permission}
    permissionLabel={permissionLabel}
    readOnly={block.read_only && !legacy}
    selectedStateKey={!legacy ? block.selected?.state : undefined}
    selectedPath={selected}
  />;
}

function CollectionFolder({ block, context, onSelect, selected, rootProps }: {
  rootProps: BlockRootProps;
  block: FolderBlockData;
  context: BlockContext;
  onSelect: (path: string, item: JsonValue) => unknown;
  selected: string | null;
}) {
  const entry = "entry" in block.root ? block.root.entry : "";
  const storageEntry = context.definition.storage?.entries.find((item) => item.id === entry);
  const workspaceId = useShellSelector(context.store, (snapshot) => snapshot?.shared.desktops
    .find((desktop) => desktop.id === context.window.desktop_id)?.workspace_id ?? "");
  const prefix = (storageEntry?.key ?? entry).replace("{workspace_id}", workspaceId);
  const backend = useMemo(() => createCollectionFolderBackend({
    store: context.store,
    windowId: context.window.id,
    entry,
    appId: context.window.app_id,
    prefix,
    markdown: storageEntry?.kind === "md",
    readOnly: Boolean(block.read_only),
  }), [block.read_only, context.store, context.window.app_id, context.window.id, entry, prefix, storageEntry?.kind]);
  const label = storageEntry?.label ?? entry;
  const onDocumentSelect = useCallback(async (path: string, item?: FolderEntry) => onSelect(path, (item ?? {
    name: path.split("/").at(-1) ?? path,
    path,
    kind: "file",
    ext: extensionOf(path),
    size: 0,
    modified: "",
  }) as unknown as JsonValue), [onSelect]);
  return <FileBrowserTree
    rootProps={rootProps}
    actionsEnabled
    backend={backend}
    backendLabel={label}
    canCreate={false}
    context={context}
    extensions={block.extensions ?? []}
    header={block.header}
    mode="files"
    onSelect={onDocumentSelect}
    permission={entry}
    permissionLabel={label}
    readOnly={Boolean(block.read_only)}
    selectedStateKey={block.selected?.state}
    selectedPath={selected}
  />;
}
