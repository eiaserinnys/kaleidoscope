import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { buildChartGeometry, createNumberFormatter, type PlotSeries } from "../blocks/chart-geometry";
import { makeTestSeed, mdViewerDefinition } from "./fixtures";
import { mockVirtualLayout } from "./virtual-layout";

beforeEach(() => {
  mockVirtualLayout();
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(ui: Block, state: AppDefinition["state"] = {}) {
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 62, modules: {} }, permissions: [], state, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...state };
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  const rendered = render(<AppWindowContent store={store} windowId="viewer-window" />);
  return { calls, store, transport, ...rendered };
}

it("keeps every bar inside the plot after the axis text", async () => {
  const points = Array.from({ length: 7 }, (_, index) => ({ x: `${index + 1}월`, y: (index + 1) * 10 }));
  const { container } = setup({ type: "chart", kind: "bar", series: [{ key: "s", name: "값", points }] });
  await screen.findByRole("slider", { name: "차트 시점" });
  const bars = [...container.querySelectorAll(".ks-chart-bar")];
  const band = 1000 / points.length;
  expect(bars).toHaveLength(points.length);
  bars.forEach((bar, index) => {
    const x = Number(bar.getAttribute("x"));
    expect(x).toBeGreaterThanOrEqual(index * band + band * 0.1 - 0.001);
    expect(x + Number(bar.getAttribute("width"))).toBeLessThanOrEqual(index * band + band * 0.9 + 0.001);
  });
});

it("stacks bar series and shows the band total", async () => {
  const { container } = setup({ type: "chart", kind: "bar", stacked: true, series: [
    { key: "a", name: "모델 A", points: [{ x: "월", y: 10 }, { x: "화", y: 20 }] },
    { key: "b", name: "모델 B", points: [{ x: "월", y: 5 }, { x: "화", y: 5 }] },
  ] });
  await screen.findByRole("slider", { name: "차트 시점" });
  const bars = [...container.querySelectorAll(".ks-chart-bar")];
  expect(bars).toHaveLength(4);
  expect(container.querySelector(".ks-chart-readout")?.textContent).toContain("25");
  expect(screen.getByRole("table", { name: "차트 데이터" }).textContent).toContain("합계");
  const titles = [...container.querySelectorAll(".ks-chart-series title")].map((element) => element.textContent);
  expect(titles).toEqual(expect.arrayContaining(["모델 A 10", "모델 B 5", "모델 A 20"]));
  // 그리기는 계열 순서라, 같은 시점의 막대는 같은 자리와 폭을 쓰고 뒤 계열이 앞 계열 위에 쌓인다.
  expect(bars[2].getAttribute("x")).toBe(bars[0].getAttribute("x"));
  expect(bars[3].getAttribute("x")).toBe(bars[1].getAttribute("x"));
  expect(bars[2].getAttribute("width")).toBe(bars[0].getAttribute("width"));
  expect(Number(bars[2].getAttribute("y"))).toBeLessThan(Number(bars[0].getAttribute("y")));
});

it("rounds a bar chart's axis end up to a readable number", () => {
  const geometry = (columns: number[][], stacked = false) => buildChartGeometry(
    columns.map((points, index): PlotSeries => ({ key: `s${index}`, name: `계열 ${index}`, points: points.map((y, at) => ({ x: `시점 ${at}`, y })) })),
    "bar", 600, undefined, { stacked, numberText: (value) => String(value) });
  expect(geometry([[80000000, 40000000], [30000000, 20000000], [20000000, 10000000], [36354414, 10000000]], true))
    .toMatchObject({ min: 0, max: 200000000 });
  expect(geometry([[160000000]])).toMatchObject({ min: 0, max: 160000000 });
  expect(geometry([[18]])).toMatchObject({ min: 0, max: 20 });
});

it.each([[21, 24], [23, 24], [30, 30], [41, 50], [210000000, 240000000], [166354414, 200000000], [160000000, 160000000]])("uses a close two-digit axis for %s", (value, end) => {
  const build = (values: number[]) => buildChartGeometry([{ key: "s", name: "값", points: values.map((y, i) => ({ x: String(i), y })) }], "bar", 600);
  const positive = build([value]);
  const negative = build([-value]);
  expect(positive.max).toBe(end);
  expect(negative.min).toBe(-end);
  expect(value / positive.max).toBeGreaterThanOrEqual(0.75);
  expect(positive.max).toBeGreaterThanOrEqual(value);
  expect(Number((positive.max / 2).toPrecision(2))).toBe(positive.max / 2);
  expect(Number(positive.max.toPrecision(2))).toBe(positive.max);
});

