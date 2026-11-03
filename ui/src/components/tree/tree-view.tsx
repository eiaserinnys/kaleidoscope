import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { isValidElement } from "react";
import { keepRovingRow, useVirtualRows, VirtualSurface } from "../../blocks/data-view-common";
import type { TreeNode, TreeRowModel } from "./tree-model";
import { flattenTreeModel } from "./tree-model";
import { TreeRow } from "./tree-row";
import type { ReactNode } from "react";
import { SHELL_TREE_CONTROL_HEIGHT_MISSING } from "../../contract/shell-errors";
import { isUnclaimedFocus } from "../focus-rescue";

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
    && left.rowClassName === right.rowClassName
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

export interface TreeFocusController {
  row: (id: string | null, waitForRow?: boolean, select?: boolean) => void;
  visibleRow: (id: string | null) => void;
  rows: (ids: readonly string[]) => TreeRowModel[];
  deletionTargets: (row: TreeRowModel, ids?: readonly string[]) => Array<string | null>;
  afterDelete: (targets: Array<string | null>) => void;
}

export interface TreeViewProps {
  nodes: TreeNode[];
  expanded: ReadonlySet<string>;
  selectedId?: string | null;
  label: string;
  className: string;
  emptyContent?: ReactNode;
  endAction?: { label: string; leading?: ReactNode; onActivate: () => void };
  onExpandedChange: (id: string, expanded: boolean) => void;
  onActivate: (row: TreeRowModel, activation: TreeActivation) => void;
  onContextMenu?: (row: TreeRowModel | null, target: HTMLElement, point: { x: number; y: number }, focus: TreeFocusController) => void;
  onCommandKeyDown?: (row: TreeRowModel | null, event: KeyboardEvent<HTMLElement>, focus: TreeFocusController) => boolean;
  onDoubleClick?: (row: TreeRowModel, target: HTMLElement) => void;
  menuTargetId?: string | null;
  onFocusController?: (focus: TreeFocusController) => void;
  selection?: readonly string[];
  onSelectionChange?: (ids: string[]) => void;
  drag?: {
    enabled: boolean;
    targetId: string | null;
    hoveredId?: string | null;
    valid: boolean;
    onStart: (row: TreeRowModel, event: DragEvent<HTMLElement>) => void;
    onOver: (row: TreeRowModel | null, event: DragEvent<HTMLElement>) => void;
    onDrop: (row: TreeRowModel | null, event: DragEvent<HTMLElement>) => void;
    onEnd: () => void;
    onLeave: (event: DragEvent<HTMLElement>) => void;
  };
}

export const END_ACTION_ID = "tree:end-action";

