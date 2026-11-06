import { expect, it, vi } from "vitest";
import type { AppDefinition } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { WindowData } from "../data/window-data";
import { ClientRuntime } from "../runtime/client-runtime";

const definition = {
  permissions: [],
  client: {
    runtime: "javascript",
    entry: { id: "runtime", version: 1 },
    inputs: {}, outputs: {}, actions: [], commands: {}, state_keys: [], storage_entries: [],
  },
} as unknown as AppDefinition;

function createSurfaceSpy() {
  return vi.spyOn(ClientRuntime.prototype, "surface");
}

type SurfaceSpy = ReturnType<typeof createSurfaceSpy>;

async function withMountedRuntime(run: (data: WindowData, surface: SurfaceSpy) => void) {
  const call = vi.fn(async (request: { op: string }) => request.op === "data.attach"
    ? { op: "data.attach", view: { values: {}, sources: {} } }
    : { op: request.op });
  const store = {
    call,
    getSnapshot: () => null,
    subscribe: () => () => undefined,
    subscribeEvents: () => () => undefined,
  } as unknown as ShellStore;
  const data = new WindowData(store, "window", definition);
  const surface = createSurfaceSpy();
  vi.spyOn(ClientRuntime.prototype, "start").mockResolvedValue();
  vi.spyOn(ClientRuntime.prototype, "stop").mockResolvedValue();
  const cleanup = data.mount();
  await (data as unknown as { ready: Promise<void> }).ready;
  try {
    run(data, surface);
  } finally {
    cleanup();
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith({ op: "data.detach", window_id: "window" }));
  }
}

it("새 세대가 먼저 붙고 옛 세대 detach가 늦게 와도 새 표면을 유지한다", async () => {
  await withMountedRuntime((data, surface) => {
    const oldCanvas = {} as OffscreenCanvas;
    const newCanvas = {} as OffscreenCanvas;
    const oldGeneration = data.attachSurface("stage", oldCanvas, 100, 100, 1, true)!;
    const newGeneration = data.attachSurface("stage", newCanvas, 120, 80, 2, true)!;

    data.detachSurface("stage", oldGeneration);
    data.resizeSurface("stage", newGeneration, 130, 90, 2);

    const events = surface.mock.calls.map(([message]) => [message.phase, message.id, message.generation]);
    expect(events).toEqual([
      ["attach", "stage", oldGeneration],
      ["detach", "stage", oldGeneration],
      ["attach", "stage", newGeneration],
      ["resize", "stage", newGeneration],
    ]);
    expect(surface.mock.calls[2]?.[0].canvas).toBe(newCanvas);
    expect(events).not.toContainEqual(["detach", "stage", newGeneration]);
  });
});

it("정상 순서로 옛 표면을 떼고 새 세대를 붙인다", async () => {
  await withMountedRuntime((data, surface) => {
    const oldGeneration = data.attachSurface("stage", {} as OffscreenCanvas, 100, 100, 1, true)!;
    data.detachSurface("stage", oldGeneration);
    const newGeneration = data.attachSurface("stage", {} as OffscreenCanvas, 120, 80, 2, true)!;

    expect(surface.mock.calls.map(([message]) => [message.phase, message.id, message.generation])).toEqual([
      ["attach", "stage", oldGeneration],
      ["detach", "stage", oldGeneration],
      ["attach", "stage", newGeneration],
    ]);
  });
});
