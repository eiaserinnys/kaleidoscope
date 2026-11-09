import { afterEach, expect, it, vi } from "vitest";
import { registerSandboxFlush } from "../blocks/sandbox-flush";
import type { ShellStore } from "../core/shell-store";
import { patchWindowState } from "../data/window-state";
import { runSavedTransition } from "../lifecycle/window-transition";

afterEach(() => { vi.restoreAllMocks(); });

it("flush가 남긴 창 상태 쓰기의 응답을 기다린 뒤 commit을 부른다", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const store = { call: vi.fn(async () => { await gate; return { op: "window.patch_state" }; }) } as unknown as ShellStore;
  const unregister = registerSandboxFlush("window-1", async () => {
    void patchWindowState({ store, window: { id: "window-1" } }, { query: "탭" }).catch(() => undefined);
    return true;
  });
  const commit = vi.fn(async () => undefined);
  let outcome: boolean | undefined;
  const running = runSavedTransition(store, ["window-1"], commit).then((value) => { outcome = value; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(commit).not.toHaveBeenCalled();
  expect(outcome).toBeUndefined();
  release();
  await running;
  expect(outcome).toBe(true);
  expect(commit).toHaveBeenCalledTimes(1);
  unregister();
});

it("flush가 실패하면 commit을 부르지 않고 false를 돌려준다", async () => {
  const store = { call: vi.fn() } as unknown as ShellStore;
  const unregister = registerSandboxFlush("window-1", async () => false);
  const commit = vi.fn(async () => undefined);
  expect(await runSavedTransition(store, ["window-1"], commit)).toBe(false);
  expect(commit).not.toHaveBeenCalled();
  unregister();
});
