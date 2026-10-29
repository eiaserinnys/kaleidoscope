import type { Rect } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";

export interface WebSurfaceOccluder {
  bounds: Rect;
  visible: boolean;
}

export interface WebSurfaceWindow extends WebSurfaceOccluder {
  zIndex: number;
}

export interface WebSurfaceProbe {
  visible: boolean;
  bounds: Rect;
  ownZIndex: number;
  overlays: WebSurfaceOccluder[];
  windows: WebSurfaceWindow[];
}

export type WebSurfaceKind = "hidden" | "covered" | "live";

export type WebSurfaceState =
  | { kind: "hidden" }
  | { kind: "live" }
  | { kind: "covered"; image: string | null };

export function evaluateWebSurface(probe: WebSurfaceProbe): WebSurfaceKind {
  if (!probe.visible) return "hidden";
  if (probe.overlays.some((overlay) => overlay.visible && rectanglesOverlap(probe.bounds, overlay.bounds))) {
    return "covered";
  }
  if (probe.windows.some((window) => window.visible
    && window.zIndex > probe.ownZIndex
    && rectanglesOverlap(probe.bounds, window.bounds))) {
    return "covered";
  }
  return "live";
}

export function rectanglesOverlap(left: Rect, right: Rect): boolean {
  const leftX = Math.round(left.x);
  const leftY = Math.round(left.y);
  const leftRight = leftX + Math.round(left.width);
  const leftBottom = leftY + Math.round(left.height);
  const rightX = Math.round(right.x);
  const rightY = Math.round(right.y);
  const rightRight = rightX + Math.round(right.width);
  const rightBottom = rightY + Math.round(right.height);
  return Math.min(leftRight, rightRight) - Math.max(leftX, rightX) > 0
    && Math.min(leftBottom, rightBottom) - Math.max(leftY, rightY) > 0;
}

interface RegisteredSurface {
  element: HTMLElement;
  windowId: string;
  store: ShellStore;
  onState: (state: WebSurfaceState) => void;
  kind: WebSurfaceKind | null;
  bounds: Rect | null;
  generation: number;
}

const surfaces = new Set<RegisteredSurface>();
let animationFrame: number | null = null;

export function registerWebSurface(
  element: HTMLElement,
  windowId: string,
  store: ShellStore,
  onState: (state: WebSurfaceState) => void,
): () => void {
  const surface: RegisteredSurface = { element, windowId, store, onState, kind: null, bounds: null, generation: 0 };
  surfaces.add(surface);
  scheduleFrame();
  return () => {
    surface.generation += 1;
    surfaces.delete(surface);
    if (surfaces.size === 0 && animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  };
}

function scheduleFrame() {
  if (animationFrame !== null || surfaces.size === 0) return;
  animationFrame = requestAnimationFrame(readSurfaces);
}

function readSurfaces() {
  animationFrame = null;
  for (const surface of surfaces) updateSurface(surface);
  scheduleFrame();
}

function updateSurface(surface: RegisteredSurface) {
  const { element } = surface;
  const rendered = element.isConnected && element.getClientRects().length > 0;
  const rect = rendered ? element.getBoundingClientRect() : null;
  const bounds = rect ? roundedRect(rect) : null;
  const ownWindow = element.closest<HTMLElement>(".ks-window");
  const siblings = ownWindow?.parentElement
    ? [...ownWindow.parentElement.querySelectorAll<HTMLElement>(".ks-window")].filter((item) => item !== ownWindow)
    : [];
  const overlays = [...document.querySelectorAll<HTMLElement>("[data-ks-overlay]")]
    .map((item) => ({ visible: isRendered(item), bounds: item.getBoundingClientRect() }))
    .map(({ visible, bounds: itemBounds }) => ({ visible, bounds: roundedRect(itemBounds) }));
  const windows = siblings.map((item) => ({
    visible: isRendered(item),
    bounds: roundedRect(item.getBoundingClientRect()),
    zIndex: Number.parseFloat(getComputedStyle(item).zIndex) || 0,
  }));
  const ownZIndex = ownWindow ? Number.parseFloat(getComputedStyle(ownWindow).zIndex) || 0 : 0;
  const kind = bounds
    ? evaluateWebSurface({ visible: rendered, bounds, ownZIndex, overlays, windows })
    : "hidden";

  if (kind === "hidden") {
    if (surface.kind !== "hidden") {
      surface.kind = "hidden";
      surface.bounds = null;
      surface.generation += 1;
      surface.onState({ kind: "hidden" });
      void callPlace(surface, null);
    }
    return;
  }

  if (kind === "live") {
    if (surface.kind !== "live" || !sameRect(surface.bounds, bounds)) {
      surface.kind = "live";
      surface.bounds = bounds;
      surface.generation += 1;
      surface.onState({ kind: "live" });
      void callPlace(surface, bounds);
    }
    return;
  }

  if (surface.kind === "covered") return;
  surface.kind = "covered";
  surface.bounds = bounds;
  const generation = ++surface.generation;
  void captureThenHide(surface, generation);
}

async function captureThenHide(surface: RegisteredSurface, generation: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutReply = new Promise<null>((resolve) => {
    timeout = setTimeout(() => resolve(null), 300);
  });
  const captureReply = surface.store.call({ op: "web.capture", window_id: surface.windowId })
    .then((reply) => reply.op === "web.capture" ? reply.image : null)
    .catch(() => null);
  const image = await Promise.race([captureReply, timeoutReply]);
  if (timeout !== undefined) clearTimeout(timeout);
  if (!surfaces.has(surface) || surface.generation !== generation || surface.kind !== "covered") return;
  surface.onState({ kind: "covered", image });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (!surfaces.has(surface) || surface.generation !== generation || surface.kind !== "covered") return;
  void callPlace(surface, null);
}

function callPlace(surface: RegisteredSurface, bounds: Rect | null) {
  return surface.store.call({ op: "web.place", window_id: surface.windowId, bounds }).catch(() => undefined);
}

function isRendered(element: HTMLElement): boolean {
  if (!element.isConnected || element.getClientRects().length === 0) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function roundedRect(rect: DOMRect): Rect {
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function sameRect(left: Rect | null, right: Rect | null): boolean {
  return left !== null && right !== null
    && left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}
