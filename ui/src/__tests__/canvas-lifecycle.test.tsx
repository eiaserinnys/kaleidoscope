import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CanvasBlock } from "../blocks/canvas";

const data = vi.hoisted(() => ({
  subscribeClient: () => () => {}, getClientGeneration: () => 0,
  attachSurface: vi.fn(() => 1), detachSurface: vi.fn(), resizeSurface: vi.fn(), setNotice: vi.fn(), act: vi.fn(),
}));
vi.mock("../data/window-data", () => ({ useWindowData: () => data, useBinding: (_pointer: string, value: unknown) => ({ status: "ready", value }) }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 360 } as DOMRect);
  const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "transferControlToOffscreen");
  Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", { configurable: true, value: () => ({}) });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  try {
    const view = render(<CanvasBlock block={{ type: "canvas", surface: "preview", aspect_ratio: 9 / 16 }} pointer="/ui" />);
    expect(view.container.querySelector("canvas")?.style.width).toBe("202.5px");
    expect(view.container.querySelector("canvas")?.style.height).toBe("360px");
    view.rerender(<CanvasBlock block={{ type: "canvas", surface: "preview", aspect_ratio: 1 }} pointer="/ui" />);
    expect(view.container.querySelector("canvas")?.style.width).toBe("360px");
  } finally {
    if (original) Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", original);
    else delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
    vi.unstubAllGlobals();
  }
});
