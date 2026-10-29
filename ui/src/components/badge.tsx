import type { Badge as BadgeValue } from "../contract/contract";

export function validColor(color: unknown): color is string {
  return typeof color === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color);
}
function luminance(color: string): number {
  const hex = color.trim().slice(1);
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
export function badgeForeground(color: string): string {
  const style = getComputedStyle(document.documentElement);
  const background = luminance(color);
  const dark = luminance(style.getPropertyValue("--ks-color-on-color-dark"));
  const light = luminance(style.getPropertyValue("--ks-color-on-color-light"));
  const contrast = (value: number) => (Math.max(background, value) + 0.05) / (Math.min(background, value) + 0.05);
  return contrast(dark) >= contrast(light) ? "var(--ks-color-on-color-dark)" : "var(--ks-color-on-color-light)";
}
export function isBadge(value: unknown): value is BadgeValue {
  return typeof value === "string" || (typeof value === "object" && value !== null && "text" in value && typeof value.text === "string");
}
export function Badge({ value }: { value: BadgeValue }) {
  const color = typeof value === "object" && validColor(value.color) ? value.color : undefined;
  return <span className="ks-badge" style={color ? { backgroundColor: color, color: badgeForeground(color) } : undefined}>{typeof value === "string" ? value : value.text}</span>;
}
