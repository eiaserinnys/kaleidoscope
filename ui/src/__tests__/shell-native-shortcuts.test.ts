import { afterEach, expect, it, vi } from "vitest";
import { installShellShortcuts } from "../../../app/src/shell/shell-shortcuts";
import type { ShellWindowActions } from "../../../app/src/shell/shell-window-actions";
import { focusRescued } from "../components/focus-rescue";

const native = vi.hoisted(() => ({ event: "", receive: undefined as undefined | ((event: { payload: { code: string; shift: boolean; alt: boolean } }) => void), stop: vi.fn() }));
vi.mock("../../../app/node_modules/@tauri-apps/api/core.js", () => ({ isTauri: () => true }));
vi.mock("../../../app/node_modules/@tauri-apps/api/webview.js", () => ({ getCurrentWebview: () => ({ listen: vi.fn(async (name: string, receive: typeof native.receive) => { native.event = name; native.receive = receive; return native.stop; }) }) }));
afterEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); });

it("창 안 대화상자는 창 순환 단축키를 막지 않는다", async () => {
  const actions = { desktop: vi.fn(), cycleWindow: vi.fn() } as unknown as ShellWindowActions;
  const dispose = installShellShortcuts(actions);
  await Promise.resolve();
  const frame = document.createElement("div");
  frame.className = "ks-window-frame ks-window-frame-active";
  const host = document.createElement("div");
  host.className = "ks-data-window";
  host.dataset.windowId = "window-a";
  const dialog = document.createElement("div");
  dialog.className = "ks-dialog";
  dialog.setAttribute("role", "dialog");
  host.appendChild(dialog);
  frame.appendChild(host);
  document.body.append(frame);
  native.receive?.({ payload: { code: "PageDown", shift: false, alt: true } });
  expect(actions.cycleWindow).toHaveBeenCalledExactlyOnceWith(1);
  dispose();
});

it("네이티브 입력도 같은 실행기와 모달 정책을 거치고 해제한다", async () => {
  const actions = { desktop: vi.fn(), cycleWindow: vi.fn() } as unknown as ShellWindowActions;
  const dispose = installShellShortcuts(actions);
  await Promise.resolve();
  expect(native.event).toBe("shell-shortcut");
  native.receive?.({ payload: { code: "ArrowRight", shift: false, alt: true } });
  expect(actions.desktop).toHaveBeenCalledExactlyOnceWith(1);
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  native.receive?.({ payload: { code: "PageDown", shift: false, alt: true } });
  expect(actions.cycleWindow).not.toHaveBeenCalled();
  dialog.remove();
  native.receive?.({ payload: { code: "Tab", shift: true, alt: true } });
  expect(actions.cycleWindow).toHaveBeenCalledExactlyOnceWith(-1);
  dispose();
  expect(native.stop).toHaveBeenCalledOnce();
});

it("포인터를 쓴 뒤 네이티브 창 전환 단축키를 받으면 다음 쉘 초점에 링이 보인다", async () => {
  const actions = { cycleWindow: vi.fn() } as unknown as ShellWindowActions;
  const dispose = installShellShortcuts(actions);
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  try {
    await Promise.resolve();
    const target = document.createElement("button");
    document.body.append(target);
    document.dispatchEvent(new Event("pointerdown"));
    focusRescued(target);
    expect(focus.mock.lastCall?.[0]).toMatchObject({ focusVisible: false });
    native.receive?.({ payload: { code: "PageDown", shift: false, alt: true } });
    expect(actions.cycleWindow).toHaveBeenCalledExactlyOnceWith(1);
    focusRescued(target);
    expect(focus.mock.lastCall?.[0]).toMatchObject({ focusVisible: true });
  } finally {
    focus.mockRestore();
    dispose();
  }
});

it("포인터를 쓴 뒤 문서 창 전환 단축키를 받으면 다음 쉘 초점에 링이 보인다", () => {
  const actions = { cycleWindow: vi.fn() } as unknown as ShellWindowActions;
  const dispose = installShellShortcuts(actions);
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  try {
    const target = document.createElement("button");
    document.body.append(target);
    document.dispatchEvent(new Event("pointerdown"));
    focusRescued(target);
    expect(focus.mock.lastCall?.[0]).toMatchObject({ focusVisible: false });
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "PageDown", ctrlKey: true, altKey: true, bubbles: true }));
    expect(actions.cycleWindow).toHaveBeenCalledExactlyOnceWith(1);
    focusRescued(target);
    expect(focus.mock.lastCall?.[0]).toMatchObject({ focusVisible: true });
  } finally {
    focus.mockRestore();
    dispose();
  }
});

it("Ctrl과 PageUp/PageDown만 누르면 작업을 앞뒤로 바꾼다", async () => {
  const desktop = vi.fn();
  const workspace = vi.fn();
  const dispose = installShellShortcuts({ desktop, workspace } as unknown as ShellWindowActions);
  await Promise.resolve();
  native.receive?.({ payload: { code: "PageDown", shift: false, alt: false } });
  expect(workspace).toHaveBeenCalledExactlyOnceWith(1);
  workspace.mockClear();
  native.receive?.({ payload: { code: "PageUp", shift: false, alt: false } });
  expect(workspace).toHaveBeenCalledExactlyOnceWith(-1);
  workspace.mockClear();
  native.receive?.({ payload: { code: "ArrowRight", shift: false, alt: false } });
  expect(desktop).not.toHaveBeenCalled();
  expect(workspace).not.toHaveBeenCalled();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  native.receive?.({ payload: { code: "PageDown", shift: false, alt: false } });
  expect(workspace).not.toHaveBeenCalled();
  dispose();
});
