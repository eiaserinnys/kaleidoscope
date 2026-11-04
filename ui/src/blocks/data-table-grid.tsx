import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import type { Column } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { Badge, isBadge } from "../components/badge";
import { useLoadMore } from "./load-more";
import { keepRovingRow, NoItems, useVirtualRows, VirtualSurface, isObject } from "./data-view-common";
import { cellValue, formattedCell, numericColumn, width, type Row, type TableViewProps } from "./data-table";
import { contentCellError } from "./data-table-cell";

type Address = { row: string; column: string };
type GridHandlers = {
  focus: (row: string, column: string) => void;
  choose: (row: string, column: string) => void;
  key: (event: KeyboardEvent<HTMLElement>, row: string, column: string) => void;
  menu: (event: MouseEvent<HTMLElement> | undefined, row: string, anchor: HTMLElement) => void;
};

export const GridCell = memo(function GridCell({ raw, column, rowKey, rowLabel, index, columnIndex, selected, focused, handlers }: {
  raw: JsonValue | undefined; column: Column; rowKey: string; rowLabel: string; index: number; columnIndex: number;
  selected: boolean; focused: boolean; handlers: RefObject<GridHandlers>;
}) {
  const press = useRef<{ x: number; y: number } | null>(null);
  const text = cellValue(raw, column);
  const title = column.format === "content" && isObject(raw) && typeof raw.title === "string" ? raw.title : text;
  const error = column.format === "content" ? contentCellError(raw, column) : null;
  return <span role="gridcell" aria-label={`${rowLabel}, ${column.label}, ${error ? `오류: ${error.message}, ${error.id}` : raw == null ? "빈 칸" : title}`} aria-selected={selected} aria-colindex={columnIndex + 1} data-focus-index={index}
    tabIndex={focused ? 0 : -1} className={`ks-table-cell ks-grid-cell${numericColumn(column) ? " is-numeric" : ""}${selected ? " is-selected" : ""}`}
    onFocus={() => handlers.current.focus(rowKey, column.field)}
    onKeyDown={(event) => handlers.current.key(event, rowKey, column.field)}
    onMouseDown={(event) => { if (event.detail >= 2) event.preventDefault(); }}
    onPointerDown={(event) => { press.current = { x: event.clientX, y: event.clientY }; }}
    onClick={(event) => {
      const start = press.current; press.current = null;
      // 지도 블록과 같은 4px 이동 문턱으로 이번 누름의 끌기만 가른다.
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
      window.getSelection()?.removeAllRanges();
      event.currentTarget.focus({ preventScroll: true }); handlers.current.choose(rowKey, column.field);
    }}
    onContextMenu={(event) => handlers.current.menu(event, rowKey, event.currentTarget)}>
    <span className="ks-grid-cell-value">{column.format === "badge" && isBadge(raw) ? <Badge value={raw} /> : formattedCell(raw, column) ?? text}</span>
  </span>;
});

export const GridRow = memo(function GridRow({ row, index, start, columns, rowHeader, active, focus, measure, handlers }: {
  row: Row; index: number; start: number; columns: Column[]; rowHeader?: string; active: string | null; focus: string | null;
  measure: (element: Element | null) => void; handlers: RefObject<GridHandlers>;
}) {
  const label = rowHeader ? cellValue(row[rowHeader], columns[0]) : row.key;
  const count = columns.length - (rowHeader ? 1 : 0);
  return <div role="row" aria-rowindex={index + 2} data-index={index} ref={measure} className="ks-row ks-table-row ks-grid-row" style={{ position: "absolute", top: 0, transform: `translateY(${start}px)` }}>
    {columns.map((column, columnIndex) => column.field === rowHeader
      ? <span role="rowheader" aria-colindex={columnIndex + 1} key={column.field} className="ks-table-cell ks-grid-row-header" onContextMenu={(event) => {
          const first = event.currentTarget.parentElement?.querySelector<HTMLElement>('[role="gridcell"]');
          if (first) handlers.current.menu(event, row.key, first);
        }}><span className="ks-grid-row-label">{label}</span></span>
      : <GridCell key={column.field} raw={row[column.field]} column={column} rowKey={row.key} rowLabel={label} index={index * count + columnIndex - (rowHeader ? 1 : 0)} columnIndex={columnIndex} selected={active === column.field} focused={focus === column.field} handlers={handlers} />)}
  </div>;
});

