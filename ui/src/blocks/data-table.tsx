import { useMemo, useState } from "react";
import type { Block, Column, SortSpec } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { Badge, isBadge } from "../components/badge";
import { DataIcon } from "../components/data-icons";
import { DataState } from "../components/data-state";
import { useBinding, useWindowData } from "../data/window-data";
import type { BlockContext } from "./block-context";
import { NoItems, VirtualSurface, asArray, dateText, isObject, useRoving, useVirtualRows } from "./data-view-common";

type Row = Record<string, JsonValue> & { key: string };
const validRow = (item: unknown): item is Row => isObject(item) && typeof item.key === "string";
function width(column: Column, rows: Row[]) {
  const base = column.width === "narrow" ? "calc(var(--ks-space-6) * 3)" : column.width === "medium" ? "calc(var(--ks-space-6) * 5)" : column.width === "wide" ? "calc(var(--ks-space-6) * 8)" : "calc(var(--ks-space-6) * 3)";
  const length = column.format === "badge" ? Math.max(0, ...rows.map((row) => {
    const badge = row[column.field];
    return isBadge(badge) ? Array.from(typeof badge === "string" ? badge : badge.text).length : 0;
  })) : 0;
  const minimum = length ? `max(${base}, calc(${length}em + 4 * var(--ks-space-2)))` : base;
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
  const [sort, setSort] = useState<SortSpec | null>(block.sort ?? null);
  const rows = useMemo(() => {
    const source = asArray(value).filter(validRow);
    if (!sort) return source;
    return [...source].sort((a, b) => {
      const left = a[sort.field], right = b[sort.field];
      const cmp = typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true });
      return sort.desc ? -cmp : cmp;
    });
  }, [value, sort]);
  const { scroll, virtual } = useVirtualRows(rows.length, 32);
  const selected = block.selected ? context.window.state[block.selected.state] : null;
  const roving = useRoving(rows, selected, scroll, virtual);
  const columns = block.columns.map((column) => width(column, rows)).join(" ");
  const choose = (row: Row) => { if (block.on_select) void data.act(`${pointer}/on_select`, row.key, row); };
  const toggleSort = (field: string) => setSort((old) => old?.field !== field ? { field, desc: false } : !old.desc ? { field, desc: true } : null);
  return <div className="ks-data-view ks-table-scroll" ref={scroll} role="table" aria-label="표">
    <div className="ks-table-inner">
      <div className="ks-table-header" role="row" style={{ gridTemplateColumns: columns }}>
        {block.columns.map((column) => <div role="columnheader" aria-sort={sort?.field === column.field ? sort.desc ? "descending" : "ascending" : "none"} key={column.field}><button type="button" onClick={() => toggleSort(column.field)}>{column.label}{sort?.field === column.field && <DataIcon name={sort.desc ? "chevron-down" : "chevron-up"} size="inline" />}</button></div>)}
      </div>
      {!rows.length ? <NoItems /> : <VirtualSurface virtual={virtual}>{virtual.getVirtualItems().map((v) => {
        const row = rows[v.index]; const active = row.key === selected;
        return <div role="row" aria-selected={active} data-focus-index={v.index} data-index={v.index} tabIndex={roving.focus === v.index ? 0 : -1} ref={virtual.measureElement} key={row.key} className={`ks-row ks-table-row${active ? " is-selected" : ""}`} style={{ position: "absolute", top: 0, transform: `translateY(${v.start}px)`, gridTemplateColumns: columns }} onFocus={() => roving.setFocus(v.index)} onKeyDown={(e) => roving.keyDown(e, v.index, () => choose(row))} onClick={() => choose(row)}>
          {block.columns.map((column) => { const raw = row[column.field]; const text = cellValue(raw, column); return <span role="cell" key={column.field} title={text} className={`ks-table-cell${column.format === "number" || column.format === "date" ? " is-numeric" : ""}`}>{column.format === "badge" && isBadge(raw) ? <Badge value={raw} /> : text}</span>; })}
        </div>;
      })}</VirtualSurface>}
    </div>
  </div>;
}
