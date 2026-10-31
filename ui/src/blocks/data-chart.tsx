import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { Block, ChartPoint, ChartSeries } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { DataState } from "../components/data-state";
import { useBinding, useWindowData } from "../data/window-data";
import { asArray, isObject, NoItems } from "./data-view-common";

type ChartBlockType = Extract<Block, { type: "chart" }>;
function isPoint(value: unknown): value is ChartPoint {
  return isObject(value) && typeof value.x === "string" && (value.y === null || (typeof value.y === "number" && Number.isFinite(value.y))) && (value.label === undefined || typeof value.label === "string");
}
function seriesFrom(value: unknown): ChartSeries[] {
  return asArray(value).flatMap((series) => {
    if (!isObject(series) || typeof series.key !== "string" || typeof series.name !== "string" || !Array.isArray(series.points)) return [];
    return [{ key: series.key, name: series.name, points: series.points.filter(isPoint) }];
  });
}

export function ChartBlock({ block, pointer }: { block: ChartBlockType; pointer: string }) {
  const value = useBinding(`${pointer}/series`, block.series);
  if (value.status !== "ready") return <DataState value={value} />;
  const series = seriesFrom(value.value);
  if (!series.some((entry) => entry.points.length)) return <NoItems />;
  return <ChartReady block={block} pointer={pointer} series={series} />;
}

