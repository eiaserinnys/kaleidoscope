import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { isValidElement } from "react";
import { useVirtualRows, VirtualSurface } from "../../blocks/data-view-common";
import type { TreeNode, TreeRowModel } from "./tree-model";
import { flattenTreeModel } from "./tree-model";
import { TreeRow } from "./tree-row";
import type { ReactNode } from "react";

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (isValidElement(left) && isValidElement(right)) {
    if (left.type !== right.type) return false;
    const leftProps = left.props as Record<string, unknown>;
    const rightProps = right.props as Record<string, unknown>;
    const keys = Object.keys(leftProps);
    return keys.length === Object.keys(rightProps).length
      && keys.every((key) => Object.is(leftProps[key], rightProps[key]));
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = Object.keys(leftRecord);
    return keys.length === Object.keys(rightRecord).length
      && keys.every((key) => Object.is(leftRecord[key], rightRecord[key]));
  }
  return false;
}

function sameNode(left: TreeRowModel["node"], right: TreeRowModel["node"]): boolean {
  return left.id === right.id
    && left.label === right.label
    && left.expandable === right.expandable
    && left.selectable === right.selectable
    && left.ariaSelectable === right.ariaSelectable
    && left.currentOnSelection === right.currentOnSelection
    && sameValue(left.leading, right.leading)
    && sameValue(left.meta, right.meta)
    && sameValue(left.trailing, right.trailing)
    && sameValue(left.content, right.content)
    && sameValue(left.data, right.data);
}

function sameRow(left: TreeRowModel, right: TreeRowModel): boolean {
  return left.id === right.id
    && left.parentId === right.parentId
    && left.depth === right.depth
    && left.expanded === right.expanded
    && left.hasChildren === right.hasChildren
    && left.position === right.position
    && left.setSize === right.setSize
    && left.indent === right.indent
    && sameNode(left.node, right.node);
}

export interface TreeActivation {
  source: "click" | "enter";
  target: HTMLElement;
  detail?: number;
}

export interface TreeViewProps {
  nodes: TreeNode[];
  expanded: ReadonlySet<string>;
  selectedId?: string | null;
  label: string;
  className: string;
  emptyContent?: ReactNode;
  onExpandedChange: (id: string, expanded: boolean) => void;
  onActivate: (row: TreeRowModel, activation: TreeActivation) => void;
  onContextMenu?: (row: TreeRowModel, target: HTMLElement) => void;
  onDoubleClick?: (row: TreeRowModel, target: HTMLElement) => void;
}

export function TreeView({ nodes, expanded, selectedId, label, className, emptyContent, onExpandedChange, onActivate, onContextMenu, onDoubleClick }: TreeViewProps) {
  const previousRows = useRef(new Map<string, TreeRowModel>());
  const flat = useMemo(() => {
    const nextRows = new Map<string, TreeRowModel>();
    const stable = flattenTreeModel(nodes, expanded).map((row) => {
      const previous = previousRows.current.get(row.id);
      const result = previous && sameRow(previous, row) ? previous : row;
      nextRows.set(row.id, result);
      return result;
    });
    previousRows.current = nextRows;
    return stable;
  }, [nodes, expanded]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const selectedRow = flat.find((row) => row.node.selectable !== false && row.node.id === selectedId);
  const preferredFocus = selectedRow?.id ?? flat[0]?.id ?? null;
  const effectiveFocus = flat.some((row) => row.id === focusId) ? focusId : preferredFocus;
  const token = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ks-control-height"));
  if (!Number.isFinite(token) || token <= 0) throw new Error("트리 행 높이 토큰 --ks-control-height을 읽을 수 없습니다");
  const { virtual } = useVirtualRows(flat.length, token, scrollRef);

  const moveFocus = useCallback((index: number) => {
    const next = flat[Math.max(0, Math.min(flat.length - 1, index))];
    if (!next) return;
    setFocusId(next.id);
    setPendingFocus(next.id);
    virtual.scrollToIndex(flat.indexOf(next), { align: "auto" });
  }, [flat, virtual]);

  const handlers = useRef({ onActivate, onContextMenu, onDoubleClick, onExpandedChange, flat, expanded, moveFocus });
  handlers.current = { onActivate, onContextMenu, onDoubleClick, onExpandedChange, flat, expanded, moveFocus };

  const onFocus = useCallback((id: string) => setFocusId(id), []);
  const activate = useCallback((row: TreeRowModel, event: MouseEvent<HTMLButtonElement>) => {
    handlers.current.onActivate(row, { source: "click", target: event.currentTarget, detail: event.detail });
  }, []);
  const contextMenu = useCallback((row: TreeRowModel, event: MouseEvent<HTMLButtonElement>) => {
    if (!handlers.current.onContextMenu) return;
    event.preventDefault();
    handlers.current.onContextMenu(row, event.currentTarget);
  }, []);
  const doubleClick = useCallback((row: TreeRowModel, event: MouseEvent<HTMLButtonElement>) => handlers.current.onDoubleClick?.(row, event.currentTarget), []);

  const previousScrolledSelection = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedRow) {
      previousScrolledSelection.current = null;
      return;
    }
    if (previousScrolledSelection.current === selectedRow.id) return;
    previousScrolledSelection.current = selectedRow.id;
    virtual.scrollToIndex(flat.indexOf(selectedRow), { align: "auto" });
  }, [flat, selectedRow, virtual]);

  const keyDown = useCallback((row: TreeRowModel, event: KeyboardEvent<HTMLButtonElement>) => {
    const { flat, expanded, moveFocus } = handlers.current;
    const index = flat.findIndex((item) => item.id === row.id);
    if (event.key === "ArrowDown") moveFocus(index + 1);
    else if (event.key === "ArrowUp") moveFocus(index - 1);
    else if (event.key === "ArrowRight" && row.hasChildren) {
      if (!expanded.has(row.id)) handlers.current.onExpandedChange(row.id, true);
      else {
        const child = flat[index + 1];
        if (child?.parentId === row.id) moveFocus(index + 1);
      }
    } else if (event.key === "ArrowLeft") {
      if (row.expanded) handlers.current.onExpandedChange(row.id, false);
      else if (row.parentId) {
        const parentIndex = flat.findIndex((item) => item.id === row.parentId);
        if (parentIndex >= 0) moveFocus(parentIndex);
      }
    } else if (event.key === "Enter") {
      handlers.current.onActivate(row, { source: "enter", target: event.currentTarget });
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useEffect(() => {
    if (!pendingFocus) return;
    const row = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>("[data-tree-row]") ?? [])
      .find((element) => element.dataset.treeRow === pendingFocus)
      ?.querySelector<HTMLElement>("[role=treeitem]");
    if (!row) return;
    row.focus();
    setPendingFocus(null);
  });

  const virtualRows = virtual.getVirtualItems();
  return <div
    aria-label={label}
    aria-rowcount={flat.length}
    className={className}
    ref={scrollRef}
    role="tree"
  >
    {flat.length === 0 && emptyContent}
    <VirtualSurface virtual={virtual}>
      {virtualRows.map((item) => {
        const row = flat[item.index];
        return <TreeRow
          focused={effectiveFocus === row.id}
          index={item.index}
          start={item.start}
          key={row.id}
          measure={virtual.measureElement}
          onActivate={activate}
          onContextMenu={onContextMenu ? contextMenu : undefined}
          onDoubleClick={onDoubleClick ? doubleClick : undefined}
          onFocus={onFocus}
          onKeyDown={keyDown}
          row={row}
          selected={row.node.selectable !== false && row.node.id === selectedId}
        />;
      })}
    </VirtualSurface>
  </div>;
}
