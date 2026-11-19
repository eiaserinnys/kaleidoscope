import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import type { ItemScope } from "../data/item-scope";

export const SECTION_MIME = "application/x-kaleidoscope-section";
type Position = "before" | "after";
type Active = { windowId: string; key: string; index: number; locator?: string; parent?: object; owner: object };
let active: Active | null = null;
let clearDisplay: (() => void) | null = null;

export function useSectionDrag(enabled: boolean, windowId: string, scope: ItemScope | null, onMove: (event: { key: string; target: string; position: Position }) => void) {
  const instance = useRef({}).current;
  const [position, setPosition] = useState<Position>();
  const clear = useCallback(() => { clearDisplay?.(); clearDisplay = null; active = null; }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape" && active) clear(); };
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("keydown", keydown, true); if (active?.owner === instance) clear(); };
  }, [clear, instance]);
  const getPosition = (event: DragEvent<HTMLElement>): Position => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };
  const valid = (pos: Position) => {
    if (!enabled || !scope || !active || active.windowId !== windowId || active.key === String(scope.key)) return false;
    const sameRepeat = active.locator !== undefined && active.locator === scope.locator?.pointer && active.parent === scope.parentScope?.instance;
    return !sameRepeat || !((pos === "after" && active.index === scope.index + 1) || (pos === "before" && active.index === scope.index - 1));
  };
  return {
    position,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!enabled || !scope || target?.closest(".ks-data-section-actions, input, textarea, [contenteditable='true']")) { event.preventDefault(); return; }
      clear();
      active = { windowId, key: String(scope.key), index: scope.index, locator: scope.locator?.pointer, parent: scope.parentScope?.instance, owner: instance };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(SECTION_MIME, JSON.stringify({ window: windowId, key: String(scope.key) }));
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!active) return;
      const next = getPosition(event);
      clearDisplay?.();
      clearDisplay = () => setPosition(undefined);
      if (!valid(next)) { setPosition(undefined); return; }
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; setPosition(next);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!active) return;
      const next = getPosition(event);
      if (valid(next) && scope) { event.preventDefault(); event.stopPropagation(); onMove({ key: active.key, target: String(scope.key), position: next }); }
      clear();
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      setPosition(undefined);
    },
    onDragEnd: clear,
  };
}
