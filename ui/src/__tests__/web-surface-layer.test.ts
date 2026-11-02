import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateWebSurface, registerWebSurface } from "../blocks/web-surface-layer";
import type { Rect } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";

afterEach(() => vi.unstubAllGlobals());

const bounds: Rect = { x: 20, y: 20, width: 100, height: 80 };

function evaluate(options: {
  visible?: boolean;
  overlays?: Array<{ bounds: Rect; visible: boolean }>;
  windows?: Array<{ bounds: Rect; visible: boolean; zIndex: number }>;
} = {}) {
  return evaluateWebSurface({
    visible: options.visible ?? true,
    bounds,
    ownZIndex: 2,
    overlays: options.overlays ?? [],
    windows: options.windows ?? [],
  });
}

describe("web surface overlap", () => {
  it("hides a surface with no rendered client rect", () => {
    expect(evaluate({ visible: false })).toBe("hidden");
  });

  it("marks an intersecting overlay as covered", () => {
    expect(evaluate({ overlays: [{ bounds: { x: 100, y: 40, width: 30, height: 30 }, visible: true }] })).toBe("covered");
  });

  it("covers only windows with a higher z index", () => {
    const overlap = { x: 30, y: 30, width: 20, height: 20 };
    expect(evaluate({ windows: [{ bounds: overlap, visible: true, zIndex: 3 }] })).toBe("covered");
    expect(evaluate({ windows: [{ bounds: overlap, visible: true, zIndex: 1 }] })).toBe("live");
  });

  it("ignores hidden occluders and rectangles that only touch an edge", () => {
    expect(evaluate({ overlays: [{ bounds: { x: 120, y: 20, width: 10, height: 10 }, visible: true }] })).toBe("live");
    expect(evaluate({ overlays: [{ bounds: { x: 30, y: 30, width: 20, height: 20 }, visible: false }] })).toBe("live");
  });

  it("does not run a frame loop with inactive surfaces and resumes on activation", () => {
    const request = vi.fn(() => 17);
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", request);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const element = document.createElement("div");
    document.body.append(element);
    const store = { call: vi.fn(async () => ({ op: "web.place" })) } as unknown as ShellStore;
    const onState = vi.fn();
    const surface = registerWebSurface(element, "window-1", store, onState, false);

    expect(request).not.toHaveBeenCalled();
    surface.setActive(true);
    expect(request).toHaveBeenCalledTimes(1);
    surface.setActive(false);
    expect(cancel).toHaveBeenCalledWith(17);
    expect(onState).toHaveBeenLastCalledWith({ kind: "hidden" });
    surface.setActive(true);
    expect(request).toHaveBeenCalledTimes(2);
    surface.unregister();
    element.remove();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("places hidden after an in-flight bounds update and resumes placement when active", async () => {
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = ++frameId; frames.set(id, callback); return id; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
    const element = document.createElement("div");
    document.body.append(element);
    const rect = new DOMRect(bounds.x, bounds.y, bounds.width, bounds.height);
    vi.spyOn(element, "getClientRects").mockReturnValue({ length: 1, item: () => rect } as unknown as DOMRectList);
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect);
    let finishBounds!: () => void;
    let boundsCalls = 0;
    const store = { call: vi.fn((request: { bounds?: Rect | null }) => request.bounds && ++boundsCalls === 1
      ? new Promise<{ op: "web.place" }>((resolve) => { finishBounds = () => resolve({ op: "web.place" }); })
      : Promise.resolve({ op: "web.place" })) } as unknown as ShellStore;
    const registration = registerWebSurface(element, "window-1", store, vi.fn());
    const runFrame = () => {
      const [id, callback] = [...frames.entries()][0];
      frames.delete(id);
      callback(0);
    };

    runFrame();
    await vi.waitFor(() => expect(store.call).toHaveBeenCalledTimes(1));
    expect(store.call).toHaveBeenNthCalledWith(1, { op: "web.place", window_id: "window-1", bounds });

    registration.setActive(false);
    expect(frames.size).toBe(0);
    await Promise.resolve();
    expect(store.call).toHaveBeenCalledTimes(1);
    finishBounds();
    await vi.waitFor(() => expect(store.call).toHaveBeenCalledTimes(2));
    expect(store.call).toHaveBeenNthCalledWith(2, { op: "web.place", window_id: "window-1", bounds: null });

    registration.setActive(true);
    expect(frames.size).toBe(1);
    runFrame();
    await vi.waitFor(() => expect(store.call).toHaveBeenCalledTimes(3));
    expect(store.call).toHaveBeenNthCalledWith(3, { op: "web.place", window_id: "window-1", bounds });

    registration.setActive(false);
    await vi.waitFor(() => expect(store.call).toHaveBeenCalledTimes(4));
    registration.unregister();
    element.remove();
  });
});
