import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Block, MapPoint } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { Badge, isBadge } from "../components/badge";
import { DataState } from "../components/data-state";
import { Select } from "../components/select-toggle";
import { useBinding, useWindowData } from "../data/window-data";
import { useShareDescriber } from "../share/visible";
import type { BlockContext } from "./block-context";
import { asArray, isObject, NoItems } from "./data-view-common";
import { WORLD_LAND } from "./world-land";

type MapBlockType = Extract<Block, { type: "map" }>;
type Point = MapPoint & { [key: string]: JsonValue | undefined };
const tones = ["default", "muted", "positive", "warning", "negative", "error"] as const;
const coord = (lat: number, lng: number) => `${Math.abs(lat).toFixed(2)}°${lat < 0 ? "S" : "N"}, ${Math.abs(lng).toFixed(2)}°${lng < 0 ? "W" : "E"}`;
const xOf = (lng: number) => (lng + 180) * 2;
const yOf = (lat: number) => (90 - lat) * 2;

type LatLng = { lat: number; lng: number };
type Projected = { x: number; y: number; z: number };
const globeRadius = 156;
const radians = Math.PI / 180;
const wrapLng = (lng: number) => ((lng + 180) % 360 + 360) % 360 - 180;

// 평면의 육지 윤곽을 한 번 복원하고 긴 선분을 구면 위에서 나눈다.
const landRings: LatLng[][] = WORLD_LAND.map((path) => {
  const vertices = Array.from(path.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g), (match) => ({ lng: Number(match[1]) / 2 - 180, lat: 90 - Number(match[2]) / 2 }));
  return vertices.flatMap((point, i) => {
    const next = vertices[(i + 1) % vertices.length];
    const count = Math.max(1, Math.ceil(Math.hypot(next.lat - point.lat, next.lng - point.lng) / 8));
    return Array.from({ length: count }, (_, n) => ({ lat: point.lat + (next.lat - point.lat) * n / count, lng: point.lng + (next.lng - point.lng) * n / count }));
  });
});

function project(point: LatLng, center: LatLng): Projected {
  const lat = point.lat * radians, delta = (point.lng - center.lng) * radians, centerLat = center.lat * radians;
  const cosLat = Math.cos(lat), sinLat = Math.sin(lat), cosCenter = Math.cos(centerLat), sinCenter = Math.sin(centerLat);
  return { x: cosLat * Math.sin(delta), y: cosCenter * sinLat - sinCenter * cosLat * Math.cos(delta), z: sinCenter * sinLat + cosCenter * cosLat * Math.cos(delta) };
}

function horizon(a: Projected, b: Projected): Projected {
  const t = a.z / (a.z - b.z), x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
  const length = Math.hypot(x, y);
  return { x: x / length, y: y / length, z: 0 };
}
const position = (point: Projected) => `${(360 + globeRadius * point.x).toFixed(2)},${(180 - globeRadius * point.y).toFixed(2)}`;

// 보이는 육지 조각의 끝은 뒷면을 가로지르지 않고 지평선 호로 잇는다.
function landPath(ring: LatLng[], center: LatLng): string {
  const vertices = ring.map((point) => project(point, center));
  const start = vertices.findIndex((point) => point.z >= 0);
  if (start < 0) return "";
  let path = `M${position(vertices[start])}`, exit: Projected | undefined;
  for (let i = 1; i <= vertices.length; i++) {
    const previous = vertices[(start + i - 1) % vertices.length], current = vertices[(start + i) % vertices.length];
    if (previous.z >= 0 && current.z < 0) {
      exit = horizon(previous, current);
      path += `L${position(exit)}`;
    } else if (previous.z < 0 && current.z >= 0) {
      const entry = horizon(previous, current);
      if (exit) {
        const cross = exit.x * entry.y - exit.y * entry.x;
        path += `A${globeRadius},${globeRadius} 0 0 ${cross < 0 ? 1 : 0} ${position(entry)}`;
      }
      path += `L${position(current)}`;
    } else if (current.z >= 0) path += `L${position(current)}`;
  }
  return `${path}Z`;
}

function globeLine(points: LatLng[], center: LatLng): string {
  const projected = points.map((point) => project(point, center));
  let path = projected[0].z >= 0 ? `M${position(projected[0])}` : "";
  for (let i = 1; i < projected.length; i++) {
    const a = projected[i - 1], b = projected[i];
    if (a.z >= 0 && b.z < 0) path += `L${position(horizon(a, b))}`;
    else if (a.z < 0 && b.z >= 0) path += `M${position(horizon(a, b))}L${position(b)}`;
    else if (b.z >= 0) path += `L${position(b)}`;
  }
  return path;
}
const latitude = (lat: number) => Array.from({ length: 73 }, (_, i) => ({ lat, lng: -180 + i * 5 }));
const longitude = (lng: number) => Array.from({ length: 37 }, (_, i) => ({ lat: -90 + i * 5, lng }));

