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
    { module: "process", id: "run", label: "자료 변환" },
    { module: "profiler", id: "perf", label: "성능" },
    { module: "store", id: "market", label: "스토어" },
  ],
  storage: { entries: [{ id: "prefs", label: "환경 설정", key: "prefs/{workspace_id}", kind: "json", collection: false, presentation: "settings", default: { theme: "dark" }, schema: { type: "object" } }] },
  client: { runtime: "javascript", entry: { id: "client", version: 1 }, inputs: {}, outputs: {}, actions: [], commands: {}, state_keys: [], storage_entries: ["prefs"], http_permissions: ["web"], process_permissions: ["run"], capabilities: ["share"], device_storage: { prefixes: ["drafts"], scope: "window" } },
  worker: { runtime: "python3", code: "print('hello')", actions: ["sync"], schedule: { interval_secs: 60, jitter_secs: 30, enabled_entry: "prefs" }, webhook: { enabled_entry: "prefs", token_secret: "webhook-token" }, secrets: [{ id: "api-key", description: "접근 키" }], watch_entries: ["prefs"] },
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
  const emit = (app = definition, id = "request") => act(() => receive({ event: "app.install_permission", window_id: appWindow.id, request_id: id, app_name: id === "request" ? "자료 수집" : id, release: 3, store_url: "https://store.example.org/apps", digest: `digest-${id}`, definition: app } as CoreEvent));
  const change = (next: (value: ShellSnapshot) => ShellSnapshot) => act(() => { snapshot = next(snapshot); receive({ event: "state.changed", snapshot, sequence: 2 }); });
  call.mockClear();
  return { appWindow, call, store, emit, change };
}

it("창 밖에 닿는 권한과 출처를 읽고 상세를 열 수 있다", async () => {
  const { emit, store } = await setup(); emit();
  const dialog = screen.getByRole("dialog");
  for (const value of ["자료 수집", "3판", "store.example.org", "문서", "내 PC", "팀 계정", "team-api", "example.org", "이 PC에서 프로그램을 실행합니다", "성능", "스토어", "연결한 서버에서 앱의 Python 코드를 실행합니다", "1분마다 스스로 실행됩니다"]) {
    expect(dialog.textContent).toContain(value);
  }
  for (const value of ["prefs", "drafts", "api-key", "writer", "입력:", "출력:", "창 상태:", "https://store.example.org/apps"]) expect(dialog.textContent).not.toContain(value);
  const details = within(dialog).getByText("자세히").closest("details")!;
  expect(details.open).toBe(false);
  expect(details.querySelector("pre")?.textContent).toBe("https://example.org/one\nhttps://example.org/two");
  expect(within(dialog).getByText("코드 보기").closest("details")?.querySelector("pre")?.textContent).toBe("print('hello')");
  expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "취소" }));
  store.dispose();
});

it("프로그램 권한에 실행 파일이 있으면 설치 전에 함께 표시한다", async () => {
  const { emit, store } = await setup();
  emit({ ...definition, permissions: [{ module: "process", id: "run", label: "변환", command: "python3" }] } as AppDefinition);
  expect(screen.getByRole("dialog").textContent).toContain("python3");
  store.dispose();
});

it("빈 선언을 표시하고 합성 허용은 거부하며 취소는 같은 digest로 응답한다", async () => {
  const { appWindow, call, emit, store } = await setup();
  emit({ ...definition, permissions: [], storage: undefined, client: undefined, worker: undefined, agent: undefined });
  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toContain("이 앱은 창 안에서만 동작합니다");
  fireEvent.click(within(dialog).getByRole("button", { name: "허용하고 설치" }));
  expect(call).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
  expect(call).toHaveBeenCalledWith({ op: "app.respond_install_permission", window_id: appWindow.id, request_id: "request", digest: "digest-request", allow: false });
  store.dispose();
});

