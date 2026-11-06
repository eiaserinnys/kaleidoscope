import { useCallback, useEffect, useRef, useState } from "react";
import type { AppCommentSummary, AppDefinition } from "../contract/contract";
import { buildDefinitionIndex, resolveDefinition, type DefinitionIndex } from "./definition";
import { resolveScreen } from "./screen";
import { setCommentHighlights } from "./highlight";
import { visibleClip } from "../share/visible";
import { describeTarget, type TargetDescription } from "./target";

type Index = { digest: string; entries: DefinitionIndex };
const indexes = new WeakMap<AppDefinition, Promise<Index>>();
export function definitionIndex(definition: AppDefinition): Promise<Index> {
  let index = indexes.get(definition);
  if (!index) { index = buildDefinitionIndex(definition); indexes.set(definition, index); }
  return index;
}
export type PositionStatus = "exact" | "moved" | "not_visible" | "orphan";
export type PinGroup = { id: string; ids: string[] };

export function useCommentPositions(content: HTMLElement | null, windowId: string, enabled: boolean, definition: AppDefinition | undefined, items: AppCommentSummary[], railOpen: boolean, selectedId: string | null, target: TargetDescription | null, hover: HTMLElement | null, onPinsPositioned: () => boolean) {
  const [index, setIndex] = useState<Index>();
  const [statuses, setStatuses] = useState<Record<string, PositionStatus>>({});
  const [groups, setGroups] = useState<PinGroup[]>([]);
  const pins = useRef(new Map<string, HTMLElement>());
  const coordinates = useRef(new Map<string, { x: number; y: number }>());
  const selectedBox = useRef<HTMLElement | null>(null);
  const hoverBox = useRef<HTMLElement | null>(null);
  const reschedule = useRef<() => void>(() => {});
  const refresh = useCallback(() => reschedule.current(), []);
  useEffect(() => {
    let cancelled = false;
    setIndex(undefined);
    if (enabled && definition) void definitionIndex(definition).then((value) => { if (!cancelled) setIndex(value); });
    return () => { cancelled = true; };
  }, [definition, enabled]);
  useEffect(() => {
    if (!enabled || !content || !index) return;
    let frame = 0;
    const observed = new Set<Element>();
    const update = () => {
      frame = 0;
      const win = content.closest<HTMLElement>(".ks-window");
      if (!win) return;
      const origin = win.getBoundingClientRect();
      const next: Record<string, PositionStatus> = {};
      const ranges: Range[] = target?.range ? [target.range] : [];
      const placed: { id: string; x: number; y: number }[] = [];
      const styles = getComputedStyle(content);
      const contentRect = content.getBoundingClientRect();
      const rail = railOpen ? win.querySelector<HTMLElement>(".ks-comment-rail")?.getBoundingClientRect() : undefined;
      const area = win.closest<HTMLElement>(".ks-desktop-area")?.getBoundingClientRect();
      const size = parseFloat(styles.getPropertyValue("--ks-space-5"));
      const small = parseFloat(styles.getPropertyValue("--ks-space-1"));
      const inset = small + parseFloat(styles.getPropertyValue("--ks-scrollbar-thumb-inset"));
      const surface = win.querySelector<HTMLElement>(".ks-comment-surface");
      const surfaceRect = surface?.getBoundingClientRect();
      const overlapsSurface = (rect: { left: number; right: number; top: number; bottom: number }) => !!surfaceRect && rect.left < surfaceRect.right && rect.right > surfaceRect.left && rect.top < surfaceRect.bottom && rect.bottom > surfaceRect.top;
      const showBox = (box: HTMLElement | null, rect: DOMRect) => {
        if (!box || overlapsSurface(rect)) return;
        box.style.display = "block";
        box.style.transform = `translate(${rect.left - origin.left}px, ${rect.top - origin.top}px)`;
        box.style.width = `${rect.width}px`; box.style.height = `${rect.height}px`;
      };
      if (selectedBox.current) selectedBox.current.style.display = "none";
      if (hoverBox.current) hoverBox.current.style.display = "none";
      if (hover && content.contains(hover)) {
        const hovered = describeTarget(hover, content)?.element;
        if (hovered) showBox(hoverBox.current, hovered.getBoundingClientRect());
      }
      if (target && target.anchor.kind !== "text" && target.anchor.kind !== "point") showBox(selectedBox.current, target.element.getBoundingClientRect());
      for (const item of items) {
        const definitionResult = resolveDefinition(item.anchor, item.created_definition_digest, index.entries, index.digest);
        const result = resolveScreen(item.anchor, definitionResult, content, { windowId, sourceWindowId: item.source_window_id });
        next[item.id] = result.kind;
        if ("range" in result && result.range && !item.resolved) ranges.push(result.range);
        if ("element" in result && !observed.has(result.element)) { observed.add(result.element); resize.observe(result.element); }
        if (item.resolved || !("rect" in result)) continue;
        const rect = result.range?.getClientRects()[0] ?? result.rect;
        if (item.id === selectedId && item.anchor.kind !== "point" && item.anchor.kind !== "text" && selectedBox.current) {
          showBox(selectedBox.current, rect);
        }
        const clip = visibleClip(result.element);
        const center = rect.top + Math.min(rect.height, size * 5 / 3) / 2;
        if (item.anchor.kind !== "point" && (center < clip.top || center > clip.bottom)) { next[item.id] = "not_visible"; continue; }
        if (rail && (rail.width >= contentRect.width || rect.left >= rail.left)) continue;
        const rightLimit = Math.min(clip.right, area ? area.right - size : Infinity, rail ? rail.left - size / 2 : Infinity);
        const x = item.anchor.kind === "point" ? Math.min(rect.left, rightLimit) : Math.min(rect.right - inset, rightLimit);
        const y = item.anchor.kind === "point" ? rect.top - size : item.anchor.kind === "control" ? rect.top - size + inset : rect.top + Math.min(rect.height, size * 5 / 3) / 2 - size / 2;
        if (overlapsSurface({ left: x, right: x + size, top: y, bottom: y + size })) continue;
        placed.push({ id: item.id, x: x - origin.left, y: y - origin.top });
      }
      placed.sort((a, b) => a.y - b.y);
      const nextGroups: PinGroup[] = [];
      const points = new Map<string, { x: number; y: number }>();
      for (const point of placed) {
        const previous = nextGroups.at(-1), previousPoint = previous && points.get(previous.id);
        if (previous && previousPoint && Math.abs(previousPoint.x - point.x) < size && Math.abs(previousPoint.y - point.y) < size - small) previous.ids.push(point.id);
        else { nextGroups.push({ id: point.id, ids: [point.id] }); points.set(point.id, point); }
      }
      coordinates.current = points;
      for (const [id, pin] of pins.current) { const point = points.get(id); if (point) pin.style.transform = `translate(${point.x}px, ${point.y}px)`; }
      if (onPinsPositioned()) schedule();
      setGroups((old) => JSON.stringify(old) === JSON.stringify(nextGroups) ? old : nextGroups);
      setCommentHighlights(windowId, ranges);
      setStatuses((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    reschedule.current = schedule;
    const resize = new ResizeObserver(schedule); resize.observe(content);
    const mutation = new MutationObserver(schedule); mutation.observe(content, { subtree: true, childList: true, attributes: true, characterData: true });
    content.addEventListener("scroll", schedule, true); schedule();
    return () => { reschedule.current = () => {}; cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); content.removeEventListener("scroll", schedule, true); setCommentHighlights(windowId, []); };
  }, [content, enabled, index, items, railOpen, selectedId, target, hover, windowId, onPinsPositioned]);
  const setPin = (id: string, node: HTMLElement | null) => {
    if (!node) { pins.current.delete(id); return; }
    pins.current.set(id, node);
    const point = coordinates.current.get(id);
    if (point) node.style.transform = `translate(${point.x}px, ${point.y}px)`;
  };
  return { index, statuses, pins, groups, setPin, selectedBox, hoverBox, refresh };
}
