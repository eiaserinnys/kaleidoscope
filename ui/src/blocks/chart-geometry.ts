import { validColor } from "../components/badge";
import type { Block, ChartPoint, ChartSeries, NumberFormat } from "../contract/contract";

export type ChartKind = Extract<Block, { type: "chart" }>["kind"];
export type PlotPoint = Omit<ChartPoint, "y"> & { y: number | null };
export type PlotSeries = Omit<ChartSeries, "points"> & { points: PlotPoint[] };
export type NumberFormatter = (value: number) => string;
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
    color: string;
    candles: Array<{ index: number; tone: string; x: number; highY: number; lowY: number; openY: number; closeY: number; width: number; title: string }>;
    bars: Array<{ index: number; x: number; y: number; width: number; height: number; title?: string }>;
    lines: Array<{ key: number; path: string; area: string | null }>;
    ordered: Array<PlotPoint | undefined>;
  }>;
  isolatedDots: Array<{ key: string; index: number; left: string; top: string; color: string }>;
  rows: Array<{ label: string; values: string[]; total?: string }>;
  axes: Array<{ label: string; index: number; left: string; transform: string }>;
};

/** 블록이 정한 수 형식으로 수를 글로 만든다. 형식이 없으면 이전과 같은 글을 쓴다. */
export function createNumberFormatter(format: NumberFormat | null | undefined, kind: ChartKind): NumberFormatter {
  if (format) {
    const options: Intl.NumberFormatOptions = {};
    if (format.notation === "compact") options.notation = "compact";
    if (format.style === "currency") {
      options.style = "currency";
      options.currency = format.currency ?? "";
      options.currencyDisplay = "narrowSymbol";
    } else if (format.style === "percent") {
      options.style = "percent";
    }
    if (format.maximum_fraction_digits != null) options.maximumFractionDigits = format.maximum_fraction_digits;
    const formatter = new Intl.NumberFormat(undefined, options);
    return (value) => formatter.format(value);
  }
  if (kind === "candlestick") {
    const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
    return (value) => formatter.format(value);
  }
  return (value) => String(Number(value.toFixed(2)));
}

