import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { AppIcon, IconButton, Maximize2, Minus, Minimize2, ScreenShare, Settings, X, forgetNumbered, openContextMenu, useShareView, windowActionActive, type MenuEntry, type ShellStore, type CoreError, type CoreReply, type CoreRequest, type AppWindow, type Rect } from "@kaleidoscope/ui";
import { fitWindowRect, usableWindowArea } from "./window-geometry";
import { ProcessConsent } from "./process-consent";
import { windowMenuEntries } from "./window-menu";

export interface WindowFrameProps {
  area: { width: number; height: number };
  appName: string;
  isTop: boolean;
  sharing: boolean;
  shareable: boolean;
  hasSettings?: boolean;
  settingsAvailableInitially?: boolean;
  store: ShellStore;
  onCall: (request: CoreRequest) => Promise<CoreReply | undefined>;
  onMinimize: (windowId: string) => void;
  onMaximize: (windowId: string) => void;
  onRestore: (windowId: string) => void;
  window: AppWindow;
  children: ReactNode | ((settingsOpen: boolean, closeSettings: () => void, reportProblem: (problem: CoreError | string | null) => void, visited: boolean, reportWindowHeader: (title: string, meta: string | null) => void, reportSettingsAvailable: (available: boolean) => void) => ReactNode);
}

type Gesture = {
  kind: "move" | "east" | "south" | "corner";
  pointerId: number;
  startX: number;
  startY: number;
  // 화면에 그린 rect를 조작과 저장의 기준으로 쓴다.
  startRect: Rect;
};

const MIN_WIDTH = "--ks-window-min-width";
const MIN_HEIGHT = "--ks-window-min-height";

