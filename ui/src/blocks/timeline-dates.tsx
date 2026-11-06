import { encodeCommentKey } from "../comments/key";
import { useBlockRootProps } from "../comments/block-root";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Block, MediaRef } from "../contract/contract";
import { DataIcon } from "../components/data-icons";
import { DataState } from "../components/data-state";
import { isMedia, MediaThumbnail } from "../components/media-thumbnail";
import { IconButton } from "../components/primitives";
import { useBinding, useWindowData } from "../data/window-data";
import { useWindowStateValue } from "../data/window-state";
import { createSerialSend } from "../data/throttled-send";
import { capturePointer } from "../share/pointer-capture";
import { eventModifiers } from "../runtime/shortcuts";
import { useShareDescriber } from "../share/visible";
import { NoItems } from "./data-view-common";
import type { BlockContext } from "./block-context";
import { autoRange, dateToDay, dayToDate, layoutLanes, localToday, monday, tickScale, visibleItems, visibleRows, type DatedItem, type DateRange } from "./timeline-dates-layout";

type DatesBlock = Extract<Block, { type: "timeline" }>;
type Item = DatedItem & { label: string; tone: string; muted: boolean; movable: boolean; resizable: boolean; resizeStartOnly: boolean };
type Track = { id: string; label: string; meta?: string; image?: MediaRef; locked: boolean; rows: Item[][]; first: number };
type Marker = { id: string; label: string; day: number };
type Edit = { phase: "preview" | "commit" | "cancel"; kind: "move" | "resize_start" | "resize_end"; id: string; track: string; start: string; end: string };
type Gesture = { id: number; x: number; start: number; end: number; track: string; item: Item; kind: Edit["kind"]; delta: number };
type Viewport = { start: string; end: string };
const EMPTY: [] = [];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isClient = (action: DatesBlock["on_edit"]) => { const item = Array.isArray(action) ? action.length === 1 ? action[0] : null : action; return !!item && "client" in item; };

function readItems(value: unknown): Item[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!object(entry) || typeof entry.id !== "string") return [];
    const absent = entry.start == null && entry.end == null;
    const start = absent ? null : dateToDay(entry.start), end = absent ? null : dateToDay(entry.end);
    if (!absent && (start === null || end === null || start > end)) return [];
    return [{ id: entry.id, label: typeof entry.label === "string" ? entry.label : entry.id, start, end,
      tone: typeof entry.tone === "string" ? entry.tone : "neutral", muted: entry.muted === true,
      movable: entry.movable === true, resizable: entry.resizable === true, resizeStartOnly: entry.resize_start_only === true }];
  });
}

function readTracks(value: unknown, lanes: "single" | "pack" | "each"): Track[] {
  if (!Array.isArray(value)) return [];
  let first = 0;
  return value.flatMap((entry) => {
    if (!object(entry) || typeof entry.id !== "string" || !Array.isArray(entry.items)) return [];
    const rows = layoutLanes(readItems(entry.items), lanes);
    const track: Track = { id: entry.id, label: typeof entry.label === "string" ? entry.label : entry.id,
      meta: typeof entry.meta === "string" ? entry.meta : undefined, image: isMedia(entry.image) ? entry.image : undefined,
      locked: entry.locked === true, rows, first };
    first += rows.length;
    return [track];
  });
}

function readMarkers(value: unknown): Marker[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!object(entry) || typeof entry.id !== "string") return [];
    const day = dateToDay(entry.time);
    return day === null ? [] : [{ id: entry.id, label: typeof entry.label === "string" ? entry.label : entry.id, day }];
  });
}

function readViewport(value: unknown): DateRange | null {
  if (!object(value)) return null;
  const start = dateToDay(value.start), end = dateToDay(value.end);
  return start === null || end === null || start > end ? null : { start, end };
}

export function TimelineDatesBlock({ block, pointer, context }: { block: DatesBlock; pointer: string; context: BlockContext }) {
  const blockRoot = useBlockRootProps();
  const tracks = useBinding(`${pointer}/tracks`, block.tracks);
  const markers = useBinding(`${pointer}/markers`, block.markers ?? EMPTY);
  const days = useBinding(`${pointer}/off_days`, block.off_days ?? EMPTY);
  const selection = useBinding(`${pointer}/selection`, block.selection ?? null);
  const viewport = useBinding(`${pointer}/viewport`, block.viewport ?? null);
  const localeValue = useWindowStateValue(context, context.definition.locale?.state ?? null);
  if (tracks.status !== "ready") return <DataState rootProps={blockRoot} value={tracks} />;
  if (markers.status !== "ready") return <DataState rootProps={blockRoot} value={markers} />;
  if (days.status !== "ready") return <DataState rootProps={blockRoot} value={days} />;
  if (selection.status !== "ready") return <DataState rootProps={blockRoot} value={selection} />;
  if (viewport.status !== "ready") return <DataState rootProps={blockRoot} value={viewport} />;
  return <DatesReady block={block} pointer={pointer} context={context} tracksValue={tracks.value} markerValue={markers.value}
    daysValue={days.value} selectionValue={selection.value} viewportValue={viewport.value} locale={typeof localeValue === "string" ? localeValue : undefined} />;
}

