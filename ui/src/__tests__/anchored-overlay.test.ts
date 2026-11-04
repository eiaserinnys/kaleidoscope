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
