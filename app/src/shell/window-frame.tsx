import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppIcon, IconButton, ScreenShare, Settings, forgetNumbered, useShareView, windowActionActive, type MenuEntry, type ShellStore, type CoreError, type CoreReply, type CoreRequest, type AppWindow } from "@kaleidoscope/ui";
import { ProcessConsent } from "./process-consent";
import { InstallationConsent } from "./installation-consent";
import { windowMenuEntries } from "./window-menu";
import { WindowChrome } from "./window-chrome";

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
  const toggleShare = () => void onCall({ op: "share.set", window_id: appWindow.id, on: !sharing });
  const toggleSettings = () => { if (settingsOpen) closeSettings(); else { setSettingsVisited(true); setSettingsOpen(true); } };
  const closeWindow = () => void onCall({ op: "window.close", window_id: appWindow.id });
  const titleMenu: MenuEntry[] = [
    ...(shareable ? [{ id: "share", label: "같이 보기", checked: sharing, onSelect: toggleShare }] : []),
    ...(hasSettings && settingsAvailable ? [{ id: "settings", label: "앱 설정", checked: settingsOpen, onSelect: toggleSettings }] : []),
    ...((shareable || (hasSettings && settingsAvailable)) ? [{ type: "separator" as const, id: "title-actions-separator" }] : []),
    ...windowMenuEntries(appWindow, { minimize: () => onMinimize(appWindow.id), raise: () => void onCall({ op: "window.raise", window_id: appWindow.id }), maximize: () => onMaximize(appWindow.id), restore: () => onRestore(appWindow.id), close: closeWindow }),
  ];

  useEffect(() => { if (!hasSettings) { setSettingsOpen(false); setSettingsProblem(null); } }, [hasSettings]);

  return <WindowChrome area={area} rect={appWindow.rect} maximized={isMaximized} minimized={isMinimized}
    zIndex={appWindow.z} isTop={isTop} title={windowHeader?.title ?? appName} meta={windowHeader?.meta}
    icon={<AppIcon store={store} appId={appWindow.app_id} appVersion={appWindow.app_version} size="chrome" />}
    titleActions={<>
      {shareable ? <IconButton aria-label={sharing ? "같이 보기 끄기" : "같이 보기"} tone="share" pressed={sharing} onClick={toggleShare}><ScreenShare size="chrome" /></IconButton> : null}
      {hasSettings && settingsAvailable ? <span ref={settingsButton}><IconButton aria-label={settingsProblem ? `앱 설정: ${typeof settingsProblem === "string" ? settingsProblem : settingsProblem.message}` : "앱 설정"} pressed={settingsOpen} onClick={toggleSettings}><Settings size="chrome" /></IconButton></span> : null}
    </>}
    menuEntries={titleMenu} onRaise={() => void onCall({ op: "window.raise", window_id: appWindow.id })}
    onMinimize={() => onMinimize(appWindow.id)} onMaximize={() => onMaximize(appWindow.id)} onRestore={() => onRestore(appWindow.id)} onClose={closeWindow}
    onRectCommit={async (rect) => Boolean(await onCall({ op: "window.set_rect", window_id: appWindow.id, rect }))}
    testId={`app-window-${appWindow.app_id}`} frameRef={setFrameHost} contentRef={contentRef} sharing={sharing}
    pointerGuard={(event) => !event.nativeEvent.isTrusted && windowActionActive(appWindow.id)}
    overlays={<><ProcessConsent store={store} windowId={appWindow.id} host={frameHost} /><InstallationConsent store={store} windowId={appWindow.id} host={frameHost} /></>}>
    {typeof children === "function" ? children(settingsOpen, closeSettings, setSettingsProblem, settingsVisited, reportWindowHeader, reportSettingsAvailable) : children}
  </WindowChrome>;
}