type ReadyProps = { block: DatesBlock; pointer: string; context: BlockContext; tracksValue: unknown; markerValue: unknown; daysValue: unknown; selectionValue: unknown; viewportValue: unknown; locale?: string };
function DatesReady({ block, pointer, tracksValue, markerValue, daysValue, selectionValue, viewportValue, locale }: ReadyProps) {
  const blockRoot = useBlockRootProps();
  const data = useWindowData();
  const root = useRef<HTMLDivElement>(null), scroll = useRef<HTMLDivElement>(null), corner = useRef<HTMLDivElement>(null), rowMeasure = useRef<HTMLDivElement>(null);
  const dayMeasure = useRef<HTMLSpanElement>(null), weekMeasure = useRef<HTMLSpanElement>(null), monthMeasure = useRef<HTMLSpanElement>(null);
  const viewportFrame = useRef<number | null>(null), pendingViewport = useRef<Viewport | null>(null), sentViewport = useRef<string>("");
  const latestViewport = useRef<DateRange | null>(null), pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const gesture = useRef<Gesture | null>(null), frame = useRef<number | null>(null), pendingEdit = useRef<Edit | null>(null);
  const editGeneration = useRef(0);
  const [preview, setPreview] = useState<Edit | null>(null), [dragging, setDragging] = useState(false);
  const [tickWidths, setTickWidths] = useState<Record<string, number>>({});
  const [metrics, setMetrics] = useState({ width: 0, height: 0, left: 0, row: 1, header: 0, gap: 0, day: 1, week: 1, month: 1 });
  const [offset, setOffset] = useState({ x: 0, y: 0 }), [px, setPx] = useState(0);
  const initialized = useRef(false), previousRange = useRef<number | null>(null), pendingScroll = useRef<number | null>(null);
  const tracks = useMemo(() => readTracks(tracksValue, block.lanes ?? "pack"), [tracksValue, block.lanes]);
  const markers = useMemo(() => readMarkers(markerValue), [markerValue]);
  const offDays = useMemo(() => new Set(Array.isArray(daysValue) ? daysValue.flatMap((value) => { const day = dateToDay(value); return day === null ? [] : [day]; }) : []), [daysValue]);
  const selected = useMemo(() => object(selectionValue) && Array.isArray(selectionValue.ids) ? selectionValue.ids : [], [selectionValue]);
  const today = localToday();
  const range = useMemo(() => autoRange(tracks.flatMap((track) => track.rows.flat()), markers.map((marker) => marker.day), today, block.today !== false), [tracks, markers, today, block.today]);
  const rowCount = tracks.reduce((sum, track) => sum + track.rows.length, 0);
  const bound = readViewport(viewportValue);
  latestViewport.current = bound;
  const canViewport = block.viewport === undefined || !!block.on_viewport;
  const formatDate = useMemo(() => new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", timeZone: "UTC" }), [locale]);
  const formatMonth = useMemo(() => new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: "UTC" }), [locale]);
  const formatYear = useMemo(() => new Intl.DateTimeFormat(locale, { year: "numeric", timeZone: "UTC" }), [locale]);
  const monthOnly = useMemo(() => new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }), [locale]);
  const dayNumber = useMemo(() => new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }), [locale]);
  const dayText = (day: number) => dayNumber.formatToParts(new Date(day * 86_400_000)).find((part) => part.type === "day")!.value;
  const date = (day: number) => new Date(day * 86_400_000);
  const lineWidth = Math.max(1, metrics.width - metrics.left);
  const minPx = lineWidth / (range.end - range.start + 1);
  const maxPx = Math.max(minPx, metrics.day * 4);
  const scale = tickScale(px || metrics.day, metrics.day, metrics.week);
  const pxDay = Math.max(minPx, Math.min(maxPx, px || metrics.day));
  const totalWidth = (range.end - range.start + 1) * pxDay;
  const from = Math.max(range.start, range.start + Math.floor(offset.x / pxDay) - 2);
  const to = Math.min(range.end, range.start + Math.ceil((offset.x + lineWidth) / pxDay) + 2);
  const rows = visibleRows(offset.y, Math.max(0, metrics.height - metrics.header), metrics.row, rowCount);

  useLayoutEffect(() => {
    const container = dayMeasure.current?.parentElement;
    if (!container || scale === "month") return;
    const labels = new Set<string>();
    for (let day = range.start; day <= range.end; day++) {
      if (scale === "week" && monday(day) !== day) continue;
      const date = new Date(day * 86_400_000);
      labels.add(scale === "day" ? dayNumber.formatToParts(date).find((part) => part.type === "day")!.value : formatDate.format(date));
    }
    const elements = [...labels].map((label) => {
      const element = document.createElement("span");
      element.style.display = "inline-block";
      element.textContent = label;
      return element;
    });
    container.append(...elements);
    const widths = Object.fromEntries(elements.map((element) => [element.textContent!, element.getBoundingClientRect().width]));
    elements.forEach((element) => element.remove());
    setTickWidths(widths);
  }, [scale, locale, range.start, range.end, dayNumber, formatDate, metrics.day]);

  const applyScale = (nextPx: number, left: number) => {
    pendingScroll.current = left;
    setPx(nextPx);
    setOffset((old) => ({ ...old, x: left }));
  };
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const delta = previousRange.current === null ? 0 : previousRange.current - range.start;
    previousRange.current = range.start;
    if (delta && initialized.current) pendingScroll.current = (pendingScroll.current ?? element.scrollLeft) + delta * pxDay;
    if (pendingScroll.current === null) return;
    element.scrollLeft = pendingScroll.current;
    pendingScroll.current = null;
    setOffset((old) => old.x === element.scrollLeft ? old : { ...old, x: element.scrollLeft });
  });

  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(element).getPropertyValue("--ks-space-1")) || 0;
      const dayWidth = (dayMeasure.current?.getBoundingClientRect().width || 1) * 1.5 + gap;
      const weekWidth = (weekMeasure.current?.getBoundingClientRect().width || 1) * 1.5 + gap;
      const monthWidth = (monthMeasure.current?.getBoundingClientRect().width || 1) * 1.5 + gap;
      const next = { width: element.clientWidth || element.getBoundingClientRect().width, height: element.clientHeight || element.getBoundingClientRect().height,
        left: corner.current?.getBoundingClientRect().width || 0, row: rowMeasure.current?.getBoundingClientRect().height || 1,
        header: corner.current?.getBoundingClientRect().height || 0, gap, day: dayWidth, week: weekWidth, month: monthWidth };
      setMetrics((old) => Object.keys(next).every((key) => old[key as keyof typeof old] === next[key as keyof typeof next]) ? old : next);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element); if (corner.current) observer?.observe(corner.current); if (dayMeasure.current) observer?.observe(dayMeasure.current);
    return () => observer?.disconnect();
  }, [locale]);

  useLayoutEffect(() => {
    if (initialized.current || !scroll.current || !metrics.width || metrics.day <= 1) return;
    const initialPx = bound ? lineWidth / (bound.end - bound.start + 1) : metrics.day;
    const nextPx = Math.max(minPx, Math.min(maxPx, initialPx));
    const todayInRange = today >= range.start && today <= range.end;
    let first = bound?.start ?? (todayInRange ? monday(today - 7) : range.start);
    if (!bound && todayInRange && (today + 0.5 - first) * nextPx > lineWidth * 2 / 3) first = today + 0.5 - lineWidth / (3 * nextPx);
    applyScale(nextPx, Math.max(0, (first - range.start) * nextPx));
    if (bound) sentViewport.current = `${bound.start}:${bound.end}`;

    initialized.current = true;
  }, [metrics, bound?.start, bound?.end, lineWidth, minPx, maxPx, range.start, range.end, today]);

  const sendViewport = useMemo(() => createSerialSend(async (next: Viewport) => {
    const accepted = await data.act(`${pointer}/on_viewport`, next, undefined, undefined, undefined, { input: true });
    if (!accepted && latestViewport.current && scroll.current) {
      const fallback = latestViewport.current;
      const nextPx = Math.max(minPx, Math.min(maxPx, lineWidth / (fallback.end - fallback.start + 1)));
      sentViewport.current = `${fallback.start}:${fallback.end}`;
      applyScale(nextPx, Math.max(0, (fallback.start - range.start) * nextPx));
    }
  }), [data, pointer, minPx, maxPx, lineWidth, range.start]);
  useLayoutEffect(() => {
    if (!initialized.current || !bound || !scroll.current || pendingViewport.current || sendViewport.idle()) return;
    const nextPx = Math.max(minPx, Math.min(maxPx, lineWidth / (bound.end - bound.start + 1)));
    const nextX = Math.max(0, (bound.start - range.start) * nextPx);
    applyScale(nextPx, nextX);
  }, [bound?.start, bound?.end, minPx, maxPx, lineWidth, range.start, sendViewport]);
  const flushViewport = useCallback(() => {
    if (viewportFrame.current !== null) cancelAnimationFrame(viewportFrame.current);
    viewportFrame.current = null;
    const next = pendingViewport.current; pendingViewport.current = null;
    if (next) void sendViewport(next, { coalesce: true });
  }, [sendViewport]);
  useEffect(() => data.holdInput(() => { flushViewport(); return sendViewport.idle(); }), [data, flushViewport, sendViewport]);
  useEffect(() => () => { flushViewport(); }, [flushViewport]);
  const queueViewport = (x: number, nextPx = pxDay) => {
    if (block.viewport === undefined || !block.on_viewport) return;
    const start = Math.max(range.start, Math.round(range.start + x / nextPx));
    const end = Math.min(range.end, Math.max(start, Math.round(range.start + (x + lineWidth) / nextPx) - 1));
    const next = { start: dayToDate(start), end: dayToDate(end) }, key = `${start}:${end}`;
    if (sentViewport.current === key) return;
    sentViewport.current = key; pendingViewport.current = next;
    if (viewportFrame.current === null) viewportFrame.current = requestAnimationFrame(flushViewport);
  };
  const onScroll = () => { const element = scroll.current; if (!element) return; setOffset({ x: element.scrollLeft, y: element.scrollTop }); queueViewport(element.scrollLeft); };
  const zoom = (factor: number, fraction = 0.5) => {
    const element = scroll.current; if (!element || !canViewport) return;
    const nextPx = Math.max(minPx, Math.min(maxPx, pxDay * factor));
    const anchor = (element.scrollLeft + fraction * lineWidth) / pxDay;
    const nextX = Math.max(0, anchor * nextPx - fraction * lineWidth);
    applyScale(nextPx, nextX); queueViewport(nextX, nextPx);
  };
  useEffect(() => {
    const element = scroll.current; if (!element) return;
    const wheel = (event: globalThis.WheelEvent) => {
      if (event.ctrlKey) { event.preventDefault(); const rect = element.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * 0.01), Math.max(0, Math.min(1, (event.clientX - rect.left - metrics.left) / lineWidth))); }
      else if (event.shiftKey && event.deltaY) { event.preventDefault(); element.scrollLeft += event.deltaY; }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  });
  const select = (id: string) => { if (block.on_select) void data.act(`${pointer}/on_select`, { ids: [id] }); };
  const serialEdit = useMemo(() => createSerialSend(({ edit, modifiers }: { edit: Edit; modifiers?: ReturnType<typeof eventModifiers> }) =>
    data.act(`${pointer}/on_edit`, edit, undefined, modifiers, undefined, { input: true })), [data, pointer]);
  const sendEdit = (edit: Edit, modifiers?: ReturnType<typeof eventModifiers>) => {
    return block.on_edit ? serialEdit({ edit, modifiers }, { coalesce: edit.phase === "preview" }) : undefined;
  };
  useEffect(() => data.holdInput(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const edit = pendingEdit.current; pendingEdit.current = null;
    if (edit && block.on_edit) void serialEdit({ edit }, { coalesce: true });
    return serialEdit.idle();
  }), [data, block.on_edit, serialEdit]);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  const editAt = (g: Gesture, delta: number, phase: Edit["phase"]): Edit => {
    let start = g.start, end = g.end;
    if (g.kind === "move") { start += delta; end += delta; }
    if (g.kind === "resize_start") start = Math.min(end, start + delta);
    if (g.kind === "resize_end") end = Math.max(start, end + delta);
    return { phase, kind: g.kind, id: g.item.id, track: g.track, start: dayToDate(start), end: dayToDate(end) };
  };
  const flushPreview = () => { frame.current = null; if (pendingEdit.current) sendEdit(pendingEdit.current); pendingEdit.current = null; };
  const begin = (event: PointerEvent<HTMLElement>, track: Track, item: Item, kind: Edit["kind"]) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    capturePointer(event);
    if (item.start === null || item.end === null || track.locked || block.read_only || !block.on_edit || (kind === "move" && !item.movable)) {
      select(item.id); return;
    }
    editGeneration.current += 1;
    gesture.current = { id: event.pointerId, x: event.clientX, start: item.start, end: item.end, track: track.id, item, kind, delta: 0 };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current; if (!current || event.pointerId !== current.id) return;
    const delta = Math.round((event.clientX - current.x) / pxDay); if (delta === current.delta) return;
    current.delta = delta; const next = editAt(current, delta, "preview"); setPreview(next);
    if (isClient(block.on_edit)) { pendingEdit.current = next; if (frame.current === null) frame.current = requestAnimationFrame(flushPreview); }
  };
  const finish = (event: PointerEvent<HTMLElement>, phase: "commit" | "cancel") => {
    const current = gesture.current; if (!current || event.pointerId !== current.id) return;
    gesture.current = null; if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; pendingEdit.current = null;
    const next = editAt(current, phase === "cancel" ? 0 : current.delta, phase);
    if (phase === "commit" && next.start === dayToDate(current.start) && next.end === dayToDate(current.end)) { setPreview(null); select(current.item.id); return; }
    if (phase === "cancel") { setPreview(null); void sendEdit(next, eventModifiers(event)); return; }
    const generation = editGeneration.current;
    setPreview(next);
    void sendEdit(next, eventModifiers(event))?.then(() => { if (editGeneration.current === generation && !gesture.current) setPreview(null); });
  };
  useEffect(() => {
    const cancel = (event: globalThis.KeyboardEvent) => { const current = gesture.current; if (event.key !== "Escape" || !current) return; gesture.current = null; if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; pendingEdit.current = null; setPreview(null); sendEdit(editAt(current, 0, "cancel")); };
    document.addEventListener("keydown", cancel); return () => document.removeEventListener("keydown", cancel);
  });
  const keyItem = (event: KeyboardEvent<HTMLElement>, track: Track, item: Item) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(item.id); return; }
    if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || !item.movable || item.start === null || item.end === null || track.locked || block.read_only || !block.on_edit) return;
    event.preventDefault(); const delta = event.key === "ArrowRight" ? 1 : -1;
    sendEdit({ phase: "commit", kind: "move", id: item.id, track: track.id, start: dayToDate(item.start + delta), end: dayToDate(item.end + delta) }, eventModifiers(event));
  };
  const firstVisibleDay = range.start + offset.x / pxDay;
  const lastVisibleDay = firstVisibleDay + lineWidth / pxDay;
  const firstVisibleRow = Math.floor(offset.y / metrics.row);
  const lastVisibleRow = Math.ceil((offset.y + Math.max(0, metrics.height - metrics.header)) / metrics.row);
  useShareDescriber(root, () => ({ text: `[일정] ${dayToDate(Math.floor(firstVisibleDay))} – ${dayToDate(Math.ceil(lastVisibleDay) - 1)}\n${tracks.flatMap((track) => {
    const items = track.rows.flatMap((row, index) => track.first + index >= firstVisibleRow && track.first + index < lastVisibleRow
      ? visibleItems(row, Math.floor(firstVisibleDay), Math.ceil(lastVisibleDay) - 1) : []).slice(0, 8);
    return items.length ? [`${track.label}: ${items.map((item) => item.start === null ? item.label : `${item.label} (${dayToDate(item.start)} – ${dayToDate(item.end!)})`).join(", ")}`] : [];
  }).join("\n")}`, visual: false }));

  const handlers = useRef({ begin, move, finish, keyItem, select });
  handlers.current = { begin, move, finish, keyItem, select };
  const dates: number[] = [];
  for (let day = from; day <= to; day++) {
    if (scale === "day" || (scale === "week" && monday(day) === day)) dates.push(day);
  }
  const monthStep = scale === "month" ? [1, 2, 3, 6].find((n) => n * 28 * pxDay >= metrics.month) ?? 6 : 1;
  const months: { day: number; end: number }[] = [];
  const beginMonth = date(range.start); beginMonth.setUTCDate(1);
  for (let cursor = beginMonth; cursor.getTime() / 86_400_000 <= range.end;) {
    const day = cursor.getTime() / 86_400_000;
    const next = new Date(cursor); next.setUTCMonth(next.getUTCMonth() + monthStep);
    months.push({ day: Math.max(day, range.start), end: Math.min(next.getTime() / 86_400_000, range.end + 1) }); cursor = next;
  }
  const periods = scale !== "month" ? months : (() => {
    const result: { day: number; end: number }[] = [];
    const cursor = date(range.start); cursor.setUTCMonth(0, 1);
    while (cursor.getTime() / 86_400_000 <= range.end) {
      const day = cursor.getTime() / 86_400_000;
      cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
      result.push({ day: Math.max(day, range.start), end: Math.min(cursor.getTime() / 86_400_000, range.end + 1) });
    }
    return result;
  })();
  const columns: number[] = [];
  if (scale !== "month") for (let day = from; day <= to; day++) columns.push(day);
  const x = (day: number) => (day - range.start) * pxDay;
  const rowStyle = { height: Math.max(rowCount * metrics.row, metrics.height - metrics.header), width: metrics.left + totalWidth };
  const beginPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !scroll.current) return;
    capturePointer(event); pan.current = { x: event.clientX, y: event.clientY, left: scroll.current.scrollLeft, top: scroll.current.scrollTop }; setDragging(true);
  };
  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    if (!pan.current || !scroll.current) return;
    scroll.current.scrollLeft = pan.current.left - (event.clientX - pan.current.x);
    scroll.current.scrollTop = pan.current.top - (event.clientY - pan.current.y);
  };
  const endPan = () => { pan.current = null; setDragging(false); };
  return <div {...blockRoot} className="ks-timeline ks-timeline-dates" data-scale={scale} ref={root}>
    <div className={`ks-dates-scroll${dragging ? " is-panning" : ""}`} ref={scroll} onScroll={onScroll} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
      <div className="ks-dates-measure" aria-hidden="true"><span ref={dayMeasure}>{dayText(dateToDay("2026-12-30")!)}</span><span ref={weekMeasure}>{formatDate.format(date(dateToDay("2026-12-31")!))}</span><span ref={monthMeasure}>{monthOnly.format(date(dateToDay("2026-12-01")!))}</span><div ref={rowMeasure} className="ks-dates-row-measure" /></div>
      <div className="ks-dates-header" style={{ width: metrics.left + totalWidth }}>
        <div className="ks-dates-corner" ref={corner} onPointerDown={(event) => event.stopPropagation()}>
          {block.controls !== false && <><IconButton aria-label="축소" disabled={!canViewport || pxDay <= minPx} onClick={() => zoom(1 / 1.6)}><DataIcon name="minus" size="inline" /></IconButton><IconButton aria-label="확대" disabled={!canViewport || pxDay >= maxPx} onClick={() => zoom(1.6)}><DataIcon name="plus" size="inline" /></IconButton>{block.controls === true && <IconButton aria-label="전체 맞춤" disabled={!canViewport || pxDay <= minPx} onClick={() => { applyScale(minPx, 0); queueViewport(0, minPx); }}><DataIcon name="maximize-2" size="inline" /></IconButton>}</>}
        </div>
        <div className="ks-dates-axis" style={{ left: metrics.left, width: totalWidth }}>
          <div className="ks-dates-months">{periods.map((month) => <div className="ks-dates-month" key={month.day} style={{ left: x(month.day), width: (month.end - month.day) * pxDay }}><PeriodLabel width={(month.end - month.day) * pxDay} left={metrics.left}>{scale === "month" ? formatYear.format(date(month.day)) : formatMonth.format(date(month.day))}</PeriodLabel></div>)}</div>
          <div className="ks-dates-ticks">{scale === "month" ? months.filter((month) => month.end >= from && month.day <= to).map((month) => <PeriodLabel key={month.day} width={(month.end - month.day) * pxDay} left={x(month.day)} tick>{monthOnly.format(date(month.day))}</PeriodLabel>) : dates.map((day) => {
            const text = scale === "day" ? dayText(day) : formatDate.format(date(day));
            if (tickWidths[text] === undefined) return null;
            const width = pxDay * (scale === "week" ? 7 : 1), center = x(day) + width / 2, half = tickWidths[text] / 2;
            if (center - half < Math.max(0, offset.x) || center + half > Math.min(totalWidth, offset.x + lineWidth)) return null;
            return <span key={day} className={offDays.has(day) ? "is-off" : [0, 6].includes(date(day).getUTCDay()) ? "is-weekend" : undefined} style={{ left: x(day), width }}>{text}</span>;
          })}</div>
          <DateMarkers markers={markers} today={block.today !== false ? today : null} start={range.start} pxDay={pxDay} width={totalWidth} gap={metrics.gap} />
        </div>
      </div>
      <div className="ks-dates-body" style={rowStyle}>
        <div className="ks-dates-background" style={{ left: metrics.left, width: totalWidth }} aria-hidden="true">
          {columns.map((day) => { const weekend = [0, 6].includes(date(day).getUTCDay()); return <span key={day} className={`${weekend || offDays.has(day) ? "is-off" : ""}${monday(day) === day ? " is-week" : ""}`} style={{ left: x(day), width: pxDay }} />; })}
          {scale === "month" && months.filter((month) => month.end >= from && month.day <= to).map((month) => <span className="is-month" key={month.day} style={{ left: x(month.day) }} />)}
          {markers.filter((marker) => marker.day >= from && marker.day <= to).map((marker) => <span className="is-marker" key={marker.id} style={{ left: x(marker.day + 0.5) }} />)}
          {block.today !== false && today >= from && today <= to && <span className="is-today" style={{ left: x(today + 0.5) }} />}
        </div>
        {!tracks.length && <><div className="ks-dates-track-header" style={{ width: metrics.left, pointerEvents: "none" }} aria-hidden="true" /><div className="ks-dates-empty" style={{ left: metrics.left + offset.x, width: lineWidth, height: Math.max(metrics.row, metrics.height - metrics.header) }}><NoItems /></div></>}
        {tracks.filter((track) => track.first < rows.end && track.first + track.rows.length > rows.start).map((track) => <div className="ks-dates-track" key={track.id} style={{ top: track.first * metrics.row, height: track.rows.length * metrics.row, width: metrics.left + totalWidth }}>
          <div className="ks-dates-track-header" style={{ width: metrics.left }} onPointerDown={(event) => event.stopPropagation()}><div className="ks-dates-track-name" style={{ top: metrics.header }}>
            {track.image && <MediaThumbnail media={track.image} />}<span className="ks-list-content"><span className="ks-list-title">{track.label}</span></span>{track.meta && <span className="ks-view-meta">{track.meta}</span>}
          </div></div>
          <div className="ks-dates-track-rows" style={{ left: metrics.left, width: totalWidth }}>{track.rows.map((row, index) => {
            const absolute = track.first + index; if (absolute < rows.start || absolute >= rows.end) return null;
            return <DateRow key={absolute} row={row} track={track} top={index * metrics.row} height={metrics.row} from={from} to={to} pxDay={pxDay} scrollLeft={offset.x} rangeStart={range.start} selected={selected} preview={row.some((item) => item.id === preview?.id) ? preview : null} lanes={block.lanes ?? "pack"} formatDate={formatDate} handlers={handlers} readOnly={!!block.read_only || !block.on_edit} />;
          })}</div>
        </div>)}
      </div>
    </div>
  </div>;
}

