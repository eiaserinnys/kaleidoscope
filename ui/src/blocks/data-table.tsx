import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Block, Column, SortSpec } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { Badge, isBadge } from "../components/badge";
import { DataIcon } from "../components/data-icons";
import { DataState } from "../components/data-state";
import { useBinding, useWindowData } from "../data/window-data";
import type { BlockContext } from "./block-context";
import { NoItems, VirtualSurface, asArray, dateText, isObject, keepRovingRow, useRoving, useVirtualRows } from "./data-view-common";

export type Row = Record<string, JsonValue> & { key: string };
const validRow = (item: unknown): item is Row => isObject(item) && typeof item.key === "string";
function width(column: Column, rows: Row[]) {
  const base = column.width === "narrow" ? "calc(var(--ks-space-6) * 3)" : column.width === "medium" ? "calc(var(--ks-space-6) * 5)" : column.width === "wide" ? "calc(var(--ks-space-6) * 8)" : "calc(var(--ks-space-6) * 3)";
  const length = column.format === "badge" ? Math.max(0, ...rows.map((row) => {
    const badge = row[column.field];
    return isBadge(badge) ? Array.from(typeof badge === "string" ? badge : badge.text).length : 0;
  })) : 0;
  // 배지 글자 수 × 본문 글자 크기. 머리와 줄이 이 값 하나를 함께 쓴다(em은 칸마다 글자 크기가 달라 어긋난다).
  const minimum = length ? `max(${base}, calc(${length} * var(--ks-type-body) + 4 * var(--ks-space-2)))` : base;
  return column.width === undefined || column.width === "fill" ? `minmax(${minimum}, 1fr)` : minimum;
}
function cellValue(value: JsonValue | undefined, column: Column): string {
  if (value == null) return "";
  if (column.format === "date") return dateText(value);
  if (column.format === "number" && typeof value === "number") return new Intl.NumberFormat().format(value);
  return typeof value === "string" ? value : JSON.stringify(value);
}
export function TableBlock({ block, context, pointer }: { block: Extract<Block, { type: "table" }>; context: BlockContext; pointer: string }) {
  const value = useBinding(`${pointer}/rows`, block.rows);
  if (value.status !== "ready") return <DataState value={value} />;
  return <TableReady block={block} context={context} pointer={pointer} value={value.value} />;
}
function TableReady({ block, context, pointer, value }: { block: Extract<Block, { type: "table" }>; context: BlockContext; pointer: string; value: unknown }) {
  const data = useWindowData();
  const rows = useMemo(() => asArray(value).filter(validRow), [value]);
  const selected = block.selected ? context.window.state[block.selected.state] : null;
  const choose = (row: Row) => { if (block.on_select) void data.act(`${pointer}/on_select`, row.key, row); };
  return <TableView columns={block.columns} rows={rows} initialSort={block.sort} selected={typeof selected === "string" ? selected : null} onChoose={choose} />;
}

export interface TableViewProps {
  columns: Column[];
  rows: Row[];
  initialSort?: SortSpec | null;
  selected: string | null;
  ariaLabel?: string;
  onChoose: (row: Row) => void;
  onActivate?: (row: Row, anchor: HTMLElement) => void;
  onContextMenu?: (row: Row, anchor: HTMLElement) => void;
  renderCell?: (row: Row, column: Column) => ReactNode | undefined;
  compareRows?: (a: Row, b: Row, sort: SortSpec) => number;
  rowProps?: (row: Row) => Record<string, string>;
}

export function TableView({ columns: sourceColumns, rows: sourceRows, initialSort, selected, ariaLabel = "표", onChoose, onActivate, onContextMenu, renderCell, compareRows, rowProps }: TableViewProps) {
  const [sort, setSort] = useState<SortSpec | null>(initialSort ?? null);
  const rows = useMemo(() => {
    if (!sort) return sourceRows;
    return [...sourceRows].sort((a, b) => {
      const customCompare = compareRows?.(a, b, sort);
      if (customCompare !== undefined) return customCompare;
      const cmp = (() => {
        const left = a[sort.field], right = b[sort.field];
        return typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true });
      })();
      return sort.desc ? -cmp : cmp;
    });
  }, [sourceRows, sort, compareRows]);
  const { scroll, virtual } = useVirtualRows(rows.length, 32);
  const roving = useRoving(rows, selected, scroll, virtual);
  keepRovingRow(virtual, roving.focus);
  const gridColumns = sourceColumns.map((column) => width(column, rows)).join(" ");
  const toggleSort = (field: string) => setSort((old) => old?.field !== field ? { field, desc: false } : !old.desc ? { field, desc: true } : null);
  return <div className="ks-data-view ks-table-scroll" ref={scroll} role="table" aria-rowcount={rows.length} aria-label={ariaLabel} style={{ "--ks-table-columns": gridColumns } as CSSProperties}>
    <div className="ks-table-inner">
      <div className="ks-table-header" role="row">
        {sourceColumns.map((column) => <div role="columnheader" aria-sort={sort?.field === column.field ? sort.desc ? "descending" : "ascending" : "none"} key={column.field}><button className={column.format === "number" || column.format === "date" ? "is-numeric" : undefined} type="button" onClick={() => toggleSort(column.field)}>{column.label}{sort?.field === column.field && <DataIcon name={sort.desc ? "chevron-down" : "chevron-up"} size="inline" />}</button></div>)}
      </div>
      {!rows.length ? <NoItems /> : <VirtualSurface virtual={virtual}>{virtual.getVirtualItems().map((v) => {
        const row = rows[v.index]; const active = row.key === selected;
        const activate = (anchor: HTMLElement) => onActivate?.(row, anchor);
        return <div {...rowProps?.(row)} role="row" aria-rowindex={v.index + 1} aria-selected={active} data-focus-index={v.index} data-index={v.index} tabIndex={roving.focus === v.index ? 0 : -1} ref={virtual.measureElement} key={row.key} className={`ks-row ks-table-row${active ? " is-selected" : ""}${onActivate ? " is-activatable" : ""}`} style={{ position: "absolute", top: 0, transform: `translateY(${v.start}px)` }} onFocus={() => roving.setFocus(v.index)} onKeyDown={(e) => roving.keyDown(e, v.index, () => onActivate ? activate(e.currentTarget) : onChoose(row))} onClick={() => onChoose(row)} onDoubleClick={(e) => activate(e.currentTarget)} onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); onContextMenu(row, e.currentTarget); } }}>
          {sourceColumns.map((column) => { const raw = row[column.field]; const text = cellValue(raw, column); const content = renderCell?.(row, column); return <span role="cell" key={column.field} title={text} className={`ks-table-cell${column.format === "number" || column.format === "date" ? " is-numeric" : ""}`}>{content === undefined ? column.format === "badge" && isBadge(raw) ? <Badge value={raw} /> : text : content}</span>; })}
        </div>;
      })}</VirtualSurface>}
    </div>
  </div>;
}
