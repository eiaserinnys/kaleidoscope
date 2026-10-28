import { useEffect, useRef, useState } from "react";
import {
  AppWindowContent,
  Button,
  EmptyState,
  type AppWindow,
  type CoreRequest,
  type ShellSnapshot,
  type ShellStore,
} from "@kaleidoscope/ui";
import { AppsIcon } from "./icons";
import { WindowFrame } from "./window-frame";

export interface DesktopAreaProps {
  activeDesktopId: string;
  activeWorkspaceId: string;
  onCall: (request: CoreRequest) => void;
  onOpenApps: (anchor: HTMLElement) => void;
  snapshot: ShellSnapshot;
  store: ShellStore;
}

export function DesktopArea({
  activeDesktopId,
  activeWorkspaceId,
  onCall,
  onOpenApps,
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
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
                icon={<AppsIcon />}
                text="열린 앱이 없습니다"
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
}: {
  appWindow: AppWindow;
  area: { width: number; height: number };
  isTop: boolean;
  onCall: (request: CoreRequest) => void;
  snapshot: ShellSnapshot;
  store: ShellStore;
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
      onCall={onCall as ShellStore["call"]}
      window={appWindow}
    >
      <AppWindowContent store={store} windowId={appWindow.id} />
    </WindowFrame>
  );
}
