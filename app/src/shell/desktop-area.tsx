import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AppWindowContent,
  AppIcon,
  ChevronLeft,
  ChevronRight,
  CountBadge,
  IconButton,
  LayoutGrid,
  Maximize2,
  Menu,
  Minus,
  Settings,
  useShellSelector,
  type AppWindow,
  type Block,
  type CoreReply,
  type CoreRequest,
  type MenuEntry,
  type PickFilesSpec,
  type ShellSnapshot,
  type ShellStore,
  type Rect,
  type WindowSize,
} from "@kaleidoscope/ui";
import { WindowFrame } from "./window-frame";
import { windowMenuEntries } from "./window-menu";
import { systemWindowMenu, type SystemWindowState } from "./system-window";
import { windowSizeForApp } from "./window-geometry";
import type { ShellWindowActions } from "./shell-window-actions";

export interface DesktopAreaProps {
  activeDesktopId?: string;
  activeWorkspaceId?: string;
  canvasKey: string;
  systemWindow?: { state: SystemWindowState; render: (area: { width: number; height: number }) => ReactNode };
  emptyState?: ReactNode;
  launcherOpen: boolean;
  onAreaChange: (area: { width: number; height: number }) => void;
  onCall: (request: CoreRequest) => Promise<CoreReply | undefined>;
  onOpenApps: (anchor: HTMLElement) => void;
  getNewWindowRect?: (desktopId: string, snapshot: ShellSnapshot, size?: WindowSize) => Rect | undefined;
  store: ShellStore;
  windowActions: ShellWindowActions;
}

