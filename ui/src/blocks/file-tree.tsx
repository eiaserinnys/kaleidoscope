import type { Block } from "../contract/contract";
import type { BlockContext } from "./block-context";
import { FileBrowserTree } from "./file-browser-tree";

type FileTreeBlockData = Extract<Block, { type: "file_tree" }>;

export function FileTreeBlock({ block, context }: { block: FileTreeBlockData; context: BlockContext }) {
  const value = context.window.state[block.selected.state];
  const selectedPath = typeof value === "string" ? value : null;
  const permissionLabel = context.definition.permissions.find(
    (item) => item.module === "files" && item.id === block.root.permission,
  )?.label ?? block.root.permission;

  return (
    <FileBrowserTree
      canCreate={context.definition.permissions.some((item) =>
        item.module === "files" && item.id === block.root.permission && item.access === "readwrite")}
      context={context}
      extensions={block.extensions}
      onSelect={(path) => context.store.call({
        op: "window.set_state",
        window_id: context.window.id,
        state: { ...context.window.state, [block.on_select.set_state]: path },
      })}
      permission={block.root.permission}
      permissionLabel={permissionLabel}
      selectedPath={selectedPath}
    />
  );
}
