import type { BlockContext } from "../blocks/block-context";
import { Notice, StatusText } from "../components/primitives";
import type { ShellStore } from "../core/shell-store";
import { useShellSnapshot } from "../core/shell-store";
import { renderBlock } from "./render-block";

export function AppWindowContent({ store, windowId }: { store: ShellStore; windowId: string }) {
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

  const context: BlockContext = { store, snapshot, window, definition: version.definition };
  return (
    <div className="ks-app-window-content">
      {renderBlock(version.definition.ui, context)}
    </div>
  );
}
