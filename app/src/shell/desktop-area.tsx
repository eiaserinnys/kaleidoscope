import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AppWindowContent,
  Button,
  EmptyState,
  LayoutGrid,
  Menu,
  focusRescued,
  useShellSelector,
  type AppWindow,
  type Block,
  type CoreReply,
  type CoreRequest,
  type MenuEntry,
  type ShellSnapshot,
  type ShellStore,
  type Rect,
  type WindowSize,
} from "@kaleidoscope/ui";
import { WindowFrame } from "./window-frame";
import { windowMenuEntries } from "./window-menu";
import { systemWindowMenu, type SystemWindowState } from "./system-window";
import { windowSizeForApp } from "./window-geometry";

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
        launcherOpen={launcherOpen}
        getNewWindowRect={getNewWindowRect}
        key={desktop.id}
        onCall={onCall}
        onOpenApps={onOpenApps}
        setWindowMenu={setWindowMenu}
        store={store}
        systemWindow={systemWindow?.state}
      />)}
      {!activeDesktopId ? <section className="ks-desktop-canvas">{emptyState}{systemWindow ? <Taskbar systemWindow={systemWindow.state} setWindowMenu={setWindowMenu} /> : null}</section> : null}
      </div>
      {windowMenu ? <Menu anchor={windowMenu.anchor} items={windowMenu.entries} onClose={() => setWindowMenu(null)} /> : null}
    </main>
  );
}

const DesktopCanvas = memo(function DesktopCanvas({
  desktopId,
  activeDesktopId,
  activeWorkspaceId,
  area,
  launcherOpen,
  onCall,
  onOpenApps,
  setWindowMenu,
  store,
  getNewWindowRect,
  systemWindow,
}: {
  desktopId: string;
  activeDesktopId?: string;
  activeWorkspaceId?: string;
  area: { width: number; height: number };
  launcherOpen: boolean;
  onCall: DesktopAreaProps["onCall"];
  onOpenApps: DesktopAreaProps["onOpenApps"];
  setWindowMenu: (menu: { anchor: HTMLElement; entries: MenuEntry[] } | null) => void;
  store: ShellStore;
  getNewWindowRect?: DesktopAreaProps["getNewWindowRect"];
  systemWindow?: SystemWindowState;
}) {
  const emptyTrigger = useRef<HTMLButtonElement | null>(null);
  const setEmptyTrigger = useCallback((element: HTMLButtonElement | null) => {
    if (!element && emptyTrigger.current && document.activeElement === emptyTrigger.current) {
      const target = document.querySelector<HTMLElement>('.ks-shell-bar button[aria-label="앱 열기"]');
      if (target) focusRescued(target, { preventScroll: true });
    }
    emptyTrigger.current = element;
  }, []);
  const desktop = useShellSelector(store, (snapshot) => snapshot?.shared.desktops.find((item) => item.id === desktopId));
  const windows = useShellSelector(store, (snapshot) => snapshot?.shared.windows.filter((window) => window.desktop_id === desktopId) ?? [], sameReferences);
  const act = useCallback((windowId: string, op: CoreRequest["op"]) => {
    setWindowMenu(null);
    if (op === "window.raise" || op === "window.minimize" || op === "window.maximize" || op === "window.restore" || op === "window.close") {
      void onCall({ op, window_id: windowId });
    }
  }, [onCall, setWindowMenu]);
  if (!desktop) return null;

  const active = desktop.id === activeDesktopId && desktop.workspace_id === activeWorkspaceId;
  const topWindowId = systemWindow?.isTop && active ? null : windows
    .filter((window) => !window.minimized)
    .reduce<(typeof windows)[number] | undefined>(
      (top, window) => !top || window.z > top.z ? window : top,
      undefined,
    )?.id ?? null;
  return <section aria-hidden={!active} className="ks-desktop-canvas" hidden={!active}>
    {windows.length === 0 ? (
      <EmptyState
        action={<Button ref={setEmptyTrigger} aria-haspopup="dialog" aria-expanded={launcherOpen} onClick={(event) => onOpenApps(event.currentTarget)}>앱 열기</Button>}
        icon={<LayoutGrid size="empty" />}
      />
    ) : windows.map((appWindow) => <DesktopWindow
      appWindow={appWindow}
      area={area}
      getNewWindowRect={getNewWindowRect}
      isTop={appWindow.id === topWindowId}
      key={appWindow.id}
      onCall={onCall}
      store={store}
    />)}
    {windows.length > 0 || (active && systemWindow) ? <nav aria-label="작업 표시줄" className="ks-taskbar" role="toolbar">
      <div className="ks-taskbar-windows">
        {windows.map((appWindow) => <TaskbarItem
          isTop={appWindow.id === topWindowId}
          key={appWindow.id}
          onAct={act}
          setWindowMenu={setWindowMenu}
          store={store}
          window={appWindow}
        />)}
        {active && systemWindow ? <SystemTaskbarItem state={systemWindow} setWindowMenu={setWindowMenu} /> : null}
      </div>
    </nav> : null}
  </section>;
});