function ChartReady({ block, pointer, series }: { block: ChartBlockType; pointer: string; series: ChartSeries[] }) {
  const data = useWindowData();
  const graph = useRef<HTMLDivElement>(null);
  const gradient = `ks-chart-gradient-${useId().replaceAll(":", "")}`;
  const [width, setWidth] = useState(320);
  const [selected, setSelected] = useState(0);
  const labels = [...new Set(series.flatMap((entry) => entry.points.map((point) => point.x)))];
  const current = Math.min(selected, labels.length - 1);
  const points = series.map((entry) => entry.points.find((point) => point.x === labels[current]));
  const numbers = series.flatMap((entry) => entry.points.flatMap((point) => point.y === null ? [] : [point.y]));
  let min = numbers.length ? Math.min(...numbers) : 0;
  let max = numbers.length ? Math.max(...numbers) : 1;
  if (min === max) { const margin = Math.abs(min) * 0.1 || 1; min -= margin; max += margin; }
  const xAt = (index: number) => labels.length === 1 ? 500 : index * 1000 / (labels.length - 1);
  const yAt = (value: number) => 10 + (max - value) / (max - min) * 140;
  const baseline = Math.max(10, Math.min(150, yAt(0)));
  const maxSteps = Math.max(1, Math.floor((width - 64) / 64));
  const labelStep = Math.max(1, Math.ceil((labels.length - 1) / maxSteps));

  useEffect(() => {
    const element = graph.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth || element.getBoundingClientRect().width || 320);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const select = (index: number) => {
    if (!block.on_select) return;
    const atTime = series.map((entry) => entry.points.find((point) => point.x === labels[index]));
    const nonNull = atTime.findIndex((point) => point && point.y !== null);
    const chosen = nonNull < 0 ? atTime.findIndex(Boolean) : nonNull;
    const point = atTime[chosen];
    if (point) void data.act(`${pointer}/on_select`, point.x, { series: series[chosen].key, x: point.x, y: point.y, ...(point.label === undefined ? {} : { label: point.label }) } as JsonValue);
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") { if (block.on_select) { event.preventDefault(); select(current); } return; }
    let next = current;
    if (event.key === "ArrowRight") next++;
    else if (event.key === "ArrowLeft") next--;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = labels.length - 1;
    else return;
    event.preventDefault();
    setSelected(Math.max(0, Math.min(labels.length - 1, next)));
  };
  const pointerIndex = (event: { currentTarget: HTMLDivElement; clientX: number }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return current;
    return Math.max(0, Math.min(labels.length - 1, Math.round((event.clientX - rect.left) / rect.width * (labels.length - 1))));
  };
  const valueText = (point: ChartPoint | undefined) => point?.y === null || point === undefined ? "없음" : `${point.y}${block.y_unit ?? ""}`;
  const accessibleValue = (point: ChartPoint | undefined) => [valueText(point), point?.label].filter(Boolean).join(" ");
  return <div className={`ks-chart is-${block.height ?? "medium"}`}>
    <div className="ks-chart-frame">
      <div className="ks-chart-readout">
        <span className="ks-chart-readout-x">{labels[current]}</span>
        <span className="ks-chart-readout-values">{series.map((entry, index) => <span key={entry.key}>
          {series.length > 1 && <span className="ks-chart-readout-label">{entry.name} </span>}
          <strong>{valueText(points[index])}</strong>{points[index]?.label && <span className="ks-chart-readout-label"> {points[index]?.label}</span>}
        </span>)}</span>
      </div>
      <div className="ks-chart-body">
        <div className="ks-chart-y-axis" aria-hidden="true"><span>{Number(max.toFixed(2))}</span><span>{Number(((max + min) / 2).toFixed(2))}</span><span>{Number(min.toFixed(2))}</span></div>
        <div ref={graph} className="ks-chart-graph" role="slider" tabIndex={0} aria-label="차트 시점"
          aria-valuemin={0} aria-valuemax={labels.length - 1} aria-valuenow={current}
          aria-valuetext={`${labels[current]} ${series.map((entry, index) => `${entry.name} ${accessibleValue(points[index])}`).join(", ")}`}
          onKeyDown={keyDown} onPointerMove={(event) => setSelected(pointerIndex(event))}
          onPointerLeave={() => { if (document.activeElement !== graph.current) setSelected(0); }}
          onClick={(event) => { const index = pointerIndex(event); setSelected(index); select(index); }}>
          <svg viewBox="0 0 1000 160" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--ks-color-accent)" stopOpacity=".22" /><stop offset="100%" stopColor="var(--ks-color-accent)" stopOpacity="0" /></linearGradient></defs>
            {[10, 80, 150].map((y) => <line key={y} className="ks-chart-grid" x1="0" x2="1000" y1={y} y2={y} vectorEffect="non-scaling-stroke" />)}
            {series.map((entry, seriesIndex) => {
              const ordered = labels.map((label) => entry.points.find((point) => point.x === label));
              const segments: Array<Array<{ x: number; y: number }>> = [];
              ordered.forEach((point, index) => {
                if (!point || point.y === null) { if (segments.at(-1)?.length) segments.push([]); return; }
                if (!segments.length) segments.push([]);
                segments.at(-1)!.push({ x: xAt(index), y: yAt(point.y) });
              });
              if (block.kind === "bar") return <g key={entry.key} className={`ks-chart-series is-series-${seriesIndex % 4}`}>
                {ordered.map((point, index) => point && point.y !== null ? <rect key={index} className={`ks-chart-bar${index === current ? " is-active" : ""}`} x={xAt(index) - Math.min(20, 350 / labels.length) + seriesIndex * Math.min(40, 700 / labels.length) / series.length} y={Math.min(yAt(point.y), baseline)} width={Math.min(40, 700 / labels.length) / series.length} height={Math.max(1, Math.abs(yAt(point.y) - baseline))} /> : null)}
              </g>;
              return <g key={entry.key} className={`ks-chart-series is-series-${seriesIndex % 4}`}>
                {segments.filter((segment) => segment.length).map((segment, index) => {
                  const line = segment.map((point, n) => `${n ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
                  return <g key={index}>{block.kind === "area" && segment.length > 1 && <path className="ks-chart-area" d={`${line} L ${segment.at(-1)!.x} 150 L ${segment[0].x} 150 Z`} fill={`url(#${gradient})`} />}<path className="ks-chart-line" d={line} vectorEffect="non-scaling-stroke" />{segment.length === 1 && <circle className="ks-chart-dot" cx={segment[0].x} cy={segment[0].y} r="4" vectorEffect="non-scaling-stroke" />}</g>;
                })}
              </g>;
            })}
            <line className="ks-chart-guide" x1={xAt(current)} x2={xAt(current)} y1="10" y2="150" vectorEffect="non-scaling-stroke" />
            {points.map((point, index) => point && point.y !== null ? <circle key={series[index].key} className="ks-chart-dot" cx={xAt(current)} cy={yAt(point.y)} r="4" vectorEffect="non-scaling-stroke" /> : null)}
          </svg>
          <div className="ks-chart-x-axis" aria-hidden="true">{labels.map((label, index) => index % labelStep === 0 ? <span key={`${label}-${index}`} style={{ left: `${xAt(index) / 10}%`, transform: index === 0 ? "translateX(0)" : index === labels.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>{label}</span> : null)}</div>
        </div>
      </div>
      <table className="ks-chart-accessible"><caption>차트 데이터</caption><thead><tr><th>시점</th>{series.map((entry) => <th key={entry.key}>{entry.name}</th>)}</tr></thead><tbody>{labels.map((label) => <tr key={label}><th>{label}</th>{series.map((entry) => <td key={entry.key}>{accessibleValue(entry.points.find((point) => point.x === label))}</td>)}</tr>)}</tbody></table>
    </div>
  </div>;
}