export function DesktopArea({
  activeDesktopId,
  activeWorkspaceId,
  canvasKey,
  systemWindow,
  emptyState,
  launcherOpen,
  onAreaChange,
  onCall,
  onOpenApps,
  getNewWindowRect,
  store,
  windowActions,
}: DesktopAreaProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [windowMenu, setWindowMenu] = useState<{ anchor: HTMLElement; entries: MenuEntry[] } | null>(null);
  const desktops = useShellSelector(store, (snapshot) => snapshot?.shared.desktops.slice().sort((a, b) => a.position - b.position) ?? [], sameReferences);

  useEffect(() => {
    const element = areaRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setArea({ width: entry.contentRect.width, height: entry.contentRect.height });
      onAreaChange({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onAreaChange]);

  return (
    <main className="ks-desktop-area" ref={areaRef}>
      {/* 동률인 앱 창이 뒤에 그려져 설정 창 위로 올라온다. */}
      {systemWindow?.render(area)}
      <div key={canvasKey}>
      {desktops.map((desktop) => <DesktopCanvas
        activeDesktopId={activeDesktopId}
        activeWorkspaceId={activeWorkspaceId}
        area={area}
        desktopId={desktop.id}
        getNewWindowRect={getNewWindowRect}
        key={desktop.id}
        onCall={onCall}
        store={store}
        systemWindow={systemWindow?.state}
      />)}
      {!activeDesktopId ? <section className="ks-desktop-canvas">{emptyState}</section> : null}
      </div>
      <Taskbar activeDesktopId={activeDesktopId} desktopCount={desktops.filter((desktop) => desktop.workspace_id === activeWorkspaceId).length}
        launcherOpen={launcherOpen} onOpenApps={onOpenApps} onCall={onCall} store={store} systemWindow={systemWindow?.state}
        setWindowMenu={setWindowMenu} windowActions={windowActions} />
      {windowMenu ? <Menu anchor={windowMenu.anchor} items={windowMenu.entries} onClose={() => setWindowMenu(null)} /> : null}
    </main>
  );
}

const DesktopCanvas = memo(function DesktopCanvas({
  desktopId,
  activeDesktopId,
  activeWorkspaceId,
  area,
  onCall,
  store,
  getNewWindowRect,
  systemWindow,
}: {
  desktopId: string;
  activeDesktopId?: string;
  activeWorkspaceId?: string;
  area: { width: number; height: number };
  onCall: DesktopAreaProps["onCall"];
  store: ShellStore;
  getNewWindowRect?: DesktopAreaProps["getNewWindowRect"];
  systemWindow?: SystemWindowState;
}) {
  const desktop = useShellSelector(store, (snapshot) => snapshot?.shared.desktops.find((item) => item.id === desktopId));
  const windows = useShellSelector(store, (snapshot) => snapshot?.shared.windows.filter((window) => window.desktop_id === desktopId) ?? [], sameReferences);
  if (!desktop) return null;

  const active = desktop.id === activeDesktopId && desktop.workspace_id === activeWorkspaceId;
  const topWindowId = systemWindow?.isTop && active ? null : windows
    .filter((window) => !window.minimized)
    .reduce<(typeof windows)[number] | undefined>(
      (top, window) => !top || window.z > top.z ? window : top,
      undefined,
    )?.id ?? null;
  return <section aria-hidden={!active} className="ks-desktop-canvas" hidden={!active}>
    {windows.map((appWindow) => <DesktopWindow
      appWindow={appWindow}
      area={area}
      getNewWindowRect={getNewWindowRect}
      isTop={appWindow.id === topWindowId}
      key={appWindow.id}
      onCall={onCall}
      store={store}
    />)}
  </section>;
});

function AppLauncherButton({ store, expanded, disabled, onClick }: { store: ShellStore; expanded: boolean; disabled: boolean; onClick: (anchor: HTMLElement) => void }) {
  const count = useShellSelector(store, (snapshot) => Object.values(snapshot?.app_badges ?? {}).reduce((sum, value) => sum + value, 0));
  return <IconButton variant="taskbar" className="ks-app-launcher-button" disabled={disabled} aria-label={count ? `앱 열기, 알림 ${count}개` : "앱 열기"} aria-haspopup="dialog" aria-expanded={expanded} onClick={(event) => onClick(event.currentTarget)} title="앱 열기">
    <span className="ks-badge-anchor"><LayoutGrid /><CountBadge count={count} dot /></span>
  </IconButton>;
}

function Taskbar({ activeDesktopId, desktopCount, launcherOpen, onOpenApps, onCall, store, systemWindow, setWindowMenu, windowActions }: {
  activeDesktopId?: string; desktopCount: number; launcherOpen: boolean; onOpenApps: DesktopAreaProps["onOpenApps"];
  onCall: DesktopAreaProps["onCall"]; store: ShellStore; systemWindow?: SystemWindowState;
  setWindowMenu: (menu: { anchor: HTMLElement; entries: MenuEntry[] } | null) => void; windowActions: ShellWindowActions;
}) {
  const windows = useShellSelector(store, (snapshot) => snapshot?.shared.windows.filter((window) => window.desktop_id === activeDesktopId) ?? [], sameReferences);
  const topWindowId = systemWindow?.isTop ? null : windows.filter((window) => !window.minimized)
    .reduce<AppWindow | undefined>((top, window) => !top || window.z > top.z ? window : top, undefined)?.id ?? null;
  const act = useCallback((windowId: string, op: CoreRequest["op"]) => {
    setWindowMenu(null);
    if (op === "window.raise" || op === "window.minimize" || op === "window.maximize" || op === "window.restore" || op === "window.close") void onCall({ op, window_id: windowId });
  }, [onCall, setWindowMenu]);
  const canMinimize = windows.some((window) => !window.minimized) || Boolean(systemWindow && !systemWindow.minimized);
  const canMaximize = windows.length > 0 || Boolean(systemWindow);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const updateFade = () => {
      list.dataset.fadeStart = String(list.scrollLeft > 1);
      list.dataset.fadeEnd = String(list.scrollWidth - list.clientWidth - list.scrollLeft > 1);
    };
    updateFade();
    list.addEventListener("scroll", updateFade);
    const observer = new ResizeObserver(updateFade);
    observer.observe(list);
    return () => {
      list.removeEventListener("scroll", updateFade);
      observer.disconnect();
    };
  }, [windows.length, Boolean(systemWindow)]);
  return <nav aria-label="작업 표시줄" className="ks-taskbar" role="toolbar">
    <IconButton variant="taskbar" aria-label="이전 데스크톱" title="이전 데스크톱 (Ctrl+Alt+←)" disabled={!activeDesktopId || desktopCount < 2} onClick={() => void windowActions.desktop(-1)}><ChevronLeft /></IconButton>
    <AppLauncherButton store={store} expanded={launcherOpen} disabled={!activeDesktopId} onClick={onOpenApps} />
    <div ref={listRef} className="ks-taskbar-windows" onWheel={(event) => { event.currentTarget.scrollLeft += event.deltaY; }}>
      {windows.map((window) => <TaskbarItem key={window.id} window={window} isTop={window.id === topWindowId} store={store} onAct={act} setWindowMenu={setWindowMenu} />)}
      {systemWindow ? <SystemTaskbarItem state={systemWindow} setWindowMenu={setWindowMenu} /> : null}
    </div>
    <IconButton variant="taskbar" aria-label="모든 창 최소화" title="모든 창 최소화 (Ctrl+Alt+Shift+↓)" disabled={!canMinimize} onClick={() => void windowActions.minimizeAll()}><Minus /></IconButton>
    <IconButton variant="taskbar" aria-label="모든 창 최대화" title="모든 창 최대화 (Ctrl+Alt+Shift+↑)" disabled={!canMaximize} onClick={() => void windowActions.maximizeAll()}><Maximize2 /></IconButton>
    <IconButton variant="taskbar" aria-label="다음 데스크톱" title="다음 데스크톱 (Ctrl+Alt+→)" disabled={!activeDesktopId || desktopCount < 2} onClick={() => void windowActions.desktop(1)}><ChevronRight /></IconButton>
  </nav>;
}

