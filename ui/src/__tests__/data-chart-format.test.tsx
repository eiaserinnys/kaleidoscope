import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(ui: Block, state: AppDefinition["state"] = {}) {
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 62, modules: {} }, permissions: [], state, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...state };
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  const rendered = render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  return { calls, ...rendered };
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
    .toMatchObject({ min: 0, max: 180000000 });
  expect(geometry([[160000000]])).toMatchObject({ min: 0, max: 160000000 });
  expect(geometry([[18]])).toMatchObject({ min: 0, max: 18 });
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
  expect(ticks).toEqual([compact.format(180000000), compact.format(90000000), compact.format(0)]);
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
