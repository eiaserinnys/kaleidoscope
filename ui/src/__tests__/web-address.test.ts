import { describe, expect, it } from "vitest";
import { normalizeWebAddress } from "../blocks/web-address";

describe("web address input", () => {
  it("keeps explicit http schemes and trims surrounding whitespace", () => {
    expect(normalizeWebAddress("  HTTP://example.org/path  ")).toBe("HTTP://example.org/path");
    expect(normalizeWebAddress("https://example.org")).toBe("https://example.org");
  });

  it("adds https to address-like input without spaces", () => {
    expect(normalizeWebAddress("example.org/path")).toBe("https://example.org/path");
    expect(normalizeWebAddress("localhost:5173")).toBe("https://localhost:5173");
  });

  it("searches for input that does not look like an address", () => {
    expect(normalizeWebAddress("two words / query")).toBe("https://www.google.com/search?q=two%20words%20%2F%20query");
    expect(normalizeWebAddress("" )).toBe("https://www.google.com/search?q=");
  });
});
