import { useBlockRootProps, type BlockRootProps } from "../comments/block-root";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { Block } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { DataState } from "../components/data-state";
import { useBinding, useWindowData } from "../data/window-data";
import { asArray, isObject, NoItems } from "./data-view-common";
import { buildChartGeometry, createNumberFormatter, type PlotPoint, type PlotSeries } from "./chart-geometry";

type ChartBlockType = Extract<Block, { type: "chart" }>;
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const seriesColor = (color: string) => ({ "--ks-chart-series-color": color }) as CSSProperties;
function seriesFrom(value: unknown, candle: boolean): PlotSeries[] {
  return asArray(value).flatMap((series) => {
    if (!isObject(series) || typeof series.key !== "string" || typeof series.name !== "string" || !Array.isArray(series.points)) return [];
    const points: PlotPoint[] = series.points.flatMap((point) => {
      if (!isObject(point) || typeof point.x !== "string" || (point.label !== undefined && typeof point.label !== "string")) return [];
      const open = finite(point.open), high = finite(point.high), low = finite(point.low), close = finite(point.close);
      return [{ x: point.x, y: finite(point.y) ?? (candle ? close : null), ...(open === null ? {} : { open }), ...(high === null ? {} : { high }), ...(low === null ? {} : { low }), ...(close === null ? {} : { close }), ...(typeof point.label === "string" ? { label: point.label } : {}) }];
    });
    return [{ key: series.key, name: series.name, points, ...(typeof series.color === "string" ? { color: series.color } : {}) }];
  });
}

export function ChartBlock({ block, pointer }: { block: ChartBlockType; pointer: string }) {
  const blockRoot = useBlockRootProps();
  const value = useBinding(`${pointer}/series`, block.series);
  const rawSeries = value.status === "ready" ? value.value : null;
  const series = useMemo(() => rawSeries === null ? [] : seriesFrom(rawSeries, block.kind === "candlestick"), [rawSeries, block.kind]);
  if (value.status !== "ready") return <DataState rootProps={blockRoot} value={value} loading={<ChartLoading block={block} rootProps={blockRoot} />} />;
  if (!series.some((entry) => entry.points.length)) return <NoItems rootProps={blockRoot} />;
  return <ChartReady block={block} pointer={pointer} series={series} />;
}

// 받는 중에도 다 받은 차트와 같은 틀과 높이를 그린다. 읽기 줄과 몸통 자리를 그대로 잡아 두어 아래 블록이 밀리지 않는다.
function ChartLoading({ block, rootProps }: { block: ChartBlockType; rootProps: BlockRootProps }) {
  return <div {...rootProps} className={`ks-chart is-${block.height ?? "medium"} ks-chart-loading`} role="status" aria-label="불러오는 중">
    <div className="ks-chart-frame">
      <div className="ks-chart-readout"><span className="ks-chart-loading-bar" /></div>
      <div className="ks-chart-body"><span className="ks-chart-loading-plot" /></div>
    </div>
  </div>;
}

