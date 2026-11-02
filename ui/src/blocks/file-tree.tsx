import type { Block, FolderRef, SetState, StateRef } from "../contract/contract";
import type { BlockContext } from "./block-context";
import { FileBrowserTree } from "./file-browser-tree";
import { patchWindowState, useWindowStateValue } from "../data/window-state";

export type FileTreeBlockData = Extract<Block, { type: "tree" }> & { root: FolderRef; selected: StateRef; on_select: SetState };

export function FileTreeBlock({ block, context }: { block: FileTreeBlockData; context: BlockContext }) {
  const value = useWindowStateValue(context, block.selected.state);
  const selectedPath = typeof value === "string" ? value : null;
  const permissionLabel = context.definition.permissions.find(
    (item) => item.module === "files" && item.id === block.root.permission,
  )?.label ?? block.root.permission;

  return (
    <FileBrowserTree
      canCreate={context.definition.permissions.some((item) =>
        item.module === "files" && item.id === block.root.permission && item.access === "readwrite")}
      context={context}
      extensions={block.extensions ?? []}
      onSelect={(path) => patchWindowState(context, { [block.on_select.set_state]: path })}
      permission={block.root.permission}
      permissionLabel={permissionLabel}
      selectedPath={selectedPath}
    />
  );
}
