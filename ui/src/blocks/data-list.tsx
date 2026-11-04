import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Block, ListItem } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { DataState } from "../components/data-state";
import { validColor } from "../components/badge";
import { isMedia, MediaThumbnail } from "../components/media-thumbnail";
import { useBinding, useWindowData } from "../data/window-data";
import { useWindowVisible } from "../data/window-state";
import { useLoadMore } from "./load-more";
import type { BindingMore } from "../contract/contract";
import type { BlockContext } from "./block-context";
import { useItemMenu } from "./item-menu";
import { Badges, DEFAULT_VIRTUAL_ROW_ESTIMATE, GroupHeading, NoItems, VirtualSurface, groups, isObject, keepRovingRow, useRoving, useVirtualRows } from "./data-view-common";

const validItem = (v: unknown): v is ListItem => isObject(v) && typeof v.key === "string" && typeof v.title === "string";
type Row = { kind: "heading"; title: string; meta?: string } | { kind: "items"; items: ListItem[]; start: number };
type ListHandlers = {
  focus: (index: number) => void;
  keyDown: (event: React.KeyboardEvent<HTMLElement>, index: number, item: ListItem) => void;
  choose: (item: ListItem) => void;
  menu: (event: React.MouseEvent<HTMLElement>, item: ListItem) => void;
};
const ListRow = memo(function ListRow({ item, index, length, active, focused, grid, handlers }: { item: ListItem; index: number; length: number; active: boolean; focused: boolean; grid: boolean; handlers: React.RefObject<ListHandlers> }) {
  return <button type="button" role="option" aria-setsize={length} aria-posinset={index + 1} aria-selected={active} aria-label={item.title} data-focus-index={index} tabIndex={focused ? 0 : -1} className={`${grid ? "ks-list-card" : "ks-row ks-list-row"}${active ? " is-selected" : ""}`} onFocus={() => handlers.current.focus(index)} onKeyDown={(event) => handlers.current.keyDown(event, index, item)} onClick={() => handlers.current.choose(item)} onContextMenu={(event) => handlers.current.menu(event, item)}>
    {grid ? <MediaThumbnail media={isMedia(item.image) ? item.image : null} size={160} /> : isMedia(item.image) ? <MediaThumbnail media={item.image} size={32} /> : validColor(item.color) ? <span className="ks-list-color" style={{ background: item.color }} /> : null}
    <span className="ks-list-content"><span className="ks-list-title">{item.title}</span>{typeof item.subtitle === "string" && <span className="ks-view-meta">{item.subtitle}</span>}</span>
    {typeof item.meta === "string" && <span className="ks-view-meta">{item.meta}</span>}<Badges values={item.badges} />
  </button>;
});
export function ListBlock({ block, context, pointer }: { block: Extract<Block, { type: "list" }>; context: BlockContext; pointer: string }) {
  const value = useBinding(`${pointer}/items`, block.items);
  if (value.status !== "ready") return <DataState value={value} />;
  return <ListReady block={block} context={context} pointer={pointer} value={value.value} more={value.more} />;
}
function ListReady({ block, context, pointer, value, more }: { block: Extract<Block, { type: "list" }>; context: BlockContext; pointer: string; value: unknown; more?: BindingMore }) {
  const data = useWindowData();
  const menu = useItemMenu(block.item_menu, pointer);
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
  const { virtual } = useVirtualRows(rows.length, grid ? 220 : DEFAULT_VIRTUAL_ROW_ESTIMATE, scroll);
  const rowOf = (index: number) => Math.max(0, rows.findIndex((row) => row.kind === "items" && index >= row.start && index < row.start + row.items.length));
  const selectedValue = useBinding(`${pointer}/selected`, block.selected ?? null);
  const selected = selectedValue.status === "ready" ? selectedValue.value : null;
  const roving = useRoving(items, selected, scroll, virtual, rowOf);
  keepRovingRow(virtual, rowOf(roving.focus));
  const handlers = useRef<ListHandlers>(null!);
  handlers.current = {
    focus: roving.setFocus,
    keyDown: (event, index, item) => roving.keyDown(event, index, () => { if (block.on_select) void data.act(`${pointer}/on_select`, item.key, item as unknown as JsonValue); }, grid ? columns : 1),
    choose: (item) => { if (block.on_select) void data.act(`${pointer}/on_select`, item.key, item as unknown as JsonValue); },
    menu: (event, item) => { if (!event.defaultPrevented) menu.open(event, event.currentTarget, item as unknown as JsonValue, item.key, "제목 복사", item.title); },
  };
  const virtualRows = virtual.getVirtualItems();
  const footer = useLoadMore(more, rows.length, virtualRows.at(-1)?.index ?? -1, data, useWindowVisible(context));
  if (value === null && !more) return null;
  if (!items.length && !more) return <NoItems />;
  const first = virtual.getVirtualItemForOffset(virtual.scrollOffset ?? 0)?.index ?? 0;
  const currentHeading = block.grouped ? rows.slice(0, first + 1).reverse().find((row) => row.kind === "heading") : undefined;
  return <><div className={`ks-data-view ks-list${grid ? " is-grid" : ""}`} ref={scroll} role="listbox" aria-label="목록">
    {currentHeading?.kind === "heading" && first > 0 ? <div className="ks-view-sticky"><GroupHeading title={currentHeading.title} meta={currentHeading.meta} /></div> : null}
    {!items.length ? <NoItems /> : <VirtualSurface virtual={virtual}>{virtualRows.map((row) => {
      const entry = rows[row.index];
      return <div className={grid && entry.kind === "items" ? "ks-list-grid-row" : undefined} key={row.key} data-index={row.index} ref={virtual.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start}px)` }}>
        {entry.kind === "heading" ? <GroupHeading title={entry.title} meta={entry.meta} /> : entry.items.map((item, n) => {
          const index = entry.start + n; const active = item.key === selected;
          return <ListRow item={item} index={index} length={items.length} active={active} focused={roving.focus === index} grid={grid} handlers={handlers} key={item.key} />;
        })}
      </div>;
    })}</VirtualSurface>}
    {footer}
  </div>{menu.dialog}</>;
}