it("closes positive and mixed area paths at zero", () => {
  const build = (values: number[]) => buildChartGeometry([{ key: "s", name: "값", points: values.map((y, i) => ({ x: String(i), y })) }], "area", 600);
  for (const values of [[10, 21], [-9, 3]]) {
    const geometry = build(values);
    expect(geometry.min).toBeLessThanOrEqual(0);
    expect(geometry.max).toBeGreaterThanOrEqual(0);
    expect(geometry.series[0].lines[0].area).toContain(`L 1000 ${geometry.yAt(0)} L 0 ${geometry.yAt(0)} Z`);
  }
  expect(build([10, 21]).min).toBe(0);
});

it("keeps an exact candidate at small and large decimal scales", () => {
  for (const value of [0.24, 2.4, 240000000]) {
    const geometry = buildChartGeometry([{ key: "s", name: "값", points: [{ x: "월", y: value }] }], "bar", 600);
    expect(geometry.max).toBe(value);
  }
});

it("keeps positive and negative bars inside a mixed-sign axis", () => {
  const geometry = (columns: number[][], stacked = false) => buildChartGeometry(
    columns.map((points, index): PlotSeries => ({ key: `s${index}`, name: `계열 ${index}`, points: points.map((y, at) => ({ x: `시점 ${at}`, y })) })),
    "bar", 600, undefined, { stacked, numberText: (value) => String(value) });
  const inside = (built: ReturnType<typeof geometry>) => built.series.flatMap((entry) => entry.bars).forEach((bar) => {
    expect(bar.y).toBeGreaterThanOrEqual(10 - 0.001);
    expect(bar.y + bar.height).toBeLessThanOrEqual(150 + 0.001);
  });
  const grouped = geometry([[-9, 1]]);
  expect(grouped).toMatchObject({ min: -10, max: 10 });
  expect(grouped.baseline).toBeCloseTo(80);
  inside(grouped);
  const stacked = geometry([[-6, 3], [-3, 2]], true);
  expect(stacked).toMatchObject({ min: -10, max: 10 });
  inside(stacked);
  const lopsided = geometry([[-1, 230]]);
  expect(lopsided).toMatchObject({ min: -250, max: 250 });
  inside(lopsided);
});

it("keeps x-axis labels apart in a nine-band bar chart inside a 360px window", () => {
  // 360px 창에서 이 차트의 그리기 영역 폭은 285px이다.
  const labels = Array.from({ length: 9 }, (_, index) => `26년 ${index + 3}월`);
  const geometry = buildChartGeometry(
    [{ key: "s", name: "값", points: labels.map((x, index) => ({ x, y: index + 1 })) }],
    "bar", 285, undefined, { numberText: (value) => String(value) });
  expect(geometry.axes.map((axis) => axis.label)).toEqual(["26년 3월", "26년 6월", "26년 11월"]);
});

it("formats the rounded bar axis with the block's notation", async () => {
  const compact = new Intl.NumberFormat(undefined, { notation: "compact" });
  const { container } = setup({ type: "chart", kind: "bar", stacked: true, number_format: { notation: "compact" }, series: [
    { key: "a", name: "계열 A", points: [{ x: "월", y: 80000000 }, { x: "화", y: 40000000 }] },
    { key: "b", name: "계열 B", points: [{ x: "월", y: 30000000 }, { x: "화", y: 20000000 }] },
    { key: "c", name: "계열 C", points: [{ x: "월", y: 20000000 }, { x: "화", y: 10000000 }] },
    { key: "d", name: "계열 D", points: [{ x: "월", y: 36354414 }, { x: "화", y: 10000000 }] },
  ] });
  await screen.findByRole("slider", { name: "차트 시점" });
  const ticks = [...container.querySelectorAll(".ks-chart-y-axis span")].map((element) => element.textContent);
  expect(ticks).toEqual([compact.format(200000000), compact.format(100000000), compact.format(0)]);
});

