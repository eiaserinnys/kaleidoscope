import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Block, MapPoint } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { Badge, isBadge } from "../components/badge";
import { DataState } from "../components/data-state";
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
  useShareDescriber(root, () => ({ text: `[지도, 지점 ${points.length}개${active ? `, ${block.selected && selectedIndex < 0 ? "표시" : "선택"}: ${active.label ?? active.key} (${coord(active.lat, active.lng)})` : ""}]\n${points.slice(0, 10).map((p) => `${p.label ?? p.key} · ${coord(p.lat, p.lng)}`).join("\n")}`, visual: true }));
  if (!points.length) return <NoItems />;
  const sizes = points.map((p) => p.size).filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0);
  const min = Math.min(...sizes), max = Math.max(...sizes);
  const radius = (point: Point) => typeof point.size === "number" && Number.isFinite(point.size) && point.size >= 0 && max > min ? 4.5 + (point.size - min) / (max - min) * 6 : 6;
  const select = (next: number) => { const point = points[next]; if (!point) return; setIndex(next); if (block.on_select) void data.act(`${pointer}/on_select`, point.key, point as JsonValue); };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
  return <div ref={root} className={`ks-map is-${block.height ?? "medium"}`}>
    <div className="ks-map-frame" role="region" aria-label="세계 지도" tabIndex={0} onKeyDown={keyDown}>
    <div className="ks-map-readout">
      <div className="ks-map-readout-main"><span className={`ks-map-swatch ks-map-tone-${tone(active)}`} /><strong>{active.label ?? active.key}</strong>{active.sublabel && <span>{active.sublabel}</span>}{isBadge(active.badge) && <Badge value={active.badge} />}</div>
      <div className="ks-map-readout-meta"><span>{coord(active.lat, active.lng)}</span></div>
    </div>
    <div className="ks-map-canvas"><svg className="ks-map-svg" viewBox="0 0 720 360" preserveAspectRatio="xMidYMid meet">
      <rect className="ks-map-ocean" width="720" height="360" />
      {[-60, -30, 30, 60].map((lat) => <line className="ks-map-graticule" key={`lat${lat}`} x1="0" x2="720" y1={yOf(lat)} y2={yOf(lat)} />)}
      {[-120, -60, 0, 60, 120].map((lng) => <line className="ks-map-graticule" key={`lng${lng}`} x1={xOf(lng)} x2={xOf(lng)} y1="0" y2="360" />)}
      <line className="ks-map-equator" x1="0" x2="720" y1="180" y2="180" />
      {WORLD_LAND.map((path, n) => <path className="ks-map-land" key={n} d={path} fillRule="evenodd" />)}
      <line className="ks-map-crosshair" x1="0" x2="720" y1={yOf(active.lat)} y2={yOf(active.lat)} />
      <line className="ks-map-crosshair" x1={xOf(active.lng)} x2={xOf(active.lng)} y1="0" y2="360" />
      {ordered.map(({ point, n }) => <g className={`ks-map-marker-group ks-map-tone-${tone(point)}`} key={point.key} data-key={point.key} role="button" aria-label={`${point.label ?? point.key} · ${coord(point.lat, point.lng)}`} aria-pressed={block.selected ? n === selectedIndex : n === activeIndex} onClick={() => select(n)}>
        <title>{point.label ?? point.key} · {coord(point.lat, point.lng)}</title>
        {(block.selected ? n === selectedIndex : n === activeIndex) && <circle className="ks-map-marker-ring" cx={xOf(point.lng)} cy={yOf(point.lat)} r={radius(point) + 5} />}
        <circle className="ks-map-marker" cx={xOf(point.lng)} cy={yOf(point.lat)} r={radius(point)} />
      </g>)}
    </svg></div>
    </div>
  </div>;
}