type Handlers = { begin: (event: PointerEvent<HTMLElement>, track: Track, item: Item, kind: Edit["kind"]) => void; move: (event: PointerEvent<HTMLElement>) => void; finish: (event: PointerEvent<HTMLElement>, phase: "commit" | "cancel") => void; keyItem: (event: KeyboardEvent<HTMLElement>, track: Track, item: Item) => void; select: (id: string) => void };
const DateRow = memo(function DateRow({ row, track, top, height, from, to, pxDay, scrollLeft, rangeStart, selected, preview, lanes, formatDate, handlers, readOnly }: { row: Item[]; track: Track; top: number; height: number; from: number; to: number; pxDay: number; scrollLeft: number; rangeStart: number; selected: unknown[]; preview: Edit | null; lanes: "single" | "pack" | "each"; formatDate: Intl.DateTimeFormat; handlers: React.RefObject<Handlers>; readOnly: boolean }) {
  return <div className="ks-dates-row" style={{ top, height }}>{visibleItems(row, from, to).map((item) => <DateBar key={item.id} item={item} track={track} pxDay={pxDay} scrollLeft={scrollLeft} rangeStart={rangeStart} selected={selected.includes(item.id)} preview={preview?.id === item.id ? preview : null} lanes={lanes} formatDate={formatDate} handlers={handlers} readOnly={readOnly} />)}</div>;
});