const TaskbarItem = memo(function TaskbarItem({ window, isTop, store, onAct, setWindowMenu }: {
  window: AppWindow;
  isTop: boolean;
  store: ShellStore;
  onAct: (windowId: string, op: CoreRequest["op"]) => void;
  setWindowMenu: (menu: { anchor: HTMLElement; entries: MenuEntry[] } | null) => void;
}) {
  const title = useShellSelector(store, (snapshot) => windowTitle(window, snapshot));
  const itemRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isTop) itemRef.current?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [isTop]);
  const toggle = () => onAct(window.id, !window.minimized && isTop ? "window.minimize" : "window.raise");
  return <TaskbarButton ref={itemRef} title={title} icon={<AppIcon store={store} appId={window.app_id} appVersion={window.app_version} size="chrome" />} minimized={Boolean(window.minimized)} isTop={isTop} onClick={toggle} windowId={window.id} onContextMenu={(anchor) => setWindowMenu({
    anchor,
    entries: windowMenuEntries(window, { minimize: () => onAct(window.id, "window.minimize"), raise: () => onAct(window.id, "window.raise"), maximize: () => onAct(window.id, "window.maximize"), restore: () => onAct(window.id, "window.restore"), close: () => onAct(window.id, "window.close") }),
  })} />;
});

function SystemTaskbarItem({ state, setWindowMenu }: { state: SystemWindowState; setWindowMenu: (menu: { anchor: HTMLElement; entries: MenuEntry[] } | null) => void }) {
  const itemRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (state.isTop) itemRef.current?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [state.isTop]);
  return <TaskbarButton ref={itemRef} title="설정" icon={<Settings className="ks-app-icon" size="chrome" />} minimized={state.minimized} isTop={state.isTop} onClick={!state.minimized && state.isTop ? state.minimize : state.raise}
    onContextMenu={(anchor) => setWindowMenu({ anchor, entries: systemWindowMenu(state) })} />;
}

function TaskbarButton({ ref, title, icon, minimized, isTop, onClick, onContextMenu, windowId }: { ref?: React.Ref<HTMLButtonElement>; title: string; icon: ReactNode; minimized: boolean; isTop: boolean; onClick: () => void; onContextMenu: (anchor: HTMLElement) => void; windowId?: string }) {
  const state = minimized ? "minimized" : isTop ? "active" : "inactive";
  return <button
    ref={ref}
    aria-pressed={!minimized && isTop}
    className="ks-taskbar-item ks-taskbar-window"
    data-state={state}
    data-window-id={windowId}
    onClick={onClick}
    onContextMenu={(event) => {
      event.preventDefault();
      onContextMenu(event.currentTarget);
    }}
    title={title}
    type="button"
  >
    {icon}
    <span className="ks-taskbar-item-label">{title}</span>
  </button>;
}

