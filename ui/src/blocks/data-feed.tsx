import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Block, FeedEntry } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { validColor } from "../components/badge";
import { DataState } from "../components/data-state";
import { isMedia, MediaThumbnail } from "../components/media-thumbnail";
import { useBinding, useWindowData } from "../data/window-data";
import type { BlockContext } from "./block-context";
import { MarkdownText } from "./markdown-text";
import { GroupHeading, NoItems, VirtualSurface, groups, isObject, keepRovingRow, useRoving, useVirtualRows } from "./data-view-common";
import { IconButton } from "../components/primitives";
import { DataIcon } from "../components/data-icons";

const valid = (value: unknown): value is FeedEntry => isObject(value) && typeof value.key === "string" && (typeof value.body === "string" || (Array.isArray(value.body) && value.body.every((v) => typeof v === "string")));
type Row = { kind: "heading"; title: string; meta?: string } | { kind: "entry"; entry: FeedEntry; index: number };
export function FeedBlock({ block, context, pointer }: { block: Extract<Block, { type: "feed" }>; context: BlockContext; pointer: string }) {
  const value = useBinding(`${pointer}/entries`, block.entries);
  if (value.status !== "ready") return <DataState value={value} />;
  return <FeedReady block={block} context={context} pointer={pointer} value={value.value} />;
}
function FeedReady({ block, context, pointer, value }: { block: Extract<Block, { type: "feed" }>; context: BlockContext; pointer: string; value: unknown }) {
  const data = useWindowData();
  const rows = useMemo(() => {
    let index = 0;
    return groups(value, Boolean(block.grouped), valid).flatMap((group): Row[] => [...(block.grouped ? [{ kind: "heading" as const, title: group.title, meta: group.meta }] : []), ...group.items.map((entry) => ({ kind: "entry" as const, entry, index: index++ }))]);
  }, [value, block.grouped]);
  const items = useMemo(() => block.on_select ? rows.flatMap((row) => row.kind === "entry" ? [row.entry] : []) : [], [rows, block.on_select]);
  const entryRows = useMemo(() => rows.flatMap((row, index) => row.kind === "entry" ? [index] : []), [rows]);
  const { scroll, virtual } = useVirtualRows(rows.length, 72);
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
  const selected = block.selected ? context.window.state[block.selected.state] : null;
  const rowOf = (index: number) => entryRows[index] ?? 0;
  const roving = useRoving(items, selected, scroll, virtual, rowOf);
  if (block.on_select && items.length) keepRovingRow(virtual, rowOf(roving.focus));
  const atEnd = useRef(true); const lastCount = useRef(0);
  useLayoutEffect(() => { if (block.follow && atEnd.current && rows.length > lastCount.current && rows.length) virtual.scrollToIndex(rows.length - 1, { align: "end" }); lastCount.current = rows.length; }, [rows.length, block.follow, virtual]);
  if (!rows.some((row) => row.kind === "entry")) return <NoItems />;
  const choose = (entry: FeedEntry) => { if (block.on_select && !globalThis.getSelection()?.toString()) void data.act(`${pointer}/on_select`, entry.key, entry as unknown as JsonValue); };
  const vrows = virtual.getVirtualItems(); const first = virtual.getVirtualItemForOffset(scroll.current?.scrollTop ?? 0)?.index ?? 0;
  const heading = block.grouped ? rows.slice(0, first + 1).reverse().find((r) => r.kind === "heading") : undefined;
  return <div className="ks-data-view ks-feed" ref={scroll} role="feed" onScroll={(e) => { const el = e.currentTarget; const line = parseFloat(getComputedStyle(el).lineHeight) || 21; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight <= line; }}>
    {heading?.kind === "heading" && first > 0 && <div className="ks-view-sticky"><GroupHeading title={heading.title} meta={heading.meta} /></div>}
    <VirtualSurface virtual={virtual}>{vrows.map((v) => {
      const row = rows[v.index];
      return <div data-index={v.index} key={v.key} ref={virtual.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${v.start}px)` }}>
        {row.kind === "heading" ? <GroupHeading title={row.title} meta={row.meta} /> : <article aria-setsize={entryRows.length} aria-posinset={row.index + 1} className={`ks-feed-entry${row.entry.key === selected ? " is-selected" : ""}${block.on_select ? " is-selectable" : ""}`} aria-current={row.entry.key === selected ? "true" : undefined} data-focus-index={block.on_select ? row.index : undefined} tabIndex={block.on_select ? roving.focus === row.index ? 0 : -1 : undefined} onFocus={block.on_select ? () => roving.setFocus(row.index) : undefined} onKeyDown={block.on_select ? (event) => { if (event.target === event.currentTarget) roving.keyDown(event, row.index, () => choose(row.entry)); } : undefined} onClick={() => choose(row.entry)}>
          {isMedia(row.entry.image) && <MediaThumbnail media={row.entry.image} size={24} className="ks-feed-avatar" />}
          <div className="ks-feed-content"><div className="ks-feed-header">{typeof row.entry.name === "string" && <strong style={validColor(row.entry.color) ? { color: row.entry.color } : undefined}>{row.entry.name}</strong>}{typeof row.entry.meta === "string" && (block.copy
            ? <span className="ks-feed-meta-copy"><span className="ks-view-meta">{row.entry.meta}</span>{copyButton(`${row.index}:meta`, row.entry.meta)}</span>
            : <span className="ks-view-meta">{row.entry.meta}</span>)}</div>
            <div className={`ks-feed-body tone-${row.entry.tone ?? "default"}${block.columns ? " is-columns" : ""}`}>{(typeof row.entry.body === "string" ? [row.entry.body] : row.entry.body).map((line, index) => block.copy
              ? <div className="ks-feed-copy-cell" key={index}>{block.format === "markdown" ? <MarkdownText>{line}</MarkdownText> : line}{copyButton(`${row.index}:body:${index}`, line)}</div>
              : <div key={index}>{block.format === "markdown" ? <MarkdownText>{line}</MarkdownText> : line}</div>)}</div>
          </div>
        </article>}
      </div>;
    })}</VirtualSurface>
  </div>;
}