function ChartReady({ block, pointer, series }: { block: ChartBlockType; pointer: string; series: PlotSeries[] }) {
  const blockRoot = useBlockRootProps();
  const data = useWindowData();
  const graph = useRef<HTMLDivElement>(null);
  const gradient = `ks-chart-gradient-${useId().replaceAll(":", "")}`;
  const [width, setWidth] = useState(320);
  const stacked = block.kind === "bar" && Boolean(block.stacked);
  const numberText = useMemo(() => createNumberFormatter(block.number_format, block.kind), [block.number_format, block.kind]);
  const axisText = useMemo(() => createNumberFormatter(block.number_format, block.kind, true), [block.number_format, block.kind]);
  const geometry = useMemo(() => buildChartGeometry(series, block.kind, width, block.y_unit, { stacked, numberText }), [series, width, block.kind, block.y_unit, stacked, numberText]);
  const { labels } = geometry;
  const selectedValue = useBinding(`${pointer}/selected`, block.selected ?? null);
  const boundSelected = selectedValue.status === "ready" && typeof selectedValue.value === "string" ? selectedValue.value : null;
  const [clicked, setClicked] = useState<string | null>(null);
  useEffect(() => {
    if (clicked !== null && !labels.includes(clicked)) setClicked(null);
  }, [clicked, labels]);
  const resting = useMemo(() => {
    const selected = block.selected != null ? boundSelected : clicked;
    if (selected !== null) {
      const chosen = labels.indexOf(selected);
      if (chosen >= 0) return chosen;
    }
    const lastWithData = labels.reduce((found, label, index) => series.some((entry) => entry.points.some((point) => point.x === label && point.y !== null)) ? index : found, -1);
    return lastWithData >= 0 ? lastWithData : Math.max(0, labels.length - 1);
  }, [block.selected, boundSelected, clicked, labels, series]);
  const [regional, setRegional] = useState<number | null>(null);
  const current = Math.max(0, Math.min(labels.length - 1, regional ?? resting));
  const points = useMemo(() => series.map((entry) => entry.points.find((point) => point.x === labels[current])), [series, labels, current]);
  // 그린 값이 하나도 없는 계열은 읽기 줄, 범례, 접근성 표에서 뺀다. 색은 원래 index 그대로라 남은 계열의 색이 밀리지 않는다.
  const { min, max, drawn } = geometry;
  const showMarker = block.selected == null || boundSelected !== null || regional !== null;
  const band = block.kind === "bar" && showMarker ? { x: current * 1000 / Math.max(labels.length, 1), width: 1000 / Math.max(labels.length, 1) } : null;

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
    if (block.selected == null) setClicked(labels[index]);
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
    setRegional(Math.max(0, Math.min(labels.length - 1, next)));
  };
  const pointerIndex = (event: { currentTarget: HTMLDivElement; clientX: number }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return current;
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = block.kind === "bar" ? Math.floor(ratio * labels.length) : Math.round(ratio * (labels.length - 1));
    return Math.max(0, Math.min(labels.length - 1, index));
  };
  const valueText = (point: PlotPoint | undefined) => point?.y == null ? "없음" : `${numberText(point.y)}${block.y_unit ?? ""}`;
  const accessibleValue = (point: PlotPoint | undefined) => [valueText(point), point?.label].filter(Boolean).join(" ");
  // 한 축의 눈금은 자릿수를 하나로 맞춘다. 눈금이 모두 정수일 때만 끝자리 0을 뗀다.
  const ticks = [max, (max + min) / 2, min];
  const tickText = ticks.every(Number.isInteger) ? axisText : numberText;
  return <div {...blockRoot} className={`ks-chart is-${block.height ?? "medium"}`}>
    <div className="ks-chart-frame">
      <div className="ks-chart-readout">
        <span className="ks-chart-readout-x">{labels[current]}</span>
        {stacked ? <span className="ks-chart-readout-values"><span><strong>{geometry.rows[current]?.total ?? "없음"}</strong></span></span> : <span className="ks-chart-readout-values">{drawn.map((index) => <span key={series[index].key}>
          {drawn.length > 1 && <span className="ks-list-color ks-chart-readout-dot" style={seriesColor(geometry.series[index].color)} aria-hidden="true" />}
          {drawn.length > 1 && <span className="ks-chart-readout-label">{series[index].name} </span>}
          <strong>{valueText(points[index])}</strong>{points[index]?.label && <span className="ks-chart-readout-label"> {points[index]?.label}</span>}
        </span>)}</span>}
      </div>
      <div className="ks-chart-body">
        <div className="ks-chart-y-axis" aria-hidden="true">{ticks.map((value, index) => <span key={index} style={{ top: `${geometry.yAt(value) / 160 * 100}%` }}>{tickText(value)}</span>)}</div>
        <div ref={graph} className="ks-chart-graph" role="slider" tabIndex={0} aria-label="차트 시점"
          aria-valuemin={0} aria-valuemax={labels.length - 1} aria-valuenow={current}
          aria-valuetext={`${labels[current]} ${drawn.map((index) => `${series[index].name} ${accessibleValue(points[index])}`).join(", ")}`}
          onKeyDown={keyDown} onPointerMove={(event) => setRegional(pointerIndex(event))}
          onPointerLeave={() => setRegional(null)}
          onBlur={() => setRegional(null)}
          onClick={(event) => { const index = pointerIndex(event); setRegional(index); select(index); }}>
          <div className="ks-chart-plot" aria-hidden="true">
          <svg viewBox="0 0 1000 160" preserveAspectRatio="none">
            {[10, 80, 150].map((y) => <line key={y} className="ks-chart-grid" x1="0" x2="1000" y1={y} y2={y} vectorEffect="non-scaling-stroke" />)}
            {band && <rect className="ks-chart-band" x={band.x} y={10} width={band.width} height={140} />}
            {geometry.series.map((entry, seriesIndex) => <g key={entry.key} className={entry.className} style={seriesColor(entry.color)}>
              {block.kind === "area" ? <defs><linearGradient id={`${gradient}-${seriesIndex}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--ks-chart-series-color)" stopOpacity=".22" /><stop offset="100%" stopColor="var(--ks-chart-series-color)" stopOpacity="0" /></linearGradient></defs> : null}
              {block.kind === "candlestick" ? entry.candles.map((candle) => <g key={candle.index}><title>{candle.title}</title><line className={`ks-chart-wick ${candle.tone}`} x1={candle.x} x2={candle.x} y1={candle.highY} y2={candle.lowY} vectorEffect="non-scaling-stroke" /><rect className={`ks-chart-candle ${candle.tone}`} x={candle.x - candle.width / 2} y={Math.min(candle.openY, candle.closeY)} width={candle.width} height={Math.max(2, Math.abs(candle.closeY - candle.openY))} rx={1.5} /></g>) : null}
              {block.kind === "bar" ? entry.bars.map((bar) => bar.title ? <g key={bar.index}><title>{bar.title}</title><rect className="ks-chart-bar" x={bar.x} y={bar.y} width={bar.width} height={bar.height} /></g> : <rect key={bar.index} className="ks-chart-bar" x={bar.x} y={bar.y} width={bar.width} height={bar.height} />) : null}
              {block.kind !== "bar" && block.kind !== "candlestick" ? entry.lines.map((line) => <g key={line.key}>{line.area && <path className="ks-chart-area" d={line.area} fill={`url(#${gradient}-${seriesIndex})`} />}<path className="ks-chart-line" d={line.path} vectorEffect="non-scaling-stroke" /></g>) : null}
            </g>)}
            {block.kind !== "bar" && showMarker && <line className="ks-chart-guide" x1={geometry.xAt(current)} x2={geometry.xAt(current)} y1="10" y2="150" vectorEffect="non-scaling-stroke" />}
          </svg>
          {geometry.isolatedDots.filter((dot) => dot.index !== current).map((dot) => <span key={dot.key} className="ks-chart-dot" style={{ left: dot.left, top: dot.top, ...seriesColor(dot.color) }} />)}
          {block.kind !== "bar" && block.kind !== "candlestick" && points.map((point, index) => point && point.y !== null ? <span key={series[index].key} className="ks-chart-dot" style={{ left: `${geometry.xAt(current) / 10}%`, top: `${geometry.yAt(point.y) / 160 * 100}%`, ...seriesColor(geometry.series[index].color) }} /> : null)}
          </div>
          <div className="ks-chart-x-axis" aria-hidden="true">{geometry.axes.map(({ label, index, left, transform }) => <span key={`${label}-${index}`} style={{ left, transform }}>{label}</span>)}</div>
        </div>
      </div>
      {drawn.length > 1 && <div className="ks-chart-legend">{drawn.map((index) => <span key={series[index].key} className="ks-chart-legend-item" style={seriesColor(geometry.series[index].color)}>
          <span className="ks-list-color" aria-hidden="true" />
          <span className="ks-chart-legend-name">{series[index].name}</span>
        </span>)}</div>}
      <table className="ks-accessible-hidden"><caption>차트 데이터</caption><thead><tr><th>시점</th>{drawn.map((index) => <th key={series[index].key}>{series[index].name}</th>)}{stacked && <th>합계</th>}</tr></thead><tbody>{geometry.rows.map((row) => <tr key={row.label}><th>{row.label}</th>{drawn.map((index) => <td key={series[index].key}>{row.values[index]}</td>)}{stacked && <td>{row.total}</td>}</tr>)}</tbody></table>
    </div>
  </div>;
}
