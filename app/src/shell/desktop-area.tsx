import { useEffect, useRef, useState } from "react";
import {
  AppWindowContent,
  Button,
  EmptyState,
  LayoutGrid,
  Menu,
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
  snapshot: ShellSnapshot;
  store: ShellStore;
}

export function DesktopArea({
  activeDesktopId,
  activeWorkspaceId,
  onAreaChange,
  onCall,
  onOpenApps,
  getNewWindowRect,
  snapshot,
  store,
}: DesktopAreaProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [windowMenu, setWindowMenu] = useState<{ anchor: HTMLElement; entries: MenuEntry[] } | null>(null);

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

  const desktops = [...snapshot.shared.desktops].sort((a, b) => a.position - b.position);

  return (
    <main className="ks-desktop-area" ref={areaRef}>
      {desktops.map((desktop) => {
        const active = desktop.id === activeDesktopId && desktop.workspace_id === activeWorkspaceId;
        const windows = snapshot.shared.windows.filter((window) => window.desktop_id === desktop.id);
        const topWindowId = windows
          .filter((window) => !window.minimized)
          .reduce<(typeof windows)[number] | undefined>(
            (top, window) => !top || window.z > top.z ? window : top,
            undefined,
          )?.id ?? null;
        return (
          <section
            aria-hidden={!active}
            className="ks-desktop-canvas"
            hidden={!active}
            key={desktop.id}
          >
            {windows.length === 0 ? (
              <EmptyState
                action={(
                  <Button onClick={(event) => onOpenApps(event.currentTarget)}>
                    앱 열기
                  </Button>
                )}
                icon={<LayoutGrid size="empty" />}
              />
            ) : windows.map((appWindow) => (
              <DesktopWindow
                appWindow={appWindow}
                area={area}
                isTop={appWindow.id === topWindowId}
                key={appWindow.id}
                onCall={onCall}
                snapshot={snapshot}
                store={store}
                getNewWindowRect={getNewWindowRect}
              />
            ))}
            {windows.length > 0 ? (
              <nav aria-label="작업 표시줄" className="ks-taskbar" role="toolbar">
                <div className="ks-taskbar-windows">
                  {windows.map((window) => {
                    const title = windowTitle(window, snapshot);
                    const isTop = window.id === topWindowId;
                    const state = window.minimized ? "minimized" : isTop ? "active" : "inactive";
                    const act = (op: CoreRequest["op"]) => {
                      setWindowMenu(null);
                      if (op === "window.raise") void onCall({ op, window_id: window.id });
                      else if (op === "window.minimize") void onCall({ op, window_id: window.id });
                      else if (op === "window.maximize") void onCall({ op, window_id: window.id });
                      else if (op === "window.restore") void onCall({ op, window_id: window.id });
                      else if (op === "window.close") void onCall({ op, window_id: window.id });
                    };
                    return (
                      <button
                        aria-pressed={!window.minimized && isTop}
                        className="ks-taskbar-item ks-taskbar-window"
                        data-state={state}
                        data-window-id={window.id}
                        key={window.id}
                        onClick={() => act(!window.minimized && isTop ? "window.minimize" : "window.raise")}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setWindowMenu({
                            anchor: event.currentTarget,
                            entries: [
                              { id: "window-toggle", label: window.minimized ? "복원" : "최소화", onSelect: () => act(window.minimized ? "window.raise" : "window.minimize") },
                              { id: "window-size", label: window.maximized ? "이전 크기로 복원" : "최대화", onSelect: () => act(window.maximized ? "window.restore" : "window.maximize") },
                              { id: "window-separator", type: "separator" },
                              { id: "window-close", label: "창 닫기", danger: true, onSelect: () => act("window.close") },
                            ],
                          });
                        }}
                        title={title}
                        type="button"
                      >
                        <span aria-hidden="true" className="ks-taskbar-window-dot" />
                        <span className="ks-taskbar-item-label">{title}</span>
                      </button>
                    );
                  })}
                </div>
              </nav>
            ) : null}
          </section>
        );
      })}
      {windowMenu ? <Menu anchor={windowMenu.anchor} items={windowMenu.entries} onClose={() => setWindowMenu(null)} /> : null}
    </main>
  );
}

function DesktopWindow({
  appWindow,
  area,
  isTop,
  onCall,
  snapshot,
  store,
  getNewWindowRect,
}: {
  appWindow: AppWindow;
  area: { width: number; height: number };
  isTop: boolean;
  onCall: (request: CoreRequest) => Promise<CoreReply | undefined>;
  snapshot: ShellSnapshot;
  store: ShellStore;
  getNewWindowRect?: (desktopId: string, snapshot: ShellSnapshot) => Rect | undefined;
}) {
  const app = snapshot.shared.apps.find((candidate) => candidate.id === appWindow.app_id);
  const version = snapshot.shared.app_versions.find((candidate) =>
    candidate.app_id === appWindow.app_id && candidate.version === appWindow.app_version,
  );
  const appName = version?.definition.name ?? app?.name ?? appWindow.app_id;

  return (
    <WindowFrame
      area={area}
      appName={appName}
      isTop={isTop}
      sharing={snapshot.sharing.includes(appWindow.id)}
      shareable={!version || !containsAgentChat(version.definition.ui)}
      hasSettings={version?.definition.storage?.entries.some((entry) => entry.presentation === "settings") ?? false}
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
        newWindowRect={() => getNewWindowRect?.(appWindow.desktop_id, snapshot)}
        store={store}
        windowId={appWindow.id}
      />}
    </WindowFrame>
  );
}

function windowTitle(window: AppWindow, snapshot: ShellSnapshot): string {
  return snapshot.shared.app_versions.find((version) =>
    version.app_id === window.app_id && version.version === window.app_version,
  )?.definition.name ?? snapshot.shared.apps.find((app) => app.id === window.app_id)?.name ?? window.app_id;
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
