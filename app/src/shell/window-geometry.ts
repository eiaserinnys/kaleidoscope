import type { Rect } from "@kaleidoscope/ui";

const RESIZE_CORNER_SIZE = 12;

export function usableWindowArea(area: { width: number; height: number }) {
  return {
    x: RESIZE_CORNER_SIZE,
    y: RESIZE_CORNER_SIZE,
    width: Math.max(0, area.width - 2 * RESIZE_CORNER_SIZE),
    height: Math.max(0, area.height - 2 * RESIZE_CORNER_SIZE),
  };
}

export function fitWindowRect(rect: Rect, area: { width: number; height: number }): Rect {
  const usable = usableWindowArea(area);
  const width = Math.min(rect.width, usable.width);
  const height = Math.min(rect.height, usable.height);
  return {
    x: Math.round(Math.min(Math.max(rect.x, usable.x), usable.x + usable.width - width)),
    y: Math.round(Math.min(Math.max(rect.y, usable.y), usable.y + usable.height - height)),
    width,
    height,
  };
}

export function makeNewWindowRect(
  area: { width: number; height: number },
  windowCount: number,
): Rect {
  const offset = windowCount % 8;
  return fitWindowRect({ x: 48 + 32 * offset, y: 48 + 32 * offset, width: 880, height: 600 }, area);
}
