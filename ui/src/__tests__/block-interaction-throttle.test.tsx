import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, MediaRef } from "../contract/contract";
import { CanvasBlock } from "../blocks/canvas";
import * as chartGeometry from "../blocks/chart-geometry";
import { ChartBlock } from "../blocks/data-chart";
import { ColorBlock, SliderBlock } from "../blocks/data-input";
import { MediaBlock } from "../blocks/data-media";
import { TimelineBlock } from "../blocks/timeline";

const runtime = vi.hoisted(() => {
  const state: any = {};
  Object.assign(state, {
    calls: [] as Array<{ pointer: string; event: unknown }>,
    act: vi.fn((pointer: string, event: unknown) => { state.calls.push({ pointer, event }); return Promise.resolve(true); }),
    bindings: {} as Record<string, unknown>,
    visible: true,
    mediaCache: new Map<string, Promise<string>>(),
    storeCall: vi.fn(async () => ({ op: "data.media", media: { mime: "audio/mpeg", data_base64: "AQID" } })),
    attachSurface: vi.fn(() => 1),
    resizeSurface: vi.fn(),
    detachSurface: vi.fn(),
    setNotice: vi.fn(),
    subscribeClient: vi.fn(() => () => undefined),
    getClientGeneration: vi.fn(() => 0),
  });
  state.data = {
    windowId: "window-1",
    act: (...args: [string, unknown]) => state.act(...args),
    store: { call: (...args: unknown[]) => state.storeCall(...args) },
    mediaCache: state.mediaCache,
    attachSurface: (...args: unknown[]) => state.attachSurface(...args),
    resizeSurface: (...args: unknown[]) => state.resizeSurface(...args),
    detachSurface: (...args: unknown[]) => state.detachSurface(...args),
    setNotice: (...args: unknown[]) => state.setNotice(...args),
    subscribeClient: (...args: unknown[]) => state.subscribeClient(...args),
    getClientGeneration: (...args: unknown[]) => state.getClientGeneration(...args),
  };
  return state;
});

vi.mock("../data/window-data", () => ({
  useWindowData: () => runtime.data,
  useBinding: (pointer: string) => ({ status: "ready", value: runtime.bindings[pointer] ?? null }),
}));
vi.mock("../data/window-state", () => ({ useWindowVisible: () => runtime.visible }));
vi.mock("../share/visible", () => ({ useShareDescriber: () => undefined }));

const context = { store: {} as never, window: { id: "window-1", app_id: "app", app_version: 1, desktop_id: "desktop" }, definition: {} as never };
let frameId = 0;
let frames: Map<number, FrameRequestCallback>;

beforeEach(() => {
  runtime.calls.length = 0;
  runtime.act.mockClear();
  runtime.bindings = {
    "/ui/value": 0,
    "/ui/duration": 10,
    "/ui/position": { position: 1, sampled_at: 1000, rate: 1, running: true, duration: 10 },
    "/ui/tracks": [],
    "/ui/markers": [],
    "/ui/ticks": [],
    "/ui/selection": null,
    "/ui/snap": null,
  };
  runtime.visible = true;
  runtime.mediaCache.clear();
  runtime.storeCall.mockClear();
  runtime.storeCall.mockImplementation(async () => ({ op: "data.media", media: { mime: "audio/mpeg", data_base64: "AQID" } }));
  frameId = 0;
  frames = new Map();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = ++frameId; frames.set(id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 320, bottom: 180, width: 320, height: 180, x: 0, y: 0, toJSON() {} } as DOMRect);
  if (!HTMLElement.prototype.setPointerCapture) Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => {} });
  Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", { configurable: true, value: () => ({}) });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("slider and color change dispatch", () => {
  it("coalesces slider updates and flushes the last value on pointer up", () => {
    const block = { type: "slider", min: 0, max: 100, value: 0, on_change: { set_state: "value" } } as Extract<Block, { type: "slider" }>;
    const { getByRole } = render(<SliderBlock block={block} pointer="/ui" context={context} />);
    const input = getByRole("slider");
    fireEvent.pointerDown(input, { pointerId: 1 });
    for (let value = 1; value <= 10; value += 1) fireEvent.input(input, { target: { value: String(value) } });
    fireEvent.pointerUp(input, { pointerId: 1 });

    expect(runtime.calls.filter((call: { pointer: string; event: unknown }) => call.pointer === "/ui/on_change")).toEqual([
      { pointer: "/ui/on_change", event: 1 },
      { pointer: "/ui/on_change", event: 10 },
    ]);
  });

  it("coalesces color updates and flushes the last value on change", () => {
    const block = { type: "color", value: "#000000", on_change: { set_state: "color" } } as Extract<Block, { type: "color" }>;
    const { getByLabelText } = render(<ColorBlock block={block} pointer="/ui" context={context} />);
    const input = getByLabelText("색상");
    fireEvent.pointerDown(input, { pointerId: 1 });
    for (let value = 1; value <= 9; value += 1) fireEvent.input(input, { target: { value: `#${value.toString(16).padStart(6, "0")}` } });
    fireEvent.change(input, { target: { value: "#00000a" } });

    expect(runtime.calls.filter((call: { pointer: string; event: unknown }) => call.pointer === "/ui/on_change")).toEqual([
      { pointer: "/ui/on_change", event: "#000001" },
      { pointer: "/ui/on_change", event: "#00000a" },
    ]);
  });
});

