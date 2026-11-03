import { memo, useEffect, useMemo } from "react";
import { AppSettings } from "../settings/app-settings";
import { WindowDataProvider, useWindowData, useDormant } from "../data/window-data";
import { ClientShareSignal, WindowNotice } from "../data/window-notice";
import type { BlockContext, WindowIdentity } from "../blocks/block-context";
import { ErrorNotice, StatusText } from "../components/primitives";
import type { ShellStore } from "../core/shell-store";
import type { CoreError, Rect } from "../contract/contract";
import { useShellSelector } from "../core/shell-store";
import { registerAppShortcuts } from "../runtime/shortcuts";
import { renderBlock } from "./render-block";
import * as shellErrors from "../contract/shell-errors";

export const AppWindowContent = memo(function AppWindowContent({
  store,
  windowId,
  newWindowRect,
  settingsOpen = false,
  settingsVisited = false,
  onSettingsClose = () => undefined,
  onSettingsProblem,
}: {
  store: ShellStore;
  windowId: string;
  newWindowRect?: () => Rect | undefined;
  settingsOpen?: boolean;
  settingsVisited?: boolean;
  onSettingsClose?: () => void;
  onSettingsProblem?: (problem: CoreError | string | null) => void;
}) {
  const window = useShellSelector(store, (snapshot) => {
    const item = snapshot?.shared.windows.find((candidate) => candidate.id === windowId);
    return item ? { id: item.id, app_id: item.app_id, app_version: item.app_version, desktop_id: item.desktop_id } : null;
  }, sameWindowIdentity);
  const version = useShellSelector(store, (snapshot) => window
    ? snapshot?.shared.app_versions.find((item) => item.app_id === window.app_id && item.version === window.app_version)
    : undefined);
  const context = useMemo<BlockContext | null>(() => window && version ? {
    store, window, definition: version.definition, newWindowRect,
  } : null, [store, window, version, newWindowRect]);

  if (!store.getSnapshot()) {
    const error = store.getError();
    return error
      ? <div className="ks-app-content-error"><ErrorNotice error={error} /></div>
      : <div className="ks-app-content-loading"><StatusText>불러오는 중</StatusText></div>;
  }
  if (!window) return <div className="ks-app-content-error"><ErrorNotice error={shellErrors.SHELL_APP_WINDOW_NOT_FOUND()} /></div>;
  if (!version || !context) return <div className="ks-app-content-error"><ErrorNotice error={shellErrors.SHELL_APP_VERSION_NOT_FOUND()} /></div>;

  const hasSettings = version.definition.storage?.entries.some((entry) => entry.presentation === "settings") ?? false;
  if (version.definition.requires.blocks < 4 && !hasSettings && !version.definition.agent) return <div className="ks-app-window-content" data-ks-app-id={window.app_id}>{renderBlock(version.definition.ui, context)}</div>;
  return <WindowDataProvider store={store} windowId={window.id} definition={version.definition}>
    <WindowBody context={context} settingsOpen={settingsOpen} settingsVisited={settingsVisited} onSettingsClose={onSettingsClose} onSettingsProblem={onSettingsProblem} />
  </WindowDataProvider>;
});

function sameWindowIdentity(left: WindowIdentity | null, right: WindowIdentity | null) {
  return left === right || Boolean(left && right && left.id === right.id && left.app_id === right.app_id && left.app_version === right.app_version && left.desktop_id === right.desktop_id);
}

function AppShortcuts({ context, active }: { context: BlockContext; active: boolean }) {
  const data = useWindowData();
  useEffect(() => {
    const shortcuts = context.definition.shortcuts;
    if (!active || !shortcuts?.length) return;
    return registerAppShortcuts(context, shortcuts, (index, modifiers) => { void data.act(`/shortcuts/${index}/action`, null, undefined, modifiers); });
  }, [active, context, data]);
  return null;
}

function WindowBody({ context, settingsOpen, settingsVisited, onSettingsClose, onSettingsProblem }: {
  context: BlockContext; settingsOpen: boolean; settingsVisited: boolean; onSettingsClose: () => void; onSettingsProblem?: (problem: CoreError | string | null) => void;
}) {
  const data = useWindowData();
  const hasSettings = context.definition.storage?.entries.some((entry) => entry.presentation === "settings") ?? false;
  useDormant("/ui", settingsOpen);
  useEffect(() => { data.setClientDormant(settingsOpen); }, [data, settingsOpen]);
  return <div ref={data.setClientHost} className="ks-app-window-content ks-data-window" data-ks-app-id={context.window.app_id}>
    <ClientShareSignal />
    <AppShortcuts context={context} active={!settingsOpen} />
    <div className="ks-data-window-body" hidden={settingsOpen} inert={settingsOpen || undefined}>{renderBlock(context.definition.ui, context)}</div>
    {hasSettings && settingsVisited ? <AppSettings key={context.window.app_version} context={context} open={settingsOpen} onClose={onSettingsClose} onProblem={onSettingsProblem} /> : null}
    <div className="ks-data-window-notice"><WindowNotice /></div>
  </div>;
}
