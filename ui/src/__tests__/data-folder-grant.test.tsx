import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, CoreReply } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed } from "./fixtures";
import { DataState } from "../components/data-state";
import { WindowDataProvider } from "../data/window-data";

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
const failed = { status: "failed" as const, id: "FILE_ACCESS_FOLDER_NOT_CHOSEN", message: "이 기기에서 폴더를 골라야 합니다", retry: ["pictures"] };

it("기본 폴더 상태를 기다리는 동안 목록의 뼈대를 보이고 허용 상태로 전환한다", async () => {
  const definition: AppDefinition = { ...folderApp, permissions: [{ module: "files", id: "media", access: "read", label: "자료", default_folder: "pictures" }] };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  let resolve!: (value: CoreReply) => void;
  vi.spyOn(transport, "call").mockImplementation((request) => request.op === "files.prepare_default_folder"
    ? new Promise<CoreReply>(done => { resolve = done; }) as never : original(request as never));
  const store = createShellStore(transport);
  render(<WindowDataProvider store={store} windowId="viewer-window" definition={definition}>
    <DataState value={failed} loading={<div className="ks-list is-grid" role="status" aria-label="불러오는 중" />} />
  </WindowDataProvider>);
  expect(screen.getByRole("status", { name: "불러오는 중" }).classList.contains("is-grid")).toBe(true);
  await waitFor(() => expect(resolve).toBeDefined());
  await act(async () => resolve({ op: "files.prepare_default_folder", result: { status: "consent_required", folder: "pictures", access: "read" } }));
  expect(await screen.findByRole("button", { name: "사진 폴더 읽기 허용" })).toBeTruthy();
});

it("기본 폴더 준비가 실패해도 원천을 붙이고 오류와 폴더 선택을 보인다", async () => {
  const definition: AppDefinition = { ...folderApp, requires: { blocks: 47, modules: { files: 4 } }, permissions: [{ module: "files", id: "media", access: "read", label: "자료", default_folder: "pictures" }] };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  const error = { code: "io", id: "DESK_DEFAULT_FOLDER_NOT_DIRECTORY", message: "사진 폴더의 경로가 폴더가 아닙니다.", details: [] };
  const calls = vi.spyOn(transport, "call").mockImplementation((request) => request.op === "files.prepare_default_folder"
    ? Promise.reject(error) : request.op === "data.attach"
      ? Promise.resolve({ op: "data.attach", view: { sources: {}, values: { "/ui/items": failed } } } as CoreReply) as never
      : original(request as never));
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  expect(await screen.findByText(error.message)).toBeTruthy();
  expect(screen.getByText(error.id)).toBeTruthy();
  expect(screen.getByRole("button", { name: "폴더 선택" })).toBeTruthy();
  expect(calls.mock.calls.some(([request]) => request.op === "data.attach")).toBe(true);
});

it("기본 폴더를 준비한 뒤 원천을 붙이고 첫 허용을 보여 준다", async () => {
  const definition: AppDefinition = { ...folderApp, requires: { blocks: 47, modules: { files: 4 } }, permissions: [{ module: "files", id: "media", access: "read", label: "자료", default_folder: "pictures" }] };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  const calls = vi.spyOn(transport, "call").mockImplementation((request) => request.op === "data.attach"
    ? Promise.resolve({ op: "data.attach", view: { sources: {}, values: { "/ui/items": failed } } } as CoreReply) as never
    : original(request as never));
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  expect((await screen.findByRole("button", { name: "사진 폴더 읽기 허용" })).hasAttribute("data-ks-user-consent")).toBe(true);
  expect(screen.queryByText("사진 폴더의 파일을 읽도록 허용")).toBeNull();
  expect(screen.getByRole("button", { name: "다른 폴더 선택" })).toBeTruthy();
  const operations = calls.mock.calls.map(([request]) => request.op);
  expect(operations.indexOf("files.prepare_default_folder")).toBeLessThan(operations.indexOf("data.attach"));
  expect(operations.filter((op) => op === "files.prepare_default_folder")).toHaveLength(1);
});

it("기본 폴더가 없으면 기존 폴더 선택을 보여 준다", async () => {
  const definition: AppDefinition = { ...folderApp, requires: { blocks: 47, modules: { files: 4 } }, permissions: [{ module: "files", id: "media", access: "read", label: "자료", default_folder: "pictures" }] };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  vi.spyOn(transport, "call").mockImplementation((request) => request.op === "files.prepare_default_folder"
    ? Promise.resolve({ op: "files.prepare_default_folder", result: { status: "unavailable" } } as CoreReply) as never
    : request.op === "data.attach" ? Promise.resolve({ op: "data.attach", view: { sources: {}, values: { "/ui/items": failed } } } as CoreReply) as never : original(request as never));
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  expect(await screen.findByRole("button", { name: "폴더 선택" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "사진 폴더 읽기 허용" })).toBeNull();
});

it("폴더 블록도 같은 기본 폴더 허용을 보여 준다", async () => {
  const definition: AppDefinition = { ...folderApp, requires: { blocks: 47, modules: { files: 4 } }, permissions: [{ module: "files", id: "media", access: "readwrite", label: "자료", default_folder: "pictures" }], state: { selected: null }, ui: { type: "folder", root: { permission: "media" }, extensions: [], selected: { state: "selected" }, on_select: { set_state: "selected" } } };
  render(<AppWindowContent store={createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })))} windowId="viewer-window" />);
  expect(await screen.findByRole("button", { name: "사진 폴더 읽고 고치기 허용" })).toBeTruthy();
  expect(screen.queryByText("사진 폴더의 파일을 읽고 고치도록 허용")).toBeNull();
});

it("폴더를 고르지 않은 원천의 합성 폴더 선택을 막는다", async () => {
  const seed = makeTestSeed({ definitions: [folderApp] });
  const transport = createFakeTransport(seed);
  const original = transport.call.bind(transport);
  const calls = vi.spyOn(transport, "call").mockImplementation((request) => request.op === "data.attach"
    ? Promise.resolve({ op: "data.attach", view: { sources: { pictures: { state: "failed", message: failed.message, has_value: false } }, values: { "/ui/items": failed } } } as CoreReply) as never
    : original(request as never));
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  expect(await screen.findByText("폴더를 선택해 주세요")).toBeTruthy();
  expect(screen.queryByText("FILE_ACCESS_FOLDER_NOT_CHOSEN")).toBeNull();
  expect(screen.queryByText(failed.message)).toBeNull();
  const pick = await screen.findByRole("button", { name: "폴더 선택" });
  expect(screen.queryByRole("button", { name: "다시 받기" })).toBeNull();
  fireEvent.click(pick);
  expect(pick.hasAttribute("data-ks-user-consent")).toBe(true);
  expect(calls.mock.calls.some(([request]) => request.op === "files.pick_folder")).toBe(false);
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
