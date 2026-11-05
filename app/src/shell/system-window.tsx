import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { SHELL_WINDOW_GEOMETRY_TOKEN_INVALID, type Rect } from "@kaleidoscope/ui";
import { fitWindowRect, usableWindowArea } from "./window-geometry";
import { WindowChrome } from "./window-chrome";
import { windowMenuEntries } from "./window-menu";

export interface SystemWindowState {
  minimized: boolean;
  maximized: boolean;
  z: number;
  isTop: boolean;
  raise: () => void;
  minimize: () => void;
  maximize: () => void;
  restore: () => void;
  close: () => void;
}

export function systemWindowMenu(state: SystemWindowState) {
  return windowMenuEntries(state, state);
}

export function SystemWindow({ area, state, title, icon, lastRect, testId, children }: {
  area: { width: number; height: number }; state: SystemWindowState; title: string; icon: ReactNode;
  lastRect: RefObject<Rect | null>; testId: string; children: ReactNode;
}) {
  const [rect, setRect] = useState<Rect | null>(lastRect.current);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (rect || !area.width || !area.height) return;
    const style = getComputedStyle(document.documentElement);
    const width = Number.parseFloat(style.getPropertyValue("--ks-window-min-width")) * 1.5;
    const height = Number.parseFloat(style.getPropertyValue("--ks-window-min-height")) * 1.5;
    if (!Number.isFinite(width) || !Number.isFinite(height)) throw SHELL_WINDOW_GEOMETRY_TOKEN_INVALID();
    const usable = usableWindowArea(area);
    const next = fitWindowRect({ x: usable.x + (usable.width - width) / 2, y: usable.y + (usable.height - height) / 2, width, height }, area);
    lastRect.current = next;
    setRect(next);
  }, [area, rect, lastRect]);
  if (!rect) return null;
  return <WindowChrome area={area} rect={rect} maximized={state.maximized} minimized={state.minimized} zIndex={state.z}
    isTop={state.isTop} title={title} icon={icon} menuEntries={systemWindowMenu(state)}
    onRaise={state.raise} onMinimize={state.minimize} onMaximize={state.maximize} onRestore={state.restore} onClose={state.close}
    onRectCommit={async (next) => { lastRect.current = next; setRect(next); return true; }}
    testId={testId} contentRef={content}>{children}</WindowChrome>;
}
