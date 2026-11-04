import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { WindowFrame } from "../../../app/src/shell/window-frame";
import type { AppDefinition, CoreEvent, CoreRequest, ShellSnapshot } from "../contract/contract";
import { createShellStore } from "../core/shell-store";
import type { CoreTransport } from "../core/core-transport";
import { beginWindowAction } from "../share/action-context";
import { executeWindowAction, readWindowView, registerControlWindow } from "../share/window-control";
import { makeTestSnapshot } from "./fixtures";

afterEach(cleanup);

const definition = {
  id: "research", name: "자료 수집", requires: { blocks: 1, modules: {} }, state: {}, ui: { type: "text", text: "안녕" },
  permissions: [
    { module: "files", id: "docs", label: "문서", access: "readwrite", scope: "folder" },
    { module: "files", id: "pc", label: "내 PC", access: "read", scope: "pc" },
    { module: "connection", id: "team", label: "팀 계정", connection: "team-api", access: "read" },
    { module: "http", id: "web", label: "웹", base_url: "https://example.org", paths: ["/one", "/two"] },
    { module: "process", id: "run", label: "프로그램 실행" },
    { module: "profiler", id: "perf", label: "성능" },
    { module: "store", id: "market", label: "스토어" },
  ],
  storage: { entries: [{ id: "prefs", label: "환경 설정", key: "prefs/{workspace_id}", kind: "json", collection: false, presentation: "settings", default: { theme: "dark" }, schema: { type: "object" } }] },
  client: { runtime: "javascript", entry: { id: "client", version: 1 }, inputs: {}, outputs: {}, actions: [], commands: {}, state_keys: [], storage_entries: ["prefs"], http_permissions: ["web"], process_permissions: ["run"], capabilities: ["share"], device_storage: { prefixes: ["drafts"], scope: "window" } },
  worker: { runtime: "python3", code: "print('hello')", actions: ["sync"], schedule: { interval_secs: 60, enabled_entry: "prefs" }, secrets: [{ id: "api-key", description: "접근 키" }], watch_entries: ["prefs"] },
  agent: { protocol: "chat", permission: "team", base_path: "/chat", namespace: "work", profile: "writer", collection: "threads", model_order: ["model"], selected_model: "model", title_template: "제목", initial_instruction_template: "처음 지시", instructions_template: "긴 지시", thread_entry: "prefs" },
} as unknown as AppDefinition;

async function setup() {
  let snapshot = makeTestSnapshot();
  snapshot.shared.windows = snapshot.shared.windows.map((item) => ({ ...item, z: item.id === "editor-window" ? 2 : 1 }));
  let receive!: (event: CoreEvent) => void;
  const call = vi.fn(async (request: CoreRequest) => request.op === "state.get" ? { op: "state.get", snapshot, sequence: 1 } : { op: request.op });
  const store = createShellStore({ call, subscribe: (listener: (event: CoreEvent) => void) => { receive = listener; return () => {}; } } as unknown as CoreTransport);
  await store.ready;
  const appWindow = snapshot.shared.windows[0];
  render(<WindowFrame area={{ width: 960, height: 552 }} appName="앱" isTop sharing={false} shareable={false} store={store}
    onCall={async () => undefined} onMinimize={() => {}} onMaximize={() => {}} onRestore={() => {}} window={appWindow}><button>본문</button></WindowFrame>);
  const emit = (app = definition) => act(() => receive({ event: "app.install_permission", window_id: appWindow.id, request_id: "request", app_name: "자료 수집", release: 3, store_url: "https://store.example.org/apps", digest: "digest-1", definition: app } as CoreEvent));
  const change = (next: (value: ShellSnapshot) => ShellSnapshot) => act(() => { snapshot = next(snapshot); receive({ event: "state.changed", snapshot, sequence: 2 }); });
  call.mockClear();
  return { appWindow, call, store, emit, change };
}

