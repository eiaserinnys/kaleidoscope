import { encodeCommentKey } from "../comments/key";
import { useBlockRootProps } from "../comments/block-root";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { BindingMore, Block } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { useBinding, useDormant, useWindowData } from "../data/window-data";
import { useWindowVisible } from "../data/window-state";
import { useLoadMore } from "./load-more";
import { ItemScopeProvider, useItemScope, type ItemScope, type RepeatLocator } from "../data/item-scope";
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
  // 동작은 부모 범위의 현재 모습을 따라가야 한다. 렌더를 일으키지 않는 참조로 넘겨 행의 memo를 지킨다.
  const parentRef = useRef<ItemScope | null>(null);
  parentRef.current = parent;
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
  // 행 반복은 칸 폭을 내용이 정하므로 템플릿 막대로 미리 맞출 수 없다. 나머지는 받은 뒤 배치의 뼈대를 쓴다.
  if (value.status !== "ready") return <DataState rootProps={blockRoot} value={value} loading={(block.layout ?? "column") !== "row" ? <RepeatLoading block={block} /> : undefined} />;
  return <RepeatReady block={block} context={context} pointer={pointer} entries={entries} parent={parent?.item} parentRef={parentRef} follow={follow.status === "ready" ? follow.value : null} more={value.more} />;
}

const Row = memo(function Row({ item, itemKey, index, parent, parentRef, locator, template, context, pointer }: {
  item: JsonValue; itemKey: string | number; index: { current: number }; parent?: JsonValue; parentRef: { current: ItemScope | null }; locator: RepeatLocator; template: Block; context: BlockContext; pointer: string;
}) {
  const instance = useRef({});
  const scope = useMemo<ItemScope>(() => ({ item, parent_item: parent, key: itemKey, get index() { return index.current; }, instance: instance.current, locator, get parentScope() { return parentRef.current ?? undefined; } }), [item, parent, itemKey, index, locator, parentRef]);
  return <div className="ks-repeat-item" data-repeat-key={String(itemKey)} data-ks-comment-key={encodeCommentKey(itemKey)}><ItemScopeProvider value={scope}>{renderBlock(template, context, `${pointer}/template`)}</ItemScopeProvider></div>;
});

// 열 수는 첫 페인트 전에 맞춘다. 빈 반복은 자리가 display: none이라 폭이 0으로 재지므로,
// 비어 있음이 바뀌는 순간에도 다시 재야 항목이 도착한 첫 프레임부터 여러 열로 그린다.
function useRepeatGridColumns(root: RefObject<HTMLDivElement | null>, block: Repeat, remeasure: unknown) {
  const [columns, setColumns] = useState(1);
  const layout = block.layout ?? "column";
  useLayoutEffect(() => {
    if (layout !== "grid" || !root.current) return;
    const element = root.current;
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
  }, [layout, block.grid?.columns, block.grid?.item_width, block.gap, remeasure]);
  return columns;
}

// 격자와 열 반복은 받은 뒤의 칸 배치를 미리 보여 준다. 칸 수가 같아야 항목이 도착할 때 줄이 흔들리지 않는다.
// 뼈대 칸에는 .ks-repeat-item을 쓰지 않는다. 더 받기와 커멘트 키가 실제 행을 그 클래스로 찾는다.
function RepeatLoading({ block }: { block: Repeat }) {
  const blockRoot = useBlockRootProps();
  const root = useRef<HTMLDivElement>(null);
  const layout = block.layout ?? "column";
  const columns = useRepeatGridColumns(root, block, null);
  return <div {...blockRoot} ref={root} role="status" aria-label="불러오는 중"
    className={`ks-data-view ks-repeat is-${layout}${block.virtual ? " is-virtual" : ""}${block.gap ? ` gap-${block.gap}` : ""} is-loading`}>
    <div className="ks-repeat-content" aria-hidden="true" style={layout === "grid" ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
      {Array.from({ length: layout === "grid" ? columns * 3 : 3 }, (_, index) => <div className="ks-repeat-skeleton-item" key={index}>{skeletonBlock(block.template)}</div>)}
    </div>
  </div>;
}

// 뼈대 칸은 템플릿의 겉틀만 얕게 그려 받은 뒤와 같은 줄 높이를 잡는다.
function skeletonBlock(block: Block): ReactNode {
  if (block.type === "when") return null;
  if (block.type === "section") return <section className="ks-data-section">
    <div className="ks-data-section-header">
      {block.title !== undefined ? <span className="ks-data-section-title">{skeletonLine()}</span> : null}
      {block.meta !== undefined ? <span className="ks-data-section-meta">{skeletonLine()}</span> : null}
    </div>
    <div className="ks-data-section-child">{skeletonBlock(block.child)}</div>
  </section>;
  if (block.type === "stack") return <div className={`ks-data-stack is-${block.direction} gap-${block.gap ?? "none"}`}>
    {block.children.slice(0, 4).map((child, index) => <div className="ks-data-stack-item" key={index}>{skeletonBlock(child)}</div>)}
  </div>;
  if (block.type === "text") return <div className={`ks-data-text is-${block.style ?? "body"}`}>{skeletonLine()}</div>;
  return <div className="ks-repeat-skeleton-block" />;
}

function skeletonLine() {
  // 줄 상자는 글꼴의 줄 높이가 정한다. 보통 공백은 인라인 블록 안에서 접혀 높이가 사라지므로 줄바꿈 없는 공백을 쓴다.
  return <span className="ks-repeat-skeleton-line">{"\u00a0"}</span>;
}

function RepeatReady({ block, context, pointer, entries, parent, parentRef, follow, more }: {
  block: Repeat; context: BlockContext; pointer: string; entries: Entry[]; parent?: JsonValue; parentRef: { current: ItemScope | null }; follow: JsonValue; more?: BindingMore;
}) {
  const locator = useMemo<RepeatLocator>(() => ({ pointer, items: block.items, keyField: block.key }), [pointer, block.items, block.key]);
  const blockRoot = useBlockRootProps();
  const scroll = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<{ element: HTMLDivElement; margin: number } | null>(null);
  const [resume, setResume] = useState(0);
  const pauseUntil = useRef(0);
  const draggingScrollbar = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layout = block.layout ?? "column";
  const horizontal = layout === "row";
  const empty = entries.length === 0;
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
  const columns = useRepeatGridColumns(scroll, block, empty);
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
  const row = (entry: Entry) => <Row key={encodeCommentKey(entry.key)} item={entry.item} itemKey={entry.key} index={entry.index} parent={parent} parentRef={parentRef} locator={locator} template={block.template} context={context} pointer={pointer} />;
  const gridStyle = layout === "grid" ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined;
  return <div {...blockRoot} ref={scroll} className={`ks-data-view ks-repeat is-${layout}${block.virtual ? " is-virtual" : ""}${block.gap ? ` gap-${block.gap}` : ""}${empty && !more ? " is-empty" : ""}`} onWheel={pause} onTouchMove={pause}
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