export function TreeView({ nodes, expanded, selectedId, label, className, emptyContent, endAction, onExpandedChange, onActivate, onContextMenu, onCommandKeyDown, onDoubleClick, menuTargetId, onFocusController, selection, onSelectionChange, drag }: TreeViewProps) {
  const previousRows = useRef(new Map<string, TreeRowModel>());
  const flat = useMemo(() => {
    const nextRows = new Map<string, TreeRowModel>();
    const allNodes: TreeNode[] = endAction ? [...nodes, {
      id: END_ACTION_ID, label: endAction.label, leading: endAction.leading,
      selectable: false, ariaSelectable: false, rowClassName: "ks-tree-end-action",
    }] : nodes;
    const stable = flattenTreeModel(allNodes, expanded).map((row) => {
      const previous = previousRows.current.get(row.id);
      const result = previous && sameRow(previous, row) ? previous : row;
      nextRows.set(row.id, result);
      return result;
    });
    previousRows.current = nextRows;
    return stable;
  }, [nodes, expanded, endAction]);
  const treeRows = useMemo(() => flat.filter((row) => row.node.content === undefined), [flat]);
  const selectableRows = useMemo(() => treeRows.filter((row) => row.id !== "tree:end-action"), [treeRows]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seenInteractiveRows = useRef(new Set<string>());
  const [pendingInteractiveFocus, setPendingInteractiveFocus] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const selectionAnchor = useRef<string | null>(null);
  const selectedRow = treeRows.find((row) => row.node.selectable !== false && row.node.id === selectedId);
  const preferredFocus = selectedRow?.id ?? treeRows[0]?.id ?? null;
  const effectiveFocus = treeRows.some((row) => row.id === focusId) ? focusId : preferredFocus;
  const token = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ks-control-height"));
  if (!Number.isFinite(token) || token <= 0) throw SHELL_TREE_CONTROL_HEIGHT_MISSING();
  const interactiveIndex = flat.findIndex((row) => row.node.interactiveContent);
  const itemKey = useCallback((index: number) => flat[index].id, [flat]);
  const { virtual } = useVirtualRows(flat.length, token, scrollRef, false, itemKey);
  const isRowVisible = useCallback((id: string | null | undefined) => {
    const row = virtual.getVirtualItems().find((item) => flat[item.index].id === id);
    const offset = virtual.scrollOffset ?? 0;
    return !!row && row.end > offset && row.start < offset + (virtual.scrollRect?.height ?? 0);
  }, [flat, virtual]);
  const focusIndex = effectiveFocus === null ? -1 : flat.findIndex((row) => row.id === effectiveFocus);
  keepRovingRow(virtual, focusIndex, interactiveIndex);

  const moveFocus = useCallback((index: number) => {
    const next = treeRows[Math.max(0, Math.min(treeRows.length - 1, index))];
    if (!next) return;
    setFocusId(next.id);
    setPendingFocus(next.id);
    virtual.scrollToIndex(flat.indexOf(next), { align: "auto" });
  }, [flat, treeRows, virtual]);

  const handlers = useRef({ onActivate, onContextMenu, onCommandKeyDown, onDoubleClick, onExpandedChange, treeRows, selectableRows, expanded, moveFocus, endAction, selection, onSelectionChange });
  handlers.current = { onActivate, onContextMenu, onCommandKeyDown, onDoubleClick, onExpandedChange, treeRows, selectableRows, expanded, moveFocus, endAction, selection, onSelectionChange };
  useEffect(() => {
    if (!selection || !onSelectionChange) return;
    const visible = new Set(selectableRows.map((row) => row.id));
    const next = selection.filter((id) => visible.has(id));
    if (next.length !== selection.length) onSelectionChange(next);
  }, [selection, selectableRows, onSelectionChange]);
  const selectRange = useCallback((id: string) => {
    const { selectableRows, onSelectionChange } = handlers.current;
    const start = selectableRows.findIndex((row) => row.id === selectionAnchor.current);
    const end = selectableRows.findIndex((row) => row.id === id);
    if (end < 0) return;
    const origin = start < 0 ? end : start;
    const step = origin <= end ? 1 : -1;
    const ids: string[] = [];
    for (let i = origin; i !== end + step; i += step) ids.push(selectableRows[i].id);
    onSelectionChange?.(ids);
  }, []);
  const [focusRequest, setFocusRequest] = useState<{ targets: Array<string | null>; waitForTarget: boolean; select?: boolean; currentOnNull: boolean; visibleOnly?: boolean; token: number } | null>(null);
  const focusRequestToken = useRef(0);
  const treeRowsRef = useRef(treeRows);
  treeRowsRef.current = treeRows;
  const focus = useMemo<TreeFocusController>(() => ({
    row: (id, waitForRow = false, select = false) => {
      focusRequestToken.current += 1;
      setFocusRequest({ targets: [id], waitForTarget: waitForRow, select, currentOnNull: id === null, token: focusRequestToken.current });
    },
    visibleRow: (id) => {
      focusRequestToken.current += 1;
      setFocusRequest({ targets: [id], waitForTarget: false, currentOnNull: id === null, visibleOnly: true, token: focusRequestToken.current });
    },
    rows: (ids) => ids.flatMap((id) => treeRowsRef.current.find((row) => row.id === id) ?? []),
    deletionTargets: (row, ids = [row.id]) => {
      const currentRows = treeRowsRef.current;
      const index = currentRows.findIndex((candidate) => candidate.id === row.id);
      const excluded = (candidate: TreeRowModel) => {
        let current: TreeRowModel | undefined = candidate;
        while (current) {
          if (ids.includes(current.id)) return true;
          current = currentRows.find((item) => item.id === current?.parentId);
        }
        return false;
      };
      const next = currentRows.slice(index + 1).find((candidate) => candidate.depth <= row.depth && !excluded(candidate));
      const previous = currentRows.slice(0, index).reverse().find((candidate) => candidate.depth <= row.depth && !excluded(candidate));
      const parent = currentRows.find((candidate) => candidate.id === row.parentId);
      return [...new Set([!excluded(row) ? row.id : undefined, next?.id, previous?.id, parent && !excluded(parent) ? parent.id : undefined].filter((id): id is string => id !== undefined && id !== null)), null];
    },
    afterDelete: (targets) => {
      focusRequestToken.current += 1;
      setFocusRequest({ targets, waitForTarget: false, currentOnNull: false, token: focusRequestToken.current });
    },
  }), []);
  useLayoutEffect(() => onFocusController?.(focus), [focus, onFocusController]);

  const onFocus = useCallback((id: string) => setFocusId(id), []);
  const activate = useCallback((row: TreeRowModel, event: MouseEvent<HTMLButtonElement>) => {
    if (row.id === END_ACTION_ID) { handlers.current.endAction?.onActivate(); return; }
    const { selection, onSelectionChange } = handlers.current;
    if (selection && onSelectionChange) {
      if (event.shiftKey) { selectRange(row.id); return; }
      if (event.ctrlKey) {
        selectionAnchor.current = row.id;
        onSelectionChange(selection.includes(row.id) ? selection.filter((id) => id !== row.id) : [...selection, row.id]);
        return;
      }
      selectionAnchor.current = row.id;
      onSelectionChange([row.id]);
    }
    handlers.current.onActivate(row, { source: "click", target: event.currentTarget, detail: event.detail });
  }, [selectRange]);
  const contextMenu = useCallback((row: TreeRowModel, event: MouseEvent<HTMLButtonElement>) => {
    if (!handlers.current.onContextMenu) return;
    if (handlers.current.selection && !handlers.current.selection.includes(row.id)) selectionAnchor.current = row.id;
    event.preventDefault();
    event.stopPropagation();
    handlers.current.onContextMenu(row.id === END_ACTION_ID ? null : row, event.currentTarget, { x: event.clientX, y: event.clientY }, focus);
  }, [focus]);
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
    const { treeRows, expanded, moveFocus } = handlers.current;
    const index = treeRows.findIndex((item) => item.id === row.id);
    if (index < 0) return;
    const move = (nextIndex: number) => {
      const next = treeRows[Math.max(0, Math.min(treeRows.length - 1, nextIndex))];
      if (handlers.current.onSelectionChange && next) {
        if (event.shiftKey) { selectionAnchor.current ??= row.id; selectRange(next.id === "tree:end-action" ? handlers.current.selectableRows.at(-1)?.id ?? row.id : next.id); }
        else if (next.id !== "tree:end-action") { selectionAnchor.current = next.id; handlers.current.onSelectionChange([next.id]); }
      }
      moveFocus(nextIndex);
    };
    if (event.ctrlKey && event.key.toLowerCase() === "a" && handlers.current.onSelectionChange) {
      handlers.current.onSelectionChange(handlers.current.selectableRows.map((item) => item.id));
    } else if (event.key === "Home" || event.key === "End") move(event.key === "Home" ? 0 : treeRows.length - 1);
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") move(index + (event.key === "ArrowDown" ? 1 : -1));
    else if (event.key === "ArrowRight" && row.hasChildren) {
      if (!expanded.has(row.id)) handlers.current.onExpandedChange(row.id, true);
      else {
        const child = treeRows[index + 1];
        if (child?.parentId === row.id) move(index + 1);
      }
    } else if (event.key === "ArrowLeft") {
      if (row.expanded) handlers.current.onExpandedChange(row.id, false);
      else if (row.parentId) {
        const parentIndex = treeRows.findIndex((item) => item.id === row.parentId);
        if (parentIndex >= 0) move(parentIndex);
      }
    } else if (event.key === "Enter") {
      if (row.id === END_ACTION_ID) handlers.current.endAction?.onActivate();
      else handlers.current.onActivate(row, { source: "enter", target: event.currentTarget });
    } else {
      if (handlers.current.onCommandKeyDown?.(row.id === END_ACTION_ID ? null : row, event, focus)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }, [focus, selectRange]);

  useEffect(() => {
    const request = focusRequest;
    if (!request) return;
    const found = request.targets.find((id) => id === null || treeRows.some((row) => row.id === id));
    const target = found === null && request.currentOnNull ? effectiveFocus : found;
    if (request.visibleOnly) {
      const visible = isRowVisible(target);
      const element = visible
        ? Array.from(scrollRef.current?.querySelectorAll<HTMLElement>("[data-tree-row]") ?? [])
          .find((row) => row.dataset.treeRow === target)?.querySelector<HTMLElement>("[role=treeitem]")
        : scrollRef.current;
      if (visible && target) setFocusId(target);
      element?.focus({ preventScroll: true });
      setPendingFocus(null);
      setFocusRequest(null);
      return;
    }
    if (target === undefined && request.waitForTarget) return;
    if (target === null || target === undefined) {
      scrollRef.current?.focus();
      setFocusRequest(null);
      return;
    }
    const row = treeRows.find((candidate) => candidate.id === target);
    if (!row) {
      if (!request.waitForTarget) {
        scrollRef.current?.focus();
        setFocusRequest(null);
      }
      return;
    }
    setFocusId(target);
    if (request.select) handlers.current.onSelectionChange?.([target]);
    virtual.scrollToIndex(flat.indexOf(row), { align: "auto" });
    setPendingFocus(target);
    setFocusRequest(null);
  }, [effectiveFocus, flat, focusRequest, isRowVisible, treeRows, virtual]);

  useEffect(() => {
    if (!pendingFocus) return;
    const row = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>("[data-tree-row]") ?? [])
      .find((element) => element.dataset.treeRow === pendingFocus)
      ?.querySelector<HTMLElement>("[role=treeitem]");
    if (!row) return;
    const active = document.activeElement;
    if (!isUnclaimedFocus(active) && !scrollRef.current?.contains(active)) {
      setPendingFocus(null);
      return;
    }
    row.focus();
    setPendingFocus(null);
  });

  const virtualRows = virtual.getVirtualItems();
  const destinationVisible = isRowVisible(drag?.targetId);
  const dropTargetId = drag?.targetId === "" || destinationVisible ? drag?.targetId : drag?.hoveredId ?? drag?.targetId;

  const dragRow = (target: EventTarget | null): TreeRowModel | null | undefined => {
    const id = target instanceof Element ? target.closest<HTMLElement>("[data-tree-id]")?.dataset.treeId : undefined;
    if (id) return treeRows.find((row) => row.id === id);
    const rowId = target instanceof Element ? target.closest<HTMLElement>("[data-tree-row]")?.dataset.treeRow : undefined;
    if (!rowId) return null;
    const row = flat.find((candidate) => candidate.id === rowId);
    return (row?.node.data as { directoryPath?: string } | undefined)?.directoryPath ? row : undefined;
  };
  useEffect(() => {
    const interactive = flat.filter((row) => row.node.interactiveContent);
    const currentIds = new Set(interactive.map((row) => row.id));
    const added = interactive.find((row) => !seenInteractiveRows.current.has(row.id));
    seenInteractiveRows.current = currentIds;
    if (!added) return;
    setPendingInteractiveFocus(added.id);
    virtual.scrollToIndex(flat.indexOf(added), { align: "auto" });
  }, [flat, virtual]);

  useEffect(() => {
    if (!pendingInteractiveFocus) return;
    const row = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>("[data-tree-row]") ?? [])
      .find((element) => element.dataset.treeRow === pendingInteractiveFocus);
    const input = row?.querySelector<HTMLElement>("input, textarea, [contenteditable='true']");
    if (!input) return;
    input.focus();
    setPendingInteractiveFocus(null);
  }, [pendingInteractiveFocus, virtualRows]);

  const adjustedInteractiveRow = useRef<{ id: string; height: number } | null>(null);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || interactiveIndex < 0) {
      adjustedInteractiveRow.current = null;
      return;
    }
    const row = Array.from(scroll.querySelectorAll<HTMLElement>("[data-tree-row]"))
      .find((element) => element.dataset.treeRow === flat[interactiveIndex].id);
    if (!row) return;
    const id = flat[interactiveIndex].id;
    if (!seenInteractiveRows.current.has(id) || pendingInteractiveFocus) return;
    const height = row.getBoundingClientRect().height;
    const adjusted = adjustedInteractiveRow.current;
    if (adjusted?.id === id && adjusted.height === height) return;
    adjustedInteractiveRow.current = { id, height };
    virtual.measureElement(row);
    const padding = Number.parseFloat(getComputedStyle(scroll).paddingBottom) || 0;
    const overflow = row.getBoundingClientRect().bottom + padding - scroll.getBoundingClientRect().bottom;
    if (overflow > 0) scroll.scrollTop += overflow;
  }, [flat, interactiveIndex, pendingInteractiveFocus, virtual, virtualRows]);
  return <div
    aria-label={label}
    aria-rowcount={treeRows.length}
    className={className}
    ref={scrollRef}
    role="tree"
    aria-multiselectable={selection ? true : undefined}
    data-drop-state={drag?.targetId === "" ? drag.valid ? "valid" : "invalid" : undefined}
    onDragStart={drag?.enabled ? (event) => { const row = dragRow(event.target); if (row) drag.onStart(row, event); } : undefined}
    onDragOver={drag?.enabled ? (event) => { const row = dragRow(event.target); if (row !== undefined) drag.onOver(row, event); } : undefined}
    onDrop={drag?.enabled ? (event) => { const row = dragRow(event.target); if (row !== undefined) drag.onDrop(row, event); } : undefined}
    onDragEnd={drag?.enabled ? drag.onEnd : undefined}
    onDragLeave={drag?.enabled ? drag.onLeave : undefined}
    tabIndex={treeRows.length ? -1 : 0}
    onClick={(event) => {
      if (!(event.target instanceof Element)) { scrollRef.current?.focus(); return; }
      if (event.target.closest("button, input, textarea, select, [contenteditable='true']")) return;
      if (!event.target.closest("[data-tree-id]")) { selectionAnchor.current = null; handlers.current.onSelectionChange?.([]); scrollRef.current?.focus(); }
    }}
    onContextMenu={(event) => {
      if (!handlers.current.onContextMenu) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest("[data-tree-id]") || target.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      const rowId = target.closest<HTMLElement>("[data-tree-row]")?.dataset.treeRow;
      const row = flat.find((candidate) => candidate.id === rowId);
      const rowData = row?.node.data as { directoryPath?: string } | undefined;
      handlers.current.onContextMenu(row?.node.content === undefined || rowData?.directoryPath ? row ?? null : null, event.currentTarget, { x: event.clientX, y: event.clientY }, focus);
    }}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.ctrlKey && event.key.toLowerCase() === "a" && handlers.current.onSelectionChange) {
        handlers.current.onSelectionChange(handlers.current.selectableRows.map((row) => row.id));
        event.preventDefault(); event.stopPropagation();
      } else if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) && effectiveFocus !== null) {
        const index = event.key === "Home" ? 0 : event.key === "End" ? treeRows.length - 1 : treeRows.findIndex((row) => row.id === effectiveFocus);
        const target = treeRows[index];
        if (handlers.current.onSelectionChange) {
          if (event.shiftKey) { selectionAnchor.current ??= effectiveFocus; selectRange(target.id === "tree:end-action" ? handlers.current.selectableRows.at(-1)?.id ?? effectiveFocus : target.id); }
          else if (target.id !== "tree:end-action") { selectionAnchor.current = target.id; handlers.current.onSelectionChange([target.id]); }
        }
        moveFocus(index);
        event.preventDefault();
        event.stopPropagation();
      } else if (handlers.current.onCommandKeyDown?.(null, event, focus)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }}
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
          menuTarget={menuTargetId === row.id}
          multiSelected={selection ? selection.includes(row.id) : undefined}
          draggable={drag?.enabled && row.node.content === undefined}
          dropState={dropTargetId === row.id ? drag?.valid ? "valid" : "invalid" : undefined}
          row={row}
          selected={row.node.selectable !== false && row.node.id === selectedId}
        />;
      })}
    </VirtualSurface>
  </div>;
}
