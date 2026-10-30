import { useEffect, useRef, useState } from "react";
import {
  AppWindowContent,
  Button,
  EmptyState,
  LayoutGrid,
  type AppWindow,
  type Block,
  type CoreReply,
  type CoreRequest,
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
        const topZ = Math.max(0, ...windows.map((window) => window.z));
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
                isTop={appWindow.z === topZ}
                key={appWindow.id}
                onCall={onCall}
                snapshot={snapshot}
                store={store}
                getNewWindowRect={getNewWindowRect}
              />
            ))}
          </section>
        );
      })}
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

function containsAgentChat(block: Block): boolean {
  switch (block.type) {
    case "agent_chat": return true;
    case "split": case "stack": return block.children.some(containsAgentChat);
    case "tabs": return block.tabs.some((tab) => containsAgentChat(tab.child));
    case "toolbar": return [...block.start, ...(block.end ?? [])].some(containsAgentChat);
    case "section": return containsAgentChat(block.child);
    default: return false;
  }
}