export function WindowFrame({ area, appName, isTop, sharing, shareable, hasSettings, settingsAvailableInitially = true, store, onCall, onMinimize, onMaximize, onRestore, window: appWindow, children }: WindowFrameProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [frameHost, setFrameHost] = useState<HTMLDivElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsVisited, setSettingsVisited] = useState(false);
  const [settingsProblem, setSettingsProblem] = useState<CoreError | string | null>(null);
  const [settingsAvailable, setSettingsAvailable] = useState(settingsAvailableInitially);
  const [windowHeader, setWindowHeader] = useState<{ title: string; meta: string | null } | null>(null);
  const settingsButton = useRef<HTMLSpanElement>(null);
  const closeSettings = useCallback(() => { setSettingsOpen(false); requestAnimationFrame(() => settingsButton.current?.querySelector<HTMLButtonElement>("button")?.focus()); }, []);
  const reportWindowHeader = useCallback((title: string, meta: string | null) => {
    setWindowHeader((current) => current?.title === title && current.meta === meta ? current : { title, meta });
  }, []);
  const reportSettingsAvailable = useCallback((available: boolean) => {
    setSettingsAvailable(available);
    if (!available) { setSettingsOpen(false); setSettingsProblem(null); }
  }, []);
  const isMaximized = Boolean(appWindow.maximized);
  const isMinimized = Boolean(appWindow.minimized);
  useShareView({ windowId: appWindow.id, root: contentRef, enabled: sharing && !settingsOpen, store });
  useEffect(() => () => forgetNumbered(appWindow.id), [appWindow.id]);
  const titleRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const previewRef = useRef<Rect | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);
  const displayRect = isMaximized ? usableWindowArea(area) : fitWindowRect(preview ?? appWindow.rect, area);
  const toggleShare = () => void onCall({ op: "share.set", window_id: appWindow.id, on: !sharing });
  const toggleSettings = () => { if (settingsOpen) closeSettings(); else { setSettingsVisited(true); setSettingsOpen(true); } };
  const changeSize = () => isMaximized ? onRestore(appWindow.id) : onMaximize(appWindow.id);
  const closeWindow = () => void onCall({ op: "window.close", window_id: appWindow.id });
  const titleMenu: MenuEntry[] = [
    ...(shareable ? [{ id: "share", label: "같이 보기", checked: sharing, onSelect: toggleShare }] : []),
    ...(hasSettings && settingsAvailable ? [{ id: "settings", label: "앱 설정", checked: settingsOpen, onSelect: toggleSettings }] : []),
    ...((shareable || (hasSettings && settingsAvailable)) ? [{ type: "separator" as const, id: "title-actions-separator" }] : []),
    ...windowMenuEntries(appWindow, { minimize: () => onMinimize(appWindow.id), raise: () => void onCall({ op: "window.raise", window_id: appWindow.id }), maximize: () => onMaximize(appWindow.id), restore: () => onRestore(appWindow.id), close: closeWindow }),
  ];

  useEffect(() => { if (!hasSettings) { setSettingsOpen(false); setSettingsProblem(null); } }, [hasSettings]);

  useEffect(() => {
    const pending = previewRef.current;
    if (gestureRef.current || !pending || pending.x !== appWindow.rect.x || pending.y !== appWindow.rect.y
      || pending.width !== appWindow.rect.width || pending.height !== appWindow.rect.height) return;
    previewRef.current = null;
    setPreview(null);
  }, [appWindow.rect.x, appWindow.rect.y, appWindow.rect.width, appWindow.rect.height]);

  const beginGesture = (kind: Gesture["kind"], event: PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startRect = displayRect;
    gestureRef.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRect,
    };
    previewRef.current = startRect;
    setPreview(startRect);
  };

  const moveGesture = (event: PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    let next: Rect;

    if (gesture.kind === "move") {
      next = fitWindowRect({
        ...gesture.startRect,
        x: gesture.startRect.x + dx,
        y: gesture.startRect.y + dy,
      }, area);
    } else {
      const minWidth = tokenPixels(MIN_WIDTH, titleRef.current);
      const minHeight = tokenPixels(MIN_HEIGHT, titleRef.current);
      const usable = usableWindowArea(area);
      const maxWidth = usable.x + usable.width - gesture.startRect.x;
      const maxHeight = usable.y + usable.height - gesture.startRect.y;
      next = {
        ...gesture.startRect,
        width: gesture.kind === "south" ? gesture.startRect.width : clamp(Math.round(gesture.startRect.width + dx), Math.min(minWidth, maxWidth), maxWidth),
        height: gesture.kind === "east"
          ? gesture.startRect.height
          : clamp(Math.round(gesture.startRect.height + dy), Math.min(minHeight, maxHeight), maxHeight),
      };
    }

    previewRef.current = next;
    setPreview(next);
  };

  const finishGesture = (event: PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    const next = fitWindowRect(previewRef.current ?? gesture.startRect, area);
    previewRef.current = next;
    const changed = gesture.kind === "move"
      ? next.x !== gesture.startRect.x || next.y !== gesture.startRect.y
      : gesture.kind === "east"
        ? next.width !== gesture.startRect.width
        : gesture.kind === "south"
          ? next.height !== gesture.startRect.height
          : next.width !== gesture.startRect.width || next.height !== gesture.startRect.height;
    if (changed) {
      void onCall({ op: "window.set_rect", window_id: appWindow.id, rect: next }).then((reply) => {
        if (!reply && !gestureRef.current && previewRef.current === next) {
          previewRef.current = null;
          setPreview(null);
        }
      });
    } else {
      previewRef.current = null;
      setPreview(null);
    }
  };

  const cancelGesture = (event: PointerEvent<HTMLElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    previewRef.current = null;
    setPreview(null);
  };

  return (
    <section
      className={`ks-window${preview ? " ks-window-gesturing" : ""}${sharing ? " ks-window-sharing" : ""}`}
      data-maximized={isMaximized ? "true" : "false"}
      data-minimized={isMinimized ? "true" : "false"}
      data-testid={`app-window-${appWindow.app_id}`}
      inert={isMinimized}
      onPointerDownCapture={(event) => {
        if (!event.nativeEvent.isTrusted && windowActionActive(appWindow.id)) return;
        if (!isTop) void onCall({ op: "window.raise", window_id: appWindow.id });
      }}
      onPointerMove={moveGesture}
      onPointerUp={finishGesture}
      onPointerCancel={cancelGesture}
      style={{
        left: displayRect.x,
        top: displayRect.y,
        width: displayRect.width,
        height: displayRect.height,
        zIndex: appWindow.z,
      }}
    >
      <div className={`ks-window-frame${isTop ? " ks-window-frame-active" : ""}`} ref={setFrameHost}>
        <header
          className={`ks-window-titlebar${isTop ? " ks-window-titlebar-active" : ""}`}
          onContextMenu={(event) => openContextMenu(event, titleMenu)}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            if (event.target instanceof Element && event.target.closest("button")) return;
            if (isMaximized) return;
            beginGesture("move", event);
          }}
          onDoubleClick={(event) => {
            if (event.target instanceof Element && event.target.closest("button")) return;
            if (isMaximized) onRestore(appWindow.id);
            else onMaximize(appWindow.id);
          }}
          ref={titleRef}
        >
          <AppIcon store={store} appId={appWindow.app_id} appVersion={appWindow.app_version} size="chrome" />
          <div className="ks-window-title-group">
            <span className="ks-window-title" title={windowHeader?.title ?? appName}>{windowHeader?.title ?? appName}</span>
            {windowHeader?.meta ? <span className="ks-window-title-meta" title={windowHeader.meta}>{windowHeader.meta}</span> : null}
          </div>
          <div className="ks-window-title-actions">
          {shareable ? <IconButton aria-label={sharing ? "같이 보기 끄기" : "같이 보기"} tone="share" pressed={sharing} onClick={toggleShare}><ScreenShare size="chrome" /></IconButton> : null}
          {hasSettings && settingsAvailable ? <span ref={settingsButton}><IconButton aria-label={settingsProblem ? `앱 설정: ${typeof settingsProblem === "string" ? settingsProblem : settingsProblem.message}` : "앱 설정"} pressed={settingsOpen} onClick={toggleSettings}><Settings size="chrome" /></IconButton></span> : null}
          <IconButton aria-label="창 최소화" title="창 최소화" onClick={() => onMinimize(appWindow.id)}><Minus size="chrome" /></IconButton>
          <IconButton
            aria-label={isMaximized ? "이전 크기로 복원" : "창 최대화"}
            title={isMaximized ? "이전 크기로 복원" : "창 최대화"}
            onClick={changeSize}
          >
            {isMaximized ? <Minimize2 size="chrome" /> : <Maximize2 size="chrome" />}
          </IconButton>
          <IconButton
            aria-label="창 닫기"
            onClick={closeWindow}
            title="창 닫기"
          >
            <X size="chrome" />
          </IconButton>
          </div>
        </header>
        <div className="ks-window-content" ref={contentRef} tabIndex={-1}>
          {typeof children === "function" ? children(settingsOpen, closeSettings, setSettingsProblem, settingsVisited, reportWindowHeader, reportSettingsAvailable) : children}
        </div>
        <ProcessConsent store={store} windowId={appWindow.id} host={frameHost} />
      </div>
      {!isMaximized ? <div
        aria-hidden="true"
        className="ks-window-resize-east"
        onPointerDown={(event) => beginGesture("east", event)}
      /> : null}
      {!isMaximized ? <div
        aria-hidden="true"
        className="ks-window-resize-south"
        onPointerDown={(event) => beginGesture("south", event)}
      /> : null}
      {!isMaximized ? <div
        aria-hidden="true"
        className="ks-window-resize-corner"
        onPointerDown={(event) => beginGesture("corner", event)}
      /> : null}
    </section>
  );
}

function tokenPixels(name: string, element: HTMLElement | null): number {
  if (!element || typeof getComputedStyle !== "function") return 0;
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return Number.parseFloat(value) || 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