export function buildChartGeometry(
  series: PlotSeries[],
  kind: ChartKind,
  width: number,
  yUnit?: string,
  options: { stacked?: boolean; numberText?: NumberFormatter } = {},
): ChartGeometry {
  const stackedBars = kind === "bar" && Boolean(options.stacked);
  const numberText = options.numberText ?? createNumberFormatter(null, kind);
  const formatValue = (value: number) => `${numberText(value)}${yUnit ?? ""}`;
  const labels = [...new Set(series.flatMap((entry) => entry.points.map((point) => point.x)))];
  const bandWidth = 1000 / Math.max(labels.length, 1);
  const groupStart = (index: number) => index * bandWidth + bandWidth * 0.1;
  const groupWidth = bandWidth * 0.8;
  const orderedSeries = series.map((entry) => labels.map((label) => entry.points.find((point) => point.x === label)));
  let min: number;
  let max: number;
  if (stackedBars) {
    let positiveSum = 0;
    let negativeSum = 0;
    labels.forEach((_, index) => {
      let positive = 0;
      let negative = 0;
      orderedSeries.forEach((ordered) => {
        const y = ordered[index]?.y;
        if (y == null || !Number.isFinite(y)) return;
        if (y > 0) positive += y; else negative += y;
      });
      positiveSum = Math.max(positiveSum, positive);
      negativeSum = Math.min(negativeSum, negative);
    });
    min = negativeSum;
    max = positiveSum;
  } else {
    const numbers = series.flatMap((entry) => entry.points.flatMap((point) => kind === "candlestick" ? [point.open, point.high, point.low, point.close].filter((v): v is number => v !== undefined) : point.y === null ? [] : [point.y]));
    min = numbers.length ? Math.min(...numbers) : 0;
    max = numbers.length ? Math.max(...numbers) : 1;
    if (kind === "bar") { min = Math.min(0, min); max = Math.max(0, max); }
  }
  if (min === max) { const margin = Math.abs(min) * 0.1 || 1; min -= margin; max += margin; }
  const xAt = (index: number) => kind === "bar" ? (index + 0.5) * bandWidth : labels.length === 1 ? 500 : index * 1000 / (labels.length - 1);
  const yAt = (value: number) => 10 + (max - value) / (max - min) * 140;
  const baseline = kind === "bar" ? yAt(0) : Math.max(10, Math.min(150, yAt(0)));
  const labelWidth = Math.max(64, ...labels.map((label) => label.length * 8));
  const maxSteps = Math.max(1, Math.floor((width - 64) / labelWidth));
  const labelStep = Math.max(1, Math.ceil((labels.length - 1) / maxSteps));
  const axisStep = labels.length > 8 ? Math.max(labelStep, Math.ceil((labels.length - 1) / 6)) : labelStep;
  const stackedOffsets = labels.map(() => ({ positive: 0, negative: 0 }));
  const seriesGeometry = series.map((entry, seriesIndex) => {
    const ordered = orderedSeries[seriesIndex];
    const color = validColor(entry.color) ? entry.color : `var(--ks-color-series-${(seriesIndex % 8) + 1})`;
    const candles = kind === "candlestick" ? ordered.flatMap((point, index) => {
      if (!point || point.open === undefined || point.high === undefined || point.low === undefined || point.close === undefined) return [];
      return [{ index, tone: point.close >= point.open ? "up" : "down", x: xAt(index), highY: yAt(point.high), lowY: yAt(point.low), openY: yAt(point.open), closeY: yAt(point.close), width: Math.max(4, Math.min(16, 1000 / Math.max(labels.length, 1) * .58)), title: point.label ?? `${point.x} 시가 ${point.open} / 고가 ${point.high} / 저가 ${point.low} / 종가 ${point.close}` }];
    }) : [];
    const bars: ChartGeometry["series"][number]["bars"] = kind !== "bar" ? [] : ordered.flatMap((point, index) => {
      if (!point || point.y === null || !Number.isFinite(point.y)) return [];
      if (stackedBars) {
        if (point.y === 0) return [];
        const offsets = stackedOffsets[index];
        if (point.y > 0) {
          const from = offsets.positive;
          offsets.positive += point.y;
          return [{ index, x: groupStart(index), y: Math.min(yAt(from), yAt(offsets.positive)), width: groupWidth, height: Math.max(1, Math.abs(yAt(offsets.positive) - yAt(from))), title: `${entry.name} ${formatValue(point.y)}` }];
        }
        const from = offsets.negative;
        offsets.negative += point.y;
        return [{ index, x: groupStart(index), y: Math.min(yAt(from), yAt(offsets.negative)), width: groupWidth, height: Math.max(1, Math.abs(yAt(offsets.negative) - yAt(from))), title: `${entry.name} ${formatValue(point.y)}` }];
      }
      const slot = groupWidth / series.length;
      return [{ index, x: groupStart(index) + seriesIndex * slot, y: Math.min(yAt(point.y), baseline), width: slot, height: Math.max(1, Math.abs(yAt(point.y) - baseline)) }];
    });
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
    return { key: entry.key, className: `ks-chart-series is-series-${seriesIndex % 4}`, color, candles, bars, lines, ordered };
  });
  const isolatedDots = kind !== "bar" && kind !== "candlestick" ? seriesGeometry.flatMap((entry) => entry.ordered.flatMap((point, index) => point && point.y !== null && entry.ordered[index - 1]?.y == null && entry.ordered[index + 1]?.y == null ? [{ key: `${entry.key}-${index}`, index, left: `${xAt(index) / 10}%`, top: `${yAt(point.y) / 160 * 100}%`, color: entry.color }] : [])) : [];
  const rows = labels.map((label) => {
    const values = series.map((entry) => {
      const point = entry.points.find((item) => item.x === label);
      const value = point?.y == null ? "없음" : formatValue(point.y);
      return [value, point?.label].filter(Boolean).join(" ");
    });
    if (!stackedBars) return { label, values };
    let total = 0;
    let has = false;
    series.forEach((entry) => {
      const y = entry.points.find((item) => item.x === label)?.y;
      if (y != null && Number.isFinite(y)) { total += y; has = true; }
    });
    return { label, values, total: has ? formatValue(total) : "없음" };
  });
  const bandCenterPx = (index: number) => (index + 0.5) * width / Math.max(labels.length, 1);
  const axes = labels.flatMap((label, index) => {
    const shown = index === labels.length - 1 || (index % axisStep === 0 && (labels.length <= 8 || labels.length - 1 - index >= Math.max(1, Math.floor(axisStep * .6))));
    if (!shown) return [];
    if (kind === "bar") {
      const halfWidth = label.length * 8;
      if (index === 0 && halfWidth > bandCenterPx(index)) return [{ label, index, left: "0%", transform: "translateX(0)" }];
      if (index === labels.length - 1 && halfWidth > width - bandCenterPx(index)) return [{ label, index, left: "100%", transform: "translateX(-100%)" }];
      return [{ label, index, left: `${xAt(index) / 10}%`, transform: "translateX(-50%)" }];
    }
    return [{ label, index, left: `${xAt(index) / 10}%`, transform: index === 0 ? "translateX(0)" : index === labels.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }];
  });
  return { labels, min, max, baseline, axisStep, xAt, yAt, series: seriesGeometry, isolatedDots, rows, axes };
}
