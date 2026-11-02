import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppWindowContent,
  Button,
  EmptyState,
  LayoutGrid,
  Menu,
  useShellSelector,
  type AppWindow,
  type Block,
  type CoreReply,
  type CoreRequest,
  type MenuEntry,
  type ShellSnapshot,
  type ShellStore,
  type Rect,
} from "@kaleidoscope/ui";
import { WindowFrame } from "./window-frame";

export interface DesktopAreaProps {
  activeDesktopId: string;
  activeWorkspaceId: string;
  onAreaChange: (area: { width: number; height: number }) => void;
  onCall: (request: CoreRequest) => Promise<CoreReply | undefined>;
  onOpenApps: (anchor: HTMLElement) => void;
  getNewWindowRect?: (desktopId: string, snapshot: ShellSnapshot) => Rect | undefined;
  store: ShellStore;
}

export function DesktopArea({
  activeDesktopId,
  activeWorkspaceId,
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
      {desktops.map((desktop) => <DesktopCanvas
        activeDesktopId={activeDesktopId}
        activeWorkspaceId={activeWorkspaceId}
        area={area}
        desktopId={desktop.id}
        getNewWindowRect={getNewWindowRect}
        key={desktop.id}
        onCall={onCall}
        onOpenApps={onOpenApps}
        setWindowMenu={setWindowMenu}
        store={store}
      />)}
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
  onOpenApps,
  setWindowMenu,
  store,
  getNewWindowRect,
}: {
  desktopId: string;
  activeDesktopId: string;
  activeWorkspaceId: string;
  area: { width: number; height: number };
  onCall: DesktopAreaProps["onCall"];
  onOpenApps: DesktopAreaProps["onOpenApps"];
  setWindowMenu: (menu: { anchor: HTMLElement; entries: MenuEntry[] } | null) => void;
  store: ShellStore;
  getNewWindowRect?: DesktopAreaProps["getNewWindowRect"];
}) {
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
  const topWindowId = windows
    .filter((window) => !window.minimized)
    .reduce<(typeof windows)[number] | undefined>(
      (top, window) => !top || window.z > top.z ? window : top,
      undefined,
    )?.id ?? null;
  return <section aria-hidden={!active} className="ks-desktop-canvas" hidden={!active}>
    {windows.length === 0 ? (
      <EmptyState
        action={<Button onClick={(event) => onOpenApps(event.currentTarget)}>앱 열기</Button>}
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
    {windows.length > 0 ? <nav aria-label="작업 표시줄" className="ks-taskbar" role="toolbar">
      <div className="ks-taskbar-windows">
        {windows.map((appWindow) => <TaskbarItem
          isTop={appWindow.id === topWindowId}
          key={appWindow.id}
          onAct={act}
          setWindowMenu={setWindowMenu}
          store={store}
          window={appWindow}
        />)}
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
  const state = window.minimized ? "minimized" : isTop ? "active" : "inactive";
  const toggle = () => onAct(window.id, !window.minimized && isTop ? "window.minimize" : "window.raise");
  return <button
    aria-pressed={!window.minimized && isTop}
    className="ks-taskbar-item ks-taskbar-window"
    data-state={state}
    data-window-id={window.id}
    onClick={toggle}
    onContextMenu={(event) => {
      event.preventDefault();
      setWindowMenu({
        anchor: event.currentTarget,
        entries: [
          { id: "window-toggle", label: window.minimized ? "복원" : "최소화", onSelect: () => onAct(window.id, window.minimized ? "window.raise" : "window.minimize") },
          { id: "window-size", label: window.maximized ? "이전 크기로 복원" : "최대화", onSelect: () => onAct(window.id, window.maximized ? "window.restore" : "window.maximize") },
          { id: "window-separator", type: "separator" },
          { id: "window-close", label: "창 닫기", danger: true, onSelect: () => onAct(window.id, "window.close") },
        ],
      });
    }}
    title={title}
    type="button"
  >
    <span aria-hidden="true" className="ks-taskbar-window-dot" />
    <span className="ks-taskbar-item-label">{title}</span>
  </button>;
});

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
      hasSettings: version?.definition.storage?.entries.some((entry) => entry.presentation === "settings") ?? false,
    };
  }, sameDetails);
  const sharing = useShellSelector(store, (snapshot) => snapshot?.sharing.includes(appWindow.id) ?? false);
  const newWindowRect = useMemo(() => () => {
    const snapshot = store.getSnapshot();
    return snapshot ? getNewWindowRect?.(appWindow.desktop_id, snapshot) : undefined;
  }, [appWindow.desktop_id, getNewWindowRect, store]);

  return <WindowFrame
    area={area}
    appName={details.appName}
    isTop={isTop}
    sharing={sharing}
    shareable={details.shareable}
    hasSettings={details.hasSettings}
    store={store}
    onCall={onCall}
    onMinimize={(windowId) => { void onCall({ op: "window.minimize", window_id: windowId }); }}
    onMaximize={(windowId) => { void onCall({ op: "window.maximize", window_id: windowId }); }}
    onRestore={(windowId) => { void onCall({ op: "window.restore", window_id: windowId }); }}
    window={appWindow}
  >
    {(settingsOpen, closeSettings, reportProblem, visited) => <AppWindowContent
      settingsOpen={settingsOpen}
      settingsVisited={visited}
      onSettingsClose={closeSettings}
      onSettingsProblem={reportProblem}
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

function sameDetails(left: { appName: string; shareable: boolean; hasSettings: boolean }, right: { appName: string; shareable: boolean; hasSettings: boolean }) {
  return left.appName === right.appName && left.shareable === right.shareable && left.hasSettings === right.hasSettings;
}

function sameReferences<T>(left: readonly T[], right: readonly T[]): boolean {
  return left === right || (left.length === right.length && left.every((item, index) => item === right[index]));
}

function containsAgentChat(block: Block): boolean {
  switch (block.type) {
    case "chat": return block.permission === undefined
      && block.root === undefined
      && block.agents === undefined
      && block.selected === undefined
      && block.on_select === undefined;
    case "split": case "stack": return block.children.some(containsAgentChat);
    case "tabs": return block.tabs.some((tab) => containsAgentChat(tab.child));
    case "toolbar": return [...block.start, ...(block.end ?? [])].some(containsAgentChat);
    case "section": return containsAgentChat(block.child);
    default: return false;
  }
}