const DateBar = memo(function DateBar({ item, track, pxDay, scrollLeft, rangeStart, selected, preview, lanes, formatDate, handlers, readOnly }: { item: Item; track: Track; pxDay: number; scrollLeft: number; rangeStart: number; selected: boolean; preview: Edit | null; lanes: "single" | "pack" | "each"; formatDate: Intl.DateTimeFormat; handlers: React.RefObject<Handlers>; readOnly: boolean }) {
    const measure = useRef<HTMLSpanElement>(null);
    const [nameSize, setNameSize] = useState({ width: 0, padding: 0 });
    useLayoutEffect(() => {
      const element = measure.current;
      if (!element) return;
      const read = () => {
        const style = getComputedStyle(element);
        const next = { width: element.getBoundingClientRect().width, padding: 2 * (parseFloat(style.getPropertyValue("--ks-space-1")) || 0) + 2 * (parseFloat(style.getPropertyValue("--ks-line-width")) || 0) };
        setNameSize((old) => old.width === next.width && old.padding === next.padding ? old : next);
      };
      read();
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
      observer?.observe(element);
      return () => observer?.disconnect();
    }, [item.label, item.start === null]);
    if (item.start === null || item.end === null) return <button data-ks-comment-key={encodeCommentKey(item.id)} type="button" className={`ks-dates-undated is-${item.tone}${item.muted ? " is-muted" : ""}${selected ? " is-selected" : ""}`} key={item.id} onPointerDown={(event) => event.stopPropagation()} onClick={() => handlers.current.select(item.id)}>{item.label} <span>날짜 없음</span></button>;
    const start = preview?.id === item.id ? dateToDay(preview.start)! : item.start, end = preview?.id === item.id ? dateToDay(preview.end)! : item.end;
    const outside = lanes === "each" && nameSize.width > Math.max(0, (end - start + 1) * pxDay - nameSize.padding);
    const labelOffset = outside ? 0 : Math.max(0, Math.min((end - start + 1) * pxDay, scrollLeft - (start - rangeStart) * pxDay));
    const name = `${item.label}, ${formatDate.format(new Date(start * 86_400_000))} – ${formatDate.format(new Date(end * 86_400_000))}`;
    const canEdit = !track.locked && !readOnly;
    const onPointerDown = (event: PointerEvent<HTMLElement>, kind: Edit["kind"]) => handlers.current.begin(event, track, item, kind);
    return <div data-ks-comment-key={encodeCommentKey(item.id)} role="button" tabIndex={0} aria-label={name} title={name} key={item.id} className={`ks-timeline-item is-${item.tone}${item.muted ? " is-muted" : ""}${selected ? " is-selected" : ""}${canEdit && item.movable ? "" : " is-fixed"}${lanes === "each" ? " is-each" : ""}`}
      style={{ left: (start - rangeStart) * pxDay, width: (end - start + 1) * pxDay }} onKeyDown={(event) => handlers.current.keyItem(event, track, item)} onPointerDown={(event) => onPointerDown(event, "move")} onPointerMove={(event) => handlers.current.move(event)} onPointerUp={(event) => handlers.current.finish(event, "commit")} onPointerCancel={(event) => handlers.current.finish(event, "cancel")}>
      {canEdit && (item.resizable || item.resizeStartOnly) && <span className="ks-timeline-handle is-start" onPointerDown={(event) => onPointerDown(event, "resize_start")} />}
      <span ref={measure} className="ks-dates-name-measure" aria-hidden="true">{item.label}</span>
      <span className={`ks-timeline-label${outside ? " is-outside" : ""}`} style={outside ? undefined : { marginLeft: labelOffset, maxWidth: labelOffset ? Math.max(0, (end - start + 1) * pxDay - labelOffset) : undefined }}>{item.label}</span>
      {canEdit && item.resizable && !item.resizeStartOnly && <span className="ks-timeline-handle is-end" onPointerDown={(event) => onPointerDown(event, "resize_end")} />}
    </div>;
});


