import { encodeCommentKey } from "../comments/key";
import { useBlockRootProps } from "../comments/block-root";
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
import { Badges, DEFAULT_VIRTUAL_ROW_ESTIMATE, GroupHeading, NoItems, VirtualSurface, listGroups, isObject, keepRovingRow, useRoving, useVirtualRows, type ListGroup } from "./data-view-common";
import { Button, EmptyState, ErrorId, IconButton } from "../components/primitives";
import { DataIcon } from "../components/data-icons";
import { ICON_NAMES } from "../contract/limits";
import { useItemScope } from "../data/item-scope";
import { X } from "../components/icons";
import { MediaPreview, type MediaPreviewRequest } from "./media-preview";
import { selectionRange, toggleSelection } from "../components/collection-selection";
import { useLocalDraft } from "../data/use-local-draft";

const validItem = (v: unknown): v is ListItem => isObject(v) && typeof v.key === "string" && typeof v.title === "string";
type Row = { kind: "heading"; title: string; meta?: string } | { kind: "status"; group: ListGroup<ListItem> } | { kind: "items"; items: ListItem[]; start: number };
type ListHandlers = {
  focus: (index: number) => void;
  keyDown: (event: React.KeyboardEvent<HTMLElement>, index: number, item: ListItem) => void;
  choose: (item: ListItem, event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => void;
  remove: (item: ListItem) => void;
  menu: (event: React.MouseEvent<HTMLElement>, item: ListItem) => void;
};
const ListRow = memo(function ListRow({ item, index, length, active, current, focused, grid, icons, handlers, readOnly, removable, disabled }: { item: ListItem; index: number; length: number; active: boolean; current: boolean; focused: boolean; grid: boolean; icons: boolean; handlers: React.RefObject<ListHandlers>; readOnly: boolean; removable: boolean; disabled: boolean }) {
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
  const icon = typeof item.icon === "string" && (ICON_NAMES as readonly string[]).includes(item.icon) ? item.icon : undefined;
  const row = icons ? <IconTile name={item.title} icon={isMedia(item.image) ? <MediaThumbnail media={item.image} size={ICON_SIZE.tile} icon /> : icon ? <DataIcon name={icon} size="tile" /> : <LayoutGrid size="tile" />} selected={active}
    role={removable ? "button" : "option"} aria-disabled={disabled || undefined} aria-setsize={removable ? undefined : length} aria-posinset={removable ? undefined : index + 1} aria-selected={removable || item.selectable === false ? undefined : active} aria-pressed={removable ? active : undefined} aria-label={item.title} data-row-key={item.key} data-ks-comment-key={removable ? undefined : encodeCommentKey(item.key)} data-ks-share-readonly={readOnly || undefined} data-focus-index={index} tabIndex={focused ? 0 : -1}
    onFocus={() => handlers.current.focus(index)} onKeyDown={(event) => handlers.current.keyDown(event, index, item)} onClick={(event) => handlers.current.choose(item, event)} onContextMenu={(event) => handlers.current.menu(event, item)} /> : <button ref={ref} type="button" role={removable ? "button" : "option"} aria-disabled={disabled || undefined} aria-setsize={removable ? undefined : length} aria-posinset={removable ? undefined : index + 1} aria-selected={removable || item.selectable === false ? undefined : active} aria-pressed={removable ? active : undefined} aria-label={item.title} data-row-key={item.key} data-ks-comment-key={removable ? undefined : encodeCommentKey(item.key)} data-ks-share-readonly={readOnly || undefined} data-focus-index={index} tabIndex={focused ? 0 : -1} className={`${grid ? "ks-list-card" : "ks-row ks-list-row"}${active ? " is-selected" : ""}${grid && current ? " is-current" : ""}`} onFocus={() => handlers.current.focus(index)} onKeyDown={(event) => handlers.current.keyDown(event, index, item)} onClick={(event) => handlers.current.choose(item, event)} onContextMenu={(event) => handlers.current.menu(event, item)}>
    {grid ? isMedia(item.image) || !icon ? <MediaThumbnail media={isMedia(item.image) ? item.image : null} size={160} /> : <span className="ks-media-thumbnail ks-list-grid-icon"><DataIcon name={icon} size="empty" /></span> : icon ? <DataIcon name={icon} size="inline" /> : isMedia(item.image) ? <MediaThumbnail media={item.image} size={32} /> : validColor(item.color) ? <span className="ks-list-color" style={{ background: item.color }} /> : null}
    <span className="ks-list-content"><span className="ks-list-title">{item.title}</span>{typeof item.subtitle === "string" && <span className="ks-view-meta">{item.subtitle}</span>}</span>
    {!grid && <Badges values={item.badges} />}{typeof item.meta === "string" && <span className="ks-view-meta">{item.meta}</span>}{grid && <Badges values={item.badges} />}
  </button>;
  return removable ? <div data-ks-comment-key={encodeCommentKey(item.key)} role="listitem" onFocus={() => handlers.current.focus(index)} data-list-index={index} className={`ks-list-item${grid || icons ? " is-grid" : ""}${active ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}>{row}<IconButton className="ks-list-remove" disabled={disabled} aria-label={`${item.title} 빼기`} onClick={() => handlers.current.remove(item)}><X /></IconButton></div> : row;
});
export function ListBlock({ block, context, pointer }: { block: Extract<Block, { type: "list" }>; context: BlockContext; pointer: string }) {
  const blockRoot = useBlockRootProps();
  const value = useBinding(`${pointer}/items`, block.items);
  if (value.status !== "ready") return block.layout === "icons" && value.status === "loading" ? <IconListLoading grouped={Boolean(block.grouped)} /> : <DataState rootProps={blockRoot} value={value} />;
  return <ListReady block={block} context={context} pointer={pointer} value={value.value} more={value.more} />;
}
function IconListLoading({ grouped }: { grouped: boolean }) {
  const blockRoot = useBlockRootProps();
  const scroll = useRef<HTMLDivElement>(null);
  const columns = useIconGridColumns(scroll, true);
  return <div {...blockRoot} className="ks-data-view ks-list is-icons" ref={scroll}>{grouped && <div className="ks-view-group" aria-hidden="true"><span className="ks-data-skeleton"><i /></span></div>}<IconTileSkeleton count={columns * 2} /></div>;
}
function ListReady({ block, context, pointer, value, more }: { block: Extract<Block, { type: "list" }>; context: BlockContext; pointer: string; value: unknown; more?: BindingMore }) {
  const blockRoot = useBlockRootProps();
  const data = useWindowData();
  const [preview, setPreview] = useState<MediaPreviewRequest | null>(null);
  const closePreview = useCallback(() => setPreview(null), []);
  const menu = useItemMenu(block.item_menu, pointer);
  const grouped = useMemo(() => listGroups(value, Boolean(block.grouped), validItem), [value, block.grouped]);
  const parentScope = useItemScope();
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
    const probe = block.item_width ? element.ownerDocument.createElement("span") : null;
    if (probe) {
      probe.setAttribute("aria-hidden", "true");
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.pointerEvents = "none";
      probe.style.width = `var(--ks-repeat-grid-item-width-${block.item_width})`;
      probe.style.height = "0";
      element.append(probe);
    }
    const resize = () => {
      const style = getComputedStyle(element);
      const pane = probe ? probe.getBoundingClientRect().width : parseFloat(style.getPropertyValue("--ks-pane-min-size")) || 160;
      if (!pane) return;
      const gap = parseFloat(style.getPropertyValue("--ks-space-3")) || 12;
      const width = element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      setColumns(Math.max(1, Math.floor((width + gap) / (pane + gap))));
    };
    resize(); const observer = new ResizeObserver(resize); observer.observe(element); return () => { observer.disconnect(); probe?.remove(); };
  }, [grid, block.item_width]);
  const rows = useMemo(() => {
    const result: Row[] = []; let start = 0;
    for (const group of grouped) {
      if (!items.length && !group.status) continue;
      if (block.grouped) result.push({ kind: "heading", title: group.title, meta: group.meta });
      if (block.grouped && group.status) result.push({ kind: "status", group });
      const step = activeColumns;
      for (let i = 0; i < group.items.length; i += step) result.push({ kind: "items", items: group.items.slice(i, i + step), start: start + i });
      start += group.items.length;
    }
    return result;
  }, [grouped, items.length, block.grouped, activeColumns]);
  const rowKeys = useMemo(() => rows.map((row) => row.kind === "items" ? row.items.map((item) => item.key) : []), [rows]);
  const { virtual } = useVirtualRows(rows.length, grid ? 220 : icons ? DEFAULT_VIRTUAL_ROW_ESTIMATE * 3 : DEFAULT_VIRTUAL_ROW_ESTIMATE, scroll, false, undefined, undefined, rowKeys);
  const rowOf = (index: number) => Math.max(0, rows.findIndex((row) => row.kind === "items" && index >= row.start && index < row.start + row.items.length));
  const selectedValue = useBinding(`${pointer}/selected`, block.selected ?? null);
  const disabledValue = useBinding(`${pointer}/disabled`, block.disabled ?? false);
  const disabled = disabledValue.status === "ready" && disabledValue.value === true;
  const selected = selectedValue.status === "ready" ? selectedValue.value : null;
  const multiple = block.selection === "multiple";
  const selectedKeys = useMemo(() => Array.isArray(selected) ? selected.filter((key): key is string => typeof key === "string") : [], [selected]);
  type SelectionDraft = { keys: string[]; item: JsonValue };
  const initialDraft = useMemo<SelectionDraft>(() => ({ keys: selectedKeys, item: null }), [selectedKeys]);
  const dispatch = useCallback((next: SelectionDraft) => data.act(`${pointer}/on_select`, next.keys, next.item, undefined, undefined, { input: true }), [data, pointer]);
  const draft = useLocalDraft(initialDraft, pointer, { sendOnChange: false, dispatch });
  const draftRef = useRef(draft.draft);
  draftRef.current = draft.draft;
  const anchor = useRef<string | null>(null);
  const pointerFocus = useRef<string | null>(null);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const current = currentKey ?? items.filter((item) => item.selectable !== false && draft.draft.keys.includes(item.key)).at(-1)?.key ?? null;
  const roving = useRoving(items, multiple ? current : selected, scroll, virtual, rowOf);
  const selectable = items.filter((item) => item.selectable !== false);
  const orderedKeys = (keys: readonly string[]) => {
    const wanted = new Set(keys);
    const result: string[] = [];
    for (const item of selectable) if (wanted.delete(item.key)) result.push(item.key);
    return result;
  };
  const submit = (keys: string[], item: ListItem | null, coalesce = false) => {
    const next = { keys: orderedKeys(keys), item: item as unknown as JsonValue };
    draftRef.current = next;
    draft.change(next);
    void draft.send(next, coalesce);
    setCurrentKey(item?.key ?? null);
  };
  const chooseMultiple = (item: ListItem, mode: "replace" | "toggle" | "range", coalesce = false, focusIndex = roving.focus) => {
    const previous = orderedKeys(draftRef.current.keys);
    if (mode === "range") {
      anchor.current ??= items[focusIndex]?.key ?? item.key;
      const range = selectionRange(items.map((entry) => entry.key), anchor.current, item.key);
      const focused = item.selectable === false ? items.find((entry) => entry.key === current) ?? null : item;
      submit(range, focused, coalesce);
    } else {
      if (item.selectable === false) return;
      anchor.current = item.key;
      const keys = mode === "toggle" ? orderedKeys(toggleSelection(previous, item.key)) : [item.key];
      const focused = mode === "toggle" && !keys.includes(item.key) ? selectable.find((entry) => entry.key === keys.at(-1)) ?? null : item;
      submit(keys, focused, coalesce);
    }
  };
  keepRovingRow(virtual, rowOf(roving.focus));
  const handlers = useRef<ListHandlers>(null!);
  handlers.current = {
    focus: roving.setFocus,
    keyDown: (event, index, item) => {
      if (multiple && event.key === " " && !disabled) { event.preventDefault(); handlers.current.choose(item, event); return; }
      roving.keyDown(event, index, () => handlers.current.choose(item, event), activeColumns,
        !disabled && block.on_select && (multiple || block.select_on_focus) ? (next) => {
          if (multiple) chooseMultiple(items[next], event.shiftKey ? "range" : "replace", true, index);
          else if (items[next].selectable !== false) handlers.current.choose(items[next], event);
        } : undefined);
    },
    choose: (item, event) => {
      if (disabled) return;
      const mouse = event.type === "click";
      if (item.selectable === false) {
        if ((!mouse || (!event.ctrlKey && !event.shiftKey)) && block.on_activate) void data.act(`${pointer}/on_activate`, item.key, item as unknown as JsonValue);
      } else if (multiple) {
        if (mouse && event.shiftKey && anchor.current === null) anchor.current = pointerFocus.current ?? items[roving.focus]?.key ?? item.key;
        chooseMultiple(item, mouse && event.shiftKey ? "range" : mouse && event.ctrlKey ? "toggle" : "replace");
      }
      else if (block.on_select) void data.act(`${pointer}/on_select`, item.key, item as unknown as JsonValue);
      else if (isMedia(item.image)) setPreview({ media: item.image, name: item.title, trigger: event.currentTarget });
    },
    remove: (item) => { if (!disabled && block.on_remove) void data.act(`${pointer}/on_remove`, item.key, item as unknown as JsonValue); },
    menu: (event, item) => { if (disabled) { event.preventDefault(); return; } if (!event.defaultPrevented) menu.open(event, event.currentTarget, item as unknown as JsonValue, item.key, "제목 복사", item.title); },
  };
  const virtualRows = virtual.getVirtualItems();
  const footer = useLoadMore(more, rows.length, virtualRows.at(-1)?.index ?? -1, data, useWindowVisible(context), icons ? <IconTileSkeleton count={activeColumns} /> : undefined, items.length);
  const hasStatus = grouped.some((group) => group.status);
  if (value === null && !more) return null;
  if (!items.length && !more && !hasStatus) return <NoItems rootProps={blockRoot} />;
  const first = virtual.getVirtualItemForOffset(virtual.scrollOffset ?? 0)?.index ?? 0;
  const currentHeading = block.grouped ? rows.slice(0, first + 1).reverse().find((row) => row.kind === "heading") : undefined;
  return <><div {...blockRoot} className={`ks-data-view ks-list${grid ? " is-grid" : icons ? " is-icons" : ""}`} style={block.item_width ? { "--ks-list-grid-width": `var(--ks-repeat-grid-item-width-${block.item_width})` } as React.CSSProperties : undefined} ref={scroll} role={block.on_remove ? "list" : "listbox"} aria-multiselectable={!block.on_remove && multiple ? true : undefined} aria-label="목록"
    onMouseDownCapture={() => { pointerFocus.current = items[roving.focus]?.key ?? null; }}
    onClick={(event) => { if (!multiple || disabled || !(event.target instanceof Element) || event.target.closest("[data-row-key], button")) return; anchor.current = null; submit([], null); }}
    onKeyDown={(event) => {
      if (!multiple || disabled) return;
      if (event.ctrlKey && event.key.toLowerCase() === "a") {
        event.preventDefault(); event.stopPropagation();
        const keys = orderedKeys(selectable.map((item) => item.key));
        const focused = items[roving.focus];
        submit(keys, focused && keys.includes(focused.key) ? focused : selectable[0] ?? null);
      } else if (event.key === "Escape" && orderedKeys(draftRef.current.keys).length) {
        event.preventDefault(); event.stopPropagation(); anchor.current = null; submit([], null);
      }
    }}>
    {currentHeading?.kind === "heading" && first > 0 ? <div className="ks-view-sticky"><GroupHeading title={currentHeading.title} meta={currentHeading.meta} /></div> : null}
    {!items.length && !hasStatus ? <NoItems /> : <VirtualSurface virtual={virtual}>{virtualRows.map((row) => {
      const entry = rows[row.index];
      return <div className={entry.kind === "status" ? "ks-load-more ks-list-group-row" : entry.kind === "items" ? grid ? "ks-list-grid-row" : icons ? "ks-icon-grid ks-list-icon-row" : undefined : undefined} key={row.key} data-index={row.index} data-row-key={entry.kind === "status" ? entry.group.key ?? entry.group.title : undefined} ref={virtual.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start}px)` }}>
        {entry.kind === "heading" ? <GroupHeading title={entry.title} meta={entry.meta} /> : entry.kind === "status" ? (() => {
          const { group } = entry; const status = group.status!;
          const index = block.group_actions?.findIndex((action) => action.key === group.action) ?? -1;
          const action = index < 0 ? undefined : block.group_actions?.[index];
          const button = action ? <Button disabled={disabled} onClick={(event) => {
            const item = group.original as unknown as JsonValue;
            void data.act(`${pointer}/group_actions/${index}/on_click`, group.action!, item, undefined, { item, parent_item: parentScope?.item, key: group.key ?? group.title, index: row.index, instance: event.currentTarget });
          }}>{action.label}</Button> : undefined;
          return <div className="ks-data-state-compact ks-list-group-status" data-layout="row" aria-live="polite">{status.state === "loading" ? <DataState value={{ status: "loading" }} compact /> : null}
            {status.state !== "loading" || status.message || status.code || button ? <EmptyState icon={status.state === "error" ? <DataIcon name="triangle-alert" size="inline" /> : undefined}
              text={<>{status.message ?? (status.state === "empty" ? "없음" : "")}{status.code ? <> <ErrorId id={status.code} /></> : null}</>} action={button} /> : null}</div>;
        })() : entry.items.map((item, n) => {
          const index = entry.start + n; const active = item.selectable !== false && (multiple ? draft.draft.keys.includes(item.key) : item.key === selected);
          return <ListRow item={item} index={index} length={items.length} active={active} current={multiple && current === item.key} focused={roving.focus === index} grid={grid} icons={icons} handlers={handlers} readOnly={disabled || (!block.on_select && !block.on_activate && !block.on_remove && !isMedia(item.image) && !block.item_menu?.length)} removable={Boolean(block.on_remove)} disabled={disabled} key={item.key} />;
        })}
      </div>;
    })}</VirtualSurface>}
    {footer}
  </div>{menu.dialog}{preview && <MediaPreview request={preview} onClose={closePreview} />}</>;
}