export function TableGrid({ columns, rows, selectedCell, rowHeader, onChooseCell, onContextMenu, more, data, visible = true, ariaLabel = "표" }: TableViewProps) {
  const dataColumns = useMemo(() => columns.filter((column) => column.field !== rowHeader), [columns, rowHeader]);
  const [focus, setFocus] = useState<Address | null>(() => rows.length && dataColumns.length ? { row: rows[0].key, column: dataColumns[0].field } : null);
  const last = useRef({ row: 0, column: 0 });
  const pending = useRef<(Address & { keyboard?: boolean }) | null>(null);
  const rowIndex = Math.max(0, rows.findIndex((row) => row.key === focus?.row));
  const columnIndex = Math.max(0, dataColumns.findIndex((column) => column.field === focus?.column));
  const currentRow = rows.some((row) => row.key === focus?.row) ? rowIndex : Math.min(last.current.row, Math.max(0, rows.length - 1));
  const currentColumn = dataColumns.some((column) => column.field === focus?.column) ? columnIndex : Math.min(last.current.column, Math.max(0, dataColumns.length - 1));
  const current = rows[currentRow] && dataColumns[currentColumn] ? { row: rows[currentRow].key, column: dataColumns[currentColumn].field } : null;
  const rowHeight = useRef(32);
  const { scroll, virtual } = useVirtualRows(rows.length, rowHeight.current);
  keepRovingRow(virtual, currentRow);
  const virtualRows = virtual.getVirtualItems();
  const footer = useLoadMore(more, rows.length, virtualRows.at(-1)?.index ?? -1, data, visible);
  const gridColumns = useMemo(() => columns.map((column) => width(column.field === rowHeader && !column.width ? { ...column, width: "medium" } : column, rows)).join(" "), [columns, rows, rowHeader]);
  const lines = Math.max(0, ...columns.filter((column) => column.format === "content").map((column) => column.max_lines ?? 3));
  useLayoutEffect(() => {
    // CSS의 예약 높이와 행 간격까지 포함한 실측을 미마운트 행에도 쓴다.
    const height = scroll.current?.querySelector<HTMLElement>(".ks-grid-row")?.getBoundingClientRect().height ?? 0;
    if (!height || height === rowHeight.current) return;
    rowHeight.current = height;
    virtual.setOptions({ ...virtual.options, estimateSize: () => height });
    // estimateSize 변경은 라이브러리의 측정 캐시를 자동 무효화하지 않는다.
    virtual.measure();
  }, [columns, lines, rows.length, visible, virtual]);
  const handlers = useRef<GridHandlers>(null!);
  const move = (row: number, column: number) => {
    row = Math.max(0, Math.min(rows.length - 1, row)); column = Math.max(0, Math.min(dataColumns.length - 1, column));
    if (!rows[row] || !dataColumns[column]) return;
    const address = { row: rows[row].key, column: dataColumns[column].field };
    last.current = { row, column }; pending.current = { ...address, keyboard: true }; setFocus(address);
    virtual.scrollToIndex(row, { align: "auto" });
  };
  const reveal = (target: HTMLElement) => {
    const container = scroll.current; if (!container) return;
    const rect = target.getBoundingClientRect(), bounds = container.getBoundingClientRect();
    const ring = Number.parseFloat(getComputedStyle(target).getPropertyValue("--ks-focus-width")) || 0;
    const pinned = rowHeader ? container.querySelector<HTMLElement>(".ks-grid-row-header")?.getBoundingClientRect().width ?? 0 : 0;
    if (rect.left - ring < bounds.left + pinned) container.scrollLeft -= bounds.left + pinned - (rect.left - ring);
    const right = bounds.left + container.clientLeft + container.clientWidth;
    if (rect.right + ring > right) container.scrollLeft += rect.right + ring - right;
    const top = bounds.top + container.clientTop + (container.querySelector<HTMLElement>(".ks-table-header")?.getBoundingClientRect().height ?? 0);
    const bottom = bounds.top + container.clientTop + container.clientHeight;
    if (rect.top - ring < top) container.scrollTop -= top - (rect.top - ring);
    else if (rect.bottom + ring > bottom) container.scrollTop += rect.bottom + ring - bottom;
  };
  useEffect(() => {
    const address = pending.current;
    if (!address) return;
    const row = rows.findIndex((item) => item.key === address.row);
    const col = dataColumns.findIndex((item) => item.field === address.column);
    const target = scroll.current?.querySelector<HTMLElement>(`[data-focus-index="${row * dataColumns.length + col}"]`);
    if (target) {
      pending.current = null;
      if (address.keyboard) {
        scroll.current?.querySelector("[data-keyboard-focus]")?.removeAttribute("data-keyboard-focus");
        target.setAttribute("data-keyboard-focus", "");
      }
      target.focus({ preventScroll: true });
      reveal(target);
    }
  });
  useEffect(() => {
    if (current && (current.row !== focus?.row || current.column !== focus?.column)) {
      if (document.activeElement === document.body) { pending.current = current; virtual.scrollToIndex(currentRow, { align: "auto" }); }
      setFocus(current);
    }
  }, [current?.row, current?.column, focus?.row, focus?.column]);
  handlers.current = {
    focus: (row, column) => { const r = rows.findIndex((item) => item.key === row), c = dataColumns.findIndex((item) => item.field === column); last.current = { row: r, column: c }; setFocus({ row, column }); },
    choose: (row, column) => { const item = rows.find((item) => item.key === row); if (item) onChooseCell?.(item, column); },
    menu: (event, row, anchor) => { const item = rows.find((item) => item.key === row); if (item && onContextMenu && !event?.defaultPrevented) { event?.preventDefault(); onContextMenu(item, anchor, event); } },
    key: (event, row, column) => {
      const r = rows.findIndex((item) => item.key === row), c = dataColumns.findIndex((item) => item.field === column);
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handlers.current.choose(row, column); return; }
      if (event.key === "F10" && event.shiftKey) { event.preventDefault(); handlers.current.menu(undefined, row, event.currentTarget); return; }
      let nextRow = r, nextColumn = c;
      if (event.key === "ArrowRight") nextColumn++; else if (event.key === "ArrowLeft") nextColumn--;
      else if (event.key === "ArrowDown") nextRow++; else if (event.key === "ArrowUp") nextRow--;
      else if (event.key === "Home") { nextColumn = 0; if (event.ctrlKey) nextRow = 0; }
      else if (event.key === "End") { nextColumn = dataColumns.length - 1; if (event.ctrlKey) nextRow = rows.length - 1; }
      else return;
      event.preventDefault(); move(nextRow, nextColumn);
    },
  };
  return <div className={`ks-data-view ks-table-scroll ks-table-grid${lines ? " has-content" : ""}`} ref={scroll} role="grid" aria-label={ariaLabel} aria-rowcount={rows.length + 1} aria-colcount={columns.length} onPointerDownCapture={(event) => event.currentTarget.querySelector("[data-keyboard-focus]")?.removeAttribute("data-keyboard-focus")} style={{ "--ks-table-columns": gridColumns, "--ks-grid-lines": lines } as CSSProperties}>
    <div className="ks-table-inner">
      <div className="ks-table-header" role="row" aria-rowindex={1}>{columns.map((column, index) => <div role="columnheader" aria-colindex={index + 1} key={column.field} className={column.field === rowHeader ? "ks-grid-corner" : undefined}>{column.label}</div>)}</div>
      {!rows.length ? <NoItems /> : <VirtualSurface virtual={virtual}>{virtualRows.map((v) => {
        const row = rows[v.index];
        return <GridRow key={row.key} row={row} index={v.index} start={v.start} columns={columns} rowHeader={rowHeader} active={selectedCell?.row === row.key ? selectedCell.column : null} focus={current?.row === row.key ? current.column : null} measure={virtual.measureElement} handlers={handlers} />;
      })}</VirtualSurface>}
    </div>{footer}
  </div>;
}
