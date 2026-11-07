import { afterEach, expect, it, vi } from "vitest";
import { hasShellBlockingOverlay, hasVisibleShortcutOverlay, registerAppShortcuts } from "../runtime/shortcuts";

afterEach(() => { document.body.innerHTML = ""; });

function windowDialog(windowId: string, active: boolean) {
  const frame = document.createElement("div");
  frame.className = `ks-window-frame${active ? " ks-window-frame-active" : ""}`;
  const shell = document.createElement("section");
  shell.className = "ks-window";
  shell.dataset.windowId = windowId;
  const host = document.createElement("div");
  host.className = "ks-data-window";
  host.dataset.windowId = windowId;
  const overlay = document.createElement("div");
  overlay.className = "ks-dialog-overlay";
  const dialog = document.createElement("div");
  dialog.className = "ks-dialog";
  dialog.setAttribute("role", "dialog");
  overlay.appendChild(dialog);
  host.appendChild(overlay);
  shell.appendChild(host);
  frame.appendChild(shell);
  document.body.appendChild(frame);
  return { frame, shell, host, overlay, dialog };
}

function overlay(role: string) {
  const element = document.createElement("div");
  element.setAttribute("role", role);
  document.body.appendChild(element);
  return element;
}

function key(code: string, key = code === "Space" ? " " : code) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code, key });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

const snapshot = {
  device: { active_workspace_id: "w", active_desktop_ids: { w: "d" } },
  shared: { desktops: [{ id: "d", workspace_id: "w" }], windows: [
    { id: "a", desktop_id: "d", z: 1, minimized: false },
    { id: "b", desktop_id: "d", z: 2, minimized: false },
  ] },
};

it("창 안 대화상자는 쉘 단축키를 막지 않고 쉘 전체 대화상자와 메뉴는 막는다", () => {
  windowDialog("a", true);
  expect(hasShellBlockingOverlay()).toBe(false);
  const shellDialog = overlay("dialog");
  expect(hasShellBlockingOverlay()).toBe(true);
  shellDialog.remove();
  overlay("menu");
  expect(hasShellBlockingOverlay()).toBe(true);
});

it("숨은 덮개는 단축키를 막지 않는다", () => {
  const holder = document.createElement("div");
  holder.setAttribute("hidden", "");
  const dialog = document.createElement("div");
  dialog.className = "ks-dialog";
  dialog.setAttribute("role", "dialog");
  holder.appendChild(dialog);
  document.body.appendChild(holder);
  expect(hasShellBlockingOverlay()).toBe(false);
  expect(hasVisibleShortcutOverlay()).toBe(false);
});

it("맨 위 창의 대화상자는 그 창의 앱 단축키를 막고 가려진 창의 대화상자는 막지 않는다", () => {
  const behind = windowDialog("a", false);
  expect(hasVisibleShortcutOverlay()).toBe(false);
  behind.frame.classList.add("ks-window-frame-active");
  expect(hasVisibleShortcutOverlay()).toBe(true);
});

it("통제된 입력에서는 창 임자가 맞는 대화상자를 지금처럼 막는다", () => {
  windowDialog("a", false);
  expect(hasVisibleShortcutOverlay("a", true)).toBe(true);
  expect(hasVisibleShortcutOverlay("b", true)).toBe(false);
});

it("가려진 창의 대화상자는 앞 창의 앱 단축키를 막지 않는다", () => {
  const action = vi.fn();
  const context = { store: { getSnapshot: () => snapshot }, window: { id: "b", desktop_id: "d" } } as never;
  const dispose = registerAppShortcuts(context, [{ code: "KeyR", modifiers: [], action: { client: "go" } }], action);
  const behind = windowDialog("a", false);
  key("KeyR", "r");
  expect(action).toHaveBeenCalledTimes(1);
  behind.frame.classList.add("ks-window-frame-active");
  key("KeyR", "r");
  expect(action).toHaveBeenCalledTimes(1);
  dispose();
});
