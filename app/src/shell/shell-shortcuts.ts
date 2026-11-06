import { hasVisibleShortcutOverlay } from "@kaleidoscope/ui";
import type { ShellWindowActions } from "./shell-window-actions";

type Shortcut = "previousDesktop" | "nextDesktop" | "previousWindow" | "nextWindow" | "toggleMaximize" | "minimize" | "maximizeAll" | "minimizeAll";

export function shellShortcut(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): Shortcut | undefined {
  if (!event.ctrlKey || !event.altKey || event.metaKey) return;
  if (event.code === "Tab") return event.shiftKey ? "previousWindow" : "nextWindow";
  if (event.code === "ArrowUp") return event.shiftKey ? "maximizeAll" : "toggleMaximize";
  if (event.code === "ArrowDown") return event.shiftKey ? "minimizeAll" : "minimize";
  if (event.shiftKey) return;
  if (event.code === "ArrowLeft") return "previousDesktop";
  if (event.code === "ArrowRight") return "nextDesktop";
  if (event.code === "PageUp") return "previousWindow";
  if (event.code === "PageDown") return "nextWindow";
}

export function installShellShortcuts(actions: ShellWindowActions): () => void {
  const handle = (event: KeyboardEvent) => {
    const shortcut = shellShortcut(event);
    if (!shortcut) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat || hasVisibleShortcutOverlay()) return;
    switch (shortcut) {
      case "previousDesktop": void actions.desktop(-1); break;
      case "nextDesktop": void actions.desktop(1); break;
      case "previousWindow": void actions.cycleWindow(-1); break;
      case "nextWindow": void actions.cycleWindow(1); break;
      case "toggleMaximize": void actions.toggleMaximizeCurrent(); break;
      case "minimize": void actions.minimizeCurrent(); break;
      case "maximizeAll": void actions.maximizeAll(); break;
      case "minimizeAll": void actions.minimizeAll(); break;
    }
  };
  window.addEventListener("keydown", handle, true);
  return () => window.removeEventListener("keydown", handle, true);
}
