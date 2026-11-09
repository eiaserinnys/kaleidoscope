import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CanvasBlock } from "../blocks/canvas";

const data = vi.hoisted(() => ({
  subscribeClient: () => () => {}, getClientGeneration: () => 0,
  getClientReady: () => data.clientReady, getClientFailed: () => data.clientFailed,
  attachSurface: vi.fn(() => 1), detachSurface: vi.fn(), resizeSurface: vi.fn(), setSurfaceVisible: vi.fn(), setNotice: vi.fn(), act: vi.fn(),
  itemSurface: "first", loading: false, clientReady: true, clientFailed: false,
}));
vi.mock("../data/window-data", () => ({ useWindowData: () => data, useBinding: (pointer: string, value: unknown) => ({ status: "ready", value: pointer.endsWith("/loading") ? data.loading : value && typeof value === "object" && "item" in value ? data.itemSurface : value }) }));
vi.mock("../data/window-state", () => ({ useWindowGrants: () => [] }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("항목의 표면이 바뀌면 이전 세대를 떼고 새 요소에 붙이며 교차 상태를 전달한다", () => {
  vi.clearAllMocks(); data.itemSurface = "first";
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 320, height: 180 } as DOMRect);
  const transfer = vi.fn(() => ({}));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  let intersect: IntersectionObserverCallback = () => {};
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: IntersectionObserverCallback) { intersect = callback; } observe() {} disconnect() {} });
  const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "transferControlToOffscreen");
  Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", { configurable: true, value: transfer });
  try {
    const block = { type: "canvas", surface: { item: "surface" } } as const;
    const view = render(<CanvasBlock block={block} pointer="/ui/template" />);
    const first = view.container.querySelector("canvas");
    expect(data.attachSurface).toHaveBeenCalledWith("first", expect.anything(), 320, 180, expect.any(Number), false);
    act(() => intersect([{ isIntersecting: true } as IntersectionObserverEntry], null as unknown as IntersectionObserver));
    expect(data.setSurfaceVisible).toHaveBeenCalledWith("first", 1, true);
    data.itemSurface = "second";
    view.rerender(<CanvasBlock block={block} pointer="/ui/template" />);
    expect(data.detachSurface).toHaveBeenCalledWith("first", 1);
    expect(view.container.querySelector("canvas")).not.toBe(first);
    expect(data.attachSurface).toHaveBeenCalledWith("second", expect.anything(), 320, 180, expect.any(Number), false);
  } finally {
    if (original) Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", original);
    else delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
    vi.unstubAllGlobals();
  }
});

it("canvas.loading은 기존 캔버스 크기와 표면 연결을 유지한다", () => {
  vi.clearAllMocks(); data.loading = false;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 320, height: 180 } as DOMRect);
  const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "transferControlToOffscreen");
  Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", { configurable: true, value: () => ({}) });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const block = { type: "canvas", surface: "preview", description: "준비된 색상 무대", loading: { state: "loading" } } as const;
  try {
    const view = render(<CanvasBlock block={block} pointer="/ui" />);
    const root = view.container.querySelector(".ks-canvas")!;
    const canvas = root.querySelector("canvas");
    expect(root.querySelector('[role="status"]')).toBeNull();
    expect(data.attachSurface).toHaveBeenCalledTimes(1);

    data.loading = true;
    view.rerender(<CanvasBlock block={block} pointer="/ui" />);
    expect(root.getAttribute("aria-label")).toBe("준비된 색상 무대, 불러오는 중");
    expect(root.querySelector('.ks-canvas-loading .ks-data-progress.is-indeterminate[role="progressbar"]')).not.toBeNull();
    expect(root.querySelector('[role="status"]')).toBeNull();
    expect(root.querySelector("canvas")).toBe(canvas);
    expect(data.attachSurface).toHaveBeenCalledTimes(1);
    expect(data.detachSurface).not.toHaveBeenCalled();
    expect(data.resizeSurface).not.toHaveBeenCalled();

    data.loading = false;
    view.rerender(<CanvasBlock block={block} pointer="/ui" />);
    expect(root.getAttribute("aria-label")).toBe("준비된 색상 무대");
    expect(root.querySelector(".ks-canvas-loading")).toBeNull();
    expect(root.querySelector("canvas")).toBe(canvas);
    expect(data.attachSurface).toHaveBeenCalledTimes(1);
  } finally {
    if (original) Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", original);
    else delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
    vi.unstubAllGlobals();
  }
});

it("개발 모드에서 다시 붙을 때 이전에 전송한 캔버스를 재사용하지 않는다", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 320, height: 180 } as DOMRect);
  vi.clearAllMocks();
  const transferred = new WeakSet<HTMLCanvasElement>();
  const width = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width")!;
  const originalTransfer = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "transferControlToOffscreen");
  Object.defineProperty(HTMLCanvasElement.prototype, "width", { ...width, set(value) { if (transferred.has(this)) throw new Error("이미 전송한 캔버스"); width.set!.call(this, value); } });
  Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", { configurable: true, value() { transferred.add(this); return {}; } });
  const previousObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  try {
    const view = render(<StrictMode><CanvasBlock block={{ type: "canvas", surface: "preview" }} pointer="/ui" /></StrictMode>);
    expect(data.attachSurface).toHaveBeenCalledTimes(2);
    expect(view.container.querySelectorAll("canvas")).toHaveLength(1);
    view.unmount();
    expect(data.detachSurface).toHaveBeenCalledTimes(2);
  } finally {
    Object.defineProperty(HTMLCanvasElement.prototype, "width", width);
    if (originalTransfer) Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", originalTransfer);
    else delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
    globalThis.ResizeObserver = previousObserver;
  }
});

