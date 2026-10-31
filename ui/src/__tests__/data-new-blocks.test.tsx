import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed, mdViewerDefinition } from "./fixtures";
import { mockVirtualLayout } from "./virtual-layout";

beforeEach(() => {
  mockVirtualLayout();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(window, "open").mockImplementation(() => null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(ui: Block, state: AppDefinition["state"] = {}) {
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 9, modules: {} }, permissions: [], state, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...state };
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  const rendered = render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  return { calls, ...rendered };
}

it("renders a featured metric with a badge, an asset, and an error tone", async () => {
  const { container } = setup({ type: "metrics", columns: 1, items: [{ label: "결과", value: "오류", tone: "error", align: "end", image: { asset: "builtin-icon" }, badge: "확인" }] });
  expect(await screen.findByText("오류")).toBeTruthy();
  const card = container.querySelector(".ks-metric-card")!;
  expect(card.classList.contains("tone-error")).toBe(true);
  expect(card.classList.contains("is-align-end")).toBe(true);
  expect(card.classList.contains("is-featured")).toBe(true);
  expect(card.querySelector(".ks-media-thumbnail.is-asset")).toBeTruthy();
  expect(screen.getByText("확인")).toBeTruthy();
});

it("dispatches keypad clicks and shortcuts once, ignoring text entry", async () => {
  const buttons = [
    { key: "1", label: "1", shortcut: "1", variant: "default" as const },
    { key: "=", label: "=", shortcut: "Enter", variant: "primary" as const },
  ];
  const { calls } = setup({ type: "stack", direction: "column", children: [
    { type: "input", value: { state: "text" }, on_change: { set_state: "text" }, placeholder: "입력" },
    { type: "keypad", columns: 2, buttons, on_press: { set_state: "value" } },
  ] }, { text: "", value: null });
  const one = await screen.findByRole("button", { name: "1" });
  await userEvent.click(one);
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/children/1/on_press", event: "1", item: buttons[0] })));
  calls.mockClear();
  await userEvent.keyboard("{Enter}");
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", event: "=" })));
  expect(calls.mock.calls.filter(([request]) => request.op === "data.act" && request.pointer.endsWith("/on_press"))).toHaveLength(1);
  calls.mockClear();
  fireEvent.keyDown(document.body, { key: "1" });
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", event: "1" })));
  calls.mockClear();
  const input = screen.getByPlaceholderText("입력");
  input.focus();
  fireEvent.keyDown(input, { key: "1" });
  expect(calls.mock.calls.some(([request]) => request.op === "data.act")).toBe(false);
  fireEvent.keyDown(document.body, { key: "1", ctrlKey: true });
  fireEvent.keyDown(document.body, { key: "1", isComposing: true });
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.appendChild(dialog);
  fireEvent.keyDown(document.body, { key: "1" });
  dialog.remove();
  expect(calls.mock.calls.some(([request]) => request.op === "data.act")).toBe(false);
  fireEvent.keyDown(document.body, { key: "Tab" });
  one.focus();
  await userEvent.keyboard("{Enter}");
  await waitFor(() => expect(calls.mock.calls.filter(([request]) => request.op === "data.act" && request.pointer.endsWith("/on_press"))).toHaveLength(1));
  expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", event: "1" }));
});

it("sends keypad shortcuts only to the active app window", async () => {
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 9, modules: {} }, permissions: [], state: { value: null }, ui: { type: "keypad", columns: 1, buttons: [{ key: "1", label: "1", shortcut: "1" }], on_press: { set_state: "value" } } };
  const seed = makeTestSeed({ definitions: [definition] });
  const first = seed.snapshot.shared.windows[0];
  first.state = { value: null };
  seed.snapshot.shared.windows.push({ ...first, id: "viewer-window-2", z: first.z + 1 });
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<><AppWindowContent store={store} windowId={first.id} /><AppWindowContent store={store} windowId="viewer-window-2" /></>);
  await screen.findAllByRole("button", { name: "1" });
  fireEvent.keyDown(document.body, { key: "1" });
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", window_id: "viewer-window-2", event: "1" })));
  expect(calls.mock.calls.filter(([request]) => request.op === "data.act")).toHaveLength(1);
});

it("moves the chart readout, selects a point, and breaks lines at missing values", async () => {
  const { calls, container } = setup({ type: "chart", kind: "area", y_unit: "°C", on_select: { set_state: "choice" }, series: [
    { key: "temp", name: "기온", points: [{ x: "10:00", y: 1 }, { x: "11:00", y: 2, label: "강수 20%" }, { x: "12:00", y: null }, { x: "13:00", y: 4 }, { x: "14:00", y: 5 }] },
  ] }, { choice: null });
  const chart = await screen.findByRole("slider", { name: "차트 시점" });
  expect(container.querySelectorAll(".ks-chart-line")).toHaveLength(2);
  fireEvent.keyDown(chart, { key: "ArrowRight" });
  expect(container.querySelector(".ks-chart-readout")?.textContent).toContain("11:00");
  expect(container.querySelector(".ks-chart-readout")?.textContent).toContain("강수 20%");
  expect(chart.getAttribute("aria-valuetext")).toContain("강수 20%");
  expect(screen.getByRole("table", { name: "차트 데이터" }).textContent).toContain("강수 20%");
  fireEvent.keyDown(chart, { key: "Enter" });
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/on_select", event: "11:00", item: { series: "temp", x: "11:00", y: 2, label: "강수 20%" } })));
  fireEvent.keyDown(chart, { key: "End" });
  expect(container.querySelector(".ks-chart-readout")?.textContent).toContain("14:00");
});

it("hides a null list while retaining the empty state for an empty array", async () => {
  const { container } = setup({ type: "list", items: null });
  await waitFor(() => expect(container.querySelector(".ks-data-window-body")).toBeTruthy());
  expect(screen.queryByText("없음")).toBeNull();
  cleanup();
  setup({ type: "list", items: [] });
  expect(await screen.findByText("없음")).toBeTruthy();
});

it("opens a markdown HTTPS link through the core", async () => {
  const { calls } = setup({ type: "text", format: "markdown", value: "[출처](https://example.com/)" });
  await userEvent.click(await screen.findByRole("link", { name: "출처" }));
  await waitFor(() => expect(calls).toHaveBeenCalledWith({ op: "external.open", window_id: "viewer-window", url: "https://example.com/" }));
});
