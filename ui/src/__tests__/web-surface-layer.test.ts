import { describe, expect, it, vi } from "vitest";
import { evaluateWebSurface, isFullyVisible } from "../blocks/web-surface-layer";
import type { Rect } from "../contract/contract";

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

  it("does not let a minimized window cover a live web surface", () => {
    const canvas = document.createElement("div");
    canvas.className = "ks-desktop-canvas";
    const target = document.createElement("section");
    target.className = "ks-window";
    target.style.zIndex = "1";
    const surface = document.createElement("div");
    target.append(surface);
    const minimized = document.createElement("section");
    minimized.className = "ks-window";
    minimized.dataset.minimized = "true";
    minimized.style.zIndex = "2";
    canvas.append(target, minimized);
    document.body.append(canvas);
    const rect = { left: 20, top: 20, right: 120, bottom: 100, x: 20, y: 20, width: 100, height: 80, toJSON() {} };
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    const clientRects = vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1, item: () => rect } as unknown as DOMRectList);

    expect(isFullyVisible(surface)).toBe(true);

    bounds.mockRestore();
    clientRects.mockRestore();
    canvas.remove();
  });
});
