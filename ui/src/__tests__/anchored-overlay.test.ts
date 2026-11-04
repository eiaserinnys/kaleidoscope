import { describe, expect, it } from "vitest";
import { computeAnchoredPosition } from "../components/anchored-overlay";

const base = { width: 120, height: 60, viewportWidth: 360, viewportHeight: 300, inset: 12 };
describe("anchored overlay placement", () => {
  it("keeps menu placement below, flips above, and clamps the screen edge", () => {
    expect(computeAnchoredPosition({ ...base, rect: { left: 24, top: 100, bottom: 140 } })).toEqual({ left: 24, top: 140 });
    expect(computeAnchoredPosition({ ...base, rect: { left: 320, top: 250, bottom: 290 } })).toEqual({ left: 228, top: 190 });
  });
  it("prefers above for a tooltip and uses below when there is no room", () => {
    expect(computeAnchoredPosition({ ...base, rect: { left: 24, top: 100, bottom: 140 }, preferAbove: true })).toEqual({ left: 24, top: 40 });
    expect(computeAnchoredPosition({ ...base, rect: { left: 24, top: 20, bottom: 60 }, preferAbove: true })).toEqual({ left: 24, top: 60 });
  });
});

describe("tooltip placement", () => {
  it("keeps an 8px gap above and below the anchor", () => {
    expect(computeAnchoredPosition({ ...base, rect: { left: 24, right: 104, top: 100, bottom: 140 }, preferAbove: true, offset: 8 })).toEqual({ left: 24, top: 32 });
    expect(computeAnchoredPosition({ ...base, rect: { left: 24, right: 104, top: 20, bottom: 60 }, preferAbove: true, offset: 8 })).toEqual({ left: 24, top: 68 });
  });
  it("aligns the tooltip right edge to its anchor on overflow, then respects the inset", () => {
    expect(computeAnchoredPosition({ ...base, rect: { left: 280, right: 330, top: 100, bottom: 140 }, preferAbove: true, alignEndOnOverflow: true })).toEqual({ left: 210, top: 40 });
    expect(computeAnchoredPosition({ ...base, rect: { left: 340, right: 400, top: 100, bottom: 140 }, preferAbove: true, alignEndOnOverflow: true })).toEqual({ left: 228, top: 40 });
  });
});
