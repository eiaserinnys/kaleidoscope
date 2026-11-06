import { encodeCommentKey } from "../comments/key";
import { useBlockRootProps } from "../comments/block-root";
import { memo, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { BindingMore, Block, Column, SortSpec, TableCellAddress } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { Badge, isBadge } from "../components/badge";
import { DataIcon } from "../components/data-icons";
import { DataState } from "../components/data-state";
import { Notice } from "../components/primitives";
import { useBinding, useWindowData, type WindowData } from "../data/window-data";
import { useWindowVisible } from "../data/window-state";
import { useLoadMore } from "./load-more";
import type { BlockContext } from "./block-context";
import { useItemMenu } from "./item-menu";
import { NoItems, VirtualSurface, asArray, dateText, isObject, keepRovingRow, useRoving, useVirtualRows } from "./data-view-common";
import * as shellErrors from "../contract/shell-errors";
import { TableGrid } from "./data-table-grid";
import { ContentCell } from "./data-table-cell";

export type Row = Record<string, JsonValue> & { key: string };
const validRow = (item: unknown): item is Row => isObject(item) && typeof item.key === "string";
const numberFormatter = new Intl.NumberFormat();
export function width(column: Column, rows: Row[]) {
  if (column.width === "narrow" && column.format === "number") {
    const valueLength = rows.reduce((longest, row) => Math.max(longest, Array.from(cellValue(row[column.field], column)).length), 0);
    const labelLength = Array.from(column.label).length;
    return `max(calc(var(--ks-space-6) * 2), calc(${valueLength} * var(--ks-type-body) * 0.6 + 2 * var(--ks-space-2)), calc(${labelLength} * var(--ks-type-body) + 2 * var(--ks-space-2)))`;
  }
  const base = column.width === "narrow" ? "calc(var(--ks-space-6) * 3)" : column.width === "medium" ? "calc(var(--ks-space-6) * 5)" : column.width === "wide" ? "calc(var(--ks-space-6) * 8)" : "calc(var(--ks-space-6) * 2)";
  const length = column.format === "badge" ? Math.max(0, ...rows.map((row) => {
    const badge = row[column.field];
    return isBadge(badge) ? Array.from(typeof badge === "string" ? badge : badge.text).length : 0;
  })) : 0;
  // 배지 글자 수 × 본문 글자 크기. 머리와 줄이 이 값 하나를 함께 쓴다(em은 칸마다 글자 크기가 달라 어긋난다).
  const minimum = length ? `max(${base}, calc(${length} * var(--ks-type-body) + 4 * var(--ks-space-2)))` : base;
  return column.width === undefined || column.width === "fill" ? `minmax(${minimum}, 1fr)` : minimum;
}
export function cellValue(value: JsonValue | undefined, column: Column): string {
  if (value == null) return "";
  if (column.format === "date") return dateText(value);
  if (column.format === "number" && typeof value === "number") return numberFormatter.format(value);
  return typeof value === "string" ? value : JSON.stringify(value);
}
const numeric = (value: JsonValue | undefined): number | null => {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};
const trend = (value: JsonValue | undefined): number[] => Array.isArray(value) ? value.filter((v): v is number => typeof v === "number" && Number.isFinite(v)) : [];
export function formattedCell(value: JsonValue | undefined, column: Column): ReactNode | undefined {
  if (column.format === "content") return <ContentCell value={value} column={column} />;
  if (column.format === "delta") {
    const n = numeric(value);
    return n === null ? "—" : <span className={`ks-table-delta ${n > 0 ? "up" : n < 0 ? "down" : "flat"}`}>{n > 0 ? "+" : ""}{n.toFixed(2)}%</span>;
  }
  if (column.format === "sparkline") {
    const values = trend(value);
    if (values.length < 2) return "—";
    const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    const points = values.map((v, i) => [2 + i * 84 / (values.length - 1), 21 - (v - min) / span * 18]);
    const line = points.map(([x, y]) => `${x},${y}`).join(" ");
    const first = values[0], last = values[values.length - 1];
    return <svg className={`ks-table-sparkline ${last >= first ? "up" : "down"}`} viewBox="0 0 88 24" role="img" aria-label={`추이 ${new Intl.NumberFormat().format(first)} → ${new Intl.NumberFormat().format(last)}`}><polygon points={`2,23 ${line} 86,23`} fillOpacity="0.14" /><polyline points={line} fill="none" strokeWidth="1.6" /><circle cx={points.at(-1)![0]} cy={points.at(-1)![1]} r="2.2" /></svg>;
  }
  return undefined;
}
export const numericColumn = (column: Column) => column.format === "number" || column.format === "date" || column.format === "delta";
const readOnlyRowProps = () => ({ "data-ks-share-readonly": "true" });
function normalizeColumns(value: unknown, rowHeader?: string, cell = false): { columns: Column[]; error?: ReturnType<typeof shellErrors.SHELL_TABLE_COLUMNS_VALUE_INVALID> } {
  const values = asArray(value);
  const fields = new Set<string>();
  for (const [index, column] of values.entries()) {
    if (!isObject(column) || Object.keys(column).some((key) => !["field", "label", "width", "format", "max_lines"].includes(key)) || typeof column.field !== "string" || typeof column.label !== "string" ||
        (column.width !== undefined && (typeof column.width !== "string" || !["narrow", "medium", "wide", "fill"].includes(column.width))) ||
        (column.format !== undefined && (typeof column.format !== "string" || !["text", "number", "date", "badge", "delta", "sparkline", "content"].includes(column.format))) ||
        (column.max_lines !== undefined && (!Number.isInteger(column.max_lines) || Number(column.max_lines) < 1 || Number(column.max_lines) > 3 || column.format !== "content"))) {
      const field = isObject(column) && typeof column.field === "string" ? column.field : `${index + 1}번째`;
      return { columns: [], error: shellErrors.SHELL_TABLE_COLUMNS_VALUE_INVALID({ field }) };
    }
    if (fields.has(column.field)) return { columns: [], error: shellErrors.SHELL_TABLE_COLUMNS_FIELD_DUPLICATE({ field: column.field }) };
    fields.add(column.field);
  }
  const columns = values as Column[];
  if (columns.length && rowHeader && (columns[0].field !== rowHeader || (columns[0].format !== undefined && columns[0].format !== "text"))) return { columns: [], error: shellErrors.SHELL_TABLE_ROW_HEADER_INVALID({ field: rowHeader }) };
  if (cell && rowHeader && columns.length === 1) return { columns: [], error: shellErrors.SHELL_TABLE_DATA_COLUMNS_EMPTY() };
  return { columns };
}
export function TableBlock({ block, context, pointer }: { block: Extract<Block, { type: "table" }>; context: BlockContext; pointer: string }) {
  const blockRoot = useBlockRootProps();
  const value = useBinding(`${pointer}/rows`, block.rows);
  const columnsValue = useBinding(`${pointer}/columns`, block.columns);
  if (value.status === "ready" && columnsValue.status === "ready") return <TableReady block={block} context={context} pointer={pointer} value={value.value} columnsValue={columnsValue.value} more={value.more} />;
  return <DataState rootProps={blockRoot} value={(value.status !== "ready" ? value : columnsValue) as Exclude<typeof value, { status: "ready" }>} loading={block.selection === "cell" ? "table-grid" : "table"} />;
}
function TableReady({ block, context, pointer, value, columnsValue, more }: { block: Extract<Block, { type: "table" }>; context: BlockContext; pointer: string; value: unknown; columnsValue: unknown; more?: BindingMore }) {
  const blockRoot = useBlockRootProps();
  const data = useWindowData();
  const menu = useItemMenu(block.item_menu, pointer);
  const rows = useMemo(() => asArray(value).filter(validRow), [value]);
  const missingCount = asArray(value).length - rows.length;
  const rowError = missingCount ? shellErrors.SHELL_TABLE_ROW_KEY_MISSING({ count: String(missingCount) }) : null;
  const result = useMemo(() => normalizeColumns(columnsValue, block.row_header, block.selection === "cell"), [columnsValue, block.row_header, block.selection]);
  const selectedValue = useBinding(`${pointer}/selected`, block.selected ?? null);
  const selected = selectedValue.status === "ready" ? selectedValue.value : null;
  const visible = useWindowVisible(context);
  const choose = (row: Row) => { if (block.on_select) void data.act(`${pointer}/on_select`, row.key, row); };
  const selectedCell = isObject(selected) && typeof selected.row === "string" && typeof selected.column === "string" ? { row: selected.row, column: selected.column } : null;
  if (result.error) return <DataState rootProps={blockRoot} value={{ status: "failed", message: result.error.message, id: result.error.id, retry: [] }} />;
  if (rowError && !rows.length) return <DataState rootProps={blockRoot} value={{ status: "failed", message: rowError.message, id: rowError.id, retry: [] }} />;
  if (!result.columns.length) return <NoItems rootProps={blockRoot} />;
  const table = <><TableView rootProps={rowError ? undefined : blockRoot} columns={result.columns} rows={rows} initialSort={block.sort} selected={typeof selected === "string" ? selected : null} selection={block.selection} selectedCell={selectedCell} rowHeader={block.row_header} onChooseCell={(row, column) => { if (block.on_select) void data.act(`${pointer}/on_select`, { row: row.key, column }, row); }} more={more} data={data} visible={visible} rowProps={!block.on_select && !block.item_menu?.length ? readOnlyRowProps : undefined} onChoose={choose} onContextMenu={(row, anchor, event) => menu.open(event, anchor, row, row.key, "행 복사", Array.from((anchor.closest('[role="row"]') ?? anchor).querySelectorAll('[role="cell"], [role="gridcell"], [role="rowheader"]'), (cell) => cell.textContent ?? "").join("\t"))} />{menu.dialog}</>;
  return rowError ? <div {...blockRoot} className="ks-table-with-notice"><div className="ks-table-row-notice"><Notice role="alert" errorId={rowError.id}>{rowError.message}</Notice></div>{table}</div> : table;
}

export interface TableViewProps {
  rootProps?: import("../comments/block-root").BlockRootProps;
  columns: Column[];
  rows: Row[];
  initialSort?: SortSpec | null;
  selected: string | null;
  selection?: "row" | "cell";
  selectedCell?: TableCellAddress | null;
  rowHeader?: string;
  onChooseCell?: (row: Row, column: string) => void;
  ariaLabel?: string;
  onChoose: (row: Row) => void;
  onActivate?: (row: Row, anchor: HTMLElement) => void;
  onContextMenu?: (row: Row, anchor: HTMLElement, event?: React.MouseEvent<HTMLElement>) => void;
  renderCell?: (row: Row, column: Column) => ReactNode | undefined;
  compareRows?: (a: Row, b: Row, sort: SortSpec) => number;
  rowProps?: (row: Row) => Record<string, string>;
  more?: BindingMore;
  data?: WindowData;
  visible?: boolean;
}

type TableHandlers = {
  focus: (index: number) => void;
  keyDown: (event: React.KeyboardEvent<HTMLElement>, index: number, row: Row) => void;
  choose: (row: Row) => void;
  activate: (row: Row, anchor: HTMLElement) => void;
  context: (event: React.MouseEvent<HTMLElement>, row: Row) => void;
};
const TableRow = memo(function TableRow({ row, index, start, active, focused, columns, measure, handlers, renderCell, rowProps, activatable }: { row: Row; index: number; start: number; active: boolean; focused: boolean; columns: Column[]; measure: (node: Element | null) => void; handlers: React.RefObject<TableHandlers>; renderCell?: TableViewProps["renderCell"]; rowProps?: TableViewProps["rowProps"]; activatable: boolean }) {
  return <div data-ks-comment-key={encodeCommentKey(row.key)} {...rowProps?.(row)} role="row" aria-rowindex={index + 1} aria-selected={active} data-row-key={row.key} data-focus-index={index} data-index={index} tabIndex={focused ? 0 : -1} ref={measure} className={`ks-row ks-table-row${active ? " is-selected" : ""}${activatable ? " is-activatable" : ""}`} style={{ position: "absolute", top: 0, transform: `translateY(${start}px)` }} onFocus={() => handlers.current.focus(index)} onKeyDown={(event) => handlers.current.keyDown(event, index, row)} onClick={() => handlers.current.choose(row)} onDoubleClick={(event) => handlers.current.activate(row, event.currentTarget)} onContextMenu={(event) => handlers.current.context(event, row)}>
    {columns.map((column) => { const raw = row[column.field]; const text = cellValue(raw, column); const content = renderCell?.(row, column); return <span role="cell" key={column.field} title={text} className={`ks-table-cell${numericColumn(column) ? " is-numeric" : ""}`}>{content === undefined ? column.format === "badge" && isBadge(raw) ? <Badge value={raw} /> : formattedCell(raw, column) ?? text : content}</span>; })}
  </div>;
});

export function TableView(props: TableViewProps) {
  return props.selection === "cell" ? <TableGrid {...props} /> : <RowTableView {...props} />;
}

function RowTableView({ rootProps, columns: sourceColumns, rows: sourceRows, initialSort, selected, ariaLabel = "표", onChoose, onActivate, onContextMenu, renderCell, compareRows, rowProps, more, data, visible = true }: TableViewProps) {
  const [sort, setSort] = useState<SortSpec | null>(initialSort ?? null);
  const rows = useMemo(() => {
    if (!sort) return sourceRows;
    return [...sourceRows].sort((a, b) => {
      const customCompare = compareRows?.(a, b, sort);
      if (customCompare !== undefined) return customCompare;
      const cmp = (() => {
        const left = a[sort.field], right = b[sort.field];
        const format = sourceColumns.find((column) => column.field === sort.field)?.format;
        if (format === "delta") return (numeric(left) ?? 0) - (numeric(right) ?? 0);
        if (format === "sparkline") {
          const change = (value: JsonValue | undefined) => { const values = trend(value); return values.length < 2 ? 0 : (values.at(-1)! - values[0]) / (Math.abs(values[0]) || 1); };
          return change(left) - change(right);
        }
        return typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true });
      })();
      return sort.desc ? -cmp : cmp;
    });
  }, [sourceRows, sourceColumns, sort, compareRows]);
  const rowKeys = useMemo(() => rows.map((row) => [row.key]), [rows]);
  const { scroll, virtual } = useVirtualRows(rows.length, 32, undefined, false, undefined, undefined, rowKeys);
  const roving = useRoving(rows, selected, scroll, virtual);
  keepRovingRow(virtual, roving.focus);
  const virtualRows = virtual.getVirtualItems();
  const footer = useLoadMore(more, rows.length, virtualRows.at(-1)?.index ?? -1, data, visible);
  const handlers = useRef<TableHandlers>(null!);
  handlers.current = {
    focus: roving.setFocus,
    keyDown: (event, index, row) => roving.keyDown(event, index, () => onActivate ? onActivate(row, event.currentTarget) : onChoose(row)),
    choose: onChoose,
    activate: (row, anchor) => onActivate?.(row, anchor),
    context: (event, row) => { if (onContextMenu && !event.defaultPrevented) { event.preventDefault(); onContextMenu(row, event.currentTarget, event); } },
  };
  const gridColumns = useMemo(() => sourceColumns.map((column) => width(column, sourceRows)).join(" "), [sourceRows, sourceColumns]);
  const lines = Math.max(0, ...sourceColumns.filter((column) => column.format === "content").map((column) => column.max_lines ?? 3));
  const toggleSort = (field: string) => setSort((old) => old?.field !== field ? { field, desc: false } : !old.desc ? { field, desc: true } : null);
  return <div {...rootProps} className={`ks-data-view ks-table-scroll ks-table-rows${lines ? " has-content" : ""}`} ref={scroll} role="table" aria-rowcount={rows.length} aria-label={ariaLabel} style={{ "--ks-table-columns": gridColumns, "--ks-grid-lines": lines } as CSSProperties}>
    <div className="ks-table-inner">
      <div className="ks-table-header" role="row">
        {sourceColumns.map((column) => <div role="columnheader" aria-sort={sort?.field === column.field ? sort.desc ? "descending" : "ascending" : "none"} key={column.field}><button className={numericColumn(column) ? "is-numeric" : undefined} type="button" onClick={() => toggleSort(column.field)}>{column.label}{sort?.field === column.field && <DataIcon name={sort.desc ? "chevron-down" : "chevron-up"} size="inline" />}</button></div>)}
      </div>
      {!rows.length ? <NoItems /> : <VirtualSurface virtual={virtual}>{virtualRows.map((v) => {
        const row = rows[v.index];
        return <TableRow key={row.key} row={row} index={v.index} start={v.start} active={row.key === selected} focused={roving.focus === v.index} columns={sourceColumns} measure={virtual.measureElement} handlers={handlers} renderCell={renderCell} rowProps={rowProps} activatable={Boolean(onActivate)} />;
      })}</VirtualSurface>}
    </div>
    {footer}
  </div>;
}
