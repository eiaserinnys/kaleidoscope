import type { MenuEntry } from "@kaleidoscope/ui";

export function windowMenuEntries(window: { minimized?: boolean; maximized?: boolean }, actions: { minimize: () => void; raise: () => void; maximize: () => void; restore: () => void; close: () => void }): MenuEntry[] {
  return [
    { id: "window-toggle", label: window.minimized ? "복원" : "창 최소화", onSelect: window.minimized ? actions.raise : actions.minimize },
    { id: "window-size", label: window.maximized ? "이전 크기로 복원" : "창 최대화", onSelect: window.maximized ? actions.restore : actions.maximize },
    { id: "window-separator", type: "separator" },
    { id: "window-close", label: "창 닫기", onSelect: actions.close },
  ];
}
