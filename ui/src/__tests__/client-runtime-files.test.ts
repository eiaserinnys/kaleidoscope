import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, Grant, ShellSnapshot } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import type { WindowData } from "../data/window-data";
import { ClientRuntime } from "../runtime/client-runtime";

afterEach(() => {
  document.querySelector(".ks-client-frames")?.remove();
  vi.restoreAllMocks();
});

it("client 폴더 선택은 코어 권한 확인을 거쳐 이름만 돌려주고 grant 변경을 알린다", async () => {
  const declared: Grant = { window_id: "window-1", permission: "docs", root_path: "/private/docs", root_name: "작업 폴더", granted_at: "2026-11-03T00:00:00Z" };
  const pc: Grant = { window_id: "window-1", permission: "pc", root_path: "/private", root_name: "내 PC", granted_at: "2026-11-03T00:00:00Z" };
  let current = {
    device: { active_workspace_id: "workspace-1", active_desktop_ids: { "workspace-1": "desktop-1" }, grants: [] },
    shared: { windows: [{ id: "window-1", desktop_id: "desktop-1", minimized: false, state: {} }], desktops: [{ id: "desktop-1", workspace_id: "workspace-1" }] },
  } as unknown as ShellSnapshot;
  const listeners = new Set<() => void>();
  const store = {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    subscribeEvents: () => () => undefined,
    nativeFiles: true,
    call: vi.fn(async (request: any) => {
      if (request.op === "data.media") return { op: "data.media", media: { mime: "text/javascript", data_base64: "" } };
      if (request.op === "files.pick_folder" && request.permission === "docs") {
        current = { ...current, device: { ...current.device, grants: [declared, pc] } };
        listeners.forEach((listener) => listener());
        return { op: "files.pick_folder", grant: declared };
      }
      throw { id: "FILE_ACCESS_PERMISSION_UNDECLARED", code: "permission_denied", message: "파일 권한 undeclared: 앱 정의 permissions에 선언되지 않았습니다.", details: [] };
    }),
  } as unknown as ShellStore;
  const definition = {
    assets: [],
    permissions: [
      { module: "files", id: "docs", access: "read", label: "문서", scope: "folder" },
      { module: "files", id: "pc", access: "read", label: "내 PC", scope: "pc" },
    ],
  } as unknown as AppDefinition;
  const client = { entry: { id: "runtime", version: 1 }, state_keys: [], storage_entries: [], inputs: {}, actions: ["pick"], commands: {} };
  const runtime = new ClientRuntime(store, { windowId: "window-1", failClient: vi.fn(), clientHost: null } as unknown as WindowData, definition, client as never);
  await runtime.start();
  const frame = document.querySelector("iframe")!;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  const token = (runtime as any).token;
  const receive = (requestId: string, permission: string) => window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow,
    origin: "null",
    data: { token, type: "ks-client-pick-folder", requestId, permission },
  }));

  window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow,
    origin: "null",
    data: { token, type: "ks-sandbox-ready" },
  }));
  receive("pick", "docs");
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-reply", requestId: "pick", result: "작업 폴더" }), "*"));
  expect(store.call).toHaveBeenCalledWith({ op: "files.pick_folder", window_id: "window-1", permission: "docs" });
  expect(post).toHaveBeenCalledWith({ type: "ks-client-grants", grants: { docs: "작업 폴더" } }, "*");

  receive("denied", "undeclared");
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-reply", requestId: "denied", errorId: "FILE_ACCESS_PERMISSION_UNDECLARED", errorCode: "permission_denied" }), "*"));
  await runtime.stop();
});
