import { encodeCommentKey } from "../comments/key";
import { useBlockRootProps } from "../comments/block-root";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BindingMore, Block } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { useBinding, useDormant, useWindowData } from "../data/window-data";
import { useWindowVisible } from "../data/window-state";
import { useLoadMore } from "./load-more";
import { ItemScopeProvider, useItemScope, type ItemScope } from "../data/item-scope";
import { DataState } from "../components/data-state";
import { shareStructure } from "../core/shell-store";
import { renderBlock } from "../render/render-block";
import type { BlockContext } from "./block-context";
import { asArray, DEFAULT_VIRTUAL_ROW_ESTIMATE, isObject, useVirtualRows } from "./data-view-common";
import { nearestScrollable, revealIn } from "./scroll-nearest";

type Repeat = Extract<Block, { type: "repeat" }>;
type Entry = { item: JsonValue; key: string | number; index: { current: number } };

export function RepeatBlock({ block, context, pointer }: { block: Repeat; context: BlockContext; pointer: string }) {
  const blockRoot = useBlockRootProps();
  const value = useBinding(`${pointer}/items`, block.items);
  const follow = useBinding(`${pointer}/follow_key`, block.follow_key ?? null);
  const parent = useItemScope();
  const previous = useRef(new Map<string | number, Entry>());
  const entries = useMemo(() => {
    const result = value.status !== "ready" ? [] : asArray(value.value).flatMap((item, index) => {
      if (!isObject(item)) return [];
      const key = item[block.key];
      if (typeof key !== "string" && typeof key !== "number") return [];
      const old = previous.current.get(key);
      // 행을 다시 그리지 않아도 동작은 현재 순서를 읽어야 한다.
      const position = old?.index ?? { current: index };
      position.current = index;
      return [{ item: shareStructure(old?.item, item as JsonValue) as JsonValue, key, index: position }];
    });
    previous.current = new Map(result.map((entry) => [entry.key, entry]));
    return result;
  }, [value, block.key]);
  useDormant(`${pointer}/template`, entries.length === 0);
  if (value.status !== "ready") return <DataState rootProps={blockRoot} value={value} />;
  return <RepeatReady block={block} context={context} pointer={pointer} entries={entries} parent={parent?.item} follow={follow.status === "ready" ? follow.value : null} more={value.more} />;
}

const Row = memo(function Row({ item, itemKey, index, parent, template, context, pointer }: {
  item: JsonValue; itemKey: string | number; index: { current: number }; parent?: JsonValue; template: Block; context: BlockContext; pointer: string;
}) {
  const instance = useRef({});
  const scope = useMemo<ItemScope>(() => ({ item, parent_item: parent, key: itemKey, get index() { return index.current; }, instance: instance.current }), [item, parent, itemKey, index]);
  return <div className="ks-repeat-item" data-repeat-key={String(itemKey)} data-ks-comment-key={encodeCommentKey(itemKey)}><ItemScopeProvider value={scope}>{renderBlock(template, context, `${pointer}/template`)}</ItemScopeProvider></div>;
});

