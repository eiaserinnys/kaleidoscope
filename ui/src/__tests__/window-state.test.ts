// @vitest-environment node
import { expect, it, vi } from "vitest";
import type { ShellStore } from "../core/shell-store";
import { patchWindowState } from "../data/window-state";

vi.mock("../core/shell-store", () => ({ useShellSelector: vi.fn() }));

it("같은 틱에 다른 키를 고치면 하나의 요청과 약속으로 함께 적용한다", async () => {
  const window = { id: "editor-window", state: { folder: "옛 폴더", file: "옛 파일", other: "처음" } };
  const snapshot = { shared: { windows: [window] } };
  const call = vi.fn(async (request: { state: typeof window.state }) => {
    await Promise.resolve();
    window.state = request.state;
    return { op: "window.set_state" };
  });
  const store = { getSnapshot: () => snapshot, call } as unknown as ShellStore;
  const context = { store, window: { id: window.id } };
  const first = patchWindowState(context, { folder: "새 폴더" });
  const second = patchWindowState(context, { file: "새 파일" });
  expect(first).toBe(second);
  window.state.other = "최신";
  await first;
  expect(window.state).toEqual({ folder: "새 폴더", file: "새 파일", other: "최신" });
  expect(call).toHaveBeenCalledTimes(1);
});
