import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Actions, Block, Clock } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { IconButton } from "../components/primitives";
import { DataIcon } from "../components/data-icons";
import { DataState } from "../components/data-state";
import { useBinding, useWindowData } from "../data/window-data";
import { useShareDescriber } from "../share/visible";

type Snap = { points?: number[]; step?: number; threshold_px?: number };
type Item = { id: string; start: number; end: number; label?: string; tone?: string; series?: number; movable?: boolean; resizable?: boolean };
type Track = { id: string; label?: string; locked?: boolean; items: Item[]; waveform?: { peaks: number[]; start?: number; end?: number } };
type Marker = { id: string; time: number; label?: string; movable?: boolean };
type Edit = { phase: "preview" | "commit" | "cancel"; kind: "move" | "resize_start" | "resize_end" | "move_marker"; id: string; track: string | null; start: number; end: number };
type Gesture = { pointerId: number; x: number; width: number; original: Edit; current: Edit };
type TimelineData = Extract<Block, { type: "timeline" }>;

export function clockPosition(clock: Clock, now: number): number {
  return Math.max(0, Math.min(clock.duration, clock.position + (clock.running ? (now - clock.sampled_at) / 1000 * clock.rate : 0)));
}

export function snapTime(time: number, snap: Snap | null, pixelsPerSecond: number, disabled: boolean): number {
  if (!snap || disabled || pixelsPerSecond <= 0) return time;
  const candidates = [...(snap.points ?? [])].filter(Number.isFinite);
  if (snap.step && Number.isFinite(snap.step) && snap.step > 0) candidates.push(Math.round(time / snap.step) * snap.step);
  const nearest = candidates.reduce<number | null>((best, candidate) => best === null || Math.abs(candidate - time) < Math.abs(best - time) ? candidate : best, null);
  return nearest !== null && Math.abs(nearest - time) * pixelsPerSecond <= (snap.threshold_px ?? 8) ? nearest : time;
}

export function rulerStep(seconds: number, zoom: number): number {
  const wanted = seconds / Math.max(1, 5 * zoom);
  return [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60].find((step) => step >= wanted) ?? 60;
}

