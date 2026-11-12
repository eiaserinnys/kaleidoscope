import { encodeCommentKey } from "../comments/key";
import { useBlockRootProps } from "../comments/block-root";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Block, ListItem } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { DataState } from "../components/data-state";
import { validColor } from "../components/badge";
import { isMedia, MediaThumbnail } from "../components/media-thumbnail";
import { IconTile, IconTileSkeleton, useIconGridColumns } from "../components/icon-tile";
import { LayoutGrid } from "../components/icons";
import { useBinding, useWindowData } from "../data/window-data";
import { useWindowVisible } from "../data/window-state";
import { useLoadMore } from "./load-more";
import type { BindingMore } from "../contract/contract";
import type { BlockContext } from "./block-context";
import { useItemMenu } from "./item-menu";
import { Badges, DEFAULT_VIRTUAL_ROW_ESTIMATE, GroupHeading, NoItems, VirtualSurface, listGroups, isObject, keepRovingRow, useRoving, useScrollbarFlapHold, useVirtualRows, type ListGroup } from "./data-view-common";
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
  const row = icons ? <IconTile name={item.title} dot={item.dot === true} icon={isMedia(item.image) ? <MediaThumbnail media={item.image} icon fallback={icon ? <DataIcon name={icon} size="tile" /> : <LayoutGrid size="tile" />} /> : icon ? <DataIcon name={icon} size="tile" /> : <LayoutGrid size="tile" />} selected={active}
    role={removable ? "button" : "option"} aria-disabled={disabled || undefined} aria-setsize={removable ? undefined : length} aria-posinset={removable ? undefined : index + 1} aria-selected={removable || item.selectable === false ? undefined : active} aria-pressed={removable ? active : undefined} aria-label={item.title} data-row-key={item.key} data-ks-comment-key={removable ? undefined : encodeCommentKey(item.key)} data-ks-share-readonly={readOnly || undefined} data-focus-index={index} tabIndex={focused ? 0 : -1}
    onFocus={() => handlers.current.focus(index)} onKeyDown={(event) => handlers.current.keyDown(event, index, item)} onClick={(event) => handlers.current.choose(item, event)} onContextMenu={(event) => handlers.current.menu(event, item)} /> : <button ref={ref} type="button" role={removable ? "button" : "option"} aria-disabled={disabled || undefined} aria-setsize={removable ? undefined : length} aria-posinset={removable ? undefined : index + 1} aria-selected={removable || item.selectable === false ? undefined : active} aria-pressed={removable ? active : undefined} aria-label={item.title} data-row-key={item.key} data-ks-comment-key={removable ? undefined : encodeCommentKey(item.key)} data-ks-share-readonly={readOnly || undefined} data-focus-index={index} tabIndex={focused ? 0 : -1} className={`${grid ? "ks-list-card" : "ks-row ks-list-row"}${active ? " is-selected" : ""}${grid && current ? " is-current" : ""}`} onFocus={() => handlers.current.focus(index)} onKeyDown={(event) => handlers.current.keyDown(event, index, item)} onClick={(event) => handlers.current.choose(item, event)} onContextMenu={(event) => handlers.current.menu(event, item)}>
    {grid ? isMedia(item.image) || !icon ? <MediaThumbnail media={isMedia(item.image) ? item.image : null} /> : <span className="ks-media-thumbnail ks-list-grid-icon"><DataIcon name={icon} size="empty" /></span> : icon ? <DataIcon name={icon} size="inline" /> : isMedia(item.image) ? <MediaThumbnail media={item.image} /> : validColor(item.color) ? <span className="ks-list-color" style={{ background: item.color }} /> : null}
    <span className="ks-list-content"><span className="ks-list-title">{item.title}</span>{typeof item.subtitle === "string" && <span className="ks-view-meta">{item.subtitle}</span>}</span>
    {!grid && <Badges values={item.badges} />}{typeof item.meta === "string" && <span className="ks-view-meta">{item.meta}</span>}{grid && <Badges values={item.badges} />}
  </button>;
  return removable ? <div data-ks-comment-key={encodeCommentKey(item.key)} role="listitem" onFocus={() => handlers.current.focus(index)} data-list-index={index} className={`ks-list-item${grid || icons ? " is-grid" : ""}${active ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}>{row}<IconButton className="ks-list-remove" disabled={disabled} aria-label={`${item.title} 빼기`} onClick={() => handlers.current.remove(item)}><X /></IconButton></div> : row;
});
export function ListBlock({ block, context, pointer }: { block: Extract<Block, { type: "list" }>; context: BlockContext; pointer: string }) {
  const blockRoot = useBlockRootProps();
  const value = useBinding(`${pointer}/items`, block.items);
  if (value.status !== "ready") return <DataState rootProps={blockRoot} value={value} loading={<ListLoading block={block} />} />;
  return <ListReady block={block} context={context} pointer={pointer} value={value.value} more={value.more} />;
}
function ListLoading({ block }: { block: Extract<Block, { type: "list" }> }) {
  const blockRoot = useBlockRootProps();
  const scroll = useRef<HTMLDivElement>(null);
  const icons = block.layout === "icons";
  const grid = block.layout === "grid";
  const columns = useIconGridColumns(scroll, icons);
  return <div {...blockRoot} className={`ks-data-view ks-list is-loading${grid ? " is-grid" : icons ? " is-icons" : ""}`} style={block.item_width ? { "--ks-list-grid-width": `var(--ks-repeat-grid-item-width-${block.item_width})` } as React.CSSProperties : undefined} ref={scroll} role="status" aria-label="불러오는 중">
    {block.grouped && <div className="ks-view-group" aria-hidden="true"><span className="ks-data-skeleton"><i /></span></div>}
    {icons ? <IconTileSkeleton count={columns * 2} status={false} /> : grid
      ? <div className="ks-list-grid-row" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <div className="ks-list-card" key={index}><span className="ks-media-thumbnail is-loading" /><span className="ks-list-content"><span className="ks-data-skeleton"><i /></span></span></div>)}</div>
      : Array.from({ length: 8 }, (_, index) => <div className="ks-row ks-list-row" aria-hidden="true" key={index}><span className="ks-data-skeleton"><i /></span></div>)}
  </div>;
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
  const measuredColumns = useRef<number | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const iconColumns = useIconGridColumns(scroll, icons && (items.length > 0 || !!more));
  const activeColumns = icons ? iconColumns : grid ? columns : 1;
  // 격자의 칸 수는 첫 그림 전에 잰다. 칸 수가 그려진 뒤에 바뀌면 줄 묶음이 달라져 줄이 다시 만들어지고,
  // 그 줄을 잡고 있던 초점이 사라진다.
  useLayoutEffect(() => {
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
      const next = Math.max(1, Math.floor((width + gap) / (pane + gap)));
      measuredColumns.current = next;
      setColumns(next);
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
  // 가상 목록이 줄 높이를 기억할 때 쓰는 줄 정체성. 항목 줄은 자리와 담긴 항목으로, 머리 줄과
  // 상태 줄은 종류와 글까지 넣어 구분한다. 머리 줄과 상태 줄의 키가 비어 있으면 장면이
  // 바뀌며 같은 자리에 다른 종류의 줄이 올 때 예전 높이를 물려받아 다음 줄과 겹친다.
  const rowIds = useMemo(() => rows.map((row, index) => row.kind === "items"
    ? `${index}\u0000${row.items.map((item) => item.key).join("\u0001")}`
    : row.kind === "heading"
      ? `${index}\u0000heading\u0000${row.title}\u0000${row.meta ?? ""}`
      : `${index}\u0000status\u0000${row.group.key ?? row.group.title}\u0000${row.group.status?.state ?? ""}\u0000${row.group.status?.message ?? ""}\u0000${row.group.status?.code ?? ""}`), [rows]);
  useScrollbarFlapHold(scroll, grid, rows.length);
  const [headingHeight, setHeadingHeight] = useState(0);
  useLayoutEffect(() => {
    if (!block.grouped || !scroll.current) return;
    const heading = scroll.current.querySelector<HTMLElement>(".ks-view-group");
    if (!heading) return;
    const measure = () => setHeadingHeight(heading.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(heading);
    return () => observer.disconnect();
  });
  const { virtual, resizeAnchor } = useVirtualRows(rows.length, grid ? 220 : icons ? DEFAULT_VIRTUAL_ROW_ESTIMATE * 3 : DEFAULT_VIRTUAL_ROW_ESTIMATE, scroll, false, undefined, undefined, rowKeys, { start: block.grouped ? headingHeight : 0, end: 0 }, rowIds);
  const rowOf = (index: number) => Math.max(0, rows.findIndex((row) => row.kind === "items" && index >= row.start && index < row.start + row.items.length));
  const selectedValue = useBinding(`${pointer}/selected`, block.selected ?? null);
  const currentValue = useBinding(`${pointer}/current`, block.current ?? null);
  const disabledValue = useBinding(`${pointer}/disabled`, block.disabled ?? false);
  const disabled = disabledValue.status === "ready" && disabledValue.value === true;
  const selected = selectedValue.status === "ready" ? selectedValue.value : null;
  const multiple = block.selection === "multiple";
  const selectedKeys = useMemo(() => Array.isArray(selected) ? selected.filter((key): key is string => typeof key === "string") : [], [selected]);
  type SelectionDraft = { keys: string[]; item: JsonValue; activate?: string; select?: boolean };
  const initialDraft = useMemo<SelectionDraft>(() => ({ keys: selectedKeys, item: null }), [selectedKeys]);
  const dispatch = useCallback(async (next: SelectionDraft) => {
    // 같은 입력 줄 안에서는 정산을 다시 기다리지 않는다.
    if (next.select !== false && block.on_select) {
      const success = await data.act(`${pointer}/on_select`, multiple ? next.keys : next.keys[0], next.item, undefined, undefined, { input: true });
      if (!success) return false;
    }
    return next.activate === undefined || await data.act(`${pointer}/on_activate`, next.activate, next.item, undefined, undefined, { input: true });
  }, [data, pointer, multiple, block.on_select]);
  const draft = useLocalDraft(initialDraft, pointer, { sendOnChange: false, dispatch });
  const draftRef = useRef(draft.draft);
  draftRef.current = draft.draft;
  const anchor = useRef<string | null>(null);
  const pointerFocus = useRef<string | null>(null);
  const pointerTarget = useRef<EventTarget | null>(null);
  const boundCurrent = currentValue.status === "ready" ? currentValue.value : null;
  const [localCurrent, setLocalCurrent] = useState<{ key: string | null; binding: unknown } | null>(null);
  useEffect(() => { if (!draft.isSending()) setLocalCurrent(null); }, [boundCurrent]);
  const localKey = localCurrent && (draft.isSending() || Object.is(localCurrent.binding, boundCurrent)) ? localCurrent.key : null;
  const validCurrent = (key: unknown): key is string => typeof key === "string" && draft.draft.keys.includes(key) && items.some(item => item.key === key && item.selectable !== false);
  const current = validCurrent(localKey) ? localKey : validCurrent(boundCurrent) ? boundCurrent : [...draft.draft.keys].reverse().find(validCurrent) ?? null;
  const anchorKey = multiple ? current : selected;
  const anchorIndex = items.findIndex((item) => item.key === anchorKey);
  resizeAnchor.current = anchorIndex < 0 ? null : rowOf(anchorIndex);
  const roving = useRoving(items, multiple ? current : selected, scroll, virtual, rowOf, multiple, !multiple || currentValue.status !== "loading");
  // 앱이 현재 칸을 바꾸면(탐색기에서 파일 열기처럼 이 목록의 입력이 아닌 것) 그 칸이 보이게 하고 키보드 기준을 옮긴다.
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!multiple) return;
    if (typeof boundCurrent !== "string") { revealed.current = null; return; }
    if (revealed.current === boundCurrent) return;
    if (draft.isSending() || localCurrent?.key === boundCurrent) { revealed.current = boundCurrent; return; }
    if (current !== boundCurrent) return;
    // 격자는 실제 열 수로 행을 나눈 뒤에 스크롤한다.
    if (grid && measuredColumns.current !== activeColumns) return;
    revealed.current = boundCurrent;
    const index = items.findIndex((item) => item.key === boundCurrent);
    roving.setFocus(index);
    virtual.scrollToIndex(rowOf(index), { align: "auto" });
  });
  const selectable = items.filter((item) => item.selectable !== false);
  const orderedKeys = (keys: readonly string[]) => {
    const wanted = new Set(keys);
    const result: string[] = [];
    for (const item of selectable) if (wanted.delete(item.key)) result.push(item.key);
    return result;
  };
  const submit = (keys: string[], item: ListItem | null, coalesce = false, activate?: string) => {
    const next = { keys: orderedKeys(keys), item: item as unknown as JsonValue, ...(activate === undefined ? {} : { activate }) };
    draftRef.current = next;
    draft.change(next);
    void draft.send(next, coalesce);
    setLocalCurrent({ key: item?.key ?? null, binding: boundCurrent });
  };
  const chooseMultiple = (item: ListItem, mode: "replace" | "toggle" | "range", coalesce = false, focusIndex = roving.focus, activate?: string) => {
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
      submit(keys, focused, coalesce, activate);
    }
  };
  keepRovingRow(virtual, rowOf(roving.focus));
  const focusEntry = () => {
    scroll.current?.querySelector<HTMLElement>(`[data-focus-index="${roving.focus}"]`)?.focus({ preventScroll: true });
  };
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
      const plain = !event.ctrlKey && !event.shiftKey;
      const activate = plain && (mouse ? event.detail <= 1 : "key" in event && (event.key === "Enter" || event.key === " "));
      if (mouse && plain && event.detail > 1 && (multiple || item.selectable === false)) return;
      if (item.selectable === false) {
        if ((!mouse || plain) && block.on_activate) void draft.send({ keys: [], item: item as unknown as JsonValue, select: false, activate: item.key });
      } else if (multiple) {
        if (mouse && event.shiftKey && anchor.current === null) anchor.current = pointerFocus.current ?? items[roving.focus]?.key ?? item.key;
        chooseMultiple(item, mouse && event.shiftKey ? "range" : mouse && event.ctrlKey ? "toggle" : "replace", false, roving.focus, activate && block.on_activate ? item.key : undefined);
      }
      else if (block.on_select) {
        if (block.on_activate) void draft.send({ keys: [item.key], item: item as unknown as JsonValue, ...(activate ? { activate: item.key } : {}) });
        else void data.act(`${pointer}/on_select`, item.key, item as unknown as JsonValue);
      } else if (activate && block.on_activate) void draft.send({ keys: [], item: item as unknown as JsonValue, select: false, activate: item.key });
      else if (!block.on_activate && isMedia(item.image)) setPreview({ media: item.image, name: item.title, trigger: event.currentTarget });
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
    onMouseDownCapture={(event) => {
      pointerFocus.current = items[roving.focus]?.key ?? null;
      pointerTarget.current = event.target;
      if (multiple && event.target instanceof Element && !event.target.closest("[data-row-key], button, input, textarea, select")) focusEntry();
    }}
    onMouseUp={(event) => { if (multiple && event.target instanceof Element && !event.target.closest("[data-row-key], button, input, textarea, select")) focusEntry(); }}
    onClick={(event) => { if (!multiple || disabled || event.target !== pointerTarget.current || !(event.target instanceof Element) || event.target.closest("[data-row-key], button")) return; anchor.current = null; submit([], null); }}
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
      // 아이콘 줄은 묶은 열 수를 그대로 그린다. 스크롤 막대가 생겨 칸 폭이 잠깐 줄면
      // auto-fill이 한 칸 모자란 폭으로 접어 두 줄이 되고, 그 두 줄 높이가 줄 묶음의
      // 기억으로 남아 막대가 사라진 뒤에도 접힌 채로 남는다. 열 수를 묶음이 정하면
      // 폭이 줄어도 줄은 한 줄이고, 높이도 한 줄 높이로만 기억된다.
      const rowStyle = entry.kind === "items" && icons
        ? { gridTemplateColumns: `repeat(${activeColumns}, minmax(0, 1fr))` } as React.CSSProperties
        : undefined;
      return <div className={entry.kind === "status" ? "ks-load-more ks-list-group-row" : entry.kind === "items" ? grid ? "ks-list-grid-row" : icons ? "ks-icon-grid ks-list-icon-row" : undefined : undefined} key={row.key} data-index={row.index} data-row-key={entry.kind === "status" ? entry.group.key ?? entry.group.title : undefined} ref={virtual.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start}px)`, ...rowStyle }}>
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
