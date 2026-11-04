const DAY_MS = 86_400_000;

export type DatedItem = { id: string; start: number | null; end: number | null };
export type DateRange = { start: number; end: number };
export type DateScale = "day" | "week" | "month";

export function dateToDay(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms / DAY_MS : null;
}

export function dayToDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function localToday(): number {
  const today = new Date();
  return Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / DAY_MS;
}

export function monday(day: number): number {
  return day - ((new Date(day * DAY_MS).getUTCDay() + 6) % 7);
}

export function autoRange(items: DatedItem[], markers: number[], today: number, showToday: boolean): DateRange {
  const dates = items.flatMap((item) => item.start === null || item.end === null ? [] : [item.start, item.end]);
  dates.push(...markers);
  if (showToday) dates.push(today);
  if (!dates.length) return { start: monday(today - 14), end: today + 42 };
  return { start: monday(Math.min(...dates) - 14), end: Math.max(...dates) + 14 };
}

export function tickScale(pxPerDay: number, dayWidth: number, weekWidth: number): DateScale {
  return pxPerDay >= dayWidth ? "day" : pxPerDay * 7 >= weekWidth ? "week" : "month";
}

export function layoutLanes<T extends DatedItem>(items: T[], lanes: "single" | "pack" | "each"): T[][] {
  if (lanes === "each") return items.length ? items.map((item) => [item]) : [[]];
  const dated = items.filter((item) => item.start !== null && item.end !== null);
  const undated = items.filter((item) => item.start === null || item.end === null);
  const rows: T[][] = [];
  if (lanes === "single" && dated.length) rows.push(dated);
  if (lanes === "pack") {
    for (const item of [...dated].sort((a, b) => a.start! - b.start!)) {
      const row = rows.find((candidate) => candidate[candidate.length - 1].end! < item.start!);
      if (row) row.push(item); else rows.push([item]);
    }
  }
  rows.push(...undated.map((item) => [item]));
  return rows.length ? rows : [[]];
}

export function visibleItems<T extends DatedItem>(items: T[], start: number, end: number): T[] {
  return items.filter((item) => item.start === null || item.end === null || (item.end >= start && item.start <= end));
}

export function visibleRows(scrollTop: number, height: number, rowHeight: number, count: number): DateRange {
  return { start: Math.max(0, Math.floor(scrollTop / rowHeight) - 2), end: Math.min(count, Math.ceil((scrollTop + height) / rowHeight) + 2) };
}
