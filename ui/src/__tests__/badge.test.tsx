import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { Badge, CountBadge, badgeForeground } from "../components/badge";
import { IconTile } from "../components/icon-tile";

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

it("숫자 배지는 0을 숨기고 100부터 99+로 보인다", () => {
  const { container, rerender } = render(<CountBadge count={0} />);
  expect(container.textContent).toBe("");
  rerender(<CountBadge count={100} />);
  expect(screen.getByText("99+").getAttribute("aria-hidden")).toBe("true");
});

it("타일 접근 이름에 알림 수를 더한다", () => {
  render(<IconTile name="앱" aria-label="별도 이름" icon={<i />} badge={2} />);
  expect(screen.getByRole("button", { name: "별도 이름, 알림 2개" })).toBeTruthy();
});

it("아이콘 타일의 점 표시는 빨간 점만 보이고 접근 이름을 바꾸지 않는다", () => {
  const { container } = render(<IconTile name="앱" icon={<i />} dot />);
  const tile = screen.getByRole("button", { name: "앱" });
  expect(tile.querySelector(".ks-icon-tile-icon.ks-badge-anchor .ks-badge.is-count.is-dot")).not.toBeNull();
  expect(tile.querySelector(".is-dot")?.textContent).toBe("");
  expect(container.textContent).not.toContain("알림");
});

it("점 배지는 1 미만이면 숨기고 알림 수와 관계없이 글자 없이 보인다", () => {
  const { container, rerender } = render(<CountBadge count={0} dot />);
  expect(container.querySelector(".is-dot")).toBeNull();
  rerender(<CountBadge count={-1} dot />);
  expect(container.querySelector(".is-dot")).toBeNull();
  for (const count of [1, 12, 150]) {
    rerender(<CountBadge count={count} dot />);
    const dot = container.querySelector(".ks-badge.is-count.is-dot");
    expect(dot).not.toBeNull();
    expect(dot?.textContent).toBe("");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
  }
});