it("marks the current bar with a band and draws no dots or guide line", async () => {
  const { container } = setup({ type: "chart", kind: "bar", series: [
    { key: "s", name: "값", points: [{ x: "월", y: 1 }, { x: "화", y: 2 }] },
  ] });
  await screen.findByRole("slider", { name: "차트 시점" });
  expect(container.querySelector(".ks-chart-band")).toBeTruthy();
  expect(container.querySelector(".ks-chart-guide")).toBeNull();
  expect(container.querySelectorAll(".ks-chart-dot")).toHaveLength(0);
});

it("keeps the guide line and value dots on a line chart", async () => {
  const { container } = setup({ type: "chart", kind: "line", series: [
    { key: "s", name: "값", points: [{ x: "월", y: 1 }, { x: "화", y: 2 }] },
  ] });
  await screen.findByRole("slider", { name: "차트 시점" });
  expect(container.querySelector(".ks-chart-guide")).toBeTruthy();
  expect(container.querySelectorAll(".ks-chart-dot")).toHaveLength(1);
  expect(container.querySelector(".ks-chart-band")).toBeNull();
});

it("returns to the selected band when the pointer leaves a focused chart", async () => {
  const { container } = setup({ type: "chart", kind: "bar", selected: { state: "picked" }, series: [
    { key: "s", name: "값", points: [{ x: "월", y: 1 }, { x: "화", y: 2 }, { x: "수", y: 3 }] },
  ] }, { picked: "월" });
  const chart = await screen.findByRole("slider", { name: "차트 시점" });
  chart.focus();
  fireEvent.keyDown(chart, { key: "ArrowRight" });
  expect(container.querySelector(".ks-chart-readout-x")?.textContent).toBe("화");
  fireEvent.pointerLeave(chart);
  expect(container.querySelector(".ks-chart-readout-x")?.textContent).toBe("월");
});

it.each(["pointerLeave", "blur"] as const)("remembers a clicked band without selected after %s", async (leave) => {
  const { container } = setup({ type: "chart", kind: "bar", on_select: [], series: [
    { key: "s", name: "값", points: [{ x: "월", y: 1 }, { x: "화", y: 2 }, { x: "수", y: 3 }] },
  ] });
  const chart = await screen.findByRole("slider", { name: "차트 시점" });
  vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({ left: 0, width: 300 } as DOMRect);
  fireEvent.click(chart, { clientX: 150 });
  fireEvent.pointerMove(chart, { clientX: 250 });
  fireEvent[leave](chart);
  expect(container.querySelector(".ks-chart-readout-x")?.textContent).toBe("화");
});

it.each([false, true])("키보드로 고른 칸은 초점을 빼도 기억한다 (먼저 누름: %s)", async (clickFirst) => {
  const { container } = setup({ type: "chart", kind: "bar", on_select: [], series: [
    { key: "s", name: "값", points: [{ x: "월", y: 1 }, { x: "화", y: 2 }, { x: "수", y: 3 }, { x: "목", y: 4 }] },
  ] });
  const chart = await screen.findByRole("slider", { name: "차트 시점" });
  if (clickFirst) {
    vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({ left: 0, width: 400 } as DOMRect);
    fireEvent.click(chart, { clientX: 150 });
  }
  fireEvent.keyDown(chart, { key: "Home" });
  fireEvent.keyDown(chart, { key: "ArrowRight" });
  fireEvent.keyDown(chart, { key: "ArrowRight" });
  fireEvent.keyDown(chart, { key: "Enter" });
  fireEvent.blur(chart);
  expect(container.querySelector(".ks-chart-readout-x")?.textContent).toBe("수");
});

it.each(["pointerLeave", "blur"] as const)("uses only the selected binding after %s even after a click", async (leave) => {
  const { container } = setup({ type: "chart", kind: "bar", selected: { state: "picked" }, on_select: [], series: [
    { key: "s", name: "값", points: [{ x: "월", y: 1 }, { x: "화", y: 2 }, { x: "수", y: 3 }] },
  ] }, { picked: null });
  const chart = await screen.findByRole("slider", { name: "차트 시점" });
  vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({ left: 0, width: 300 } as DOMRect);
  fireEvent.click(chart, { clientX: 150 });
  fireEvent[leave](chart);
  expect(container.querySelector(".ks-chart-readout-x")?.textContent).toBe("수");
});

