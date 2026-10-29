import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { Badge, badgeForeground } from "../components/badge";

const foundation = readFileSync(resolve(cwd(), "src/styles/foundation.css"), "utf8");

function luminance(color: string) {
  const parts = color.match(/[0-9a-f]{2}/gi)!.map((part) => parseInt(part, 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (x + 0.05) / (y + 0.05);
}
for (const name of ["dark", "light"]) {
  const value = foundation.match(new RegExp(`--ks-color-on-color-${name}:\\s*(#[0-9a-f]+)`))?.[1];
  if (!value) throw new Error(`색 토큰 없음: ${name}`);
  document.documentElement.style.setProperty(`--ks-color-on-color-${name}`, value);
}
it.each([
  ["#ffffff", "var(--ks-color-on-color-dark)", "#222935"],
  ["#2f7d4f", "var(--ks-color-on-color-light)", "#ffffff"],
  ["#315da8", "var(--ks-color-on-color-light)", "#ffffff"],
  ["#f5c542", "var(--ks-color-on-color-dark)", "#222935"],
])("chooses the more legible foreground for %s", (background, token, color) => {
  expect(badgeForeground(background)).toBe(token);
  expect(contrast(background, color)).toBeGreaterThanOrEqual(4.5);
});
it("uses the theme default for an invalid color", () => {
  render(<Badge value={{ text: "상태", color: "red" }} />);
  expect(screen.getByText("상태").getAttribute("style")).toBeNull();
});
