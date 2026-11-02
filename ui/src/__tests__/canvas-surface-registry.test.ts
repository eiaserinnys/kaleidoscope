import { expect, it } from "vitest";
import { WindowData } from "../data/window-data";
import type { AppDefinition } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";

it("같은 창에서 살아 있는 중복 표면을 거부하고 이름과 해결 방법을 알린다", () => {
  const data = new WindowData({} as ShellStore, "window", { client: null } as unknown as AppDefinition);
  const canvas = {} as OffscreenCanvas;
  const first = data.attachSurface("tile-1", canvas, 100, 100, 1, true);
  expect(first).toBeTypeOf("number");
  expect(data.attachSurface("tile-1", canvas, 100, 100, 1, true)).toBeUndefined();
  expect(data.getNotice()).toContain("tile-1");
  data.detachSurface("tile-1", first!);
  expect(data.attachSurface("tile-1", canvas, 100, 100, 1, true)).not.toBe(first);
});