export function rulerTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}`;
}

function isClientAction(actions: Actions | undefined): boolean {
  const action = Array.isArray(actions) ? actions.length === 1 ? actions[0] : null : actions;
  return !!action && typeof action === "object" && "client" in action;
}

export function TimelineBlock({ block, pointer }: { block: TimelineData; pointer: string }) {
  const data = useWindowData();
  const duration = useBinding(`${pointer}/duration`, block.duration);
  const position = useBinding(`${pointer}/position`, block.position);
  const tracks = useBinding(`${pointer}/tracks`, block.tracks);
  const markers = useBinding(`${pointer}/markers`, block.markers ?? []);
  const ticks = useBinding(`${pointer}/ticks`, block.ticks ?? []);
  const selection = useBinding(`${pointer}/selection`, block.selection ?? null);
  const snap = useBinding(`${pointer}/snap`, block.snap ?? null);
  const root = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null), playhead = useRef<HTMLDivElement>(null), ruler = useRef<HTMLDivElement>(null), scroll = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null), previewFrame = useRef<number | null>(null), pendingPreview = useRef<Edit | null>(null);
  const [zoom, setZoom] = useState(1), [preview, setPreview] = useState<Edit | null>(null);
  const seconds = duration.status === "ready" && typeof duration.value === "number" && Number.isFinite(duration.value) ? Math.max(0, duration.value) : 0;
  const trackData = tracks.status === "ready" && Array.isArray(tracks.value) ? tracks.value.filter((v): v is unknown & Track => !!v && typeof v === "object" && !Array.isArray(v) && typeof v.id === "string" && Array.isArray(v.items)) : [];
  const markerData = markers.status === "ready" && Array.isArray(markers.value) ? markers.value.filter((v): v is unknown & Marker => !!v && typeof v === "object" && !Array.isArray(v) && typeof v.id === "string" && typeof v.time === "number") : [];
  const tickData = ticks.status === "ready" && Array.isArray(ticks.value) ? ticks.value.filter((v): v is number => typeof v === "number" && Number.isFinite(v)) : [];
  const selected = selection.status === "ready" && selection.value && typeof selection.value === "object" && !Array.isArray(selection.value) && Array.isArray(selection.value.ids) ? selection.value.ids : [];
  const snapValue = snap.status === "ready" && snap.value && typeof snap.value === "object" && !Array.isArray(snap.value) ? snap.value as Snap : null;
  const rawPosition = position.status === "ready" ? position.value : 0;
  const clock = rawPosition && typeof rawPosition === "object" && !Array.isArray(rawPosition) && typeof rawPosition.position === "number" && typeof rawPosition.sampled_at === "number" && typeof rawPosition.rate === "number" && typeof rawPosition.running === "boolean" && typeof rawPosition.duration === "number" ? rawPosition as Clock : null;
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const time = clock ? clockPosition(clock, performance.timeOrigin + performance.now()) : typeof rawPosition === "number" ? rawPosition : 0;
      const ratio = seconds ? Math.max(0, Math.min(1, time / seconds)) : 0;
      if (playhead.current) playhead.current.style.left = `${ratio * 100}%`;
      ruler.current?.setAttribute("aria-valuenow", String(Math.round(time * 100) / 100));
      if (clock?.running && scroll.current && body.current) {
        const viewport = scroll.current, x = ratio * body.current.getBoundingClientRect().width;
        const relative = x - viewport.scrollLeft;
        if (relative > viewport.clientWidth * 0.85) viewport.scrollLeft += (relative - viewport.clientWidth * 0.75) * 0.2;
        else if (relative < 0) viewport.scrollLeft += (relative - viewport.clientWidth * 0.1) * 0.2;
      }
      if (clock?.running) frame = requestAnimationFrame(draw);
    };
    draw(); return () => cancelAnimationFrame(frame);
  }, [clock, rawPosition, seconds]);
  useShareDescriber(root, () => ({ text: `[시간축] ${clock ? clockPosition(clock, performance.timeOrigin + performance.now()).toFixed(1) : typeof rawPosition === "number" ? rawPosition.toFixed(1) : "0"} / ${seconds.toFixed(1)}초\n${trackData.map((track) => `${track.label ?? track.id}: ${track.items.length}개`).join("\n")}`, visual: false }));

  const dispatch = (edit: Edit) => { if (block.on_edit) void data.act(`${pointer}/on_edit`, edit as unknown as JsonValue); };
  const finish = (phase: "commit" | "cancel") => {
    const current = gesture.current; if (!current) return;
    if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
    previewFrame.current = null; pendingPreview.current = null;
    dispatch({ ...(phase === "cancel" ? current.original : current.current), phase });
    gesture.current = null; setPreview(null);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && gesture.current) { event.preventDefault(); finishRef.current("cancel"); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
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
      pendingPreview.current = current.current;
      if (previewFrame.current === null) previewFrame.current = requestAnimationFrame(() => { previewFrame.current = null; if (pendingPreview.current) dispatch(pendingPreview.current); pendingPreview.current = null; });
    }
  };
  const seek = (event: PointerEvent<HTMLElement>) => {
    if (!block.on_seek || !body.current || seconds <= 0) return;
    const bounds = body.current.getBoundingClientRect();
    void data.act(`${pointer}/on_seek`, Math.max(0, Math.min(seconds, (event.clientX - bounds.left) / bounds.width * seconds)));
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
    dispatch({ ...edit, phase: "commit", start, end: start + length });
  };
  if (duration.status !== "ready") return <DataState value={duration} />;
  if (tracks.status !== "ready") return <DataState value={tracks} />;
  const percent = (value: number) => `${seconds ? value / seconds * 100 : 0}%`;
  const step = rulerStep(seconds, zoom);
  const rulerTicks = Array.from({ length: Math.floor(seconds / step) + 1 }, (_, index) => index * step);
  const currentTime = clock ? clockPosition(clock, performance.timeOrigin + performance.now()) : typeof rawPosition === "number" ? rawPosition : 0;
  return <div className="ks-timeline" ref={root}>
    <div className="ks-timeline-layout"><div className="ks-timeline-labels"><div className="ks-timeline-ruler-label"><IconButton aria-label="축소" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value / 2))}><DataIcon name="minus" size="inline" /></IconButton><IconButton aria-label="확대" disabled={zoom >= 32} onClick={() => setZoom((value) => Math.min(32, value * 2))}><DataIcon name="plus" size="inline" /></IconButton></div>{trackData.map((track) => <div key={track.id}><span>{track.label ?? track.id}</span>{track.locked ? <DataIcon name="lock" size="inline" /> : null}</div>)}</div>
      <div className="ks-timeline-scroll" ref={scroll}><div className="ks-timeline-body" ref={body} style={{ width: `${zoom * 100}%` }}>
        <div className="ks-timeline-ruler" ref={ruler} role="slider" aria-label="재생 위치" aria-valuemin={0} aria-valuemax={Math.round(seconds * 100) / 100} aria-valuenow={Math.round(currentTime * 100) / 100} tabIndex={block.on_seek ? 0 : -1} onKeyDown={(event) => { if (!block.on_seek || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return; event.preventDefault(); const increment = event.shiftKey ? 0.1 : snapValue?.step && snapValue.step > 0 ? snapValue.step : 1; void data.act(`${pointer}/on_seek`, Math.max(0, Math.min(seconds, currentTime + (event.key === "ArrowRight" ? increment : -increment)))); }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); seek(event); }} onPointerMove={(event) => { if (event.buttons) seek(event); }}>
          {rulerTicks.map((tick) => <span key={tick} style={{ left: percent(tick) }}>{rulerTime(tick)}</span>)}
        </div>
        {tickData.map((tick, index) => <span key={index} className="ks-timeline-tick" style={{ left: percent(tick) }} />)}
        {trackData.map((track) => <div className="ks-timeline-track" key={track.id}>
          {track.waveform?.peaks?.length ? <svg className="ks-timeline-waveform" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true" style={{ left: percent(track.waveform.start ?? 0), width: percent((track.waveform.end ?? seconds) - (track.waveform.start ?? 0)) }}><polygon points={[...track.waveform.peaks.map((peak, index, all) => `${index * 1000 / Math.max(1, all.length - 1)},${50 - Math.max(0, Math.min(1, peak)) * 48}`), ...track.waveform.peaks.map((peak, index, all) => `${index * 1000 / Math.max(1, all.length - 1)},${50 + Math.max(0, Math.min(1, peak)) * 48}`).reverse()].join(" ")} /></svg> : null}
          {track.items.filter((item) => typeof item.id === "string" && Number.isFinite(item.start) && Number.isFinite(item.end)).map((item) => {
            const shown = preview?.id === item.id ? preview : item;
            const edit: Edit = { phase: "preview", kind: "move", id: item.id, track: track.id, start: item.start, end: item.end };
            const handlers = { onPointerMove: move, onPointerUp: () => finish("commit"), onPointerCancel: () => finish("cancel") };
            return <div key={item.id} role="button" tabIndex={0} className={`ks-timeline-item is-${item.tone ?? "neutral"} series-${(item.series ?? 0) % 4}${selected.includes(item.id) ? " is-selected" : ""}${preview?.id === item.id ? " is-dragging" : ""}`} style={{ left: percent(shown.start), width: percent(shown.end - shown.start) }} onKeyDown={(event) => keyEdit(event, edit, !!item.movable && !track.locked)} onPointerDown={(event) => begin(event, edit, !!item.movable && !track.locked)} {...handlers}>
              {item.resizable && !track.locked && !block.read_only ? <span className="ks-timeline-handle is-start" onPointerDown={(event) => begin(event, { ...edit, kind: "resize_start" }, true)} {...handlers} /> : null}
              <span>{item.label ?? item.id}</span>
              {item.resizable && !track.locked && !block.read_only ? <span className="ks-timeline-handle is-end" onPointerDown={(event) => begin(event, { ...edit, kind: "resize_end" }, true)} {...handlers} /> : null}
            </div>;
          })}
        </div>)}
        {markerData.map((marker) => { const time = preview?.id === marker.id ? preview.start : marker.time; const edit: Edit = { phase: "preview", kind: "move_marker", id: marker.id, track: null, start: marker.time, end: marker.time }; return <button key={marker.id} type="button" className="ks-timeline-marker" title={marker.label ?? marker.id} aria-label={marker.label ?? marker.id} style={{ left: percent(time) }} onKeyDown={(event) => keyEdit(event, edit, !!marker.movable)} onPointerDown={(event) => begin(event, edit, !!marker.movable)} onPointerMove={move} onPointerUp={() => finish("commit")} onPointerCancel={() => finish("cancel")} />; })}
        <div className="ks-timeline-playhead" ref={playhead} />
      </div></div></div>
  </div>;
}
