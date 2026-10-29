import { describe, expect, it } from "vitest";
import { evaluateWebSurface } from "../blocks/web-surface-layer";
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
});
