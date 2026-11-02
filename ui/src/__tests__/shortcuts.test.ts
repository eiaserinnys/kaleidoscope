import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAppShortcuts, registerGridShortcuts } from "../runtime/shortcuts";

const mods = { shift: false, alt: false, ctrl: false, meta: false };
const snapshot = () => ({ device: { active_workspace_id: "w", active_desktop_ids: { w: "d" } }, shared: { desktops: [{ id: "d", workspace_id: "w" }], windows: [{ id: "a", desktop_id: "d", z: 1, minimized: false }] } });
const store = { getSnapshot: snapshot } as never;
const context = { store, window: { id: "a", desktop_id: "d" } } as never;
const disposers: Array<() => void> = [];
afterEach(() => { disposers.splice(0).forEach((dispose) => dispose()); document.body.innerHTML = ""; });

function key(code: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code, key: code === "Space" ? " " : code, ...options });
  document.activeElement?.dispatchEvent(event);
  return event;
}

describe("앱과 단추 격자의 단축키", () => {
  it("명시한 키 조합을 정확히 한 번 실행하고 격자보다 우선한다", () => {
    const app = vi.fn(), grid = vi.fn();
    const root = document.createElement("div"); document.body.append(root);
    disposers.push(registerAppShortcuts(context, [{ code: "KeyR", modifiers: [], action: { client: "app" } }, { code: "ArrowRight", modifiers: ["shift"], action: { client: "shift" } }], app));
    disposers.push(registerGridShortcuts(context, root, [{ key: "r", label: "R", shortcut: "r" }], grid));
    key("KeyR", { key: "r" }); key("ArrowRight", { shiftKey: true }); key("ArrowRight");
    expect(app).toHaveBeenCalledTimes(2);
    expect(app).toHaveBeenNthCalledWith(1, 0, mods);
    expect(app).toHaveBeenNthCalledWith(2, 1, { ...mods, shift: true });
    expect(grid).not.toHaveBeenCalled();
  });
  it("입력, 조합, 차단된 이벤트에서는 실행하지 않고 range와 checkbox는 허용한다", () => {
    const action = vi.fn();
    disposers.push(registerAppShortcuts(context, [{ code: "KeyR", modifiers: [], action: { client: "go" } }], action));
    const input = document.createElement("input"); document.body.append(input); input.focus();
    expect(key("KeyR", { key: "r" }).defaultPrevented).toBe(false);
    input.type = "range"; key("KeyR", { key: "r" });
    input.type = "checkbox"; key("KeyR", { key: "r" });
    key("KeyR", { key: "r", isComposing: true });
    const blocked = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code: "KeyR", key: "r" }); blocked.preventDefault(); input.dispatchEvent(blocked);
    expect(action).toHaveBeenCalledTimes(2);
  });
  it("다른 창이 앞에 있거나 대화상자가 열렸으면 실행하지 않는다", () => {
    const action = vi.fn();
    const behind = { store: { getSnapshot: () => ({ ...snapshot(), shared: { ...snapshot().shared, windows: [...snapshot().shared.windows, { id: "b", desktop_id: "d", z: 2, minimized: false }] } }) }, window: { id: "a", desktop_id: "d" } } as never;
    disposers.push(registerAppShortcuts(behind, [{ code: "Space", modifiers: [], action: { client: "go" } }], action));
    key("Space");
    expect(action).not.toHaveBeenCalled();
  });
});

it("열린 안내가 앱 단축키보다 먼저 이전·다음·닫기를 처리한다", async () => {
  const { registerTourShortcuts } = await import("../runtime/shortcuts");
  const app = vi.fn(), previous = vi.fn(), next = vi.fn(), close = vi.fn();
  disposers.push(registerAppShortcuts(context, [{ code: "ArrowRight", modifiers: [], action: { client: "app" } }], app));
  disposers.push(registerTourShortcuts(context, { previous, next, close }));
  key("ArrowLeft", { key: "ArrowLeft" }); key("ArrowRight", { key: "ArrowRight" }); key("Enter", { key: "Enter" }); key("Escape", { key: "Escape" });
  expect(previous).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledTimes(1);
  expect(app).not.toHaveBeenCalled();
});
