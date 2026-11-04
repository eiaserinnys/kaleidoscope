import type { CoreError, WindowAction, WindowGeometry } from "../contract/contract";
import * as errors from "../contract/shell-errors";
import { pointerClick } from "./action-events";
import { framePointHandler } from "./frame-point";
import { inConsent, ownedOverlays } from "./overlay-owner";
import { topPainted } from "./paint-order";
import { visibleClip } from "./visible";

export async function pointElement(root: HTMLElement, windowId: string, geometry: WindowGeometry | undefined, action: Extract<WindowAction, { kind: "point" }>, requestId: string): Promise<CoreError | undefined> {
  if (!geometry) return errors.SHELL_WINDOW_CONTROL_GEOMETRY_CHANGED();
  if (action.x < 0 || action.y < 0 || action.x >= geometry.pixel_width || action.y >= geometry.pixel_height) return errors.SHELL_WINDOW_CONTROL_POINT_OUTSIDE({ x: String(action.x), y: String(action.y) });
  const bounds = root.getBoundingClientRect();
  if (bounds.width !== geometry.css_width || bounds.height !== geometry.css_height) return errors.SHELL_WINDOW_CONTROL_GEOMETRY_CHANGED();
  const x = bounds.left + action.x * geometry.css_width / geometry.pixel_width;
  const y = bounds.top + action.y * geometry.css_height / geometry.pixel_height;
  const roots = [root, ...ownedOverlays(windowId)];
  const candidates = [...new Set(roots.flatMap((surface) => [surface, ...surface.querySelectorAll("*")]))].filter((candidate): candidate is HTMLElement => {
    if (!(candidate instanceof HTMLElement)) return false;
    for (let node: HTMLElement | null = candidate; node; node = node.parentElement) {
      if (node.hidden || getComputedStyle(node).display === "none") return false;
    }
    const rect = candidate.getBoundingClientRect(), clip = visibleClip(candidate), style = getComputedStyle(candidate);
    return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom && x >= clip.left && x < clip.right && y >= clip.top && y < clip.bottom && style.visibility === "visible";
  });
  const target = topPainted(candidates);
  if (!target) return errors.SHELL_WINDOW_CONTROL_ACTION_UNSUPPORTED({ target: "좌표", action: "point" });
  if (inConsent(target)) return errors.SHELL_WINDOW_CONTROL_CONSENT_BLOCKED();
  if (!target.matches("canvas, iframe")) return errors.SHELL_WINDOW_CONTROL_ACTION_UNSUPPORTED({ target: "좌표", action: "point" });
  if (target instanceof HTMLIFrameElement) {
    const handler = framePointHandler(target);
    if (!handler) return errors.SHELL_WINDOW_CONTROL_ACTION_UNSUPPORTED({ target: "프레임", action: "point" });
    const rect = target.getBoundingClientRect();
    await handler(x - rect.left, y - rect.top, action.gesture, requestId);
  } else pointerClick(target, x, y, action.gesture);
}