const DesktopWindow = memo(function DesktopWindow({ appWindow, area, isTop, onCall, store, getNewWindowRect }: {
  appWindow: AppWindow;
  area: { width: number; height: number };
  isTop: boolean;
  onCall: DesktopAreaProps["onCall"];
  store: ShellStore;
  getNewWindowRect?: DesktopAreaProps["getNewWindowRect"];
}) {
  const details = useShellSelector(store, (snapshot) => {
    const version = snapshot?.shared.app_versions.find((candidate) =>
      candidate.app_id === appWindow.app_id && candidate.version === appWindow.app_version,
    );
    const app = snapshot?.shared.apps.find((candidate) => candidate.id === appWindow.app_id);
    return {
      appName: version?.definition.name ?? app?.name ?? appWindow.app_id,
      fileDrop: version?.definition.file_drop,
      shareable: !version || !containsAgentChat(version.definition.ui),
      hasSettings: Boolean(version?.definition.settings)
        || (version?.definition.storage?.entries.some((entry) => entry.presentation === "settings") ?? false),
      settingsAvailableInitially: version?.definition.settings?.available === undefined
        || version.definition.settings.available === true,
    };
  }, sameDetails);
  const sharing = useShellSelector(store, (snapshot) => snapshot?.sharing.includes(appWindow.id) ?? false);
  const newWindowRect = useMemo(() => (appId: string) => {
    const snapshot = store.getSnapshot();
    return snapshot ? getNewWindowRect?.(appWindow.desktop_id, snapshot, windowSizeForApp(snapshot, appId)) : undefined;
  }, [appWindow.desktop_id, getNewWindowRect, store]);

  return <WindowFrame
    key={`${appWindow.id}:${appWindow.app_version}`}
    area={area}
    appName={details.appName}
    fileDrop={details.fileDrop}
    isTop={isTop}
    sharing={sharing}
    shareable={details.shareable}
    hasSettings={details.hasSettings}
    settingsAvailableInitially={details.settingsAvailableInitially}
    store={store}
    onCall={onCall}
    onMinimize={(windowId) => { void onCall({ op: "window.minimize", window_id: windowId }); }}
    onMaximize={(windowId) => { void onCall({ op: "window.maximize", window_id: windowId }); }}
    onRestore={(windowId) => { void onCall({ op: "window.restore", window_id: windowId }); }}
    window={appWindow}
  >
    {(settingsOpen, closeSettings, reportProblem, visited, reportWindowHeader, reportSettingsAvailable) => <AppWindowContent
      settingsOpen={settingsOpen}
      settingsVisited={visited}
      onSettingsClose={closeSettings}
      onSettingsProblem={reportProblem}
      onWindowHeader={reportWindowHeader}
      onSettingsAvailable={reportSettingsAvailable}
      newWindowRect={newWindowRect}
      store={store}
      windowId={appWindow.id}
    />}
  </WindowFrame>;
});

function windowTitle(window: AppWindow, snapshot: ShellSnapshot | null): string {
  return snapshot?.shared.app_versions.find((version) =>
    version.app_id === window.app_id && version.version === window.app_version,
  )?.definition.name ?? snapshot?.shared.apps.find((app) => app.id === window.app_id)?.name ?? window.app_id;
}

function sameDetails(left: { appName: string; fileDrop: PickFilesSpec | undefined; shareable: boolean; hasSettings: boolean; settingsAvailableInitially: boolean }, right: { appName: string; fileDrop: PickFilesSpec | undefined; shareable: boolean; hasSettings: boolean; settingsAvailableInitially: boolean }) {
  return left.appName === right.appName && left.shareable === right.shareable && left.hasSettings === right.hasSettings
    && left.settingsAvailableInitially === right.settingsAvailableInitially && left.fileDrop === right.fileDrop;
}

function sameReferences<T>(left: readonly T[], right: readonly T[]): boolean {
  return left === right || (left.length === right.length && left.every((item, index) => item === right[index]));
}

function containsAgentChat(block: Block): boolean {
  switch (block.type) {
    case "chat": return block.client === undefined;
    case "split": case "stack": return block.children.some(containsAgentChat);
    case "tabs": return block.tabs.some((tab) => containsAgentChat(tab.child));
    case "toolbar": return [...block.start, ...(block.end ?? [])].some(containsAgentChat);
    case "section": return containsAgentChat(block.child);
    default: return false;
  }
}
