import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BindingMore, Block, FeedEntry } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { validColor } from "../components/badge";
import { DataState } from "../components/data-state";
import { isMedia, MediaThumbnail } from "../components/media-thumbnail";
import { useBinding, useWindowData } from "../data/window-data";
import type { BlockContext } from "./block-context";
import { useItemMenu } from "./item-menu";
import { MarkdownText } from "./markdown-text";
import { Badges, GroupHeading, NoItems, VirtualSurface, asArray, asBadges, groups, isObject, keepRovingRow, useRoving, useVirtualRows } from "./data-view-common";
import { IconButton } from "../components/primitives";
import { DataIcon } from "../components/data-icons";
import { useWindowStateValue, useWindowVisible } from "../data/window-state";
import { useLoadMore } from "./load-more";

function asFeedEntry(value: unknown): FeedEntry | null {
  if (!isObject(value) || typeof value.key !== "string" || !(typeof value.body === "string" || (Array.isArray(value.body) && value.body.every((part) => typeof part === "string")))) return null;
  const entry = { ...value, key: value.key, body: value.body as FeedEntry["body"] } as FeedEntry;
  const name = typeof value.name === "string" ? value.name : typeof value.author === "string" ? value.author : undefined;
  const meta = typeof value.meta === "string" ? value.meta : typeof value.timestamp === "string" ? value.timestamp : undefined;
  const depth = typeof value.depth === "number" && value.depth >= 0 ? Math.floor(value.depth) : undefined;
  if (name === undefined) delete entry.name; else entry.name = name;
  if (meta === undefined) delete entry.meta; else entry.meta = meta;
  if (depth === undefined) delete entry.depth; else entry.depth = depth;
  if ("badges" in value) entry.badges = asBadges(value.badges); else delete entry.badges;
  if ("children" in value) entry.children = asArray(value.children).flatMap((child) => { const parsed = asFeedEntry(child); return parsed ? [parsed] : []; });
  else delete entry.children;
  return entry;
}
const valid = (value: unknown): value is FeedEntry => isObject(value) && typeof value.key === "string" && (typeof value.body === "string" || (Array.isArray(value.body) && value.body.every((part) => typeof part === "string")));
type FlattenedFeedItem = { entry: FeedEntry; depth: number; replyCount: number };
function flattenFeedEntries(entries: FeedEntry[]): FlattenedFeedItem[] {
  const flattened: FlattenedFeedItem[] = [];
  const walk = (entry: FeedEntry, parentDepth: number, nested: boolean) => {
    const depth = entry.depth ?? (nested ? parentDepth + 1 : 0);
    flattened.push({ entry, depth, replyCount: 0 });
    (entry.children ?? []).forEach((child) => walk(child, depth, true));
  };
  entries.forEach((entry) => walk(entry, 0, false));
  const ancestors: number[] = [];
  for (let index = 0; index < flattened.length; index++) {
    while (ancestors.length && flattened[ancestors[ancestors.length - 1]].depth >= flattened[index].depth) {
      const ancestor = ancestors.pop()!;
      flattened[ancestor].replyCount = index - ancestor - 1;
    }
    ancestors.push(index);
  }
  while (ancestors.length) {
    const ancestor = ancestors.pop()!;
    flattened[ancestor].replyCount = flattened.length - ancestor - 1;
  }
  return flattened;
}
type Row = { kind: "heading"; title: string; meta?: string; groupKey: string; collapsed: boolean } | { kind: "entry"; item: FlattenedFeedItem; index: number };
type FeedHandlers = {
  focus: (index: number) => void;
  keyDown: (event: React.KeyboardEvent<HTMLElement>, index: number, entry: FeedEntry) => void;
  choose: (entry: FeedEntry) => void;
  menu: (event: React.MouseEvent<HTMLElement>, entry: FeedEntry) => void;
  toggle: (key: string) => void;
  copy: (target: string, text: string) => React.ReactNode;
};
const FeedRow = memo(function FeedRow({ item, index, count, collapsed, active, focused, selectable, copy, columns, format, collapsible, handlers }: { item: FlattenedFeedItem; index: number; count: number; collapsed: boolean; active: boolean; focused: boolean; selectable: boolean; copy: boolean; columns: boolean; format: string | undefined; collapsible: boolean; feedback: string; handlers: React.RefObject<FeedHandlers> }) {
  const entry = item.entry;
  const canCollapse = collapsible || item.replyCount > 0;
  const collapseLabel = collapsed ? item.replyCount ? `답글 ${item.replyCount}개 펴기` : "본문 펴기" : item.replyCount ? `답글 ${item.replyCount}개 접기` : "접기";
  return <article aria-setsize={count} aria-posinset={index + 1} className={`ks-feed-entry${item.depth > 0 ? " ks-feed-entry-nested" : ""}${collapsed ? " is-collapsed" : ""}${active ? " is-selected" : ""}${selectable ? " is-selectable" : ""}`} aria-current={active ? "true" : undefined} data-depth={item.depth} style={{ "--ks-feed-depth": Math.min(item.depth, 6) } as React.CSSProperties} data-focus-index={index} tabIndex={focused ? 0 : -1} onFocus={() => handlers.current.focus(index)} onKeyDown={(event) => { if (event.target === event.currentTarget) handlers.current.keyDown(event, index, entry); }} onClick={() => handlers.current.choose(entry)} onContextMenu={(event) => handlers.current.menu(event, entry)}>
    {isMedia(entry.image) && <MediaThumbnail media={entry.image} size={24} className="ks-feed-avatar" />}
    <div className="ks-feed-content"><div className={`ks-feed-header${copy || canCollapse ? " is-copy" : ""}`}>
      <div className="ks-feed-ident"><div className="ks-feed-name-line">{typeof entry.name === "string" && <strong style={validColor(entry.color) ? { color: entry.color } : undefined}>{entry.name}</strong>}<Badges values={entry.badges} />{(collapsed || item.replyCount > 0) && <Badges values={[collapsed ? item.replyCount > 0 ? `답글 ${item.replyCount}개 접힘` : "접힘" : `답글 ${item.replyCount}`]} />}</div>
        {typeof entry.meta === "string" && (copy ? <span className="ks-feed-meta-copy"><span className="ks-view-meta">{entry.meta}</span>{!collapsed && handlers.current.copy(JSON.stringify([entry.key, "meta"]), entry.meta)}</span> : <span className="ks-view-meta">{entry.meta}</span>)}</div>
      <div className="ks-feed-head-actions">{canCollapse && <IconButton className="ks-feed-collapse-btn" aria-label={collapseLabel} title={collapseLabel} onClick={(event) => { event.stopPropagation(); handlers.current.toggle(entry.key); }}><DataIcon name={collapsed ? "chevron-right" : "chevron-down"} /></IconButton>}</div>
    </div>
    {!collapsed && <div className={`ks-feed-body tone-${entry.tone ?? "default"}${columns ? " is-columns" : ""}`}>{(typeof entry.body === "string" ? [entry.body] : entry.body).map((line, part) => copy ? <div className="ks-feed-copy-cell" key={part}>{format === "markdown" ? <MarkdownText>{line}</MarkdownText> : line}{handlers.current.copy(JSON.stringify([entry.key, "body", part]), line)}</div> : <div key={part}>{format === "markdown" ? <MarkdownText>{line}</MarkdownText> : line}</div>)}</div>}
    </div>
  </article>;
});
export function FeedBlock({ block, context, pointer }: { block: Extract<Block, { type: "feed" }>; context: BlockContext; pointer: string }) {
  const value = useBinding(`${pointer}/entries`, block.entries);
  if (value.status !== "ready") return <DataState value={value} />;
  return <FeedReady block={block} context={context} pointer={pointer} value={value.value} more={value.more} />;
}
function FeedReady({ block, context, pointer, value, more }: { block: Extract<Block, { type: "feed" }>; context: BlockContext; pointer: string; value: unknown; more?: BindingMore }) {
  const data = useWindowData();
  const menu = useItemMenu(block.item_menu, pointer);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const rows = useMemo(() => {
    const sourceGroups = groups(value, Boolean(block.grouped), valid);
    const next: Row[] = [];
    let index = 0;
    sourceGroups.forEach((group, groupIndex) => {
      const groupKey = `${groupIndex}:${group.title}`;
      if (block.grouped) next.push({ kind: "heading", title: group.title, meta: group.meta, groupKey, collapsed: collapsedGroups.has(groupKey) });
      const entries = group.items.map((entry) => asFeedEntry(entry)!).filter(Boolean);
      if (collapsedGroups.has(groupKey)) return;
      const flattened = flattenFeedEntries(entries);
      const collapsedDepths: number[] = [];
      for (const item of flattened) {
        while (collapsedDepths.length && collapsedDepths[collapsedDepths.length - 1] >= item.depth) collapsedDepths.pop();
        const hidden = collapsedDepths.length > 0;
        if (!hidden) {
          next.push({ kind: "entry", item, index: index++ });
          if (collapsedKeys.has(item.entry.key)) collapsedDepths.push(item.depth);
        }
      }
    });
    return next;
  }, [value, block.grouped, collapsedGroups, collapsedKeys]);
  const items = useMemo(() => rows.flatMap((row) => row.kind === "entry" ? [row.item.entry] : []), [rows]);
  const entryRows = useMemo(() => rows.flatMap((row, index) => row.kind === "entry" ? [index] : []), [rows]);
  const rowKeys = useMemo(() => rows.map((row) => row.kind === "entry" ? [row.item.entry.key] : []), [rows]);
  const { scroll, virtual } = useVirtualRows(rows.length, 72, undefined, false, undefined, undefined, rowKeys);
  const [copyFeedback, setCopyFeedback] = useState<Record<string, "copied" | "failed">>({});
  const copyTimers = useRef(new Map<string, number>());
  useEffect(() => () => {
    for (const timer of copyTimers.current.values()) window.clearTimeout(timer);
  }, []);
  const copyText = async (target: string, text: string) => {
    let feedback: "copied" | "failed";
    try {
      await navigator.clipboard.writeText(text);
      feedback = "copied";
    } catch {
      feedback = "failed";
    }
    setCopyFeedback((current) => ({ ...current, [target]: feedback }));
    const previous = copyTimers.current.get(target);
    if (previous !== undefined) window.clearTimeout(previous);
    copyTimers.current.set(target, window.setTimeout(() => {
      setCopyFeedback((current) => {
        const next = { ...current };
        delete next[target];
        return next;
      });
      copyTimers.current.delete(target);
    }, 1500));
  };
  const copyButton = (target: string, text: string) => {
    const feedback = copyFeedback[target];
    const title = feedback === "failed" ? "복사하지 못했습니다" : "복사";
    return <span className={`ks-feed-copy-control${feedback ? " is-feedback" : ""}`}>
      <IconButton aria-label="복사" title={title} onClick={(event) => { event.stopPropagation(); void copyText(target, text); }}>
        <DataIcon name={feedback === "copied" ? "check" : feedback === "failed" ? "circle-alert" : "copy"} />
      </IconButton>
    </span>;
  };
  const selectedValue = useWindowStateValue(context, block.selected?.state ?? null);
  const selected = block.selected ? selectedValue : null;
  const rowOf = (index: number) => entryRows[index] ?? 0;
  const roving = useRoving(items, selected, scroll, virtual, rowOf);
  const handlers = useRef<FeedHandlers>(null!);
  if (items.length) keepRovingRow(virtual, rowOf(roving.focus));
  const atEnd = useRef(true); const lastCount = useRef(0);
  useLayoutEffect(() => { if (block.follow && atEnd.current && rows.length > lastCount.current && rows.length) virtual.scrollToIndex(rows.length - 1, { align: "end" }); lastCount.current = rows.length; }, [rows.length, block.follow, virtual]);
  const vrows = virtual.getVirtualItems();
  const footer = useLoadMore(block.follow ? undefined : more, rows.length, vrows.at(-1)?.index ?? -1, data, useWindowVisible(context));
  if (!rows.length && (!more || block.follow)) return <NoItems />;
  const choose = (entry: FeedEntry) => { if (block.on_select && !globalThis.getSelection()?.toString()) void data.act(`${pointer}/on_select`, entry.key, entry as unknown as JsonValue); };
  const toggleEntry = (key: string) => setCollapsedKeys((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleGroup = (key: string) => setCollapsedGroups((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  handlers.current = {
    focus: roving.setFocus,
    keyDown: (event, index, entry) => roving.keyDown(event, index, () => choose(entry)),
    choose,
    menu: (event, entry) => { if (!event.defaultPrevented) menu.open(event, event.currentTarget, entry as unknown as JsonValue, entry.key, "본문 복사", typeof entry.body === "string" ? entry.body : entry.body.join("\n\n")); },
    toggle: toggleEntry,
    copy: copyButton,
  };
  const first = virtual.getVirtualItemForOffset(virtual.scrollOffset ?? 0)?.index ?? 0;
  const heading = block.grouped ? rows.slice(0, first + 1).reverse().find((r) => r.kind === "heading") : undefined;
  return <><div className="ks-data-view ks-feed" ref={scroll} role="feed" onScroll={(e) => { const el = e.currentTarget; const line = parseFloat(getComputedStyle(el).lineHeight) || 21; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight <= line; }}>
    {heading?.kind === "heading" && first > 0 && <div className="ks-view-sticky"><GroupHeading title={heading.title} meta={heading.meta} /></div>}
    <VirtualSurface virtual={virtual}>{vrows.map((v) => {
      const row = rows[v.index];
      return <div data-index={v.index} key={v.key} ref={virtual.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${v.start}px)` }}>
        {row.kind === "heading" ? block.collapsible ? <div className="ks-feed-group-head" role="button" tabIndex={0} aria-expanded={!row.collapsed} onClick={() => toggleGroup(row.groupKey)} onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleGroup(row.groupKey); }
        }}>
          <GroupHeading title={row.title} meta={row.meta} />
          <span className="ks-feed-group-chevron" aria-hidden="true"><DataIcon name={row.collapsed ? "chevron-right" : "chevron-down"} /></span>
        </div> : <GroupHeading title={row.title} meta={row.meta} /> : (() => {
          const entry = row.item.entry;
          const feedback = JSON.stringify([copyFeedback[JSON.stringify([entry.key, "meta"])], ...(typeof entry.body === "string" ? [entry.body] : entry.body).map((_, index) => copyFeedback[JSON.stringify([entry.key, "body", index])])]);
          return <FeedRow item={row.item} index={row.index} count={entryRows.length} collapsed={collapsedKeys.has(entry.key)} active={entry.key === selected} focused={roving.focus === row.index} selectable={Boolean(block.on_select)} copy={Boolean(block.copy)} columns={Boolean(block.columns)} format={block.format} collapsible={Boolean(block.collapsible)} feedback={feedback} handlers={handlers} />;
        })()}
      </div>;
    })}</VirtualSurface>
    {footer}
  </div>{menu.dialog}</>;
}
