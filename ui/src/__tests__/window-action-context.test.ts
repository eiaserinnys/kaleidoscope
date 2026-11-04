import { expect, it, vi } from "vitest";
import { createShellStore } from "../core/shell-store";
import type { CoreTransport } from "../core/core-transport";
import { beginWindowAction, waitForWindowActionCalls } from "../share/action-context";

it("실행 대상 창의 허용 확대 호출만 거절하고 취소는 보낸다", async () => {
  const call = vi.fn(async (request: { op: string }) => request.op === "state.get" ? { op: "state.get", snapshot: { shared: { app_versions: [] } } } : { op: request.op });
  const store = createShellStore({ call, subscribe: () => () => {} } as unknown as CoreTransport);
  await store.ready;
  const finish = beginWindowAction("one");
  await expect(store.call({ op: "files.pick_folder", window_id: "one", permission: "docs" })).rejects.toMatchObject({ id: "SHELL_WINDOW_CONTROL_CONSENT_BLOCKED" });
  await store.call({ op: "process.respond_permission", window_id: "one", request_id: "r", allow: false });
  await store.call({ op: "files.pick_folder", window_id: "two", permission: "docs" });
  expect(call).toHaveBeenCalledTimes(3);
  finish(); store.dispose();
});

it("대상 창에서 시작한 코어 호출의 완료를 기다린다", async () => {
  let resolve!: (value: unknown) => void;
  const call = vi.fn((request: { op: string }) => request.op === "state.get" ? Promise.resolve({ op: "state.get", snapshot: { shared: { app_versions: [] } } }) : new Promise((done) => { resolve = done; }));
  const store = createShellStore({ call, subscribe: () => () => {} } as unknown as CoreTransport);
  await store.ready;
  const finish = beginWindowAction("one");
  const pending = store.call({ op: "window.raise", window_id: "one" });
  let settled = false;
  const waiting = waitForWindowActionCalls("one").then(() => { settled = true; });
  await Promise.resolve(); expect(settled).toBe(false);
  resolve({ op: "window.raise" }); await pending; await waiting;
  expect(settled).toBe(true);
  finish(); store.dispose();
});
