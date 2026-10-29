import { useEffect, useMemo, useRef, useState } from "react";
import type { Block, ListItem } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { DataState } from "../components/data-state";
import { validColor } from "../components/badge";
import { isMedia, MediaThumbnail } from "../components/media-thumbnail";
import { useBinding, useWindowData } from "../data/window-data";
import type { BlockContext } from "./block-context";
import { Badges, GroupHeading, NoItems, VirtualSurface, groups, isObject, useRoving, useVirtualRows } from "./data-view-common";

const validItem = (v: unknown): v is ListItem => isObject(v) && typeof v.key === "string" && typeof v.title === "string";
type Row = { kind: "heading"; title: string; meta?: string } | { kind: "items"; items: ListItem[]; start: number };
export function ListBlock({ block, context, pointer }: { block: Extract<Block, { type: "list" }>; context: BlockContext; pointer: string }) {
  const value = useBinding(`${pointer}/items`, block.items);
  if (value.status !== "ready") return <DataState value={value} />;
  return <ListReady block={block} context={context} pointer={pointer} value={value.value} />;
}
function ListReady({ block, context, pointer, value }: { block: Extract<Block, { type: "list" }>; context: BlockContext; pointer: string; value: unknown }) {
  const data = useWindowData();
  const grouped = useMemo(() => groups(value, Boolean(block.grouped), validItem), [value, block.grouped]);
  const items = useMemo(() => grouped.flatMap((group) => group.items), [grouped]);
  const grid = block.layout === "grid";
  const [columns, setColumns] = useState(1);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!grid || !scroll.current) return;
    const element = scroll.current;
    const resize = () => {
      const style = getComputedStyle(element);
      const pane = parseFloat(style.getPropertyValue("--ks-pane-min-size")) || 160;
      const gap = parseFloat(style.getPropertyValue("--ks-space-3")) || 12;
      setColumns(Math.max(1, Math.floor((element.clientWidth - gap) / (pane + gap))));
    };
    resize(); const observer = new ResizeObserver(resize); observer.observe(element); return () => observer.disconnect();
  }, [grid, scroll]);
  const rows = useMemo(() => {
    const result: Row[] = []; let start = 0;
    for (const group of grouped) {
      if (block.grouped) result.push({ kind: "heading", title: group.title, meta: group.meta });
      const step = grid ? columns : 1;
      for (let i = 0; i < group.items.length; i += step) result.push({ kind: "items", items: group.items.slice(i, i + step), start: start + i });
      start += group.items.length;
    }
    return result;
  }, [grouped, block.grouped, grid, columns]);
  const { virtual } = useVirtualRows(rows.length, grid ? 220 : 40, scroll);
  const rowOf = (index: number) => Math.max(0, rows.findIndex((row) => row.kind === "items" && index >= row.start && index < row.start + row.items.length));
  const selected = block.selected ? context.window.state[block.selected.state] : null;
  const roving = useRoving(items, selected, scroll, virtual, rowOf);
  if (!items.length) return <NoItems />;
  const choose = (item: ListItem) => { if (block.on_select) void data.act(`${pointer}/on_select`, item.key, item as unknown as JsonValue); };
  const virtualRows = virtual.getVirtualItems();
  const first = virtual.getVirtualItemForOffset(scroll.current?.scrollTop ?? 0)?.index ?? 0;
  const currentHeading = block.grouped ? rows.slice(0, first + 1).reverse().find((row) => row.kind === "heading") : undefined;
  return <div className={`ks-data-view ks-list${grid ? " is-grid" : ""}`} ref={scroll} role="listbox" aria-label="목록">
    {currentHeading?.kind === "heading" && first > 0 ? <div className="ks-view-sticky"><GroupHeading title={currentHeading.title} meta={currentHeading.meta} /></div> : null}
    <VirtualSurface virtual={virtual}>{virtualRows.map((row) => {
      const entry = rows[row.index];
      return <div className={grid && entry.kind === "items" ? "ks-list-grid-row" : undefined} key={row.key} data-index={row.index} ref={virtual.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start}px)` }}>
        {entry.kind === "heading" ? <GroupHeading title={entry.title} meta={entry.meta} /> : entry.items.map((item, n) => {
          const index = entry.start + n; const active = item.key === selected;
          return <button type="button" role="option" aria-selected={active} aria-label={item.title} data-focus-index={index} tabIndex={roving.focus === index ? 0 : -1} className={`${grid ? "ks-list-card" : "ks-row ks-list-row"}${active ? " is-selected" : ""}`} key={item.key} onFocus={() => roving.setFocus(index)} onKeyDown={(e) => roving.keyDown(e, index, () => choose(item), grid ? columns : 1)} onClick={() => choose(item)}>
            {grid ? <MediaThumbnail media={isMedia(item.image) ? item.image : null} size={160} /> : isMedia(item.image) ? <MediaThumbnail media={item.image} size={32} /> : validColor(item.color) ? <span className="ks-list-color" style={{ background: item.color }} /> : null}
            <span className="ks-list-content"><span className="ks-list-title">{item.title}</span>{typeof item.subtitle === "string" && <span className="ks-view-meta">{item.subtitle}</span>}</span>
            {typeof item.meta === "string" && <span className="ks-view-meta">{item.meta}</span>}<Badges values={item.badges} />
          </button>;
        })}
      </div>;
    })}</VirtualSurface>
  </div>;
}
