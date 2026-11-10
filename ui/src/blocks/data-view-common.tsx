import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { defaultRangeExtractor, measureElement, observeElementOffset, observeElementRect, useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import type { Badge as BadgeValue, Group } from "../contract/contract";
import { Badge, isBadge } from "../components/badge";
import { DataIcon } from "../components/data-icons";
import { EmptyState } from "../components/primitives";

export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const DEFAULT_VIRTUAL_ROW_ESTIMATE = 40;
export function asArray(value: unknown): unknown[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }
export function groups<T>(value: unknown, grouped: boolean, valid: (item: unknown) => item is T): Group<T>[] {
  const values = asArray(value);
  if (!grouped) return [{ title: "", items: values.filter(valid) }];
  return values.filter((g): g is Record<string, unknown> => isObject(g) && typeof g.title === "string" && "items" in g).map((g) => ({ title: g.title as string, meta: typeof g.meta === "string" ? g.meta : undefined, items: asArray(g.items).filter(valid) }));
}
export type ListGroup<T> = Group<T> & { original?: Record<string, unknown>; status?: { state: "loading" | "empty" | "error"; message?: string; code?: string }; action?: string; key?: string };
export function listGroups<T>(value: unknown, grouped: boolean, valid: (item: unknown) => item is T): ListGroup<T>[] {
  if (!grouped) return groups(value, false, valid);
  return asArray(value).filter((g): g is Record<string, unknown> => isObject(g) && typeof g.title === "string" && "items" in g).map((g) => {
    const status: ListGroup<T>["status"] = isObject(g.status) && (g.status.state === "loading" || g.status.state === "empty" || g.status.state === "error") ? {
      state: g.status.state, message: typeof g.status.message === "string" ? g.status.message : undefined, code: typeof g.status.code === "string" ? g.status.code : undefined,
    } : undefined;
    return { title: g.title as string, meta: typeof g.meta === "string" ? g.meta : undefined, items: asArray(g.items).filter(valid), original: g, status, action: typeof g.action === "string" ? g.action : undefined, key: typeof g.key === "string" ? g.key : undefined };
  });
}
export function asBadges(value: unknown): BadgeValue[] { return asArray(value).filter(isBadge); }
export function Badges({ values }: { values: unknown }) {
  const badges = asBadges(values);
  return badges.length ? <span className="ks-view-badges">{badges.map((badge: BadgeValue, i: number) => <Badge key={i} value={badge} />)}</span> : null;
}
export function GroupHeading({ title, meta }: { title: string; meta?: string }) {
  return <div className="ks-view-group"><strong>{title}</strong>{meta && <span>{meta}</span>}</div>;
}
export function NoItems({ rootProps }: { rootProps?: import("../comments/block-root").BlockRootProps }) { return <EmptyState rootProps={rootProps} className="ks-no-items" icon={<DataIcon name="list-filter" size="empty" />} text="없음" />; }
export function dateText(value: unknown) {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(date);
}
// 스크롤 막대가 나타나면 칸 폭이 줄어 행 높이가 달라지고, 다시 막대가 사라지는 왕복이 이어진다.
// 짧은 시간에 세 번 왕복하면 스크롤 막대를 남겨 왕복을 끊는다. 다시 그리지 않도록 요소 스타일만 고친다.
const FLAP_WINDOW_MS = 500;
const FLAP_LIMIT = 3;
export function useScrollbarFlapHold(scroll: RefObject<HTMLDivElement | null>, enabled: boolean, marker: number) {
  useEffect(() => {
    const element = scroll.current;
    if (!enabled || !element) return;
    let outerWidth = element.offsetWidth;
    let outerHeight = element.offsetHeight;
    let clientWidth = element.clientWidth;
    let flips = 0;
    let last = 0;
    const observer = new ResizeObserver(() => {
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      if (width !== outerWidth || height !== outerHeight) {
        // 창이나 칸 자체가 바뀌면 왕복이 아니라 배치 변경이다.
        outerWidth = width; outerHeight = height; clientWidth = element.clientWidth;
        flips = 0; last = 0; element.style.overflowY = "";
        return;
      }
      const current = element.clientWidth;
      if (current === clientWidth) return;
      clientWidth = current;
      const now = Date.now();
      flips = now - last <= FLAP_WINDOW_MS ? flips + 1 : 1;
      last = now;
      if (flips >= FLAP_LIMIT) element.style.overflowY = "scroll";
    });
    observer.observe(element);
    return () => { observer.disconnect(); element.style.overflowY = ""; };
  }, [scroll, enabled, marker]);
}
type RowKeys = readonly (readonly (string | number)[])[];
export function useVirtualRows(count: number, estimate: number, supplied?: RefObject<HTMLDivElement | null>, horizontal = false, getItemKey?: (index: number) => string | number, viewport?: { element: HTMLDivElement; margin: number } | null, rowKeys?: RowKeys, scrollPadding?: { start: number; end: number }) {
  const local = useRef<HTMLDivElement>(null);
  const scroll = supplied ?? local;
  const position = useRef(0);
  const hidden = useRef(false);
  const resizeAnchor = useRef<number | null>(null);
  const previous = useRef<{ keys: RowKeys; virtual: Virtualizer<HTMLDivElement, Element> } | null>(null);
  // 새 옵션을 가상화기에 넣기 전에 이전 행의 화면 범위를 읽는다.
  const reset = useMemo(() => {
    const old = previous.current;
    if (!rowKeys || !old || old.keys === rowKeys) return false;
    const before = old.keys.flat();
    const after = rowKeys.flat();
    if (before.length === after.length && before.every((key, index) => key === after[index])) return false;
    const offset = old.virtual.scrollOffset ?? 0;
    if (offset === 0) return false;
    const size = horizontal ? old.virtual.scrollRect?.width : old.virtual.scrollRect?.height;
    const next = new Set(after);
    return !old.virtual.getVirtualItems().some((row) => row.end > offset && row.start < offset + (size ?? 0)
      && old.keys[row.index]?.some((key) => next.has(key)));
  }, [rowKeys]);
  // 행 높이를 자리 번호가 아니라 줄에 담긴 항목으로 기억한다. 창 폭이 바뀌면 같은 항목이
  // 다른 줄 묶음으로 나뉘어 자리 번호의 뜻이 달라지는데, 자리 번호로 기억하면 예전 폭에서
  // 잰 높이가 남아 전체 높이와 스크롤 자리가 어긋난다.
  const rowIdentity = useMemo(() => rowKeys
    ? (index: number) => `${index}\u0000${rowKeys[index]?.join("\u0001") ?? ""}`
    : undefined, [rowKeys]);
  const virtual = useVirtualizer({
    count, getScrollElement: () => viewport?.element ?? scroll.current, estimateSize: () => estimate, overscan: 4, horizontal,
    getItemKey: getItemKey ?? rowIdentity,
    scrollMargin: viewport?.margin ?? 0,
    scrollPaddingStart: scrollPadding?.start ?? 0,
    scrollPaddingEnd: scrollPadding?.end ?? 0,
    initialRect: { width: 800, height: 480 },
    // display:none은 행의 실제 크기가 아니다. 숨김 중의 0을 캐시하면
    // 다시 그리지 않은 앞쪽 행들이 계속 높이 0으로 남는다.
    measureElement: (element, entry, instance) => {
      if (!(horizontal ? instance.scrollElement?.clientWidth : instance.scrollElement?.clientHeight)) {
        const index = instance.indexFromElement(element);
        return instance.itemSizeCache.get(instance.options.getItemKey(index)) ?? instance.options.estimateSize(index);
      }
      return measureElement(element, entry, instance);
    },
    observeElementOffset: (instance, callback) => observeElementOffset(instance, (offset, scrolling) => {
      if (!(horizontal ? instance.scrollElement?.clientWidth : instance.scrollElement?.clientHeight)) return;
      position.current = offset;
      callback(offset, scrolling);
    }),
    observeElementRect: (instance, callback) => observeElementRect(instance, (rect) => {
      const size = horizontal ? rect.width : rect.height;
      if (!size) { hidden.current = true; return; }
      let restored = false;
      if (hidden.current) {
        hidden.current = false;
        const offset = instance.getTotalSize() <= size ? 0 : position.current;
        instance.scrollToOffset(offset);
        restored = true;
      }
      const oldHeight = instance.scrollRect?.height ?? 0;
      const oldTop = instance.scrollOffset ?? 0;
      const index = resizeAnchor.current;
      const anchor = index === null ? undefined : instance.getVirtualItems().find((item) => item.index === index);
      const preserve = !horizontal && !restored && oldHeight > 0 && rect.height > 0 && rect.height < oldHeight && anchor !== undefined
        && anchor.end > oldTop + (instance.options.scrollPaddingStart ?? 0)
        && anchor.start < oldTop + oldHeight - (instance.options.scrollPaddingEnd ?? 0);
      callback(rect);
      if (preserve && index !== null) {
        const element = instance.elementsCache.get(instance.options.getItemKey(index));
        const viewport = instance.scrollElement;
        const overflow = element && viewport ? element.getBoundingClientRect().bottom - viewport.getBoundingClientRect().bottom : 0;
        if (overflow > 0) instance.scrollToOffset(oldTop + overflow);
        else instance.scrollToIndex(index, { align: "auto" });
      }
    }),
  });
  useLayoutEffect(() => {
    if (rowKeys) previous.current = { keys: rowKeys, virtual };
    if (reset) { position.current = 0; virtual.scrollToOffset(0); }
  }, [rowKeys, reset, virtual]);
  return { scroll, virtual, resizeAnchor };
}
export function useRoving<T extends { key: string }>(items: T[], selected: unknown, scroll: RefObject<HTMLDivElement | null>, virtual?: Virtualizer<HTMLDivElement, Element>, rowOf?: (index: number) => number, noInitialScroll = false, initialReady = true) {
  const [focusKey, setFocusKey] = useState<string | null>(() => items.find((item) => item.key === selected)?.key ?? items[0]?.key ?? null);
  const previousIndex = useRef(0);
  const entryKey = items.some((item) => item.key === focusKey) ? focusKey : focusKey === null
    ? items.find((item) => item.key === selected)?.key ?? items[0]?.key ?? null
    : items[Math.min(previousIndex.current, items.length - 1)]?.key ?? null;
  const entryIndex = Math.max(0, items.findIndex((item) => item.key === entryKey));
  const setFocus = (index: number) => { previousIndex.current = index; setFocusKey(items[index]?.key ?? null); };
  const pending = useRef<string | null>(null);
  const initial = useRef(false);
  useEffect(() => {
    if (!initial.current && initialReady && items.length) {
      initial.current = true;
      const index = items.findIndex((item) => item.key === selected);
      if (index >= 0) { setFocus(index); if (!noInitialScroll) virtual?.scrollToIndex(rowOf ? rowOf(index) : index, { align: "auto" }); }
    }
  }, [items, selected, virtual, rowOf, noInitialScroll, initialReady]);
  useEffect(() => {
    previousIndex.current = entryIndex;
    if (focusKey !== entryKey) setFocusKey(entryKey);
  }, [focusKey, entryKey, entryIndex]);
  useEffect(() => {
    if (pending.current === null) return;
    const index = items.findIndex((item) => item.key === pending.current);
    if (index < 0) { pending.current = null; return; }
    const target = scroll.current?.querySelector<HTMLElement>(`[data-focus-index="${index}"]`);
    if (target) { target.focus(); pending.current = null; }
  });
  const move = (next: number) => {
    next = Math.max(0, Math.min(items.length - 1, next));
    if (next < 0) return;
    setFocus(next); pending.current = items[next].key;
    virtual?.scrollToIndex(rowOf ? rowOf(next) : next, { align: "auto" });
    const target = scroll.current?.querySelector<HTMLElement>(`[data-focus-index="${next}"]`);
    if (target) { target.focus(); pending.current = null; }
  };
  const keyDown = (event: KeyboardEvent, index: number, select: () => void, columns = 1, selectMoved?: (index: number) => void) => {
    let next = index;
    if (event.key === "ArrowDown") next += columns;
    else if (event.key === "ArrowUp") next -= columns;
    else if (columns > 1 && event.key === "ArrowRight") next++;
    else if (columns > 1 && event.key === "ArrowLeft") next--;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Enter") { event.preventDefault(); select(); return; }
    else return;
    event.preventDefault();
    next = Math.max(0, Math.min(items.length - 1, next));
    move(next);
    if (next !== index) selectMoved?.(next);
  };
  return { focus: entryIndex, setFocus, keyDown };
}
export function keepRovingRow(virtual: Virtualizer<HTMLDivElement, Element>, index: number, pinnedIndex?: number) {
  virtual.setOptions({ ...virtual.options, rangeExtractor: (range) => {
    const visible = defaultRangeExtractor(range);
    if (!visible.includes(index) && index >= 0 && index < range.count) visible.push(index);
    if (pinnedIndex !== undefined && !visible.includes(pinnedIndex) && pinnedIndex >= 0 && pinnedIndex < range.count) visible.push(pinnedIndex);
    return visible.sort((a, b) => a - b);
  } });
}
export function VirtualSurface({ virtual, children }: { virtual: Virtualizer<HTMLDivElement, Element>; children: ReactNode }) {
  return <div style={{ height: virtual.getTotalSize(), position: "relative", width: "100%" }}>{children}</div>;
}
