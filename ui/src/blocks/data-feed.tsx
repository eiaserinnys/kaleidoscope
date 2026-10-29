import { useLayoutEffect, useMemo, useRef } from "react";
import type { Block, FeedEntry } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { validColor } from "../components/badge";
import { DataState } from "../components/data-state";
import { isMedia, MediaThumbnail } from "../components/media-thumbnail";
import { useBinding, useWindowData } from "../data/window-data";
import type { BlockContext } from "./block-context";
import { MarkdownText } from "./markdown-text";
import { GroupHeading, NoItems, VirtualSurface, groups, isObject, useVirtualRows } from "./data-view-common";

const valid = (value: unknown): value is FeedEntry => isObject(value) && typeof value.key === "string" && (typeof value.body === "string" || (Array.isArray(value.body) && value.body.every((v) => typeof v === "string")));
type Row = { kind: "heading"; title: string; meta?: string } | { kind: "entry"; entry: FeedEntry };
export function FeedBlock({ block, context, pointer }: { block: Extract<Block, { type: "feed" }>; context: BlockContext; pointer: string }) {
  const value = useBinding(`${pointer}/entries`, block.entries);
  if (value.status !== "ready") return <DataState value={value} />;
  return <FeedReady block={block} context={context} pointer={pointer} value={value.value} />;
}
function FeedReady({ block, context, pointer, value }: { block: Extract<Block, { type: "feed" }>; context: BlockContext; pointer: string; value: unknown }) {
  const data = useWindowData();
  const rows = useMemo(() => groups(value, Boolean(block.grouped), valid).flatMap((group): Row[] => [...(block.grouped ? [{ kind: "heading" as const, title: group.title, meta: group.meta }] : []), ...group.items.map((entry) => ({ kind: "entry" as const, entry }))]), [value, block.grouped]);
  const { scroll, virtual } = useVirtualRows(rows.length, 72);
  const atEnd = useRef(true); const lastCount = useRef(0);
  useLayoutEffect(() => { if (block.follow && atEnd.current && rows.length > lastCount.current && rows.length) virtual.scrollToIndex(rows.length - 1, { align: "end" }); lastCount.current = rows.length; }, [rows.length, block.follow, virtual]);
  const selected = block.selected ? context.window.state[block.selected.state] : null;
  if (!rows.some((row) => row.kind === "entry")) return <NoItems />;
  const vrows = virtual.getVirtualItems(); const first = virtual.getVirtualItemForOffset(scroll.current?.scrollTop ?? 0)?.index ?? 0;
  const heading = block.grouped ? rows.slice(0, first + 1).reverse().find((r) => r.kind === "heading") : undefined;
  return <div className="ks-data-view ks-feed" ref={scroll} onScroll={(e) => { const el = e.currentTarget; const line = parseFloat(getComputedStyle(el).lineHeight) || 21; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight <= line; }}>
    {heading?.kind === "heading" && first > 0 && <div className="ks-view-sticky"><GroupHeading title={heading.title} meta={heading.meta} /></div>}
    <VirtualSurface virtual={virtual}>{vrows.map((v) => {
      const row = rows[v.index];
      return <div data-index={v.index} key={v.key} ref={virtual.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${v.start}px)` }}>
        {row.kind === "heading" ? <GroupHeading title={row.title} meta={row.meta} /> : <article className={`ks-feed-entry${row.entry.key === selected ? " is-selected" : ""}${block.on_select ? " is-selectable" : ""}`} onClick={() => { if (block.on_select && !globalThis.getSelection()?.toString()) void data.act(`${pointer}/on_select`, row.entry.key, row.entry as unknown as JsonValue); }}>
          {isMedia(row.entry.image) && <MediaThumbnail media={row.entry.image} size={24} className="ks-feed-avatar" />}
          <div className="ks-feed-content"><div className="ks-feed-header">{typeof row.entry.name === "string" && <strong style={validColor(row.entry.color) ? { color: row.entry.color } : undefined}>{row.entry.name}</strong>}{typeof row.entry.meta === "string" && <span className="ks-view-meta">{row.entry.meta}</span>}</div>
            <div className={`ks-feed-body tone-${row.entry.tone ?? "default"}`}>{(typeof row.entry.body === "string" ? [row.entry.body] : row.entry.body).map((line, index) => <div key={index}>{block.format === "markdown" ? <MarkdownText>{line}</MarkdownText> : line}</div>)}</div>
          </div>
        </article>}
      </div>;
    })}</VirtualSurface>
  </div>;
}
