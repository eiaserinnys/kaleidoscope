import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Actions, Block, EventModifiers, TimelineViewport } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { IconButton } from "../components/primitives";
import { DataIcon } from "../components/data-icons";
import { DataState } from "../components/data-state";
import { useBinding, useWindowData } from "../data/window-data";
import { useWindowVisible } from "../data/window-state";
import { createSerialSend } from "../data/throttled-send";
import { useShareDescriber } from "../share/visible";
import { eventModifiers } from "../runtime/shortcuts";
import { clockPosition, isClock } from "../data/clock";
import type { BlockContext } from "./block-context";

export { clockPosition } from "../data/clock";

type Snap = { points?: number[]; step?: number; threshold_px?: number };
type Item = { id: string; start: number; end: number; label?: string; tone?: string; series?: number; movable?: boolean; resizable?: boolean; resize_start_only?: boolean };
type Track = { id: string; label?: string; locked?: boolean; items: Item[]; waveform?: { peaks: number[]; start?: number; end?: number } };
type Marker = { id: string; time: number; label?: string; movable?: boolean };
type Edit = { phase: "preview" | "commit" | "cancel"; kind: "move" | "resize_start" | "resize_end" | "move_marker"; id: string; track: string | null; start: number; end: number };
type Gesture = { pointerId: number; x: number; width: number; original: Edit; current: Edit };
type TimelineData = Extract<Block, { type: "timeline" }>;
const LEGACY_RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60];
const RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 14400, 21600, 28800, 43200, 86400];

export function snapTime(time: number, snap: Snap | null, pixelsPerSecond: number, disabled: boolean): number {
  if (!snap || disabled || pixelsPerSecond <= 0) return time;
  const candidates = [...(snap.points ?? [])].filter(Number.isFinite);
  if (snap.step && Number.isFinite(snap.step) && snap.step > 0) candidates.push(Math.round(time / snap.step) * snap.step);
  const nearest = candidates.reduce<number | null>((best, candidate) => best === null || Math.abs(candidate - time) < Math.abs(best - time) ? candidate : best, null);
  return nearest !== null && Math.abs(nearest - time) * pixelsPerSecond <= (snap.threshold_px ?? 8) ? nearest : time;
}

export function rulerStep(seconds: number, zoom: number, viewportControls = false, availableWidth = 0, minimumSpacing = 0): number {
  const wanted = seconds / Math.max(1, 5 * zoom);
  if (availableWidth <= 0 || minimumSpacing <= 0) {
    if (!viewportControls) return LEGACY_RULER_STEPS.find((step) => step >= wanted) ?? 60;
    return RULER_STEPS.find((step) => step >= wanted) ?? Math.ceil(wanted / 86400) * 86400;
  }
  const widthLimited = seconds * minimumSpacing / (availableWidth * Math.max(1, zoom));
  const target = Math.max(wanted, widthLimited);
  return RULER_STEPS.find((step) => step >= target) ?? Math.ceil(target / 86400) * 86400;
}

