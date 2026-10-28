import type { Rect } from "@kaleidoscope/ui";

export function makeNewWindowRect(
  area: { width: number; height: number },
  windowCount: number,
  minWidth: number,
  minHeight: number,
): Rect {
  const offset = windowCount % 8;
  const x = 48 + 32 * offset;
  const y = 48 + 32 * offset;
  return {
    x,
    y,
    width: Math.max(minWidth, Math.min(880, area.width - x - 24)),
    height: Math.max(minHeight, Math.min(600, area.height - y - 24)),
  };
}
