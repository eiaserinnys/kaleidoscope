import { SHELL_WINDOW_GEOMETRY_TOKEN_INVALID, type Rect, type ShellSnapshot, type WindowSize } from "@kaleidoscope/ui";

const RESIZE_CORNER_SIZE = 12;
/** 바탕 영역 가장자리에서 창과 아이콘이 비켜서는 안쪽 여백. */
export const DESKTOP_USABLE_PADDING = RESIZE_CORNER_SIZE;
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
  windowSize?: WindowSize,
): Rect {
  const usable = usableWindowArea(area);
  const style = getComputedStyle(document.documentElement);
  const minWidth = Number.parseFloat(style.getPropertyValue("--ks-window-min-width"));
  const minHeight = Number.parseFloat(style.getPropertyValue("--ks-window-min-height"));
  if (!Number.isFinite(minWidth) || !Number.isFinite(minHeight)) {
    throw SHELL_WINDOW_GEOMETRY_TOKEN_INVALID();
  }

  const rectFor = (offset: number): Rect => {
    const position = 48 + 32 * offset;
    return {
      x: position,
      y: position,
      width: Math.min(windowSize?.width ?? 880, usable.x + usable.width - position),
      height: Math.min(windowSize?.height ?? 600, usable.y + usable.height - position),
    };
  };

  let rect = rectFor(windowCount % 8);
  if (rect.width < minWidth || rect.height < minHeight) rect = rectFor(0);
  if (rect.width < minWidth || rect.height < minHeight) return usable;
  return rect;
}

export function windowSizeForApp(snapshot: ShellSnapshot, appId: string): WindowSize | undefined {
  const app = snapshot.shared.apps.find((item) => item.id === appId);
  return snapshot.shared.app_versions.find((version) => version.app_id === appId && version.version === app?.current_version)?.definition.window_size;
}
