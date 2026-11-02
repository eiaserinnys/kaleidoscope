import { AppSettings } from "../settings/app-settings";
import { WindowDataProvider } from "../data/window-data";
import { ClientShareSignal, WindowNotice } from "../data/window-notice";
import type { BlockContext } from "../blocks/block-context";
import { Notice, StatusText } from "../components/primitives";
import type { ShellStore } from "../core/shell-store";
import type { Rect } from "../contract/contract";
import { useShellSnapshot } from "../core/shell-store";
import { renderBlock } from "./render-block";

export function AppWindowContent({
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
  onSettingsProblem?: (message: string | null) => void;
}) {
  const snapshot = useShellSnapshot(store);
  if (!snapshot) {
    const error = store.getError();
    return error
      ? <div className="ks-app-content-error"><Notice role="alert">{error.message}</Notice></div>
      : <div className="ks-app-content-loading"><StatusText>불러오는 중</StatusText></div>;
  }

  const window = snapshot.shared.windows.find((item) => item.id === windowId);
  if (!window) return <div className="ks-app-content-error"><Notice role="alert">앱 창을 찾을 수 없습니다</Notice></div>;

  const version = snapshot.shared.app_versions.find(
    (item) => item.app_id === window.app_id && item.version === window.app_version,
  );
  if (!version) return <div className="ks-app-content-error"><Notice role="alert">앱 정의를 찾을 수 없습니다</Notice></div>;

  const context: BlockContext = { store, snapshot, window, definition: version.definition, newWindowRect };
  const hasSettings = version.definition.storage?.entries.some((entry) => entry.presentation === "settings") ?? false;
  if (version.definition.requires.blocks < 4 && !hasSettings && !version.definition.agent) return <div className="ks-app-window-content">{renderBlock(version.definition.ui, context)}</div>;
  return <WindowDataProvider store={store} appWindow={window} definition={version.definition}>
    <div className="ks-app-window-content ks-data-window">
      <ClientShareSignal />
      <div className="ks-data-window-body" hidden={settingsOpen} inert={settingsOpen || undefined}>{renderBlock(version.definition.ui, context)}</div>
      {hasSettings && settingsVisited ? <AppSettings key={window.app_version} context={context} open={settingsOpen} onClose={onSettingsClose} onProblem={onSettingsProblem} /> : null}
      <div className="ks-data-window-notice"><WindowNotice /></div>
    </div>
  </WindowDataProvider>;
}