it("숨겨진 캔버스는 마지막 크기를 유지하고 처음부터 숨겨졌다면 표시될 때 붙인다", () => {
  let width = 320, height = 180;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width, height } as DOMRect));
  vi.clearAllMocks();
  const originalTransfer = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "transferControlToOffscreen");
  Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", { configurable: true, value() { return {}; } });
  const previousObserver = globalThis.ResizeObserver;
  let resize: ResizeObserverCallback = () => {};
  globalThis.ResizeObserver = class { constructor(callback: ResizeObserverCallback) { resize = callback; } observe() {} disconnect() {} unobserve() {} };
  const update = () => act(() => resize([], null as unknown as ResizeObserver));
  try {
    const view = render(<CanvasBlock block={{ type: "canvas", surface: "preview" }} pointer="/ui" />);
    expect(data.attachSurface).toHaveBeenCalledTimes(1);
    width = 0; height = 0; update();
    expect(data.resizeSurface).not.toHaveBeenCalled();
    width = 640; height = 360; update();
    expect(data.resizeSurface).toHaveBeenCalledWith("preview", 1, 640, 360, expect.any(Number));
    view.unmount();
    vi.clearAllMocks();
    width = 0; height = 0;
    const hidden = render(<CanvasBlock block={{ type: "canvas", surface: "preview" }} pointer="/ui" />);
    expect(data.attachSurface).not.toHaveBeenCalled();
    width = 320; height = 180; update();
    expect(data.attachSurface).toHaveBeenCalledTimes(1);
    hidden.unmount();
  } finally {
    if (originalTransfer) Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", originalTransfer);
    else delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
    globalThis.ResizeObserver = previousObserver;
  }
});

it("비율 바인딩이 바뀌면 실제 캔버스를 세로와 정사각 무대에 맞춘다", () => {
  vi.clearAllMocks();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 360 } as DOMRect);
  const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "transferControlToOffscreen");
  Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", { configurable: true, value: () => ({}) });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  try {
    const view = render(<CanvasBlock block={{ type: "canvas", surface: "preview", aspect_ratio: 9 / 16 }} pointer="/ui" />);
    const canvas = view.container.querySelector("canvas");
    expect(view.container.querySelector("canvas")?.style.width).toBe("202.5px");
    expect(view.container.querySelector("canvas")?.style.height).toBe("360px");
    view.rerender(<CanvasBlock block={{ type: "canvas", surface: "preview", aspect_ratio: 1 }} pointer="/ui" />);
    expect(view.container.querySelector("canvas")?.style.width).toBe("360px");
    expect(view.container.querySelector("canvas")).toBe(canvas);
    expect(data.attachSurface).toHaveBeenCalledTimes(1);
    expect(data.detachSurface).not.toHaveBeenCalled();
    expect(data.resizeSurface).toHaveBeenCalledWith("preview", 1, 360, 360, expect.any(Number));
  } finally {
    if (original) Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", original);
    else delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
    vi.unstubAllGlobals();
  }
});

it("세로 영상의 좁은 창 무대는 정사각 이상으로 유지하고 영상 비율은 보존한다", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 498, height: 498 } as DOMRect);
  const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "transferControlToOffscreen");
  Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", { configurable: true, value: () => ({}) });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  try {
    const view = render(<CanvasBlock block={{ type: "canvas", surface: "preview", aspect_ratio: 9 / 16 }} pointer="/ui" />);
    expect(view.container.firstElementChild?.getAttribute("style")).toContain("--ks-canvas-ratio: 1");
    expect(view.container.querySelector("canvas")?.style.height).toBe("498px");
    expect(view.container.querySelector("canvas")?.style.width).toBe("280.125px");
  } finally {
    if (original) Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", original);
    else delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
    vi.unstubAllGlobals();
  }
});

it("client가 준비되기 전에는 로딩 표현을 보이고 준비되거나 실패하면 지운다", () => {
  vi.clearAllMocks(); data.loading = false; data.clientReady = false; data.clientFailed = false;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 320, height: 180 } as DOMRect);
  const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "transferControlToOffscreen");
  Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", { configurable: true, value: () => ({}) });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const block = { type: "canvas", surface: "preview", description: "준비된 색상 무대" } as const;
  try {
    const view = render(<CanvasBlock block={block} pointer="/ui" />);
    const root = view.container.querySelector(".ks-canvas")!;
    expect(root.getAttribute("aria-label")).toBe("준비된 색상 무대, 불러오는 중");
    expect(root.getAttribute("aria-busy")).toBe("true");
    expect(root.querySelector('.ks-canvas-loading .ks-data-progress.is-indeterminate[role="progressbar"]')).not.toBeNull();

    data.clientReady = true;
    view.rerender(<CanvasBlock block={block} pointer="/ui" />);
    expect(root.getAttribute("aria-label")).toBe("준비된 색상 무대");
    expect(root.getAttribute("aria-busy")).toBeNull();
    expect(root.querySelector(".ks-canvas-loading")).toBeNull();

    data.clientReady = false; data.clientFailed = true;
    view.rerender(<CanvasBlock block={block} pointer="/ui" />);
    expect(root.getAttribute("aria-label")).toBe("준비된 색상 무대");
    expect(root.getAttribute("aria-busy")).toBeNull();
    expect(root.querySelector(".ks-canvas-loading")).toBeNull();
  } finally {
    if (original) Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", original);
    else delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
    vi.unstubAllGlobals();
  }
});
