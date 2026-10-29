import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, CoreReply } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const folderApp: AppDefinition = {
  id: "folder-app",
  name: "폴더 원천",
  requires: { blocks: 4, modules: { files: 1 } },
  permissions: [{ module: "files", id: "media", access: "read", label: "그림 폴더" }],
  state: {},
  sources: { pictures: { kind: "folder", permission: "media", recursive: false, extensions: [] } },
  ui: { type: "list", items: { expr: "$data.pictures.{ \"key\": path, \"title\": name }" } },
};
const failed = { status: "failed" as const, message: "이 기기에서 폴더를 골라야 합니다", retry: ["pictures"] };

it("폴더를 고르지 않은 폴더 원천은 폴더 선택을 보이고, 고르면 그 원천을 다시 받는다", async () => {
  const seed = makeTestSeed({ definitions: [folderApp] });
  const transport = createFakeTransport(seed);
  const original = transport.call.bind(transport);
  const calls = vi.spyOn(transport, "call").mockImplementation((request) => request.op === "data.attach"
    ? Promise.resolve({ op: "data.attach", view: { sources: { pictures: { state: "failed", message: failed.message, has_value: false } }, values: { "/ui/items": failed } } } as CoreReply) as never
    : original(request as never));
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  const pick = await screen.findByRole("button", { name: "폴더 선택" });
  expect(screen.queryByRole("button", { name: "다시 받기" })).toBeNull();
  fireEvent.click(pick);
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "files.pick_folder", window_id: "viewer-window", permission: "media" })));
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.refresh", window_id: "viewer-window", sources: ["pictures"] })));
});

it("폴더를 이미 고른 원천의 실패는 지금처럼 다시 받기를 보인다", async () => {
  const seed = makeTestSeed({ definitions: [folderApp] });
  seed.snapshot.device.grants = [{ window_id: "viewer-window", permission: "media", root_path: "/fake/docs", root_name: "docs", granted_at: "2026-10-30T00:00:00Z" }];
  const transport = createFakeTransport(seed);
  const original = transport.call.bind(transport);
  vi.spyOn(transport, "call").mockImplementation((request) => request.op === "data.attach"
    ? Promise.resolve({ op: "data.attach", view: { sources: {}, values: { "/ui/items": { status: "failed", message: "읽지 못했습니다", retry: ["pictures"] } } } } as CoreReply) as never
    : original(request as never));
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  expect(await screen.findByRole("button", { name: "다시 받기" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "폴더 선택" })).toBeNull();
});

it("다시 붙는 동안 온 이벤트를 늦게 온 붙이기 응답이 덮지 않는다", async () => {
  const definition: AppDefinition = { ...folderApp, ui: { type: "text", value: { expr: "$string($data.pictures)" } } };
  const seed = makeTestSeed({ definitions: [definition] });
  const transport = createFakeTransport(seed);
  const original = transport.call.bind(transport);
  const held: Array<() => void> = [];
  let attaches = 0;
  vi.spyOn(transport, "call").mockImplementation((request) => {
    if (request.op !== "data.attach") return original(request as never);
    attaches += 1;
    return new Promise((resolve) => held.push(() => resolve({ op: "data.attach", view: { sources: {}, values: { "/ui/value": { status: "loading" } } } } as never)));
  });
  render(<StrictMode><AppWindowContent store={createShellStore(transport)} windowId="viewer-window" /></StrictMode>);
  await waitFor(() => expect(held.length).toBeGreaterThan(0));
  act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/value": { status: "ready", value: "도착한 값" } } } }));
  for (let round = 0; round < 3; round += 1) {
    await act(async () => { held.splice(0).forEach((release) => release()); await new Promise((r) => setTimeout(r, 20)); });
  }
  expect(attaches).toBeGreaterThan(0);
  expect(screen.getByText("도착한 값")).toBeTruthy();
});