const DateMarkers = memo(function DateMarkers({ markers, today, start, pxDay, width, gap }: { markers: Marker[]; today: number | null; start: number; pxDay: number; width: number; gap: number }) {
  const root = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<number[]>([]);
  const labels = useMemo(() => [
    ...(today !== null ? [{ id: "today", label: "오늘", day: today, today: true }] : []),
    ...[...markers].sort((a, b) => a.day - b.day).map((marker) => ({ ...marker, id: `marker:${marker.id}`, today: false })),
  ], [markers, today]);
  useLayoutEffect(() => {
    const next = [...(root.current?.querySelectorAll<HTMLElement>("[data-marker]") ?? [])].map((element) => {
      const previous = element.style.maxWidth;
      element.style.maxWidth = "none";
      const measured = element.getBoundingClientRect().width;
      element.style.maxWidth = previous;
      return measured;
    });
    setWidths((old) => old.length === next.length && old.every((value, index) => value === next[index]) ? old : next);
  }, [labels, pxDay]);
  const placed = useMemo(() => {
    const occupied: { left: number; right: number }[] = [], next: Record<string, number> = {};
    labels.forEach((label, index) => {
      if (widths[index] === undefined) return;
      const chipWidth = Math.min(width, widths[index]);
      const left = Math.max(0, Math.min(width - chipWidth, (label.day - start + 0.5) * pxDay - chipWidth / 2));
      if (occupied.some((chip) => left < chip.right + gap && left + chipWidth + gap > chip.left)) return;
      occupied.push({ left, right: left + chipWidth }); next[label.id] = left;
    });
    return next;
  }, [labels, widths, pxDay, width, gap, start]);
  return <div className="ks-dates-markers" ref={root}>{labels.map((label) => <span key={label.id} data-marker={label.id} className={label.today ? "is-today" : undefined} style={{ left: placed[label.id] ?? 0, visibility: placed[label.id] === undefined ? "hidden" : undefined }}>{label.label}</span>)}</div>;
});


function PeriodLabel({ width, left, tick = false, children }: { width: number; left: number; tick?: boolean; children: string }) {
  const text = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(false);
  useLayoutEffect(() => {
    const element = text.current;
    if (!element) return;
    const read = () => {
      const style = getComputedStyle(element.parentElement!);
      setFits(element.getBoundingClientRect().width + (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0) <= width);
    };
    read();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [width, children]);
  return <span style={{ left, ...(tick ? { width, justifyContent: "flex-start", paddingInline: "var(--ks-space-1)", boxSizing: "border-box" as const } : {}) }}><span ref={text} className="ks-dates-period-text" style={{ visibility: fits ? undefined : "hidden" }}>{children}</span></span>;
}
