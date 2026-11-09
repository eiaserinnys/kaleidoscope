import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  SHELL_PROGRAM_CLOSE_UNSAVED,
  runSavedTransition,
  toCoreError,
  type CoreError,
  type ShellStore,
} from "@kaleidoscope/ui";

const CLOSE_REQUESTED = "shell-close-requested";

/**
 * 네이티브 X와 Alt+F4가 보낸 닫기 요청을 열린 모든 창의 저장으로 잇는다.
 * 저장을 마치지 못하면 프로그램을 닫지 않고 쉘의 알림으로 알린다.
 */
export function installNativeClose(store: ShellStore, setNotice: (error: CoreError) => void): () => void {
  if (!isTauri()) return () => {};
  let disposed = false;
  let finishing: Promise<void> | undefined;
  let unlisten: (() => void) | undefined;

  const finish = async () => {
    const windows = store.getSnapshot()?.shared.windows ?? [];
    let saved: boolean;
    try {
      saved = await runSavedTransition(store, windows.map((window) => window.id), async () => {
        await invoke("shell_finish_close");
      });
    } catch (reason) {
      if (!disposed) setNotice(toCoreError(reason));
      return;
    }
    if (!saved && !disposed) setNotice(SHELL_PROGRAM_CLOSE_UNSAVED());
  };

  // 저장 중 다시 닫기 요청이 와도 진행 중인 같은 작업에 합류한다.
  const request = () => {
    if (finishing) {
      void finishing;
      return;
    }
    finishing = finish().finally(() => {
      finishing = undefined;
    });
  };

  void listen(CLOSE_REQUESTED, () => {
    if (!disposed) request();
  }).then((stop) => {
    if (disposed) stop();
    else unlisten = stop;
  });
  void invoke("shell_close_ready", { ready: true });

  return () => {
    disposed = true;
    unlisten?.();
    void invoke("shell_close_ready", { ready: false });
  };
}
