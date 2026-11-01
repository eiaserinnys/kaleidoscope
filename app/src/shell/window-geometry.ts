import type { Rect } from "@kaleidoscope/ui";

const RESIZE_CORNER_SIZE = 12;
export const TASKBAR_HEIGHT = 40;
const TASKBAR_RESERVED_BOTTOM = RESIZE_CORNER_SIZE + TASKBAR_HEIGHT + RESIZE_CORNER_SIZE;

export function usableWindowArea(area: { width: number; height: number }) {
  return {
    x: RESIZE_CORNER_SIZE,
    y: RESIZE_CORNER_SIZE,
    width: Math.max(0, area.width - 2 * RESIZE_CORNER_SIZE),
    height: Math.max(0, area.height - RESIZE_CORNER_SIZE - TASKBAR_RESERVED_BOTTOM),
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
  const usable = usableWindowArea(area);
  const style = getComputedStyle(document.documentElement);
  const minWidth = Number.parseFloat(style.getPropertyValue("--ks-window-min-width"));
  const minHeight = Number.parseFloat(style.getPropertyValue("--ks-window-min-height"));
  if (!Number.isFinite(minWidth) || !Number.isFinite(minHeight)) {
    throw new Error("필수 창 최소 크기 토큰을 읽을 수 없습니다");
  }

  const rectFor = (offset: number): Rect => {
    const position = 48 + 32 * offset;
    return {
      x: position,
      y: position,
      width: Math.min(880, usable.x + usable.width - position),
      height: Math.min(600, usable.y + usable.height - position),
    };
  };

  let rect = rectFor(windowCount % 8);
  if (rect.width < minWidth || rect.height < minHeight) rect = rectFor(0);
  if (rect.width < minWidth || rect.height < minHeight) return usable;
  return rect;
}