it("tracks a clicked x across reordered data and forgets it when that x disappears", async () => {
  const points = [{ x: "월", y: 1 }, { x: "화", y: 2 }, { x: "수", y: 3 }];
  const data = (items: typeof points) => [{ key: "s", name: "값", points: items }];
  const { container, store } = setup({ type: "chart", kind: "bar", series: { state: "series" }, on_select: [] }, { series: data(points) });
  const chart = await screen.findByRole("slider", { name: "차트 시점" });
  vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({ left: 0, width: 300 } as DOMRect);
  fireEvent.click(chart, { clientX: 150 });
  fireEvent.pointerLeave(chart);
  const change = async (items: typeof points) => act(async () => { await store.call({ op: "window.set_state", window_id: "viewer-window", state: { series: data(items) } }); });
  const readout = () => container.querySelector(".ks-chart-readout-x")?.textContent;
  await change([points[1], points[0], points[2]]);
  expect(readout()).toBe("화");
  await change([points[0], points[2]]);
  expect(readout()).toBe("수");
  await change(points);
  expect(readout()).toBe("수");
});

it("returns to the last populated band when the selected binding is cleared", async () => {
  const { container, store } = setup({ type: "chart", kind: "bar", selected: { state: "picked" }, on_select: [], series: [
    { key: "s", name: "값", points: [{ x: "월", y: 1 }, { x: "화", y: 2 }, { x: "수", y: 3 }] },
  ] }, { picked: "월" });
  const chart = await screen.findByRole("slider", { name: "차트 시점" });
  vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({ left: 0, width: 300 } as DOMRect);
  fireEvent.click(chart, { clientX: 150 });
  fireEvent.pointerLeave(chart);
  expect(container.querySelector(".ks-chart-readout-x")?.textContent).toBe("월");
  await act(async () => { await store.call({ op: "window.set_state", window_id: "viewer-window", state: { picked: null } }); });
  expect(container.querySelector(".ks-chart-readout-x")?.textContent).toBe("수");
});

it("formats ticks, readout, and the data table with the block's notation", async () => {
  const values = [66354414, 160000000];
  const { container } = setup({ type: "chart", kind: "bar", number_format: { notation: "compact" }, series: [
    { key: "s", name: "토큰", points: [{ x: "월", y: values[0] }, { x: "화", y: values[1] }] },
  ] });
  await screen.findByRole("slider", { name: "차트 시점" });
  const compact = new Intl.NumberFormat(undefined, { notation: "compact" });
  const ticks = [...container.querySelectorAll(".ks-chart-y-axis span")].map((element) => element.textContent);
  expect(ticks[0]).toBe(compact.format(160000000));
  expect(container.querySelector(".ks-chart-readout")?.textContent).toContain(compact.format(160000000));
  expect(screen.getByRole("table", { name: "차트 데이터" }).textContent).toContain(compact.format(66354414));
});

it("applies currency, percent, and fraction digits to numbers", () => {
  const currency = createNumberFormatter({ style: "currency", currency: "USD", maximum_fraction_digits: 0 }, "bar");
  expect(currency(1234.5)).toBe(new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(1234.5));
  const percent = createNumberFormatter({ style: "percent" }, "bar");
  expect(percent(0.375)).toBe(new Intl.NumberFormat(undefined, { style: "percent" }).format(0.375));
});

it("uses each series color and falls back to the palette for a bad value", async () => {
  const { container } = setup({ type: "chart", kind: "bar", series: [
    { key: "a", name: "모델 A", color: "#3d7cc9", points: [{ x: "월", y: 1 }] },
    { key: "b", name: "모델 B", color: "파랑", points: [{ x: "월", y: 2 }] },
  ] });
  await screen.findByRole("slider", { name: "차트 시점" });
  const groups = [...container.querySelectorAll(".ks-chart-series")];
  expect(groups[0].getAttribute("style")).toContain("--ks-chart-series-color: #3d7cc9");
  expect(groups[1].getAttribute("style")).toContain("--ks-chart-series-color: var(--ks-color-series-2)");
  const legend = container.querySelector(".ks-chart-legend");
  expect(legend?.textContent).toContain("모델 A");
  expect(legend?.textContent).toContain("모델 B");
});

