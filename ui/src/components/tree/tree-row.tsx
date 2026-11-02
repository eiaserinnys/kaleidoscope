import { memo, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronRight, FileText } from "../icons";
import type { TreeRowModel } from "./tree-model";

export interface TreeRowProps {
  row: TreeRowModel;
  index: number;
  start: number;
  selected: boolean;
  focused: boolean;
  measure: (element: Element | null) => void;
  onFocus: (id: string) => void;
  onKeyDown: (row: TreeRowModel, event: KeyboardEvent<HTMLButtonElement>) => void;
  onActivate: (row: TreeRowModel, event: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu?: (row: TreeRowModel, event: MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: (row: TreeRowModel, event: MouseEvent<HTMLButtonElement>) => void;
}

function TreeRowView({ row, index, start, selected, focused, measure, onFocus, onKeyDown, onActivate, onContextMenu, onDoubleClick }: TreeRowProps) {
  const { node } = row;
  return <div
    className="ks-tree-virtual-row"
    data-index={index}
    data-tree-row={row.id}
    ref={measure}
    style={{
      position: "absolute",
      top: 0,
      left: 0,
      width: "100%",
      transform: `translateY(${start}px)`,
      paddingInlineStart: row.indent,
    } as CSSProperties}
  >
    {node.content !== undefined ? <div
      className="ks-file-tree-entry"
      data-index={index}
    >{node.content}</div> : <button
      aria-current={node.currentOnSelection && selected ? "page" : undefined}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      aria-level={row.depth + 1}
      aria-posinset={row.position}
      aria-selected={node.ariaSelectable === false ? undefined : selected}
      aria-setsize={row.setSize}
      className={`ks-row ks-file-tree-row${selected ? " is-selected" : ""}${node.rowClassName ? ` ${node.rowClassName}` : ""}`}
      data-index={index}
      data-tree-id={row.id}
      data-file-path={typeof node.data === "object" && node.data !== null && "filePath" in node.data ? String(node.data.filePath) : undefined}
      data-folder-path={typeof node.data === "object" && node.data !== null && "folderPath" in node.data ? String(node.data.folderPath) : undefined}
      data-selectable={node.selectable === false ? "false" : undefined}
      onClick={(event) => onActivate(row, event)}
      onContextMenu={onContextMenu ? (event) => onContextMenu(row, event) : undefined}
      onDoubleClick={onDoubleClick ? (event) => onDoubleClick(row, event) : undefined}
      onFocus={() => onFocus(row.id)}
      onKeyDown={(event) => onKeyDown(row, event)}
      role="treeitem"
      tabIndex={focused ? 0 : -1}
      type="button"
    >
      <span aria-hidden="true" className={`ks-file-tree-icon${row.hasChildren ? " is-directory" : ""}`}>
        {row.hasChildren
          ? <ChevronRight className={`ks-chevron${row.expanded ? " is-expanded" : ""}`} size="inline" />
          : node.leading ?? <FileText size="inline" />}
      </span>
      <span className="ks-file-tree-name ks-tree-name">{node.label}</span>
      {node.meta ? <span className="ks-view-meta">{node.meta}</span> : null}
      {node.trailing}
    </button>}
  </div>;
}

export const TreeRow = memo(TreeRowView);
