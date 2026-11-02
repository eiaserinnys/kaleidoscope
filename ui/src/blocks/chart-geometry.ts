import type { Block, ChartPoint, ChartSeries } from "../contract/contract";

export type ChartKind = Extract<Block, { type: "chart" }>["kind"];
export type PlotPoint = Omit<ChartPoint, "y"> & { y: number | null };
export type PlotSeries = Omit<ChartSeries, "points"> & { points: PlotPoint[] };
export type ChartGeometry = {
  labels: string[];
  min: number;
  max: number;
  baseline: number;
  axisStep: number;
  xAt: (index: number) => number;
  yAt: (value: number) => number;
  series: Array<{
    key: string;
    className: string;
    candles: Array<{ index: number; tone: string; x: number; highY: number; lowY: number; openY: number; closeY: number; width: number; title: string }>;
    bars: Array<{ index: number; x: number; y: number; width: number; height: number }>;
    lines: Array<{ key: number; path: string; area: string | null }>;
    ordered: Array<PlotPoint | undefined>;
  }>;
  isolatedDots: Array<{ key: string; index: number; left: string; top: string }>;
  rows: Array<{ label: string; values: string[] }>;
  axes: Array<{ label: string; index: number; left: string; transform: string }>;
};

export function buildChartGeometry(series: PlotSeries[], kind: ChartKind, width: number, yUnit?: string): ChartGeometry {
  const labels = [...new Set(series.flatMap((entry) => entry.points.map((point) => point.x)))];
  const numbers = series.flatMap((entry) => entry.points.flatMap((point) => kind === "candlestick" ? [point.open, point.high, point.low, point.close].filter((v): v is number => v !== undefined) : point.y === null ? [] : [point.y]));
  let min = numbers.length ? Math.min(...numbers) : 0;
  let max = numbers.length ? Math.max(...numbers) : 1;
  if (kind === "bar") { min = Math.min(0, min); max = Math.max(0, max); }
  if (min === max) { const margin = Math.abs(min) * 0.1 || 1; min -= margin; max += margin; }
  const xAt = (index: number) => labels.length === 1 ? 500 : index * 1000 / (labels.length - 1);
  const yAt = (value: number) => 10 + (max - value) / (max - min) * 140;
  const baseline = kind === "bar" ? yAt(0) : Math.max(10, Math.min(150, yAt(0)));
  const labelWidth = Math.max(64, ...labels.map((label) => label.length * 8));
  const maxSteps = Math.max(1, Math.floor((width - 64) / labelWidth));
  const labelStep = Math.max(1, Math.ceil((labels.length - 1) / maxSteps));
  const axisStep = labels.length > 8 ? Math.max(labelStep, Math.ceil((labels.length - 1) / 6)) : labelStep;
  const numberText = (n: number) => kind === "candlestick" ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n) : String(Number(n.toFixed(2)));
  const seriesGeometry = series.map((entry, seriesIndex) => {
    const ordered = labels.map((label) => entry.points.find((point) => point.x === label));
    const candles = kind === "candlestick" ? ordered.flatMap((point, index) => {
      if (!point || point.open === undefined || point.high === undefined || point.low === undefined || point.close === undefined) return [];
      return [{ index, tone: point.close >= point.open ? "up" : "down", x: xAt(index), highY: yAt(point.high), lowY: yAt(point.low), openY: yAt(point.open), closeY: yAt(point.close), width: Math.max(4, Math.min(16, 1000 / Math.max(labels.length, 1) * .58)), title: point.label ?? `${point.x} 시가 ${point.open} / 고가 ${point.high} / 저가 ${point.low} / 종가 ${point.close}` }];
    }) : [];
    const bars = kind === "bar" ? ordered.flatMap((point, index) => point && point.y !== null ? [{ index, x: xAt(index) - Math.min(20, 350 / labels.length) + seriesIndex * Math.min(40, 700 / labels.length) / series.length, y: Math.min(yAt(point.y), baseline), width: Math.min(40, 700 / labels.length) / series.length, height: Math.max(1, Math.abs(yAt(point.y) - baseline)) }] : []) : [];
    const segments: Array<Array<{ x: number; y: number }>> = [];
    if (kind !== "bar" && kind !== "candlestick") ordered.forEach((point, index) => {
      if (!point || point.y === null) { if (segments.at(-1)?.length) segments.push([]); return; }
      if (!segments.length) segments.push([]);
      segments.at(-1)!.push({ x: xAt(index), y: yAt(point.y) });
    });
    const lines = segments.filter((segment) => segment.length).map((segment, index) => {
      const path = segment.map((point, n) => `${n ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
      return { key: index, path, area: kind === "area" && segment.length > 1 ? `${path} L ${segment.at(-1)!.x} 150 L ${segment[0].x} 150 Z` : null };
    });
    return { key: entry.key, className: `ks-chart-series is-series-${seriesIndex % 4}`, candles, bars, lines, ordered };
  });
  const isolatedDots = kind !== "bar" && kind !== "candlestick" ? seriesGeometry.flatMap((entry) => entry.ordered.flatMap((point, index) => point && point.y !== null && entry.ordered[index - 1]?.y == null && entry.ordered[index + 1]?.y == null ? [{ key: `${entry.key}-${index}`, index, left: `${xAt(index) / 10}%`, top: `${yAt(point.y) / 160 * 100}%` }] : [])) : [];
  const rows = labels.map((label) => ({ label, values: series.map((entry) => {
    const point = entry.points.find((item) => item.x === label);
    const value = point?.y == null ? "없음" : `${numberText(point.y)}${yUnit ?? ""}`;
    return [value, point?.label].filter(Boolean).join(" ");
  }) }));
  const axes = labels.flatMap((label, index) => index === labels.length - 1 || (index % axisStep === 0 && (labels.length <= 8 || labels.length - 1 - index >= Math.max(1, Math.floor(axisStep * .6)))) ? [{ label, index, left: `${xAt(index) / 10}%`, transform: index === 0 ? "translateX(0)" : index === labels.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }] : []);
  return { labels, min, max, baseline, axisStep, xAt, yAt, series: seriesGeometry, isolatedDots, rows, axes };
}
