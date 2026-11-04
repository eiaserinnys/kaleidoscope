// @vitest-environment node
import { expect, it, vi } from "vitest";
import type { AppDefinition, CoreEvent } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore, type ShellStore } from "../core/shell-store";
import { patchWindowState } from "../data/window-state";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";

it("같은 틱에 다른 키를 고치면 하나의 요청과 약속으로 함께 적용한다", async () => {
  const window = { id: "editor-window", state: { folder: "옛 폴더", file: "옛 파일", other: "처음" } };
  const snapshot = { shared: { windows: [window] } };
  const call = vi.fn(async (request: { patch: Partial<typeof window.state> }) => {
    await Promise.resolve();
    window.state = { ...window.state, ...request.patch };
    return { op: "window.patch_state" };
  });
  const store = { getSnapshot: () => snapshot, call } as unknown as ShellStore;
  const context = { store, window: { id: window.id } };
  const first = patchWindowState(context, { folder: "중간 폴더" });
  const second = patchWindowState(context, { folder: "새 폴더", file: "새 파일" });
  expect(first).toBe(second);
  window.state.other = "최신";
  await first;
  expect(window.state).toEqual({ folder: "새 폴더", file: "새 파일", other: "최신" });
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith({ op: "window.patch_state", window_id: window.id, patch: { folder: "새 폴더", file: "새 파일" } });
});

it("앞 요청이 지연돼도 다른 틱의 키를 보존한다", async () => {
  const definition: AppDefinition = { ...mdEditorDefinition, state: { a: 0, b: 0, current_file: null } };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const subscribe = transport.subscribe.bind(transport);
  let held: CoreEvent | undefined;
  vi.spyOn(transport, "subscribe").mockImplementation((listener) => subscribe((event) => {
    if (event.event === "state.changed" && !held) { held = event; return; }
    if (held) { listener(held); held = undefined; }
    listener(event);
  }));
  const store = createShellStore(transport);
  await store.ready;
  const original = store.call.bind(store);
  let release!: () => void;
  const delay = new Promise<void>((resolve) => { release = resolve; });
  const call = vi.spyOn(store, "call").mockImplementation(async (request) => {
    const result = original(request);
    if (call.mock.calls.length === 1) await delay;
    return result;
  });
  const context = { store, window: { id: "editor-window" } };
  const first = patchWindowState(context, { a: 1 });
  await Promise.resolve();
  expect(held).toMatchObject({ event: "state.changed", snapshot: { shared: { windows: [{ state: { a: 1, b: 0 } }] } } });
  expect(store.getSnapshot()?.shared.windows[0].state).toEqual({ a: 0, b: 0, current_file: null });
  const second = patchWindowState(context, { b: 1 });
  await second;
  expect(call.mock.calls.map(([request]) => request)).toEqual([
    { op: "window.patch_state", window_id: "editor-window", patch: { a: 1 } },
    { op: "window.patch_state", window_id: "editor-window", patch: { b: 1 } },
  ]);
  release();
  await first;
  expect(store.getSnapshot()?.shared.windows[0].state).toEqual({ a: 1, b: 1, current_file: null });
  store.dispose();
});