function RepeatReady({ block, context, pointer, entries, parent, follow, more }: {
  block: Repeat; context: BlockContext; pointer: string; entries: Entry[]; parent?: JsonValue; follow: JsonValue; more?: BindingMore;
}) {
  const blockRoot = useBlockRootProps();
  const scroll = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<{ element: HTMLDivElement; margin: number } | null>(null);
  const [columns, setColumns] = useState(1);
  const [resume, setResume] = useState(0);
  const pauseUntil = useRef(0);
  const draggingScrollbar = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layout = block.layout ?? "column";
  const horizontal = layout === "row";
  useLayoutEffect(() => {
    const root = scroll.current;
    if (!block.virtual || !root) return;
    let observed: HTMLElement | null = null;
    const update = () => {
      let element: HTMLElement | null = root;
      while (element) {
        const style = getComputedStyle(element);
        const overflow = horizontal ? style.overflowX : style.overflowY;
        const clientSize = horizontal ? element.clientWidth : element.clientHeight;
        const scrollSize = horizontal ? element.scrollWidth : element.scrollHeight;
        if (/^(auto|scroll|overlay)$/.test(overflow) && clientSize > 0 && scrollSize > clientSize + 1) break;
        element = element.parentElement;
      }
      element ??= root;
      if (observed !== element) {
        observed?.removeEventListener("scroll", update);
        observed = element;
        observed.addEventListener("scroll", update, { passive: true });
      }
      const rootRect = root.getBoundingClientRect(), scrollRect = element.getBoundingClientRect();
      const margin = element === root ? 0 : horizontal
        ? rootRect.left - scrollRect.left + element.scrollLeft - element.clientLeft
        : rootRect.top - scrollRect.top + element.scrollTop - element.clientTop;
      const target = element as HTMLDivElement;
      setViewport((previous) => previous?.element === target && Math.abs(previous.margin - margin) < 0.5
        ? previous : { element: target, margin });
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    for (let element: HTMLElement | null = root; element; element = element.parentElement) observer?.observe(element);
    return () => { observer?.disconnect(); observed?.removeEventListener("scroll", update); };
  }, [block.virtual, horizontal, entries.length]);
  useEffect(() => {
    if (layout !== "grid" || !scroll.current) return;
    const element = scroll.current;
    if (typeof block.grid?.columns === "number") {
      setColumns(block.grid.columns);
      return;
    }
    const itemWidth = block.grid?.item_width ?? "medium";
    const probe = element.ownerDocument.createElement("span");
    probe.className = "ks-repeat-grid-width-probe";
    probe.setAttribute("aria-hidden", "true");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    probe.style.boxSizing = "border-box";
    probe.style.width = `var(--ks-repeat-grid-item-width-${itemWidth})`;
    probe.style.height = "0";
    const gapToken = { none: "0", small: "var(--ks-space-2)", medium: "var(--ks-space-3)", large: "var(--ks-space-5)" };
    probe.style.marginInlineEnd = block.gap ? gapToken[block.gap] : "var(--ks-space-3)";
    element.append(probe);
    const resize = () => {
      if (!element.clientWidth) return;
      const style = getComputedStyle(element);
      const pane = probe.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(probe).marginInlineEnd);
      if (!Number.isFinite(pane) || !Number.isFinite(gap) || pane <= 0) return;
      const gridWidth = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setColumns(Math.max(1, Math.floor((gridWidth + gap) / (pane + gap))));
    };
    resize(); const observer = new ResizeObserver(resize); observer.observe(element); return () => { observer.disconnect(); probe.remove(); };
  }, [layout, block.grid?.columns, block.grid?.item_width, block.gap]);
  const rowSize = layout === "grid" ? columns : 1;
  const itemKey = useCallback((index: number) => encodeCommentKey(entries[index].key), [entries]);
  const rowKeys = useMemo(() => Array.from({ length: Math.ceil(entries.length / rowSize) }, (_, i) => entries.slice(i * rowSize, (i + 1) * rowSize).map((entry) => entry.key)), [entries, rowSize]);
  const { virtual } = useVirtualRows(Math.ceil(entries.length / rowSize), DEFAULT_VIRTUAL_ROW_ESTIMATE, scroll, horizontal, layout === "grid" ? undefined : itemKey, viewport, rowKeys);
  const virtualRows = virtual.getVirtualItems();
  const followIndex = entries.findIndex((entry) => entry.key === follow);
  useEffect(() => {
    if (followIndex < 0 || Date.now() < pauseUntil.current) return;
    const root = scroll.current;
    if (!root) return;
    const scroller = nearestScrollable(root, horizontal);
    if (!scroller) return;
    if (block.virtual) virtual.scrollToIndex(Math.floor(followIndex / rowSize), { align: "auto" });
    else {
      const row = root.querySelector(":scope > .ks-repeat-content")?.children[followIndex] as HTMLElement | undefined;
      if (row) revealIn(row, scroller, horizontal);
    }
  }, [followIndex, follow, block.virtual, rowSize, virtual, resume, horizontal]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const pause = () => {
    const ms = block.follow_pause_ms ?? 2500;
    pauseUntil.current = Date.now() + ms;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setResume((n) => n + 1), ms);
  };
  const row = (entry: Entry) => <Row key={encodeCommentKey(entry.key)} item={entry.item} itemKey={entry.key} index={entry.index} parent={parent} template={block.template} context={context} pointer={pointer} />;
  const gridStyle = layout === "grid" ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined;
  return <div {...blockRoot} ref={scroll} className={`ks-data-view ks-repeat is-${layout}${block.virtual ? " is-virtual" : ""}${block.gap ? ` gap-${block.gap}` : ""}`} onWheel={pause} onTouchMove={pause}
    onPointerDown={(event) => { if (event.target === event.currentTarget) { draggingScrollbar.current = true; pause(); } }}
    onPointerUp={() => { draggingScrollbar.current = false; }} onPointerCancel={() => { draggingScrollbar.current = false; }}
    onScroll={() => { if (draggingScrollbar.current) pause(); }}
    onKeyDown={(event) => { if (event.target === event.currentTarget && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) pause(); }}>
    {block.virtual ? <div style={horizontal ? { width: virtual.getTotalSize(), height: "100%", position: "relative" } : { height: virtual.getTotalSize(), width: "100%", position: "relative" }}>
      {virtualRows.map((virtualRow) => <div key={virtualRow.key} data-index={virtualRow.index} ref={virtual.measureElement}
        className={`ks-repeat-virtual-row${layout === "grid" ? " ks-repeat-grid-row" : ""}${virtualRow.index === Math.ceil(entries.length / rowSize) - 1 ? " is-last" : ""}`}
        style={{ position: "absolute", top: 0, left: 0, ...(horizontal ? { height: "100%", transform: `translateX(${virtualRow.start - (viewport?.margin ?? 0)}px)` } : { width: "100%", transform: `translateY(${virtualRow.start - (viewport?.margin ?? 0)}px)` }), ...gridStyle }}>
        {entries.slice(virtualRow.index * rowSize, (virtualRow.index + 1) * rowSize).map(row)}
      </div>)}
    </div> : <div className="ks-repeat-content" style={gridStyle}>{entries.map(row)}</div>}
    {block.virtual && !horizontal && more ? <RepeatLoadMore more={more} rows={Math.ceil(entries.length / rowSize)} last={virtualRows.at(-1)?.index ?? -1} context={context} /> : null}
  </div>;
}

function RepeatLoadMore({ more, rows, last, context }: { more: BindingMore; rows: number; last: number; context: BlockContext }) {
  const data = useWindowData();
  const visible = useWindowVisible(context);
  return useLoadMore(more, rows, last, data, visible);
}