describe("canvas pointer dispatch", () => {
  it("sends at most one move per frame and flushes it before up", () => {
    const block = { type: "canvas", surface: "surface", on_pointer: { set_state: "pointer" } } as Extract<Block, { type: "canvas" }>;
    const { container } = render(<CanvasBlock block={block} pointer="/ui" />);
    const canvas = container.querySelector(".ks-canvas")!;
    for (let x = 1; x <= 10; x += 1) fireEvent.pointerMove(canvas, { pointerId: 1, clientX: x, clientY: 20, buttons: 1 });
    expect(runtime.calls).toHaveLength(0);
    const scheduled = [...frames.entries()][0];
    act(() => scheduled[1](16));
    expect(runtime.calls).toHaveLength(1);
    expect((runtime.calls[0].event as { x: number }).x).toBe(10 / 320);

    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 20, clientY: 20, buttons: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 21, clientY: 20, buttons: 0 });
    expect((runtime.calls.slice(-2).map((call: { pointer: string; event: unknown }) => (call.event as { phase: string }).phase))).toEqual(["move", "up"]);
  });
});

describe("timeline seek and playback visibility", () => {
  const block = { type: "timeline", duration: 10, position: { position: 1, sampled_at: 1000, rate: 1, running: true, duration: 10 }, tracks: [], on_seek: { set_state: "position" } } as Extract<Block, { type: "timeline" }>;
  it("coalesces seek moves and sends the final pointer position", () => {
    runtime.bindings["/ui/position"] = { position: 1, sampled_at: 1000, rate: 1, running: false, duration: 10 };
    const seekBlock = { ...block, position: { position: 1, sampled_at: 1000, rate: 1, running: false, duration: 10 } };
    const { container } = render(<TimelineBlock block={seekBlock} pointer="/ui" context={context} />);
    const ruler = container.querySelector(".ks-timeline-ruler")!;
    fireEvent.pointerDown(ruler, { pointerId: 1, clientX: 10, buttons: 1 });
    for (let x = 11; x <= 20; x += 1) fireEvent.pointerMove(ruler, { pointerId: 1, clientX: x, buttons: 1 });
    expect(runtime.calls).toHaveLength(1);
    const scheduled = [...frames.entries()][0];
    act(() => scheduled[1](16));
    expect(runtime.calls).toHaveLength(2);
    fireEvent.pointerUp(ruler, { pointerId: 1, clientX: 320, buttons: 0 });
    expect(runtime.calls).toHaveLength(3);
    expect(runtime.calls.at(-1)?.event).toBe(10);
  });

  it("does not request playback frames while hidden and resumes when visible", () => {
    runtime.visible = false;
    const view = render(<TimelineBlock block={block} pointer="/ui" context={context} />);
    expect(frames.size).toBe(0);
    runtime.visible = true;
    view.rerender(<TimelineBlock block={block} pointer="/ui" context={{ ...context }} />);
    expect(frames.size).toBe(1);
  });
});

it("reuses a window media request after the block remounts", async () => {
  const media = { asset: "audio", version: 1 } as MediaRef;
  runtime.bindings["/ui/src"] = media;
  const block = { type: "media", src: media, kind: "audio" } as Extract<Block, { type: "media" }>;
  const first = render(<MediaBlock block={block} pointer="/ui" />);
  await waitFor(() => expect(first.container.querySelector("audio")?.getAttribute("src")).toContain("data:audio/mpeg"));
  first.unmount();
  const second = render(<MediaBlock block={block} pointer="/ui" />);
  await waitFor(() => expect(second.container.querySelector("audio")?.getAttribute("src")).toContain("data:audio/mpeg"));
  expect(runtime.storeCall).toHaveBeenCalledTimes(1);
});

it("does not rebuild chart geometry when only the selected point changes", () => {
  runtime.bindings["/ui/series"] = [{ key: "temperature", name: "기온", points: [{ x: "09:00", y: 12 }, { x: "10:00", y: 17 }, { x: "11:00", y: 15 }] }];
  const build = vi.spyOn(chartGeometry, "buildChartGeometry");
  const block = { type: "chart", kind: "line", series: [] } as Extract<Block, { type: "chart" }>;
  const { getByRole } = render(<ChartBlock block={block} pointer="/ui" />);
  expect(build).toHaveBeenCalledTimes(1);

  fireEvent.pointerMove(getByRole("slider"), { pointerId: 1, clientX: 0 });

  expect(build).toHaveBeenCalledTimes(1);
});
