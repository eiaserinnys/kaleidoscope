import { hasShellBlockingOverlay } from "@kaleidoscope/ui";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { ShellWindowActions } from "./shell-window-actions";

type Shortcut = "previousDesktop" | "nextDesktop" | "previousWindow" | "nextWindow" | "toggleMaximize" | "minimize" | "restoreAll" | "minimizeAll";

export function shellShortcut(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): Shortcut | undefined {
  if (!event.ctrlKey || !event.altKey || event.metaKey) return;
  if (event.code === "Tab") return event.shiftKey ? "previousWindow" : "nextWindow";
  if (event.code === "ArrowUp") return event.shiftKey ? "restoreAll" : "toggleMaximize";
  if (event.code === "ArrowDown") return event.shiftKey ? "minimizeAll" : "minimize";
  if (event.shiftKey) return;
  if (event.code === "ArrowLeft") return "previousDesktop";
  if (event.code === "ArrowRight") return "nextDesktop";
  if (event.code === "PageUp") return "previousWindow";
  if (event.code === "PageDown") return "nextWindow";
}

export function installShellShortcuts(actions: ShellWindowActions): () => void {
  const execute = (shortcut: Shortcut) => {
    if (hasShellBlockingOverlay()) return;
    switch (shortcut) {
      case "previousDesktop": void actions.desktop(-1); break;
      case "nextDesktop": void actions.desktop(1); break;
      case "previousWindow": void actions.cycleWindow(-1); break;
      case "nextWindow": void actions.cycleWindow(1); break;
      case "toggleMaximize": void actions.toggleMaximizeCurrent(); break;
      case "minimize": void actions.minimizeCurrent(); break;
      case "restoreAll": void actions.restoreAll(); break;
      case "minimizeAll": void actions.minimizeAll(); break;
    }
  };
  const handle = (event: KeyboardEvent) => {
    const shortcut = shellShortcut(event);
    if (!shortcut) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) execute(shortcut);
  };
  let cancelled = false;
  let unlisten: (() => void) | undefined;
  if (isTauri()) {
    void getCurrentWebview().listen<{ code: string; shift: boolean }>("shell-shortcut", ({ payload }) => {
      if (cancelled) return;
      const shortcut = shellShortcut({ code: payload.code, shiftKey: payload.shift, ctrlKey: true, altKey: true, metaKey: false });
      if (shortcut) execute(shortcut);
    }).then((stop) => { if (cancelled) stop(); else unlisten = stop; });
  }
  window.addEventListener("keydown", handle, true);
  return () => { cancelled = true; unlisten?.(); window.removeEventListener("keydown", handle, true); };
}
