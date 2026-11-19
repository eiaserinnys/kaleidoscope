import { memo, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
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
  dropPosition?: "before" | "after";
  draggable?: boolean;
  focused: boolean;
  menuTarget?: boolean;
  checkEnabled?: boolean;
  /** 그림 트리(항목 가운데 그림이 하나라도 있는 트리). 모든 줄이 화살표 열(확인 모드면 확인 상자 열도) 다음에 그림 열을 같은 차례로 둔다. */
  imageColumn?: boolean;
  /** 그림 트리에 subtitle이 있는 항목이 하나라도 있으면 그림 열을 목록 줄 그림과 같은 크기로 그린다. */
  largeImage?: boolean;
  measure: (element: Element | null) => void;
  onFocus: (id: string) => void;
  onKeyDown: (row: TreeRowModel, event: KeyboardEvent<HTMLButtonElement>) => void;
  onActivate: (row: TreeRowModel, event: MouseEvent<HTMLButtonElement>) => void;
  onCheck?: (row: TreeRowModel) => void;
  onToggleExpand?: (row: TreeRowModel) => void;
  onContextMenu?: (row: TreeRowModel, event: MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: (row: TreeRowModel, event: MouseEvent<HTMLButtonElement>) => void;
}

/** 트리 줄의 표식 열. 보통 줄과 바로 입력 줄이 같은 함수로 그려 같은 깊이의 제목 x와 열 크기가 같다(카드 #1729 S9). */
export function treeRowColumns({ chevron, check, marker, image, hasChildren = false, checkEnabled = false, imageColumn = false, largeImage = false }: {
  chevron?: ReactNode;
  check?: ReactNode;
  /** 그림 트리가 아닐 때 화살표 자리 다음(자식 없는 줄은 대신)에 두는 표식: 확인 상자나 잎 아이콘. */
  marker?: ReactNode;
  image?: ReactNode;
  hasChildren?: boolean;
  checkEnabled?: boolean;
  imageColumn?: boolean;
  largeImage?: boolean;
}): ReactNode {
  const iconClass = `ks-file-tree-icon${hasChildren ? " is-directory" : ""}`;
  // 그림 트리: 모든 줄이 화살표 열, (확인 모드면) 확인 상자 열, 그림 열을 같은 차례로 두어 같은 깊이의 제목 x가 같다.
  // 자식 없는 줄의 화살표 자리, 확인 상자 없는 줄의 확인 상자 자리, 그림 없는 항목의 그림 자리는 같은 크기의 빈 칸이다.
  if (imageColumn) {
    return <>
      <span aria-hidden="true" className={iconClass}>{chevron}</span>
      {checkEnabled ? <span aria-hidden="true" className={iconClass}>{check}</span> : null}
      <span aria-hidden="true" className={`${iconClass} is-image${largeImage ? " is-large" : ""}`}>{image}</span>
    </>;
  }
  // 그림이 없는 트리: 확인 상자가 없는 부모 행은 확인 모드가 아닐 때처럼 화살표 한 열만 두고 제목을 바로 잇는다.
  // 확인 상자가 있는 행과 확인 상자가 없는 잎 행은 화살표 열 다음에 표식 열을 둔다.
  const twoColumns = checkEnabled && !(check === undefined && hasChildren);
  return twoColumns ? <>
    <span aria-hidden="true" className={iconClass}>{chevron}</span>
    <span aria-hidden="true" className={iconClass}>{marker}</span>
  </> : <span aria-hidden="true" className={iconClass}>{chevron ?? marker}</span>;
}

function TreeRowView({ row, commentKey, index, start, selected, multiSelected, dropState, dropPosition, draggable, focused, menuTarget = false, checkEnabled = false, imageColumn = false, largeImage = false, measure, onFocus, onKeyDown, onActivate, onCheck, onToggleExpand, onContextMenu, onDoubleClick }: TreeRowProps) {
  const { node } = row;
  const check = node.checked !== undefined
    ? <span
      className={`ks-tree-check${node.checked ? " is-checked" : ""}`}
      data-tree-check=""
      onClick={checkEnabled ? (event) => { event.preventDefault(); event.stopPropagation(); onCheck?.(row); } : undefined}
    >{node.checked ? <Check size="chrome" /> : null}</span>
    : undefined;
  const image = node.leadingImage;
  const marker = check ?? (row.hasChildren ? undefined : image ?? node.leading ?? <FileText size="inline" />);
  const chevron = row.hasChildren
    ? <span
      className="ks-tree-chevron-trigger"
      onClick={checkEnabled ? (event) => { event.preventDefault(); event.stopPropagation(); onToggleExpand?.(row); } : undefined}
    ><ChevronRight className={`ks-chevron${row.expanded ? " is-expanded" : ""}`} size="inline" /></span>
    : undefined;
  const columns = treeRowColumns({ chevron, check, marker, image, hasChildren: row.hasChildren, checkEnabled, imageColumn, largeImage });
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
      data-drop-state={dropPosition === undefined ? dropState : undefined}
      data-drop-position={dropPosition}
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
      {columns}
      {node.subtitle === undefined
        ? <span className={`ks-file-tree-name ks-tree-name${node.checked ? " is-checked" : ""}`}>{node.label}</span>
        : <span className="ks-tree-title-block">
          <span className={`ks-file-tree-name ks-tree-name${node.checked ? " is-checked" : ""}`}>{node.label}</span>
          <span className="ks-view-meta ks-tree-subtitle">{node.subtitle}</span>
        </span>}
      {node.meta ? <span className="ks-view-meta">{node.meta}</span> : null}
      {node.trailing}
    </button>}
  </div>;
}

export const TreeRow = memo(TreeRowView);