it("Escape와 창 닫기는 취소하고 숨김은 대기를 유지한다", async () => {
  const { appWindow, call, emit, change, store } = await setup(); emit();
  change((snapshot) => ({ ...snapshot, shared: { ...snapshot.shared, windows: snapshot.shared.windows.map((item) => item.id === appWindow.id ? { ...item, minimized: true } : item) } }));
  expect(call).not.toHaveBeenCalled();
  change((snapshot) => ({ ...snapshot, shared: { ...snapshot.shared, windows: snapshot.shared.windows.map((item) => item.id === appWindow.id ? { ...item, minimized: false } : item) } }));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(call).toHaveBeenCalledWith({ op: "app.respond_install_permission", window_id: appWindow.id, request_id: "request", digest: "digest-request", allow: false });
  call.mockClear(); emit();
  change((snapshot) => ({ ...snapshot, shared: { ...snapshot.shared, windows: snapshot.shared.windows.filter((item) => item.id !== appWindow.id) } }));
  expect(call).toHaveBeenCalledWith({ op: "app.respond_install_permission", window_id: appWindow.id, request_id: "request", digest: "digest-request", allow: false });
  store.dispose();
});

it("같은 창의 설치 요청을 순서대로 보여 주고 응답한다", async () => {
  const { appWindow, call, emit, store } = await setup();
  emit(definition, "A"); emit(definition, "B");
  expect(screen.getByRole("dialog").textContent).toContain("A");
  expect(store.getInstallConsent(appWindow.id)?.request_id).toBe("A");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "취소" }));
  expect(call).toHaveBeenCalledWith({ op: "app.respond_install_permission", window_id: appWindow.id, request_id: "A", digest: "digest-A", allow: false });
  expect(screen.getByRole("dialog").textContent).toContain("B");
  expect(store.getInstallConsent(appWindow.id)?.request_id).toBe("B");
  store.dispose();
});

it("큐의 뒤 요청에 응답해도 앞 요청은 그대로 유지한다", async () => {
  const { appWindow, emit, store } = await setup();
  emit(definition, "A"); emit(definition, "B");
  await act(async () => { await store.call({ op: "app.respond_install_permission", window_id: appWindow.id, request_id: "B", digest: "digest-B", allow: false }); });
  expect(store.getInstallConsent(appWindow.id)?.request_id).toBe("A");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "취소" }));
  expect(store.getInstallConsent(appWindow.id)).toBeUndefined();
  store.dispose();
});

it.each(["제거", "앱 교체"])("창 %s 시 대기 중인 설치 요청을 모두 거절한다", async (action) => {
  const { appWindow, call, emit, change, store } = await setup();
  emit(definition, "A"); emit(definition, "B");
  change((snapshot) => ({ ...snapshot, shared: { ...snapshot.shared, windows: action === "제거"
    ? snapshot.shared.windows.filter((item) => item.id !== appWindow.id)
    : snapshot.shared.windows.map((item) => item.id === appWindow.id ? { ...item, app_id: "new-app" } : item) } }));
  for (const id of ["A", "B"]) expect(call).toHaveBeenCalledWith({ op: "app.respond_install_permission", window_id: appWindow.id, request_id: id, digest: `digest-${id}`, allow: false });
  expect(store.getInstallConsent(appWindow.id)).toBeUndefined();
  store.dispose();
});

it.each([
  [{ state: "connected", mode: "embedded", server_url: "http://localhost:1", device_name: "기기" }, "이 PC에서 앱의 Python 코드를 실행합니다"],
  [{ state: "offline", mode: "embedded", server_url: "http://localhost:1", device_name: "기기", reason: null }, "이 PC에서 앱의 Python 코드를 실행합니다"],
  [{ state: "connected", mode: "remote", server_url: "https://server.example.org/path", device_name: "기기" }, "server.example.org 서버에서 앱의 Python 코드를 실행합니다"],
  [{ state: "offline", mode: "remote", server_url: "https://server.example.org/path", device_name: "기기", reason: null }, "server.example.org 서버에서 앱의 Python 코드를 실행합니다"],
  [{ state: "unlinked" }, "연결한 서버에서 앱의 Python 코드를 실행합니다"],
] as const)("연결 상태에 맞는 서버 실행 위치를 표시한다", async (link, message) => {
  const { change, emit, store } = await setup();
  change((snapshot) => ({ ...snapshot, link }));
  emit();
  expect(screen.getByRole("dialog").textContent).toContain(message);
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
