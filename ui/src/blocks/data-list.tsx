import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Block, ListItem } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { DataState } from "../components/data-state";
import { validColor } from "../components/badge";
import { isMedia, MediaThumbnail } from "../components/media-thumbnail";
import { IconTile, IconTileSkeleton, useIconGridColumns } from "../components/icon-tile";
import { ICON_SIZE, LayoutGrid } from "../components/icons";
import { useBinding, useWindowData } from "../data/window-data";
import { useWindowVisible } from "../data/window-state";
import { useLoadMore } from "./load-more";
import type { BindingMore } from "../contract/contract";
import type { BlockContext } from "./block-context";
import { useItemMenu } from "./item-menu";
import { Badges, DEFAULT_VIRTUAL_ROW_ESTIMATE, GroupHeading, NoItems, VirtualSurface, groups, isObject, keepRovingRow, useRoving, useVirtualRows } from "./data-view-common";
import { IconButton } from "../components/primitives";
import { X } from "../components/icons";
import { MediaPreview, type MediaPreviewRequest } from "./media-preview";

const validItem = (v: unknown): v is ListItem => isObject(v) && typeof v.key === "string" && typeof v.title === "string";
type Row = { kind: "heading"; title: string; meta?: string } | { kind: "items"; items: ListItem[]; start: number };
type ListHandlers = {
  focus: (index: number) => void;
  keyDown: (event: React.KeyboardEvent<HTMLElement>, index: number, item: ListItem) => void;
  choose: (item: ListItem, trigger: HTMLElement) => void;
  remove: (item: ListItem) => void;
  menu: (event: React.MouseEvent<HTMLElement>, item: ListItem) => void;
};
const ListRow = memo(function ListRow({ item, index, length, active, focused, grid, icons, handlers, readOnly, removable, disabled }: { item: ListItem; index: number; length: number; active: boolean; focused: boolean; grid: boolean; icons: boolean; handlers: React.RefObject<ListHandlers>; readOnly: boolean; removable: boolean; disabled: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row || grid || icons) return;
    const group = row.querySelector<HTMLElement>(":scope > .ks-view-badges");
    const badges = [...(group?.children ?? [])] as HTMLElement[];
    const meta = row.querySelector<HTMLElement>(":scope > .ks-view-meta");
    const content = row.querySelector<HTMLElement>(":scope > .ks-list-content")!;
    const update = () => {
      content.style.minWidth = "";
      if (group) group.style.display = "";
      badges.forEach(badge => { badge.style.display = ""; });
      if (meta) meta.style.display = "";
      const style = getComputedStyle(row);
      const available = row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const fits = () => {
        const widths = [...row.children].map(child => child.getBoundingClientRect().width).filter(width => width > 0);
        return widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * parseFloat(style.columnGap) <= available + 0.5;
      };
      // 최소 제목 폭을 남긴 뒤 배지, 시각 순으로 통째로 자리를 돌려준다.
      for (let i = badges.length - 1; i >= 0 && !fits(); i -= 1) {
        badges[i].style.display = "none";
        if (i === 0 && group) group.style.display = "none";
      }
      if (meta && !fits()) meta.style.display = "none";
      if (!fits()) content.style.minWidth = "0";
    };
    const observer = new ResizeObserver(update);
    observer.observe(row);
    update();
    return () => observer.disconnect();
  }, [item, grid, icons]);
  const row = icons ? <IconTile name={item.title} icon={isMedia(item.image) ? <MediaThumbnail media={item.image} size={ICON_SIZE.tile} icon /> : <LayoutGrid size="tile" />} selected={active}
    role={removable ? "button" : "option"} aria-disabled={disabled || undefined} aria-setsize={removable ? undefined : length} aria-posinset={removable ? undefined : index + 1} aria-selected={removable ? undefined : active} aria-pressed={removable ? active : undefined} aria-label={item.title} data-row-key={item.key} data-ks-share-readonly={readOnly || undefined} data-focus-index={index} tabIndex={focused ? 0 : -1}
    onFocus={() => handlers.current.focus(index)} onKeyDown={(event) => handlers.current.keyDown(event, index, item)} onClick={(event) => handlers.current.choose(item, event.currentTarget)} onContextMenu={(event) => handlers.current.menu(event, item)} /> : <button ref={ref} type="button" role={removable ? "button" : "option"} aria-disabled={disabled || undefined} aria-setsize={removable ? undefined : length} aria-posinset={removable ? undefined : index + 1} aria-selected={removable ? undefined : active} aria-pressed={removable ? active : undefined} aria-label={item.title} data-row-key={item.key} data-ks-share-readonly={readOnly || undefined} data-focus-index={index} tabIndex={focused ? 0 : -1} className={`${grid ? "ks-list-card" : "ks-row ks-list-row"}${active ? " is-selected" : ""}`} onFocus={() => handlers.current.focus(index)} onKeyDown={(event) => handlers.current.keyDown(event, index, item)} onClick={(event) => handlers.current.choose(item, event.currentTarget)} onContextMenu={(event) => handlers.current.menu(event, item)}>
    {grid ? <MediaThumbnail media={isMedia(item.image) ? item.image : null} size={160} /> : isMedia(item.image) ? <MediaThumbnail media={item.image} size={32} /> : validColor(item.color) ? <span className="ks-list-color" style={{ background: item.color }} /> : null}
    <span className="ks-list-content"><span className="ks-list-title">{item.title}</span>{typeof item.subtitle === "string" && <span className="ks-view-meta">{item.subtitle}</span>}</span>
    {!grid && <Badges values={item.badges} />}{typeof item.meta === "string" && <span className="ks-view-meta">{item.meta}</span>}{grid && <Badges values={item.badges} />}
  </button>;
  return removable ? <div role="listitem" onFocus={() => handlers.current.focus(index)} data-list-index={index} className={`ks-list-item${grid || icons ? " is-grid" : ""}${active ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}>{row}<IconButton className="ks-list-remove" disabled={disabled} aria-label={`${item.title} 빼기`} onClick={() => handlers.current.remove(item)}><X /></IconButton></div> : row;
});
export function ListBlock({ block, context, pointer }: { block: Extract<Block, { type: "list" }>; context: BlockContext; pointer: string }) {
  const value = useBinding(`${pointer}/items`, block.items);
  if (value.status !== "ready") return block.layout === "icons" && value.status === "loading" ? <IconListLoading /> : <DataState value={value} />;
  return <ListReady block={block} context={context} pointer={pointer} value={value.value} more={value.more} />;
}
function IconListLoading() {
  const scroll = useRef<HTMLDivElement>(null);
  const columns = useIconGridColumns(scroll, true);
  return <div className="ks-data-view ks-list is-icons" ref={scroll}><IconTileSkeleton count={columns * 2} /></div>;
}
function ListReady({ block, context, pointer, value, more }: { block: Extract<Block, { type: "list" }>; context: BlockContext; pointer: string; value: unknown; more?: BindingMore }) {
  const data = useWindowData();
  const [preview, setPreview] = useState<MediaPreviewRequest | null>(null);
  const closePreview = useCallback(() => setPreview(null), []);
  const menu = useItemMenu(block.item_menu, pointer);
  const grouped = useMemo(() => groups(value, Boolean(block.grouped), validItem), [value, block.grouped]);
  const items = useMemo(() => grouped.flatMap((group) => group.items), [grouped]);
  const grid = block.layout === "grid";
  const icons = block.layout === "icons";
  const [columns, setColumns] = useState(1);
  const scroll = useRef<HTMLDivElement>(null);
  const iconColumns = useIconGridColumns(scroll, icons && (items.length > 0 || !!more));
  const activeColumns = icons ? iconColumns : grid ? columns : 1;
  useEffect(() => {
    if (!grid || !scroll.current) return;
    const element = scroll.current;
    const resize = () => {
      const style = getComputedStyle(element);
      const pane = parseFloat(style.getPropertyValue("--ks-pane-min-size")) || 160;
      const gap = parseFloat(style.getPropertyValue("--ks-space-3")) || 12;
      const width = element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      setColumns(Math.max(1, Math.floor((width + gap) / (pane + gap))));
    };
    resize(); const observer = new ResizeObserver(resize); observer.observe(element); return () => observer.disconnect();
  }, [grid, scroll]);
  const rows = useMemo(() => {
    const result: Row[] = []; let start = 0;
    for (const group of grouped) {
      if (block.grouped) result.push({ kind: "heading", title: group.title, meta: group.meta });
      const step = activeColumns;
      for (let i = 0; i < group.items.length; i += step) result.push({ kind: "items", items: group.items.slice(i, i + step), start: start + i });
      start += group.items.length;
    }
    return result;
  }, [grouped, block.grouped, activeColumns]);
  const rowKeys = useMemo(() => rows.map((row) => row.kind === "items" ? row.items.map((item) => item.key) : []), [rows]);
  const { virtual } = useVirtualRows(rows.length, grid ? 220 : icons ? DEFAULT_VIRTUAL_ROW_ESTIMATE * 3 : DEFAULT_VIRTUAL_ROW_ESTIMATE, scroll, false, undefined, undefined, rowKeys);
  const rowOf = (index: number) => Math.max(0, rows.findIndex((row) => row.kind === "items" && index >= row.start && index < row.start + row.items.length));
  const selectedValue = useBinding(`${pointer}/selected`, block.selected ?? null);
  const disabledValue = useBinding(`${pointer}/disabled`, block.disabled ?? false);
  const disabled = disabledValue.status === "ready" && disabledValue.value === true;
  const selected = selectedValue.status === "ready" ? selectedValue.value : null;
  const roving = useRoving(items, selected, scroll, virtual, rowOf);
  keepRovingRow(virtual, rowOf(roving.focus));
  const handlers = useRef<ListHandlers>(null!);
  handlers.current = {
    focus: roving.setFocus,
    keyDown: (event, index, item) => { const trigger = event.currentTarget; roving.keyDown(event, index, () => handlers.current.choose(item, trigger), activeColumns); },
    choose: (item, trigger) => { if (disabled) return; if (block.on_select) void data.act(`${pointer}/on_select`, item.key, item as unknown as JsonValue); else if (isMedia(item.image)) setPreview({ media: item.image, name: item.title, trigger }); },
    remove: (item) => { if (!disabled && block.on_remove) void data.act(`${pointer}/on_remove`, item.key, item as unknown as JsonValue); },
    menu: (event, item) => { if (disabled) { event.preventDefault(); return; } if (!event.defaultPrevented) menu.open(event, event.currentTarget, item as unknown as JsonValue, item.key, "제목 복사", item.title); },
  };
  const virtualRows = virtual.getVirtualItems();
  const footer = useLoadMore(more, rows.length, virtualRows.at(-1)?.index ?? -1, data, useWindowVisible(context), icons ? <IconTileSkeleton count={activeColumns} /> : undefined, items.length);
  if (value === null && !more) return null;
  if (!items.length && !more) return <NoItems />;
  const first = virtual.getVirtualItemForOffset(virtual.scrollOffset ?? 0)?.index ?? 0;
  const currentHeading = block.grouped ? rows.slice(0, first + 1).reverse().find((row) => row.kind === "heading") : undefined;
  return <><div className={`ks-data-view ks-list${grid ? " is-grid" : icons ? " is-icons" : ""}`} ref={scroll} role={block.on_remove ? "list" : "listbox"} aria-label="목록">
    {currentHeading?.kind === "heading" && first > 0 ? <div className="ks-view-sticky"><GroupHeading title={currentHeading.title} meta={currentHeading.meta} /></div> : null}
    {!items.length ? <NoItems /> : <VirtualSurface virtual={virtual}>{virtualRows.map((row) => {
      const entry = rows[row.index];
      return <div className={entry.kind === "items" ? grid ? "ks-list-grid-row" : icons ? "ks-icon-grid ks-list-icon-row" : undefined : undefined} key={row.key} data-index={row.index} ref={virtual.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start}px)` }}>
        {entry.kind === "heading" ? <GroupHeading title={entry.title} meta={entry.meta} /> : entry.items.map((item, n) => {
          const index = entry.start + n; const active = item.key === selected;
          return <ListRow item={item} index={index} length={items.length} active={active} focused={roving.focus === index} grid={grid} icons={icons} handlers={handlers} readOnly={disabled || (!block.on_select && !block.on_remove && !isMedia(item.image) && !block.item_menu?.length)} removable={Boolean(block.on_remove)} disabled={disabled} key={item.key} />;
        })}
      </div>;
    })}</VirtualSurface>}
    {footer}
  </div>{menu.dialog}{preview && <MediaPreview request={preview} onClose={closePreview} />}</>;
}