const TaskbarItem = memo(function TaskbarItem({ window, isTop, store, onAct, setWindowMenu }: {
  window: AppWindow;
  isTop: boolean;
  store: ShellStore;
  onAct: (windowId: string, op: CoreRequest["op"]) => void;
  setWindowMenu: (menu: { anchor: HTMLElement; entries: MenuEntry[] } | null) => void;
}) {
  const title = useShellSelector(store, (snapshot) => windowTitle(window, snapshot));
  const toggle = () => onAct(window.id, !window.minimized && isTop ? "window.minimize" : "window.raise");
  return <TaskbarButton title={title} minimized={Boolean(window.minimized)} isTop={isTop} onClick={toggle} windowId={window.id} onContextMenu={(anchor) => setWindowMenu({
    anchor,
    entries: windowMenuEntries(window, { minimize: () => onAct(window.id, "window.minimize"), raise: () => onAct(window.id, "window.raise"), maximize: () => onAct(window.id, "window.maximize"), restore: () => onAct(window.id, "window.restore"), close: () => onAct(window.id, "window.close") }),
  })} />;
});

function Taskbar({ systemWindow, setWindowMenu }: { systemWindow: SystemWindowState; setWindowMenu: (menu: { anchor: HTMLElement; entries: MenuEntry[] } | null) => void }) {
  return <nav aria-label="작업 표시줄" className="ks-taskbar" role="toolbar"><div className="ks-taskbar-windows"><SystemTaskbarItem state={systemWindow} setWindowMenu={setWindowMenu} /></div></nav>;
}

function SystemTaskbarItem({ state, setWindowMenu }: { state: SystemWindowState; setWindowMenu: (menu: { anchor: HTMLElement; entries: MenuEntry[] } | null) => void }) {
  return <TaskbarButton title="설정" minimized={state.minimized} isTop={state.isTop} onClick={!state.minimized && state.isTop ? state.minimize : state.raise}
    onContextMenu={(anchor) => setWindowMenu({ anchor, entries: systemWindowMenu(state) })} />;
}

function TaskbarButton({ title, minimized, isTop, onClick, onContextMenu, windowId }: { title: string; minimized: boolean; isTop: boolean; onClick: () => void; onContextMenu: (anchor: HTMLElement) => void; windowId?: string }) {
  const state = minimized ? "minimized" : isTop ? "active" : "inactive";
  return <button
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
    <span aria-hidden="true" className="ks-taskbar-window-dot" />
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

function sameDetails(left: { appName: string; shareable: boolean; hasSettings: boolean; settingsAvailableInitially: boolean }, right: { appName: string; shareable: boolean; hasSettings: boolean; settingsAvailableInitially: boolean }) {
  return left.appName === right.appName && left.shareable === right.shareable && left.hasSettings === right.hasSettings
    && left.settingsAvailableInitially === right.settingsAvailableInitially;
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
