import { useCallback, useEffect, useRef, useState } from "react";
import type { AppCommentSummary, AppDefinition } from "../contract/contract";
import { buildDefinitionIndex, resolveDefinition, type DefinitionIndex } from "./definition";
import { resolveScreen } from "./screen";
import { setCommentHighlights } from "./highlight";
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

function scrollClip(element: HTMLElement, content: HTMLElement) {
  let left = 0, top = 0, right = window.innerWidth, bottom = window.innerHeight;
  for (let node: HTMLElement | null = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node === content || style.overflowX !== "visible" || style.overflowY !== "visible") {
      const rect = node.getBoundingClientRect();
      const x = rect.left + node.clientLeft, y = rect.top + node.clientTop;
      left = Math.max(left, x); top = Math.max(top, y);
      right = Math.min(right, node.clientWidth ? x + node.clientWidth : rect.right);
      bottom = Math.min(bottom, node.clientHeight ? y + node.clientHeight : rect.bottom);
    }
    if (node === content) break;
  }
  return { left, top, right, bottom };
}

/** 창 내용 안의 고정 머리만 말풍선을 가리는 것으로 본다. */
export function isCommentAnchorVisible(content: HTMLElement, element: HTMLElement, kind: string, rect: Pick<DOMRect, "left" | "right" | "top" | "height">, clip: { left: number; right: number; top: number; bottom: number }, firstLineHeight: number): boolean {
  if (kind === "point") {
    const surface = element.getBoundingClientRect();
    return rect.left >= Math.max(surface.left, clip.left) && rect.left <= Math.min(surface.right, clip.right)
      && rect.top >= Math.max(surface.top, clip.top) && rect.top <= Math.min(surface.bottom, clip.bottom);
  }
  const x = Math.max(clip.left, Math.min((rect.left + rect.right) / 2, clip.right));
  const y = rect.top + Math.min(rect.height, firstLineHeight) / 2;
  const top = element.ownerDocument.elementsFromPoint(x, y).find((candidate) => content.contains(candidate) && !candidate.closest(".ks-comment-layer"));
  if (!top || element.contains(top) || top.contains(element)) return true;
  for (let node: Element | null = top; node; node = node.parentElement) {
    if (getComputedStyle(node).position === "sticky") return false;
    if (node === content) break;
  }
  return true;
}

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
      const barRect = win.querySelector<HTMLElement>(".ks-comment-bar.is-inside")?.getBoundingClientRect();
      const overlapsSurface = (rect: { left: number; right: number; top: number; bottom: number }) => !!surfaceRect && rect.left < surfaceRect.right && rect.right > surfaceRect.left && rect.top < surfaceRect.bottom && rect.bottom > surfaceRect.top;
      const expands = (element: HTMLElement, kind: string, type?: string) => {
        if (kind !== "row") return true;
        if (type !== "feed") return false;
        const padding = getComputedStyle(element);
        return parseFloat(padding.paddingInlineStart) === 0 && parseFloat(padding.paddingInlineEnd) === 0;
      };
      const showBox = (box: HTMLElement | null, element: HTMLElement, rect: DOMRect, expand = false) => {
        const clip = scrollClip(element, content), extra = expand ? small : 0;
        const left = Math.max(contentRect.left, clip.left - extra, rect.left - extra), top = Math.max(clip.top, rect.top - extra);
        const right = Math.min(contentRect.right, clip.right + extra, rect.right + extra), bottom = Math.min(clip.bottom, rect.bottom + extra);
        if (!box || right <= left || bottom <= top || overlapsSurface({ left, right, top, bottom })) return;
        box.style.display = "block";
        box.style.transform = `translate(${left - origin.left}px, ${top - origin.top}px)`;
        box.style.width = `${right - left}px`; box.style.height = `${bottom - top}px`;
      };
      if (selectedBox.current) selectedBox.current.style.display = "none";
      if (hoverBox.current) hoverBox.current.style.display = "none";
      if (hover && content.contains(hover)) {
        const hovered = describeTarget(hover, content);
        if (hovered) showBox(hoverBox.current, hovered.element, hovered.element.getBoundingClientRect(), expands(hovered.element, hovered.anchor.kind, hovered.anchor.normalized_type));
      }
      if (target && target.anchor.kind !== "text" && target.anchor.kind !== "point") showBox(selectedBox.current, target.element, target.element.getBoundingClientRect(), expands(target.element, target.anchor.kind, target.anchor.normalized_type));
      const place = (id: string, kind: string, element: HTMLElement, rect: DOMRect) => {
        const clip = scrollClip(element, content);
        const center = rect.top + Math.min(rect.height, size * 5 / 3) / 2;
        const y = kind === "point" ? rect.top - size : kind === "control" ? rect.top - size + inset : center - size / 2;
        if (kind !== "point" && (center < clip.top || center > clip.bottom)) return false;
        if (!isCommentAnchorVisible(content, element, kind, rect, clip, size * 5 / 3)) return false;
        if (rail && (rail.width >= contentRect.width || rect.left >= rail.left)) return true;
        const rightLimit = Math.min(area ? area.right - size : Infinity, rail ? rail.left - size / 2 : Infinity);
        const bounds = element.getBoundingClientRect();
        const ownRight = kind === "block" && element.clientWidth ? bounds.left + element.clientLeft + element.clientWidth : bounds.right;
        const edge = Math.min(kind === "text" ? bounds.right : rect.right, clip.right, ownRight);
        const x = kind === "point" ? Math.min(rect.left, rightLimit) : Math.min(edge - inset, rightLimit);
        if (!overlapsSurface({ left: x, right: x + size, top: y, bottom: y + size }) && !(barRect && x < barRect.right && x + size > barRect.left && y < barRect.bottom && y + size > barRect.top)) placed.push({ id, x: x - origin.left, y: y - origin.top });
        return true;
      };
      for (const item of items) {
        const definitionResult = resolveDefinition(item.anchor, item.created_definition_digest, index.entries, index.digest);
        const result = resolveScreen(item.anchor, definitionResult, content, { windowId, sourceWindowId: item.source_window_id });
        next[item.id] = result.kind;
        if ("range" in result && result.range && !item.resolved) ranges.push(result.range);
        if ("element" in result && !observed.has(result.element)) { observed.add(result.element); resize.observe(result.element); }
        if (item.resolved || !("rect" in result)) continue;
        const rect = result.range?.getClientRects()[0] ?? result.rect;
        if (item.id === selectedId && item.anchor.kind !== "point" && item.anchor.kind !== "text" && selectedBox.current) {
          showBox(selectedBox.current, result.element, rect, expands(result.element, item.anchor.kind, item.anchor.normalized_type));
        }
        if (!place(item.id, item.anchor.kind, result.element, rect)) next[item.id] = "not_visible";
      }
      if (target) {
        const bounds = target.anchor.kind === "point" ? target.element.getBoundingClientRect() : target.range?.getClientRects()[0] ?? target.rect ?? target.element.getBoundingClientRect();
        const rect = target.anchor.kind === "point" && target.anchor.frame_rel ? new DOMRect(bounds.left + bounds.width * target.anchor.frame_rel.x, bounds.top + bounds.height * target.anchor.frame_rel.y, 0, 0) : bounds;
        place("__draft__", target.anchor.kind, target.element, rect);
      }
      placed.sort((a, b) => a.y - b.y);
      const nextGroups: PinGroup[] = [];
      const points = new Map<string, { x: number; y: number }>();
      for (const point of placed) {
        if (point.id === "__draft__") { points.set(point.id, point); continue; }
        const previous = nextGroups.at(-1), previousPoint = previous && points.get(previous.id);
        if (previous && previousPoint && Math.abs(previousPoint.x - point.x) < size && Math.abs(previousPoint.y - point.y) < size - small) previous.ids.push(point.id);
        else { nextGroups.push({ id: point.id, ids: [point.id] }); points.set(point.id, point); }
      }
      coordinates.current = points;
      for (const [id, pin] of pins.current) { const point = points.get(id); pin.style.display = point ? "" : "none"; if (point) pin.style.transform = `translate(${point.x}px, ${point.y}px)`; }
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
    node.style.display = point ? "" : "none";
    if (point) node.style.transform = `translate(${point.x}px, ${point.y}px)`;
  };
  return { index, statuses, pins, groups, setPin, selectedBox, hoverBox, refresh };
}