it("resolves palette names for series colors", async () => {
  const { container } = setup({ type: "chart", kind: "bar", series: [
    { key: "a", name: "계열 A", color: "series-4", points: [{ x: "월", y: 1 }] },
    { key: "b", name: "계열 B", color: "muted", points: [{ x: "월", y: 2 }] },
    { key: "c", name: "계열 C", color: "#123456", points: [{ x: "월", y: 3 }] },
    { key: "d", name: "계열 D", color: "bogus", points: [{ x: "월", y: 4 }] },
  ] });
  await screen.findByRole("slider", { name: "차트 시점" });
  const expected = ["var(--ks-color-series-4)", "var(--ks-color-series-muted)", "#123456", "var(--ks-color-series-4)"];
  const groups = [...container.querySelectorAll(".ks-chart-series")];
  const legendItems = [...container.querySelectorAll(".ks-chart-legend-item")];
  expect(groups).toHaveLength(4);
  expect(legendItems).toHaveLength(4);
  groups.forEach((group, index) => expect(group.getAttribute("style")).toContain(`--ks-chart-series-color: ${expected[index]}`));
  legendItems.forEach((item, index) => expect(item.getAttribute("style")).toContain(`--ks-chart-series-color: ${expected[index]}`));
});

it("값이 없는 계열은 범례와 읽기 줄과 표에서 빼고 남은 계열은 원래 색을 지킨다", async () => {
  const { container } = setup({ type: "chart", kind: "bar", series: [
    { key: "a", name: "계열 가", points: [{ x: "월", y: 10 }, { x: "화", y: 20 }] },
    { key: "b", name: "빈 계열", points: [{ x: "월", y: null }, { x: "화", y: null }] },
    { key: "c", name: "계열 다", points: [{ x: "월", y: 5 }, { x: "화", y: 11 }] },
  ] });
  await screen.findByRole("slider", { name: "차트 시점" });
  const legend = container.querySelector(".ks-chart-legend");
  expect(legend?.textContent).toContain("계열 가");
  expect(legend?.textContent).toContain("계열 다");
  expect(legend?.textContent).not.toContain("빈 계열");
  const items = [...container.querySelectorAll(".ks-chart-legend-item")];
  // 빈 계열을 빼도 색은 원래 index로 정해지므로 셋째 계열은 series-3을 유지한다.
  expect(items.map((item) => item.getAttribute("style"))).toEqual([
    expect.stringContaining("var(--ks-color-series-1)"),
    expect.stringContaining("var(--ks-color-series-3)"),
  ]);
  const readout = container.querySelector(".ks-chart-readout-values");
  expect(readout?.textContent).toContain("계열 가");
  expect(readout?.textContent).toContain("계열 다");
  expect(readout?.textContent).not.toContain("빈 계열");
  const table = screen.getByRole("table", { name: "차트 데이터" });
  expect(table.textContent).not.toContain("빈 계열");
  expect(table.textContent).toContain("계열 다");
  expect([...table.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual(["시점", "계열 가", "계열 다"]);
});

it("받는 중에도 다 받은 차트와 같은 틀을 그린다", async () => {
  const { transport } = setup({ type: "chart", kind: "line", height: "tall", series: { expr: "[]" } });
  await screen.findByText("없음", { exact: true });
  act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/series": { status: "loading" } } } }));
  const loading = await screen.findByRole("status", { name: "불러오는 중" });
  expect(loading.classList.contains("ks-chart")).toBe(true);
  expect(loading.classList.contains("is-tall")).toBe(true);
  expect(loading.querySelector(".ks-chart-frame")).not.toBeNull();
  expect(loading.querySelector(".ks-chart-readout .ks-chart-loading-bar")).not.toBeNull();
  expect(loading.querySelector(".ks-chart-body .ks-chart-loading-plot")).not.toBeNull();
});

it("returns to the selected band and starts on the last band with data", async () => {
  const first = setup({ type: "chart", kind: "bar", selected: { state: "picked" }, series: [
    { key: "s", name: "값", points: [{ x: "월", y: 1 }, { x: "화", y: 2 }, { x: "수", y: 3 }] },
  ] }, { picked: "화" });
  const chart = await screen.findByRole("slider", { name: "차트 시점" });
  const readout = () => first.container.querySelector(".ks-chart-readout-x")?.textContent;
  expect(readout()).toBe("화");
  expect(first.container.querySelector(".ks-chart-band")).toBeTruthy();
  fireEvent.keyDown(chart, { key: "ArrowLeft" });
  expect(readout()).toBe("월");
  fireEvent.blur(chart);
  expect(readout()).toBe("화");
  cleanup();
  const second = setup({ type: "chart", kind: "bar", series: [
    { key: "s", name: "값", points: [{ x: "월", y: 1 }, { x: "화", y: 2 }, { x: "수", y: null }] },
  ] });
  await screen.findByRole("slider", { name: "차트 시점" });
  expect(second.container.querySelector(".ks-chart-readout-x")?.textContent).toBe("화");
  expect(second.container.querySelector(".ks-chart-band")).toBeTruthy();
});

it.each(["bar", "line", "area"] as const)("%s 차트는 선택 바인딩이 비었으면 쉬는 동안 표시를 숨긴다", async (kind) => {
  const { container, store } = setup({ type: "chart", kind, selected: { state: "picked" }, series: [
    { key: "s", name: "값", points: [{ x: "월", y: 1 }, { x: "화", y: 2 }] },
  ] }, { picked: null });
  const chart = await screen.findByRole("slider", { name: "차트 시점" });
  const marker = () => container.querySelector(".ks-chart-band, .ks-chart-guide");
  expect(container.querySelector(".ks-chart-readout-x")?.textContent).toBe("화");
  expect(marker()).toBeNull();
  fireEvent.keyDown(chart, { key: "Home" });
  expect(marker()).toBeTruthy();
  fireEvent.blur(chart);
  expect(marker()).toBeNull();
  await act(async () => { await store.call({ op: "window.set_state", window_id: "viewer-window", state: { picked: "월" } }); });
  expect(marker()).toBeTruthy();
  expect(container.querySelector(".ks-chart-readout-x")?.textContent).toBe("월");
});

it.each([
  { values: [1234.07], stacked: false, ticks: ["$1,600", "$800", "$0"], text: "$1,234.07" },
  { values: [1.23], stacked: false, ticks: ["$1.60", "$0.80", "$0.00"], text: "$1.23" },
  { values: [1.2, 2.8, 0.4], stacked: false, ticks: ["$3.00", "$1.50", "$0.00"], text: "$2.80" },
  { values: [1.2, 2.8, 0.4], stacked: true, ticks: ["$3.00", "$1.50", "$0.00"], text: "$2.80" },
])("통화 축은 눈금이 모두 정수일 때만 끝자리를 떼고 읽기 줄과 표는 유지한다 ($values, 쌓기 $stacked)", async ({ values, stacked, ticks, text }) => {
  const { container } = setup({ type: "chart", kind: "bar", stacked, number_format: { style: "currency", currency: "USD", maximum_fraction_digits: 2 }, series: [
    { key: "s", name: "값", points: values.map((y, index) => ({ x: ["월", "화", "수"][index], y })) },
  ] });
  const chart = await screen.findByRole("slider", { name: "차트 시점" });
  expect([...container.querySelectorAll(".ks-chart-y-axis span")].map((s) => s.textContent)).toEqual(ticks);
  if (values.length > 1) fireEvent.keyDown(chart, { key: "ArrowLeft" });
  expect(container.querySelector(".ks-chart-readout-values")?.textContent).toContain(text);
  expect(screen.getByRole("table", { name: "차트 데이터" }).textContent).toContain(text);
});

it("0 막대는 생략하고 작은 양수와 음수의 최소 높이는 부호 쪽으로 그린다", () => {
  for (const stacked of [false, true]) {
    const geometry = buildChartGeometry([{ key: "s", name: "값", points: [0, .001, -.001, 100].map((y, i) => ({ x: String(i), y })) }], "bar", 600, undefined, { stacked });
    const bars = geometry.series[0].bars;
    expect(bars.map((bar) => bar.index)).toEqual([1, 2, 3]);
    expect(bars[0].height).toBe(1);
    expect(bars[0].y + bars[0].height).toBeCloseTo(geometry.baseline);
    expect(bars[1].height).toBe(1);
    expect(bars[1].y).toBeCloseTo(geometry.baseline);
  }
});

it("sorts a table column by its sort value instead of the shown text", async () => {
  const { container } = setup({ type: "table", columns: [{ field: "value", label: "값", sort_field: "raw" }], rows: [
    { key: "a", value: "1.5억+", raw: 150000000 },
    { key: "b", value: "1.6억+", raw: 160000000 },
    { key: "c", value: "6075만+", raw: 60750000 },
    { key: "d", value: "6276.2만+", raw: 62762000 },
  ] });
  fireEvent.click(await screen.findByRole("button", { name: "값" }));
  await waitFor(() => expect([...container.querySelectorAll(".ks-table-row")].map((row) => row.textContent)).toEqual(["6075만+", "6276.2만+", "1.5억+", "1.6억+"]));
});
