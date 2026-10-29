import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import type { Badge as BadgeValue, Group } from "../contract/contract";
import { Badge, isBadge } from "../components/badge";
import { DataIcon } from "../components/data-icons";
import { EmptyState } from "../components/primitives";

export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export function asArray(value: unknown): unknown[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }
export function groups<T>(value: unknown, grouped: boolean, valid: (item: unknown) => item is T): Group<T>[] {
  const values = asArray(value);
  if (!grouped) return [{ title: "", items: values.filter(valid) }];
  return values.filter((g): g is Record<string, unknown> => isObject(g) && typeof g.title === "string" && "items" in g).map((g) => ({ title: g.title as string, meta: typeof g.meta === "string" ? g.meta : undefined, items: asArray(g.items).filter(valid) }));
}
export function Badges({ values }: { values: unknown }) {
  const badges = asArray(values).filter(isBadge);
  return badges.length ? <span className="ks-view-badges">{badges.map((badge: BadgeValue, i: number) => <Badge key={i} value={badge} />)}</span> : null;
}
export function GroupHeading({ title, meta }: { title: string; meta?: string }) {
  return <div className="ks-view-group"><strong>{title}</strong>{meta && <span>{meta}</span>}</div>;
}
export function NoItems() { return <EmptyState icon={<DataIcon name="list-filter" size="empty" />} text="없음" />; }
export function dateText(value: unknown) {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(date);
}
export function useVirtualRows(count: number, estimate: number, supplied?: RefObject<HTMLDivElement | null>) {
  const local = useRef<HTMLDivElement>(null);
  const scroll = supplied ?? local;
  const virtual = useVirtualizer({ count, getScrollElement: () => scroll.current, estimateSize: () => estimate, overscan: 4, initialRect: { width: 800, height: 480 } });
  return { scroll, virtual };
}
export function useRoving<T extends { key: string }>(items: T[], selected: unknown, scroll: RefObject<HTMLDivElement | null>, virtual?: Virtualizer<HTMLDivElement, Element>, rowOf?: (index: number) => number) {
  const [focus, setFocus] = useState(() => Math.max(0, items.findIndex((item) => item.key === selected)));
  const pending = useRef<number | null>(null);
  const initial = useRef(false);
  useEffect(() => {
    if (!initial.current && items.length) {
      initial.current = true;
      const index = items.findIndex((item) => item.key === selected);
      if (index >= 0) { setFocus(index); virtual?.scrollToIndex(rowOf ? rowOf(index) : index, { align: "auto" }); }
    }
  }, [items, selected, virtual, rowOf]);
  useEffect(() => {
    if (pending.current === null) return;
    const target = scroll.current?.querySelector<HTMLElement>(`[data-focus-index="${pending.current}"]`);
    if (target) { target.focus(); pending.current = null; }
  });
  const move = (next: number) => {
    next = Math.max(0, Math.min(items.length - 1, next));
    if (next < 0) return;
    setFocus(next); pending.current = next;
    virtual?.scrollToIndex(rowOf ? rowOf(next) : next, { align: "auto" });
    const target = scroll.current?.querySelector<HTMLElement>(`[data-focus-index="${next}"]`);
    if (target) { target.focus(); pending.current = null; }
  };
  const keyDown = (event: KeyboardEvent, index: number, select: () => void, columns = 1) => {
    let next = index;
    if (event.key === "ArrowDown") next += columns;
    else if (event.key === "ArrowUp") next -= columns;
    else if (columns > 1 && event.key === "ArrowRight") next++;
    else if (columns > 1 && event.key === "ArrowLeft") next--;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Enter") { event.preventDefault(); select(); return; }
    else return;
    event.preventDefault(); move(next);
  };
  return { focus, setFocus, keyDown };
}
export function VirtualSurface({ virtual, children }: { virtual: Virtualizer<HTMLDivElement, Element>; children: ReactNode }) {
  return <div style={{ height: virtual.getTotalSize(), position: "relative", width: "100%" }}>{children}</div>;
}
