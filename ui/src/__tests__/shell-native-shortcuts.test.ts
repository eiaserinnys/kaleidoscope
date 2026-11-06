import { afterEach, expect, it, vi } from "vitest";
import { installShellShortcuts } from "../../../app/src/shell/shell-shortcuts";
import type { ShellWindowActions } from "../../../app/src/shell/shell-window-actions";

const native = vi.hoisted(() => ({ receive: undefined as undefined | ((event: { payload: { code: string; shift: boolean } }) => void), stop: vi.fn() }));
vi.mock("../../../app/node_modules/@tauri-apps/api/core.js", () => ({ isTauri: () => true }));
vi.mock("../../../app/node_modules/@tauri-apps/api/webview.js", () => ({ getCurrentWebview: () => ({ listen: vi.fn(async (_: string, receive: typeof native.receive) => { native.receive = receive; return native.stop; }) }) }));
afterEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); });

it("네이티브 입력도 같은 실행기와 모달 정책을 거치고 해제한다", async () => {
  const actions = { desktop: vi.fn(), cycleWindow: vi.fn() } as unknown as ShellWindowActions;
  const dispose = installShellShortcuts(actions);
  await Promise.resolve();
  native.receive?.({ payload: { code: "ArrowRight", shift: false } });
  expect(actions.desktop).toHaveBeenCalledExactlyOnceWith(1);
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  native.receive?.({ payload: { code: "PageDown", shift: false } });
  expect(actions.cycleWindow).not.toHaveBeenCalled();
  dialog.remove();
  native.receive?.({ payload: { code: "Tab", shift: true } });
  expect(actions.cycleWindow).toHaveBeenCalledExactlyOnceWith(-1);
  dispose();
  expect(native.stop).toHaveBeenCalledOnce();
});