export function rulerTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}`;
}

function readViewport(value: unknown): TimelineViewport | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("start" in value) || !("end" in value)) return null;
  const { start, end } = value as { start: unknown; end: unknown };
  return typeof start === "number" && Number.isFinite(start) && typeof end === "number" && Number.isFinite(end) && end > start ? { start, end } : null;
}

function clampViewport(value: TimelineViewport, duration: number): TimelineViewport {
  if (duration <= 0) return { start: 0, end: 0 };
  const span = Math.max(Math.min(2, duration), Math.min(duration, value.end - value.start));
  const start = Math.max(0, Math.min(duration - span, value.start));
  return { start, end: start + span };
}

function sameViewport(left: TimelineViewport | null, right: TimelineViewport | null): boolean {
  return left === right || (!!left && !!right && left.start === right.start && left.end === right.end);
}

function zoomViewport(viewport: TimelineViewport, duration: number, factor: number, fraction: number, anchorTime: number): TimelineViewport {
  if (duration <= 0) return { start: 0, end: 0 };
  const currentSpan = viewport.end - viewport.start;
  const maxZoom = Math.max(1, duration / 2);
  const zoom = Math.max(1, Math.min(maxZoom, duration / currentSpan * factor));
  const nextSpan = duration / zoom;
  const start = Math.max(0, Math.min(duration - nextSpan, anchorTime - fraction * nextSpan));
  return { start, end: start + nextSpan };
}

function isClientAction(actions: Actions | undefined): boolean {
  const action = Array.isArray(actions) ? actions.length === 1 ? actions[0] : null : actions;
  return !!action && typeof action === "object" && "client" in action;
}

export function TimelineBlock({ block, pointer, context }: { block: TimelineData; pointer: string; context: BlockContext }) {
  const data = useWindowData();
  const visible = useWindowVisible(context);
  const serialSeek = useMemo(() => createSerialSend((value: number) => data.act(`${pointer}/on_seek`, value)), [data, pointer]);
  const duration = useBinding(`${pointer}/duration`, block.duration);
  const position = useBinding(`${pointer}/position`, block.position);
  const tracks = useBinding(`${pointer}/tracks`, block.tracks);
  const markers = useBinding(`${pointer}/markers`, block.markers ?? []);
  const ticks = useBinding(`${pointer}/ticks`, block.ticks ?? []);
  const selection = useBinding(`${pointer}/selection`, block.selection ?? null);
  const snap = useBinding(`${pointer}/snap`, block.snap ?? null);
  const viewportBinding = useBinding(`${pointer}/viewport`, block.viewport ?? null);
  const root = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null), playhead = useRef<HTMLDivElement>(null), ruler = useRef<HTMLDivElement>(null), scroll = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null), previewFrame = useRef<number | null>(null), pendingPreview = useRef<{ edit: Edit; modifiers: EventModifiers } | null>(null);
  const seekFrame = useRef<number | null>(null), pendingSeek = useRef<number | null>(null);
  const viewportFrame = useRef<number | null>(null), pendingViewport = useRef<TimelineViewport | null>(null);
  const scrollHandler = useRef<(() => void) | null>(null);
  const wheelHandler = useRef<((event: globalThis.WheelEvent) => void) | null>(null);
  const [localViewport, setLocalViewport] = useState<TimelineViewport | null>(null), [draftViewport, setDraftViewport] = useState<TimelineViewport | null>(null), [preview, setPreview] = useState<Edit | null>(null);
  const seconds = duration.status === "ready" && typeof duration.value === "number" && Number.isFinite(duration.value) ? Math.max(0, duration.value) : 0;
  const trackData = tracks.status === "ready" && Array.isArray(tracks.value) ? tracks.value.filter((v): v is unknown & Track => !!v && typeof v === "object" && !Array.isArray(v) && typeof v.id === "string" && Array.isArray(v.items)) : [];
  const markerData = markers.status === "ready" && Array.isArray(markers.value) ? markers.value.filter((v): v is unknown & Marker => !!v && typeof v === "object" && !Array.isArray(v) && typeof v.id === "string" && typeof v.time === "number") : [];
  const tickData = ticks.status === "ready" && Array.isArray(ticks.value) ? ticks.value.filter((v): v is number => typeof v === "number" && Number.isFinite(v)) : [];
  const selected = selection.status === "ready" && selection.value && typeof selection.value === "object" && !Array.isArray(selection.value) && Array.isArray(selection.value.ids) ? selection.value.ids : [];
  const snapValue = snap.status === "ready" && snap.value && typeof snap.value === "object" && !Array.isArray(snap.value) ? snap.value as Snap : null;
  const rawPosition = position.status === "ready" ? position.value : 0;
  const clock = isClock(rawPosition) ? rawPosition : null;
  const hasViewportBinding = block.viewport !== undefined;
  const boundViewport = hasViewportBinding && viewportBinding.status === "ready" ? readViewport(viewportBinding.value) : null;
  const latestBoundViewport = useRef<TimelineViewport | null>(boundViewport);
  latestBoundViewport.current = boundViewport;
  const fullViewport: TimelineViewport = { start: 0, end: seconds };
  const requestedViewport = hasViewportBinding ? draftViewport ?? boundViewport ?? fullViewport : localViewport ?? fullViewport;
  const viewportRange = clampViewport(requestedViewport, seconds);
  const currentViewport = useRef(viewportRange);
  currentViewport.current = viewportRange;
  const draftViewportRef = useRef<TimelineViewport | null>(draftViewport);
  draftViewportRef.current = draftViewport;
  const viewportSpan = Math.max(0.001, viewportRange.end - viewportRange.start);
  const zoom = seconds > 0 ? seconds / viewportSpan : 1;
  const maxZoom = Math.max(1, seconds / 2);
  const canChangeViewport = !hasViewportBinding || !!block.on_viewport;
  const rulerMetrics = useRef({ width: 0, minimumSpacing: 0 });
  const [, setRulerRevision] = useState(0);
  const viewportControls = block.controls !== undefined || hasViewportBinding;
  const step = rulerStep(seconds, zoom, viewportControls, rulerMetrics.current.width, rulerMetrics.current.minimumSpacing);
  const currentStep = useRef(step);
  currentStep.current = step;
  const attachScroll = useCallback((scroller: HTMLDivElement | null) => {
    scroll.current = scroller;
    if (!scroller) return;
    const update = () => {
      const measure = scroller.querySelector<HTMLElement>(".ks-timeline-ruler-measure");
      const firstLabel = scroller.querySelector<HTMLElement>(".ks-timeline-ruler > span");
      if (!measure) return;
      const bounds = scroller.getBoundingClientRect();
      const style = getComputedStyle(scroller);
      const width = Math.max(0, bounds.width - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0));
      const labelWidth = measure.getBoundingClientRect().width;
      const gap = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ks-space-1")) || 0;
      const leadingPadding = firstLabel ? Number.parseFloat(getComputedStyle(firstLabel).paddingInlineStart) || 0 : 0;
      const minimumSpacing = labelWidth > 0 ? labelWidth * 1.5 + gap + leadingPadding : 0;
      rulerMetrics.current = { width, minimumSpacing };
      const nextStep = rulerStep(seconds, zoom, viewportControls, width, minimumSpacing);
      if (nextStep !== currentStep.current) {
        currentStep.current = nextStep;
        setRulerRevision((revision) => revision + 1);
      }
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(scroller);
    return () => { observer?.disconnect(); scroll.current = null; };
  }, [seconds, zoom, viewportControls]);
  const sendViewport = useMemo(() => createSerialSend(async (next: TimelineViewport) => {
    const accepted = await data.act(`${pointer}/on_viewport`, next);
    if (!accepted && sameViewport(draftViewportRef.current, next)) {
      const fallback = latestBoundViewport.current ?? fullViewport;
      draftViewportRef.current = null;
      currentViewport.current = clampViewport(fallback, seconds);
      setDraftViewport(null);
    }
  }), [data, fullViewport.end, pointer, seconds]);
  const flushViewport = () => {
    if (viewportFrame.current !== null) cancelAnimationFrame(viewportFrame.current);
    viewportFrame.current = null;
    const next = pendingViewport.current;
    pendingViewport.current = null;
    if (!next) return;
    sendViewport(next, { coalesce: true });
  };
  const changeViewport = (next: TimelineViewport) => {
    const normalized = clampViewport(next, seconds);
    if (!hasViewportBinding) {
      if (sameViewport(currentViewport.current, normalized)) return;
      currentViewport.current = normalized;
      setLocalViewport(normalized);
      return;
    }
    if (!block.on_viewport) return;
    if (sameViewport(pendingViewport.current ?? currentViewport.current, normalized)) return;
    currentViewport.current = normalized;
    draftViewportRef.current = normalized;
    setDraftViewport(normalized);
    pendingViewport.current = normalized;
    if (viewportFrame.current === null) viewportFrame.current = requestAnimationFrame(flushViewport);
  };
  const viewportFromScroll = (): TimelineViewport | null => {
    const scroller = scroll.current, content = body.current;
    const contentWidth = content?.getBoundingClientRect().width ?? 0;
    if (!scroller || !content || contentWidth <= 0 || scroller.clientWidth <= 0 || seconds <= 0) return null;
    const styles = getComputedStyle(scroller);
    const padding = (Number.parseFloat(styles.paddingLeft) || 0) + (Number.parseFloat(styles.paddingRight) || 0);
    const width = scroller.clientWidth - padding;
    if (width <= 0) return null;
    const start = scroller.scrollLeft / contentWidth * seconds;
    const span = width / contentWidth * seconds;
    return clampViewport({ start, end: start + span }, seconds);
  };
  const syncViewportFromScroll = () => {
    const scrolled = viewportFromScroll();
    if (scrolled && canChangeViewport && !sameViewport(currentViewport.current, scrolled)) changeViewport(scrolled);
    return scrolled ?? currentViewport.current;
  };
  scrollHandler.current = syncViewportFromScroll;
  useEffect(() => {
    if (!hasViewportBinding || !draftViewport || !sameViewport(boundViewport, draftViewport)) return;
    draftViewportRef.current = null;
    setDraftViewport(null);
  }, [boundViewport?.start, boundViewport?.end, draftViewport, hasViewportBinding]);
  useEffect(() => () => {
    if (viewportFrame.current !== null) cancelAnimationFrame(viewportFrame.current);
    viewportFrame.current = null;
    pendingViewport.current = null;
  }, []);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const listener = (event: globalThis.WheelEvent) => wheelHandler.current?.(event);
    const onScroll = () => scrollHandler.current?.();
    element.addEventListener("wheel", listener, { passive: false });
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("wheel", listener);
      element.removeEventListener("scroll", onScroll);
    };
  }, [duration.status, tracks.status]);
  useLayoutEffect(() => {
    const scroller = scroll.current, content = body.current;
    if (!scroller || !content || seconds <= 0) return;
    const contentWidth = content.getBoundingClientRect().width;
    if (contentWidth > 0) scroller.scrollLeft = viewportRange.start / seconds * contentWidth;
  }, [seconds, viewportRange.start, viewportRange.end, visible]);
  useEffect(() => {
    if (!visible) return;
    let frame = 0;
    const draw = () => {
      const time = clock ? clockPosition(clock, performance.timeOrigin + performance.now()) : typeof rawPosition === "number" ? rawPosition : 0;
      const ratio = seconds ? Math.max(0, Math.min(1, time / seconds)) : 0;
      if (playhead.current) playhead.current.style.left = `${ratio * 100}%`;
      ruler.current?.setAttribute("aria-valuenow", String(Math.round(time * 100) / 100));
      if (clock?.running && scroll.current && body.current) {
        const viewport = scroll.current, x = ratio * body.current.getBoundingClientRect().width;
        const relative = x - viewport.scrollLeft;
        if (relative > viewport.clientWidth * 0.85) {
          viewport.scrollLeft += (relative - viewport.clientWidth * 0.75) * 0.2;
          syncViewportFromScroll();
        } else if (relative < 0) {
          viewport.scrollLeft += (relative - viewport.clientWidth * 0.1) * 0.2;
          syncViewportFromScroll();
        }
      }
      if (clock?.running) frame = requestAnimationFrame(draw);
    };
    draw(); return () => cancelAnimationFrame(frame);
  }, [clock, rawPosition, seconds, visible]);
  useShareDescriber(root, () => ({ text: `[시간축] ${clock ? clockPosition(clock, performance.timeOrigin + performance.now()).toFixed(1) : typeof rawPosition === "number" ? rawPosition.toFixed(1) : "0"} / ${seconds.toFixed(1)}초\n${trackData.map((track) => `${track.label ?? track.id}: ${track.items.length}개`).join("\n")}`, visual: false }));

  const dispatch = (edit: Edit, modifiers: EventModifiers) => { if (block.on_edit) void data.act(`${pointer}/on_edit`, edit as unknown as JsonValue, undefined, modifiers); };
  const finish = (phase: "commit" | "cancel", modifiers: EventModifiers) => {
    const current = gesture.current; if (!current) return;
    if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
    previewFrame.current = null; pendingPreview.current = null;
    dispatch({ ...(phase === "cancel" ? current.original : current.current), phase }, modifiers);
    gesture.current = null; setPreview(null);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && gesture.current) { event.preventDefault(); finishRef.current("cancel", eventModifiers(event)); } };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  useEffect(() => () => { if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current); previewFrame.current = null; }, []);
  const begin = (event: PointerEvent<HTMLElement>, edit: Edit, editable: boolean) => {
    event.stopPropagation();
    if (block.on_select) void data.act(`${pointer}/on_select`, { ids: [edit.id] });
    if (!editable || block.read_only || !block.on_edit || !body.current || seconds <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { pointerId: event.pointerId, x: event.clientX, width: body.current.getBoundingClientRect().width, original: edit, current: edit };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current; if (!current || current.pointerId !== event.pointerId || !current.width) return;
    const initial = current.original, delta = (event.clientX - current.x) / current.width * seconds;
    const snapTo = (time: number) => Math.max(0, Math.min(seconds, snapTime(time, snapValue, current.width / seconds, event.shiftKey)));
    let start = initial.start, end = initial.end;
    if (initial.kind === "move") { start = Math.min(seconds - (end - start), snapTo(start + delta)); end = start + initial.end - initial.start; }
    else if (initial.kind === "resize_start") start = Math.min(end, snapTo(start + delta));
    else if (initial.kind === "resize_end") end = Math.max(start, snapTo(end + delta));
    else start = end = snapTo(start + delta);
    current.current = { ...initial, phase: "preview", start, end };
    setPreview(current.current);
    if (isClientAction(block.on_edit)) {
      pendingPreview.current = { edit: current.current, modifiers: eventModifiers(event) };
      if (previewFrame.current === null) previewFrame.current = requestAnimationFrame(() => { previewFrame.current = null; if (pendingPreview.current) dispatch(pendingPreview.current.edit, pendingPreview.current.modifiers); pendingPreview.current = null; });
    }
  };
  const seekValue = (event: PointerEvent<HTMLElement>) => {
    if (!block.on_seek || !body.current || seconds <= 0) return;
    const bounds = body.current.getBoundingClientRect();
    if (!bounds.width) return;
    return Math.max(0, Math.min(seconds, (event.clientX - bounds.left) / bounds.width * seconds));
  };
  const keyEdit = (event: KeyboardEvent<HTMLElement>, edit: Edit, editable: boolean) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); if (block.on_select) void data.act(`${pointer}/on_select`, { ids: [edit.id] }); return;
    }
    if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || !editable || block.read_only || !block.on_edit) return;
    event.preventDefault();
    const delta = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 0.1 : snapValue?.step && snapValue.step > 0 ? snapValue.step : 1);
    const length = edit.end - edit.start;
    const start = Math.max(0, Math.min(seconds - length, edit.start + delta));
    dispatch({ ...edit, phase: "commit", start, end: start + length }, eventModifiers(event));
  };
  const flushSeek = () => {
    if (seekFrame.current !== null) cancelAnimationFrame(seekFrame.current);
    seekFrame.current = null;
    const value = pendingSeek.current;
    pendingSeek.current = null;
    if (value !== null) serialSeek(value, { coalesce: true });
  };
  const seek = (event: PointerEvent<HTMLElement>, immediate = false) => {
    const value = seekValue(event);
    if (value === undefined || value === null) return;
    if (immediate) { flushSeek(); serialSeek(value, { coalesce: false }); return; }
    pendingSeek.current = value;
    if (seekFrame.current !== null) return;
    seekFrame.current = requestAnimationFrame(() => {
      seekFrame.current = null;
      const latest = pendingSeek.current;
      pendingSeek.current = null;
      if (latest !== null) serialSeek(latest, { coalesce: true });
    });
  };
  useEffect(() => () => {
    if (seekFrame.current !== null) cancelAnimationFrame(seekFrame.current);
    seekFrame.current = null;
    const latest = pendingSeek.current;
    pendingSeek.current = null;
    if (latest !== null) serialSeek(latest, { coalesce: true });
  }, [serialSeek]);
  if (duration.status !== "ready") return <DataState value={duration} />;
  if (tracks.status !== "ready") return <DataState value={tracks} />;
  const percent = (value: number) => `${seconds ? value / seconds * 100 : 0}%`;
  const rulerTicks = Array.from({ length: Math.floor(seconds / step) + 1 }, (_, index) => index * step);
  const currentTime = clock ? clockPosition(clock, performance.timeOrigin + performance.now()) : typeof rawPosition === "number" ? rawPosition : 0;
  const zoomBy = (factor: number, pointerFraction?: number) => {
    if (!canChangeViewport || seconds <= 0) return;
    const current = syncViewportFromScroll();
    const span = current.end - current.start;
    const fraction = pointerFraction ?? (currentTime - current.start) / span;
    const anchorTime = pointerFraction === undefined ? currentTime : current.start + fraction * span;
    changeViewport(zoomViewport(current, seconds, factor, fraction, anchorTime));
  };
  const onWheel = (event: globalThis.WheelEvent) => {
    if (!canChangeViewport || seconds <= 0) return;
    event.preventDefault();
    const bounds = scroll.current?.getBoundingClientRect();
    const styles = scroll.current ? getComputedStyle(scroll.current) : null;
    const paddingLeft = Number.parseFloat(styles?.paddingLeft ?? "") || 0;
    const paddingRight = Number.parseFloat(styles?.paddingRight ?? "") || 0;
    const width = Math.max(1, (scroll.current?.clientWidth || bounds?.width || 1) - paddingLeft - paddingRight);
    const fraction = Math.max(0, Math.min(1, (event.clientX - (bounds?.left ?? 0) - (scroll.current?.clientLeft ?? 0) - paddingLeft) / width));
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      const delta = event.shiftKey ? event.deltaY : event.deltaX;
      const current = syncViewportFromScroll();
      const span = current.end - current.start;
      changeViewport(clampViewport({ start: current.start + delta / width * span, end: current.end + delta / width * span }, seconds));
    } else {
      zoomBy(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0025)), fraction);
    }
  };
  wheelHandler.current = onWheel;
  const showControls = block.controls !== false;
  const bodyWidth = seconds > 0 ? `${seconds / viewportSpan * 100}%` : "100%";
  return <div className="ks-timeline" ref={root}>
    <div className={`ks-timeline-layout${block.controls === true ? " has-controls" : ""}`}><div className="ks-timeline-labels"><div className="ks-timeline-ruler-label">{showControls ? <><IconButton aria-label="축소" disabled={!canChangeViewport || zoom <= 1} onClick={() => zoomBy(1 / 1.6)}><DataIcon name="minus" size="inline" /></IconButton><IconButton aria-label="확대" disabled={!canChangeViewport || zoom >= maxZoom} onClick={() => zoomBy(1.6)}><DataIcon name="plus" size="inline" /></IconButton>{block.controls === true ? <IconButton aria-label="전체 맞춤" disabled={!canChangeViewport || (viewportRange.start === 0 && viewportRange.end === seconds)} onClick={() => changeViewport({ start: 0, end: seconds })}><DataIcon name="maximize-2" size="inline" /></IconButton> : null}</> : null}</div>{trackData.map((track) => <div key={track.id}><span>{track.label ?? track.id}</span>{track.locked ? <DataIcon name="lock" size="inline" /> : null}</div>)}</div>
      <div className="ks-timeline-scroll" ref={attachScroll}><div className="ks-timeline-body" ref={body} style={{ width: bodyWidth }}>
        <span className="ks-timeline-ruler-measure" aria-hidden="true">{rulerTime(seconds)}</span>
        <div className="ks-timeline-ruler" ref={ruler} role="slider" aria-label="재생 위치" aria-valuemin={0} aria-valuemax={Math.round(seconds * 100) / 100} aria-valuenow={Math.round(currentTime * 100) / 100} tabIndex={block.on_seek ? 0 : -1} onKeyDown={(event) => { if (!block.on_seek || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return; event.preventDefault(); const increment = event.shiftKey ? 0.1 : snapValue?.step && snapValue.step > 0 ? snapValue.step : 1; void data.act(`${pointer}/on_seek`, Math.max(0, Math.min(seconds, currentTime + (event.key === "ArrowRight" ? increment : -increment)))); }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); seek(event, true); }} onPointerMove={(event) => { if (event.buttons) seek(event); }} onPointerUp={(event) => seek(event, true)} onPointerCancel={() => flushSeek()}>
          {rulerTicks.map((tick) => <span key={tick} className={seconds > 0 && tick / seconds >= 0.96 ? "is-end" : undefined} style={{ left: percent(tick) }}>{rulerTime(tick)}</span>)}
        </div>
        {tickData.map((tick, index) => <span key={index} className="ks-timeline-tick" style={{ left: percent(tick) }} />)}
        {trackData.map((track) => <div className="ks-timeline-track" key={track.id}>
          {track.waveform?.peaks?.length ? <svg className="ks-timeline-waveform" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true" style={{ left: percent(track.waveform.start ?? 0), width: percent((track.waveform.end ?? seconds) - (track.waveform.start ?? 0)) }}><polygon points={[...track.waveform.peaks.map((peak, index, all) => `${index * 1000 / Math.max(1, all.length - 1)},${50 - Math.max(0, Math.min(1, peak)) * 48}`), ...track.waveform.peaks.map((peak, index, all) => `${index * 1000 / Math.max(1, all.length - 1)},${50 + Math.max(0, Math.min(1, peak)) * 48}`).reverse()].join(" ")} /></svg> : null}
          {track.items.filter((item) => typeof item.id === "string" && Number.isFinite(item.start) && Number.isFinite(item.end)).map((item) => {
            const shown = preview?.id === item.id ? preview : item;
            const edit: Edit = { phase: "preview", kind: "move", id: item.id, track: track.id, start: item.start, end: item.end };
            const handlers = { onPointerMove: move, onPointerUp: (event: PointerEvent<HTMLElement>) => finish("commit", eventModifiers(event)), onPointerCancel: (event: PointerEvent<HTMLElement>) => finish("cancel", eventModifiers(event)) };
            const canResizeStart = !!(item.resize_start_only || item.resizable) && !track.locked && !block.read_only;
            const canResizeEnd = !!item.resizable && !item.resize_start_only && !track.locked && !block.read_only;
            const label = item.label ?? item.id;
            return <div key={item.id} role="button" tabIndex={0} aria-label={label} title={label} className={`ks-timeline-item is-${item.tone ?? "neutral"} series-${(item.series ?? 0) % 4}${!item.movable || track.locked || block.read_only ? " is-fixed" : ""}${selected.includes(item.id) ? " is-selected" : ""}${preview?.id === item.id ? " is-dragging" : ""}`} style={{ left: percent(shown.start), width: percent(shown.end - shown.start) }} onKeyDown={(event) => keyEdit(event, edit, !!item.movable && !track.locked)} onPointerDown={(event) => begin(event, edit, !!item.movable && !track.locked)} {...handlers}>
              {canResizeStart ? <span className="ks-timeline-handle is-start" onPointerDown={(event) => begin(event, { ...edit, kind: "resize_start" }, true)} {...handlers} /> : null}
              <span className="ks-timeline-label">{label}</span>
              {canResizeEnd ? <span className="ks-timeline-handle is-end" onPointerDown={(event) => begin(event, { ...edit, kind: "resize_end" }, true)} {...handlers} /> : null}
            </div>;
          })}
        </div>)}
        {markerData.map((marker) => { const time = preview?.id === marker.id ? preview.start : marker.time; const edit: Edit = { phase: "preview", kind: "move_marker", id: marker.id, track: null, start: marker.time, end: marker.time }; return <button key={marker.id} type="button" className="ks-timeline-marker" title={marker.label ?? marker.id} aria-label={marker.label ?? marker.id} style={{ left: percent(time) }} onKeyDown={(event) => keyEdit(event, edit, !!marker.movable)} onPointerDown={(event) => begin(event, edit, !!marker.movable)} onPointerMove={move} onPointerUp={(event) => finish("commit", eventModifiers(event))} onPointerCancel={(event) => finish("cancel", eventModifiers(event))} />; })}
        <div className="ks-timeline-playhead" ref={playhead} />
      </div></div></div>
  </div>;
}
