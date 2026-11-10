import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import type { TreeItem } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import type { TreeRowModel } from "../components/tree/tree-model";

/** 데이터 트리 전용 끌기 표식. 폴더 트리의 것과 섞이지 않게 이름을 따로 둔다. */
export const TREE_ITEM_MIME = "application/x-kaleidoscope-tree-item";

export type TreeDropPosition = "before" | "after" | "inside" | "end";

interface DragPayload {
  window: string;
  key: string;
}

interface ActiveDrag extends DragPayload {
  item: TreeItem;
}

/** dragover 중에는 dataTransfer를 읽을 수 없으므로 끄는 항목을 모듈 전역에 둔다(folder-drag.ts와 같은 방식). */
let active: ActiveDrag | null = null;
let owner: object | null = null;

function itemOf(row: TreeRowModel | null): TreeItem | undefined {
  const value = row?.node.data as TreeItem | undefined;
  return value && typeof value.key === "string" ? value : undefined;
}

/** source 자신이거나 source의 자손이면 놓을 수 없다. */
function contains(source: TreeItem, target: TreeItem): boolean {
  if (source === target) return true;
  if (!Array.isArray(source.children)) return false;
  return source.children.some((child) => {
    if (child === null || typeof child !== "object" || Array.isArray(child)) return false;
    return contains(child as TreeItem, target);
  });
}

function positionOf(event: DragEvent<HTMLElement>): "before" | "after" | "inside" {
  const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tree-id]") : null;
  if (!row) return "inside";
  const rect = row.getBoundingClientRect();
  if (!(rect.height > 0)) return "inside";
  const ratio = (event.clientY - rect.top) / rect.height;
  return ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
}

export interface DataTreeDrag {
  enabled: boolean;
  targetId: string | null;
  hoveredId: string | null;
  valid: boolean;
  position?: "before" | "after";
  onStart: (row: TreeRowModel, event: DragEvent<HTMLElement>) => void;
  onOver: (row: TreeRowModel | null, event: DragEvent<HTMLElement>) => void;
  onDrop: (row: TreeRowModel | null, event: DragEvent<HTMLElement>) => void;
  onEnd: () => void;
  onLeave: (event: DragEvent<HTMLElement>) => void;
}

export function useDataTreeDrag({ enabled, windowId, onMove }: {
  enabled: boolean;
  windowId: string;
  onMove: (event: JsonValue, item: JsonValue) => void;
}): DataTreeDrag {
  const [target, setTarget] = useState<{ id: string; hoveredId: string | null; valid: boolean; position?: "before" | "after" } | null>(null);
  const instance = useRef({}).current;
  const clear = useCallback(() => {
    if (owner === instance) { active = null; owner = null; }
    setTarget(null);
  }, [instance]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !active || owner !== instance) return;
      event.preventDefault();
      clear();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (owner === instance) { active = null; owner = null; }
    };
  }, [clear, instance]);
  const onStart = useCallback((row: TreeRowModel, event: DragEvent<HTMLElement>) => {
    const item = itemOf(row);
    if (!item) { event.preventDefault(); return; }
    active = { window: windowId, key: item.key, item };
    owner = instance;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TREE_ITEM_MIME, JSON.stringify({ window: windowId, key: item.key } satisfies DragPayload));
  }, [instance, windowId]);
  const onOver = useCallback((row: TreeRowModel | null, event: DragEvent<HTMLElement>) => {
    if (!active) return;
    const sameWindow = active.window === windowId;
    if (row === null) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = sameWindow ? "move" : "none";
      setTarget({ id: "", hoveredId: null, valid: sameWindow });
      return;
    }
    const item = itemOf(row);
    const valid = sameWindow && item !== undefined && !contains(active.item, item);
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = valid ? "move" : "none";
    const drop = valid ? positionOf(event) : undefined;
    setTarget({ id: row.id, hoveredId: row.id, valid, position: drop === "inside" ? undefined : drop });
  }, [windowId]);
  const onDrop = useCallback((row: TreeRowModel | null, event: DragEvent<HTMLElement>) => {
    const current = active;
    if (!current) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      if (current.window !== windowId) return;
      const item = row === null ? undefined : itemOf(row);
      if (row !== null && (item === undefined || contains(current.item, item))) return;
      const position: TreeDropPosition = row === null ? "end" : positionOf(event);
      onMove(
        { key: current.key, target: item === undefined ? null : item.key, position },
        item === undefined ? null : item as unknown as JsonValue,
      );
    } finally {
      clear();
    }
  }, [clear, onMove, windowId]);
  return { enabled, targetId: target === null ? null : target.id, hoveredId: target?.hoveredId ?? null, valid: target?.valid ?? false, position: target?.position, onStart, onOver, onDrop, onEnd: clear, onLeave: () => undefined };
}
