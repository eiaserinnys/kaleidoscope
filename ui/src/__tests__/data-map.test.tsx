import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed, mdViewerDefinition } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("지점을 고르고 창 상태의 선택을 지도에 반영한다", async () => {
  const points = [{ key: "a", lat: 37, lng: 127, label: "서울" }, { key: "b", lat: 35, lng: 139, label: "도쿄" }];
  const ui = { type: "map", points, selected: { state: "selected" }, on_select: { set_state: "selected" } } as unknown as Block;
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 10, modules: {} }, permissions: [], state: { selected: "a" }, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { selected: "a" };
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  const first = await screen.findByRole("button", { name: /서울/ });
  const second = screen.getByRole("button", { name: /도쿄/ });
  expect(first.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(second);
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/on_select", event: "b", item: points[1] })));
  await waitFor(() => expect(second.getAttribute("aria-pressed")).toBe("true"));
  fireEvent.keyDown(screen.getByRole("region", { name: "세계 지도" }), { key: "Home" });
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", event: "a" })));
});
