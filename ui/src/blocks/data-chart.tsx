import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Block } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { DataState } from "../components/data-state";
import { useBinding, useWindowData } from "../data/window-data";
import { asArray, isObject, NoItems } from "./data-view-common";
import { buildChartGeometry, type PlotPoint, type PlotSeries } from "./chart-geometry";

type ChartBlockType = Extract<Block, { type: "chart" }>;
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
function seriesFrom(value: unknown, candle: boolean): PlotSeries[] {
  return asArray(value).flatMap((series) => {
    if (!isObject(series) || typeof series.key !== "string" || typeof series.name !== "string" || !Array.isArray(series.points)) return [];
    const points: PlotPoint[] = series.points.flatMap((point) => {
      if (!isObject(point) || typeof point.x !== "string" || (point.label !== undefined && typeof point.label !== "string")) return [];
      const open = finite(point.open), high = finite(point.high), low = finite(point.low), close = finite(point.close);
      return [{ x: point.x, y: finite(point.y) ?? (candle ? close : null), ...(open === null ? {} : { open }), ...(high === null ? {} : { high }), ...(low === null ? {} : { low }), ...(close === null ? {} : { close }), ...(typeof point.label === "string" ? { label: point.label } : {}) }];
    });
    return [{ key: series.key, name: series.name, points }];
  });
}

export function ChartBlock({ block, pointer }: { block: ChartBlockType; pointer: string }) {
  const value = useBinding(`${pointer}/series`, block.series);
  const rawSeries = value.status === "ready" ? value.value : null;
  const series = useMemo(() => rawSeries === null ? [] : seriesFrom(rawSeries, block.kind === "candlestick"), [rawSeries, block.kind]);
  if (value.status !== "ready") return <DataState value={value} />;
  if (!series.some((entry) => entry.points.length)) return <NoItems />;
  return <ChartReady block={block} pointer={pointer} series={series} />;
}

function ChartReady({ block, pointer, series }: { block: ChartBlockType; pointer: string; series: PlotSeries[] }) {
  const data = useWindowData();
  const graph = useRef<HTMLDivElement>(null);
  const gradient = `ks-chart-gradient-${useId().replaceAll(":", "")}`;
  const [width, setWidth] = useState(320);
  const geometry = useMemo(() => buildChartGeometry(series, block.kind, width, block.y_unit), [series, width, block.kind, block.y_unit]);
  const { labels } = geometry;
  const [selected, setSelected] = useState(labels.length - 1);
  const current = Math.min(selected, labels.length - 1);
  const points = useMemo(() => series.map((entry) => entry.points.find((point) => point.x === labels[current])), [series, labels, current]);
  const { min, max } = geometry;
  const numberText = (n: number) => block.kind === "candlestick" ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n) : String(Number(n.toFixed(2)));

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
    if (point) void data.act(`${pointer}/on_select`, point.x, { series: series[chosen].key, x: point.x, y: point.y, ...(block.kind === "candlestick" ? { open: point.open ?? null, high: point.high ?? null, low: point.low ?? null, close: point.close ?? null, label: point.label ?? null } : point.label === undefined ? {} : { label: point.label }) } as JsonValue);
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
  const valueText = (point: PlotPoint | undefined) => point?.y == null ? "없음" : `${numberText(point.y)}${block.y_unit ?? ""}`;
  const accessibleValue = (point: PlotPoint | undefined) => [valueText(point), point?.label].filter(Boolean).join(" ");
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
        <div className="ks-chart-y-axis" aria-hidden="true"><span>{numberText(max)}</span><span>{numberText((max + min) / 2)}</span><span>{numberText(min)}</span></div>
        <div ref={graph} className="ks-chart-graph" role="slider" tabIndex={0} aria-label="차트 시점"
          aria-valuemin={0} aria-valuemax={labels.length - 1} aria-valuenow={current}
          aria-valuetext={`${labels[current]} ${series.map((entry, index) => `${entry.name} ${accessibleValue(points[index])}`).join(", ")}`}
          onKeyDown={keyDown} onPointerMove={(event) => setSelected(pointerIndex(event))}
          onPointerLeave={() => { if (document.activeElement !== graph.current) setSelected(labels.length - 1); }}
          onClick={(event) => { const index = pointerIndex(event); setSelected(index); select(index); }}>
          <div className="ks-chart-plot" aria-hidden="true">
          <svg viewBox="0 0 1000 160" preserveAspectRatio="none">
            <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--ks-color-accent)" stopOpacity=".22" /><stop offset="100%" stopColor="var(--ks-color-accent)" stopOpacity="0" /></linearGradient></defs>
            {[10, 80, 150].map((y) => <line key={y} className="ks-chart-grid" x1="0" x2="1000" y1={y} y2={y} vectorEffect="non-scaling-stroke" />)}
            {geometry.series.map((entry) => <g key={entry.key} className={entry.className}>
              {block.kind === "candlestick" ? entry.candles.map((candle) => <g key={candle.index}><title>{candle.title}</title><line className={`ks-chart-wick ${candle.tone}`} x1={candle.x} x2={candle.x} y1={candle.highY} y2={candle.lowY} vectorEffect="non-scaling-stroke" /><rect className={`ks-chart-candle ${candle.tone}`} x={candle.x - candle.width / 2} y={Math.min(candle.openY, candle.closeY)} width={candle.width} height={Math.max(2, Math.abs(candle.closeY - candle.openY))} rx={1.5} /></g>) : null}
              {block.kind === "bar" ? entry.bars.map((bar) => <rect key={bar.index} className={`ks-chart-bar${bar.index === current ? " is-active" : ""}`} x={bar.x} y={bar.y} width={bar.width} height={bar.height} />) : null}
              {block.kind !== "bar" && block.kind !== "candlestick" ? entry.lines.map((line) => <g key={line.key}>{line.area && <path className="ks-chart-area" d={line.area} fill={`url(#${gradient})`} />}<path className="ks-chart-line" d={line.path} vectorEffect="non-scaling-stroke" /></g>) : null}
            </g>)}
            <line className="ks-chart-guide" x1={geometry.xAt(current)} x2={geometry.xAt(current)} y1="10" y2="150" vectorEffect="non-scaling-stroke" />
          </svg>
          {geometry.isolatedDots.filter((dot) => dot.index !== current).map((dot) => <span key={dot.key} className="ks-chart-dot" style={{ left: dot.left, top: dot.top }} />)}
          {block.kind !== "candlestick" && points.map((point, index) => point && point.y !== null ? <span key={series[index].key} className="ks-chart-dot" style={{ left: `${geometry.xAt(current) / 10}%`, top: `${geometry.yAt(point.y) / 160 * 100}%` }} /> : null)}
          </div>
          <div className="ks-chart-x-axis" aria-hidden="true">{geometry.axes.map(({ label, index, left, transform }) => <span key={`${label}-${index}`} style={{ left, transform }}>{label}</span>)}</div>
        </div>
      </div>
      <table className="ks-chart-accessible"><caption>차트 데이터</caption><thead><tr><th>시점</th>{series.map((entry) => <th key={entry.key}>{entry.name}</th>)}</tr></thead><tbody>{geometry.rows.map((row) => <tr key={row.label}><th>{row.label}</th>{row.values.map((value, index) => <td key={series[index].key}>{value}</td>)}</tr>)}</tbody></table>
    </div>
  </div>;
}
