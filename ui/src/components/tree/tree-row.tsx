import { memo, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { Check, ChevronRight, FileText } from "../icons";
import type { TreeRowModel } from "./tree-model";

export interface TreeRowProps {
  row: TreeRowModel;
  commentKey?: string;
  index: number;
  start: number;
  selected: boolean;
  multiSelected?: boolean;
  dropState?: "valid" | "invalid";
  draggable?: boolean;
  focused: boolean;
  menuTarget?: boolean;
  checkEnabled?: boolean;
  measure: (element: Element | null) => void;
  onFocus: (id: string) => void;
  onKeyDown: (row: TreeRowModel, event: KeyboardEvent<HTMLButtonElement>) => void;
  onActivate: (row: TreeRowModel, event: MouseEvent<HTMLButtonElement>) => void;
  onCheck?: (row: TreeRowModel) => void;
  onToggleExpand?: (row: TreeRowModel) => void;
  onContextMenu?: (row: TreeRowModel, event: MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: (row: TreeRowModel, event: MouseEvent<HTMLButtonElement>) => void;
}

function TreeRowView({ row, commentKey, index, start, selected, multiSelected, dropState, draggable, focused, menuTarget = false, checkEnabled = false, measure, onFocus, onKeyDown, onActivate, onCheck, onToggleExpand, onContextMenu, onDoubleClick }: TreeRowProps) {
  const { node } = row;
  const check = node.checked !== undefined
    ? <span
      className={`ks-tree-check${node.checked ? " is-checked" : ""}`}
      data-tree-check=""
      onClick={checkEnabled ? (event) => { event.preventDefault(); event.stopPropagation(); onCheck?.(row); } : undefined}
    >{node.checked ? <Check size="chrome" /> : null}</span>
    : undefined;
  const marker = check ?? (row.hasChildren ? undefined : node.leading ?? <FileText size="inline" />);
  const chevron = row.hasChildren
    ? <span
      className="ks-tree-chevron-trigger"
      onClick={checkEnabled ? (event) => { event.preventDefault(); event.stopPropagation(); onToggleExpand?.(row); } : undefined}
    ><ChevronRight className={`ks-chevron${row.expanded ? " is-expanded" : ""}`} size="inline" /></span>
    : undefined;
  const iconClass = `ks-file-tree-icon${row.hasChildren ? " is-directory" : ""}`;
  // 확인 상자가 없는 부모 행은 확인 모드가 아닐 때처럼 화살표 한 열만 두고 제목을 바로 잇는다. 확인 상자가 있는 행과
  // 확인 상자가 없는 잎 행은 화살표 열 다음에 표식 열을 둔다.
  const twoColumns = checkEnabled && !(check === undefined && row.hasChildren);
  return <div
    className="ks-tree-virtual-row"
    data-index={index}
    data-tree-row={row.id}
    data-ks-comment-key={commentKey}
    data-drop-state={node.content !== undefined ? dropState : undefined}
    data-menu-target={menuTarget && node.content !== undefined ? "" : undefined}
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
      aria-checked={node.checked}
      aria-current={node.currentOnSelection && selected ? "page" : undefined}
      aria-disabled={node.checked !== undefined && !checkEnabled ? true : undefined}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      aria-level={row.depth + 1}
      aria-posinset={row.position}
      aria-selected={multiSelected !== undefined ? multiSelected : node.ariaSelectable === false ? undefined : selected}
      aria-setsize={row.setSize}
      className={`ks-row ks-file-tree-row${multiSelected === undefined ? selected ? " is-selected" : "" : `${multiSelected ? " is-selected" : ""}${selected ? " is-open-file" : ""}`}${node.rowClassName ? ` ${node.rowClassName}` : ""}`}
      data-drop-state={dropState}
      draggable={draggable || undefined}
      data-menu-target={menuTarget && node.content === undefined ? "" : undefined}
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
      {twoColumns ? <>
        <span aria-hidden="true" className={iconClass}>{chevron}</span>
        <span aria-hidden="true" className={iconClass}>{marker}</span>
      </> : <span aria-hidden="true" className={iconClass}>{chevron ?? marker}</span>}
      <span className={`ks-file-tree-name ks-tree-name${node.checked ? " is-checked" : ""}`}>{node.label}</span>
      {node.meta ? <span className="ks-view-meta">{node.meta}</span> : null}
      {node.trailing}
    </button>}
  </div>;
}

export const TreeRow = memo(TreeRowView);