it("설치 선언 전체와 출처를 읽고 접힌 상세를 열 수 있다", async () => {
  const { emit, store } = await setup(); emit();
  const dialog = screen.getByRole("dialog");
  for (const value of ["자료 수집", "3", "https://store.example.org/apps", "문서", "내 PC", "팀 계정", "team-api", "https://example.org", "/one", "/two", "프로그램 실행", "성능", "스토어", "환경 설정", "prefs", "client", "web", "run", "drafts", "sync", "api-key", "writer"]) {
    expect(dialog.textContent).toContain(value);
  }
  expect(dialog.textContent).toContain("print('hello')");
  expect(dialog.textContent).toContain("기준 주소: https://example.org");
  expect(dialog.textContent).toContain("허용 경로: /one, /two");
  expect(dialog.textContent).toContain("모음: threads");
  expect(dialog.textContent).toContain("범위: 창별");
  expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "취소" }));
  store.dispose();
});

it("빈 선언을 표시하고 합성 허용은 거부하며 취소는 같은 digest로 응답한다", async () => {
  const { appWindow, call, emit, store } = await setup();
  emit({ ...definition, permissions: [], storage: undefined, client: undefined, worker: undefined, agent: undefined });
  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toContain("선언된 권한이 없습니다");
  fireEvent.click(within(dialog).getByRole("button", { name: "허용하고 설치" }));
  expect(call).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
  expect(call).toHaveBeenCalledWith({ op: "app.respond_install_permission", window_id: appWindow.id, request_id: "request", digest: "digest-1", allow: false });
  store.dispose();
});

it("Escape와 창 닫기는 취소하고 숨김은 대기를 유지한다", async () => {
  const { appWindow, call, emit, change, store } = await setup(); emit();
  change((snapshot) => ({ ...snapshot, shared: { ...snapshot.shared, windows: snapshot.shared.windows.map((item) => item.id === appWindow.id ? { ...item, minimized: true } : item) } }));
  expect(call).not.toHaveBeenCalled();
  change((snapshot) => ({ ...snapshot, shared: { ...snapshot.shared, windows: snapshot.shared.windows.map((item) => item.id === appWindow.id ? { ...item, minimized: false } : item) } }));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(call).toHaveBeenCalledWith({ op: "app.respond_install_permission", window_id: appWindow.id, request_id: "request", digest: "digest-1", allow: false });
  call.mockClear(); emit();
  change((snapshot) => ({ ...snapshot, shared: { ...snapshot.shared, windows: snapshot.shared.windows.filter((item) => item.id !== appWindow.id) } }));
  expect(call).toHaveBeenCalledWith({ op: "app.respond_install_permission", window_id: appWindow.id, request_id: "request", digest: "digest-1", allow: false });
  store.dispose();
});

it("같이 보기 자동 조작은 설치를 허용할 수 없다", async () => {
  const { appWindow, call, store, emit } = await setup();
  const finish = beginWindowAction("editor-window");
  await expect(store.call({ op: "app.respond_install_permission", window_id: "editor-window", request_id: "r", digest: "d", allow: true })).rejects.toMatchObject({ id: "SHELL_WINDOW_CONTROL_CONSENT_BLOCKED" });
  expect(call).not.toHaveBeenCalled();
  finish();
  emit();
  const root = screen.getByTestId("app-window-md-editor");
  const unregister = registerControlWindow(appWindow.id, root, store);
  const view = readWindowView(appWindow.id);
  const result = await executeWindowAction(appWindow.id, view.view_id, { kind: "key", key: "Enter" }, "control");
  expect(result).toMatchObject({ applied: false, error: { id: "SHELL_WINDOW_CONTROL_CONSENT_BLOCKED" } });
  expect(call).not.toHaveBeenCalled();
  unregister(); store.dispose();
});

it("설치 동의 변경은 다른 창을 다시 그리지 않는다", async () => {
  const { emit, store } = await setup();
  let renders = 0;
  const other = store.getSnapshot()!.shared.windows.find((item) => item.id === "viewer-window")!;
  render(<Profiler id="other" onRender={() => { renders += 1; }}>
    <WindowFrame area={{ width: 960, height: 552 }} appName="다른 창" isTop={false} sharing={false} shareable={false} store={store}
      onCall={async () => undefined} onMinimize={() => {}} onMaximize={() => {}} onRestore={() => {}} window={other}>다른 창</WindowFrame>
  </Profiler>);
  const before = renders;
  emit();
  expect(renders - before).toBe(0);
  store.dispose();
});