function normalize(value: unknown): Point[] {
  return asArray(value).flatMap((item) => {
    if (!isObject(item)) return [];
    const key = typeof item.key === "string" ? item.key : typeof item.key === "number" && Number.isFinite(item.key) ? String(item.key) : "";
    if (!key.trim() || typeof item.lat !== "number" || !Number.isFinite(item.lat) || Math.abs(item.lat) > 90 || typeof item.lng !== "number" || !Number.isFinite(item.lng) || Math.abs(item.lng) > 180) return [];
    return [{ ...item, key, lat: item.lat, lng: item.lng } as Point];
  });
}

export function MapBlock({ block, context, pointer }: { block: MapBlockType; context: BlockContext; pointer: string }) {
  const value = useBinding(`${pointer}/points`, block.points);
  if (value.status !== "ready") return <DataState value={value} />;
  return <MapReady block={block} context={context} pointer={pointer} value={value.value} />;
}

function MapReady({ block, context, pointer, value }: { block: MapBlockType; context: BlockContext; pointer: string; value: JsonValue }) {
  const data = useWindowData();
  const root = useRef<HTMLDivElement>(null);
  const points = useMemo(() => normalize(value), [value]);
  const selectedKey = block.selected ? context.window.state[block.selected.state] : undefined;
  const selectedIndex = selectedKey == null ? -1 : points.findIndex((point) => point.key === String(selectedKey));
  const [index, setIndex] = useState(Math.max(0, selectedIndex));
  useEffect(() => { setIndex(Math.max(0, selectedIndex)); }, [selectedIndex, selectedKey, points]);
  const activeIndex = Math.min(index, points.length - 1);
  const displayIndex = selectedIndex >= 0 ? selectedIndex : activeIndex;
  const active = points[displayIndex];
  const [mode, setMode] = useState<"flat" | "globe">("flat");
  const [center, setCenter] = useState<LatLng>(() => ({ lat: active?.lat ?? 0, lng: active?.lng ?? 0 }));
  const drag = useRef<{ id: number; x: number; y: number; center: LatLng; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const globeId = useId();
  useEffect(() => { if (active) setCenter({ lat: active.lat, lng: active.lng }); }, [active?.key, active?.lat, active?.lng]);
  const projectedLand = useMemo(() => mode === "globe" ? landRings.map((ring) => landPath(ring, center)) : [], [mode, center]);
  useShareDescriber(root, () => ({ text: `[지도${mode === "globe" ? " (3D 지구본)" : ""}, 지점 ${points.length}개${active ? `, ${block.selected && selectedIndex < 0 ? "표시" : "선택"}: ${active.label ?? active.key} (${coord(active.lat, active.lng)})` : ""}]\n${points.slice(0, 10).map((p) => `${p.label ?? p.key} · ${coord(p.lat, p.lng)}`).join("\n")}`, visual: true }));
  if (!points.length) return <NoItems />;
  const sizes = points.map((p) => p.size).filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0);
  const min = Math.min(...sizes), max = Math.max(...sizes);
  const radius = (point: Point) => typeof point.size === "number" && Number.isFinite(point.size) && point.size >= 0 && max > min ? 4.5 + (point.size - min) / (max - min) * 6 : 6;
  const select = (next: number) => { const point = points[next]; if (!point) return; setIndex(next); setCenter({ lat: point.lat, lng: point.lng }); if (block.on_select) void data.act(`${pointer}/on_select`, point.key, point as JsonValue); };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest(".ks-data-segmented")) return;
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % points.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + points.length) % points.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = points.length - 1;
    else if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault(); select(next);
  };
  const tone = (point: Point) => tones.includes(point.tone as typeof tones[number]) ? point.tone : "default";
  const ordered = points.map((point, n) => ({ point, n })).filter(({ n }) => n !== displayIndex).concat([{ point: active, n: displayIndex }]);
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    suppressClick.current = false;
    if (mode !== "globe" || event.button !== 0) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, center, moved: false };
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) <= 4) return;
    if (!current.moved) event.currentTarget.setPointerCapture?.(event.pointerId);
    current.moved = true;
    suppressClick.current = true;
    const width = event.currentTarget.getBoundingClientRect().width || 720;
    const degreesPerPixel = 180 / (width * globeRadius / 360);
    setCenter({ lat: Math.max(-80, Math.min(80, current.center.lat + dy * degreesPerPixel)), lng: wrapLng(current.center.lng - dx * degreesPerPixel) });
  };
  const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };
  return <div ref={root} className={`ks-map is-${block.height ?? "medium"}`}>
    <div className="ks-map-frame" role="region" aria-label="세계 지도" tabIndex={0} onKeyDown={keyDown}>
    <div className="ks-map-readout">
      <div className="ks-map-readout-main"><span className={`ks-map-swatch ks-map-tone-${tone(active)}`} /><strong>{active.label ?? active.key}</strong>{active.sublabel && <span>{active.sublabel}</span>}{isBadge(active.badge) && <Badge value={active.badge} />}</div>
      <div className="ks-map-readout-meta"><span>{coord(active.lat, active.lng)}</span><Select segmented value={mode} onChange={(value) => { if (value === "flat" || value === "globe") { suppressClick.current = false; setMode(value); } }} items={[{ value: "flat", label: "평면" }, { value: "globe", label: "3D 지구본" }]} /></div>
    </div>
    <div className="ks-map-canvas"><svg className={`ks-map-svg${mode === "globe" ? " is-globe" : ""}`} viewBox="0 0 720 360" preserveAspectRatio="xMidYMid meet" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      {mode === "flat" ? <>
      <rect className="ks-map-ocean" width="720" height="360" />
      {[-60, -30, 30, 60].map((lat) => <line className="ks-map-graticule" key={`lat${lat}`} x1="0" x2="720" y1={yOf(lat)} y2={yOf(lat)} />)}
      {[-120, -60, 0, 60, 120].map((lng) => <line className="ks-map-graticule" key={`lng${lng}`} x1={xOf(lng)} x2={xOf(lng)} y1="0" y2="360" />)}
      <line className="ks-map-equator" x1="0" x2="720" y1="180" y2="180" />
      {WORLD_LAND.map((path, n) => <path className="ks-map-land" key={n} d={path} fillRule="evenodd" />)}
      <line className="ks-map-crosshair" x1="0" x2="720" y1={yOf(active.lat)} y2={yOf(active.lat)} />
      <line className="ks-map-crosshair" x1={xOf(active.lng)} x2={xOf(active.lng)} y1="0" y2="360" />
      </> : <>
        <defs>
          <radialGradient id={`${globeId}-ocean`} cx="32%" cy="25%" r="75%"><stop offset="0%" stopColor="var(--ks-color-surface-raised)" /><stop offset="65%" stopColor="var(--ks-color-background)" /><stop offset="100%" stopColor="var(--ks-color-border)" /></radialGradient>
          <clipPath id={`${globeId}-clip`}><circle cx="360" cy="180" r={globeRadius} /></clipPath>
        </defs>
        <circle className="ks-map-globe-ocean" cx="360" cy="180" r={globeRadius} fill={`url(#${globeId}-ocean)`} />
        <g clipPath={`url(#${globeId}-clip)`}>
          {[-60, -30, 0, 30, 60].map((lat) => <path className={lat === 0 ? "ks-map-equator" : "ks-map-graticule"} key={`lat${lat}`} d={globeLine(latitude(lat), center)} fill="none" />)}
          {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180].map((lng) => <path className="ks-map-graticule" key={`lng${lng}`} d={globeLine(longitude(lng), center)} fill="none" />)}
          {projectedLand.map((path, n) => path && <path className="ks-map-land" key={n} d={path} fillRule="evenodd" />)}
          {project(active, center).z >= 0 && <><path className="ks-map-crosshair" fill="none" d={globeLine(latitude(active.lat), center)} /><path className="ks-map-crosshair" fill="none" d={globeLine(longitude(active.lng), center)} /></>}
        </g>
        <circle className="ks-map-globe-rim" cx="360" cy="180" r={globeRadius} />
      </>}
      {ordered.map(({ point, n }) => {
        const projected = mode === "globe" ? project(point, center) : null;
        if (projected && projected.z < 0) return null;
        const x = projected ? Number((360 + globeRadius * projected.x).toFixed(2)) : xOf(point.lng);
        const y = projected ? Number((180 - globeRadius * projected.y).toFixed(2)) : yOf(point.lat);
        return <g className={`ks-map-marker-group ks-map-tone-${tone(point)}`} key={point.key} data-key={point.key} role="button" aria-label={`${point.label ?? point.key} · ${coord(point.lat, point.lng)}`} aria-pressed={block.selected ? n === selectedIndex : n === activeIndex} onClick={() => { if (!suppressClick.current) select(n); }}>
        <title>{point.label ?? point.key} · {coord(point.lat, point.lng)}</title>
        {(block.selected ? n === selectedIndex : n === activeIndex) && <circle className="ks-map-marker-ring" cx={x} cy={y} r={radius(point) + 5} />}
        <circle className="ks-map-marker" cx={x} cy={y} r={radius(point)} />
      </g>; })}
    </svg></div>
    </div>
  </div>;
}
