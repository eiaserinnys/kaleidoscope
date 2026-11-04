import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shell } from "../../../app/src/shell/shell";
import type { CoreEvent } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { makeTestSeed, makeTestSnapshot } from "./fixtures";
import calculatorJson from "../../../apps/calculator.json";
import weatherJson from "../../../apps/weather.json";
import agentJson from "../../../apps/agent.json";
import explorerJson from "../../../apps/explorer.json";
import mdEditorJson from "../../../apps/md-editor.json";
import { mdViewerDefinition as mdViewerJson } from "./fixtures";
import htmlReportJson from "../../../apps/html-report.json";
import webBrowserJson from "../../../apps/web-browser.json";
import type { AppDefinition } from "../contract/contract";

if (!globalThis.ResizeObserver) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width: 960, height: 552 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    },
  });
}

afterEach(() => cleanup());

describe("shell core events", () => {
  it("빈 데스크톱은 작업 표시줄을 숨기고 최소화된 창의 작업 표시줄은 유지한다", async () => {
    const snapshot = makeTestSnapshot();
    const window = snapshot.shared.windows[0];
    snapshot.shared.windows = [];
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    expect(document.querySelector(".ks-taskbar")).toBeNull();
    transport.emit({ event: "state.changed", snapshot: { ...snapshot, shared: { ...snapshot.shared, windows: [window] } } });
    await waitFor(() => expect(document.querySelector(".ks-taskbar")).not.toBeNull());

    await transport.call({ op: "window.minimize", window_id: window.id });
    await waitFor(() => expect(document.querySelector(".ks-taskbar")).not.toBeNull());
    expect(document.querySelector(".ks-taskbar-window")?.getAttribute("data-state")).toBe("minimized");
    store.dispose();
  });

  it("태스크바로 창을 올리고 최소화하며 우클릭 메뉴에서 최대화와 복원을 수행한다", async () => {
    const transport = createFakeTransport(makeTestSeed());
    const calls = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    const editorItem = document.querySelector<HTMLButtonElement>('[data-window-id="editor-window"]');
    const editorWindow = screen.getByTestId("app-window-md-editor");
    if (!editorItem) throw new Error("편집기 태스크바 항목을 찾지 못했습니다");
    const titlebarIcons = [...editorWindow.querySelectorAll<SVGElement>(".ks-window-title-actions svg")];
    expect(titlebarIcons.map((icon) => icon.getAttribute("width"))).toEqual(titlebarIcons.map(() => "14"));
    const minimizeIcon = within(editorWindow).getByRole("button", { name: "창 최소화" }).querySelector("svg");
    expect(minimizeIcon?.classList.contains("lucide-minus")).toBe(true);
    expect(editorItem.getAttribute("data-state")).toBe("inactive");
    expect(document.querySelector('[data-window-id="viewer-window"]')?.getAttribute("data-state")).toBe("active");

    fireEvent.click(editorItem);
    await waitFor(() => expect(editorItem.getAttribute("data-state")).toBe("active"));
    expect(calls).toHaveBeenCalledWith({ op: "window.raise", window_id: "editor-window" });

    fireEvent.click(editorItem);
    await waitFor(() => expect(editorWindow.getAttribute("data-minimized")).toBe("true"));
    expect(editorItem.getAttribute("data-state")).toBe("minimized");
    expect(calls).toHaveBeenCalledWith({ op: "window.minimize", window_id: "editor-window" });

    fireEvent.contextMenu(editorItem);
    expect(screen.getByRole("menuitem", { name: "복원" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    fireEvent.click(editorItem);
    await waitFor(() => expect(editorWindow.getAttribute("data-minimized")).toBe("false"));
    expect(editorItem.getAttribute("data-state")).toBe("active");

    fireEvent.contextMenu(editorItem);
    const menu = screen.getByRole("menu");
    expect(menu.getAttribute("role")).toBe("menu");
    expect(screen.getByRole("menuitem", { name: "창 최소화" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "창 닫기" }).classList.contains("ks-menu-item-danger")).toBe(false);
    fireEvent.click(screen.getByRole("menuitem", { name: "창 최대화" }));
    await waitFor(() => expect(editorWindow.getAttribute("data-maximized")).toBe("true"));
    expect(editorWindow.querySelector(".ks-window-resize-east")).toBeNull();
    expect(calls).toHaveBeenCalledWith({ op: "window.maximize", window_id: "editor-window" });

    fireEvent.click(editorItem);
    await waitFor(() => expect(editorWindow.getAttribute("data-minimized")).toBe("true"));
    fireEvent.click(editorItem);
    await waitFor(() => expect(editorWindow.getAttribute("data-minimized")).toBe("false"));
    expect(editorWindow.getAttribute("data-maximized")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "이전 크기로 복원" }));
    await waitFor(() => expect(editorWindow.getAttribute("data-maximized")).toBe("false"));
    expect(calls).toHaveBeenCalledWith({ op: "window.restore", window_id: "editor-window" });
    store.dispose();
  });

  it("앱 열기 메뉴에서 기본 앱과 커스텀 앱을 각각 가나다순으로 열 수 있다", async () => {
    document.documentElement.style.setProperty("--ks-window-min-width", "360px");
    document.documentElement.style.setProperty("--ks-window-min-height", "240px");
    const definitions = [
      calculatorJson, weatherJson, agentJson, explorerJson, mdEditorJson, htmlReportJson, webBrowserJson,
      { ...mdViewerJson, id: "custom-z", name: "가나다 커스텀" },
      { ...mdViewerJson, id: "custom-a", name: "가나가 커스텀" },
      { ...mdViewerJson, id: "custom-b", name: "가나가 커스텀" },
    ] as AppDefinition[];
    const snapshot = makeTestSnapshot({ definitions });
    snapshot.shared.windows.forEach((window) => { window.id = `test-window-${window.app_id}`; });
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const calls = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    fireEvent.click(screen.getByRole("button", { name: "앱 열기" }));

    const menu = screen.getByRole("menu");
    expect([...menu.querySelectorAll(".ks-menu-group-heading")].map((item) => item.textContent)).toEqual(["기본앱", "커스텀 앱"]);
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual([
      "계산기", "날씨", "마크다운 편집기", "시안과 리포트", "에이전트", "웹 브라우저", "탐색기",
      "가나가 커스텀", "가나가 커스텀", "가나다 커스텀",
    ]);
    fireEvent.click(screen.getByRole("menu").querySelectorAll('[role="menuitem"]')[7]);
    await waitFor(() => expect(calls).toHaveBeenCalledWith({
      op: "window.open",
      desktop_id: "desktop-1",
      app_id: "custom-a",
      rect: { x: 112, y: 112, width: 836, height: 376 },
    }));
    const openedWindow = {
      ...snapshot.shared.windows[0],
      id: "custom-a-window",
      app_id: "custom-a",
      z: Math.max(...snapshot.shared.windows.map((window) => window.z)) + 1,
    };
    transport.emit({
      event: "state.changed",
      snapshot: {
        ...snapshot,
        shared: { ...snapshot.shared, windows: [...snapshot.shared.windows, openedWindow] },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "앱 열기" }));
    fireEvent.click(screen.getByRole("menu").querySelectorAll('[role="menuitem"]')[8]);
    await waitFor(() => expect(calls).toHaveBeenCalledWith({
      op: "window.open",
      desktop_id: "desktop-1",
      app_id: "custom-b",
      rect: { x: 144, y: 144, width: 804, height: 344 },
    }));
    store.dispose();
  });

  it("기본 앱만 있으면 기본앱 섹션만 표시한다", async () => {
    const definitions = [calculatorJson, htmlReportJson] as AppDefinition[];
    const snapshot = makeTestSnapshot({ definitions });
    snapshot.shared.windows.forEach((window) => { window.id = `builtin-window-${window.app_id}`; });
    const store = createShellStore(createFakeTransport({ ...makeTestSeed(), snapshot }));
    render(<Shell store={store} />);
    await store.ready;

    fireEvent.click(screen.getByRole("button", { name: "앱 열기" }));

    const menu = screen.getByRole("menu");
    expect([...menu.querySelectorAll(".ks-menu-group-heading")].map((item) => item.textContent)).toEqual(["기본앱"]);
    expect(menu.querySelector('[role="separator"]')).toBeNull();
    expect(screen.queryByText("커스텀 앱")).toBeNull();
    store.dispose();
  });

  it("delivers non-state events without replacing the snapshot", async () => {
    const transport = createFakeTransport(makeTestSeed());
    const store = createShellStore(transport);
    await store.ready;
    const listener = vi.fn();
    const unsubscribe = store.subscribeEvents(listener);
    const event: CoreEvent = { event: "app.open_requested", app_id: "md-viewer" };

    transport.emit(event);

    expect(listener).toHaveBeenCalledWith(event);
    expect(store.getSnapshot()?.shared.apps.map((app) => app.id)).toContain("md-viewer");
    unsubscribe();
    store.dispose();
  });

  it("opens a requested app on the selected desktop using the new-window placement", async () => {
    document.documentElement.style.setProperty("--ks-window-min-width", "360px");
    document.documentElement.style.setProperty("--ks-window-min-height", "240px");
    const snapshot = makeTestSnapshot();
    snapshot.shared.windows = snapshot.shared.windows.filter((window) => window.app_id !== "md-viewer");
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    transport.emit({ event: "app.open_requested", app_id: "md-viewer" });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({
      op: "window.open",
      desktop_id: "desktop-1",
      app_id: "md-viewer",
      rect: { x: 80, y: 80, width: 868, height: 408 },
    }));
    store.dispose();
  });

  it("raises the highest window for an already open requested app", async () => {
    const snapshot = makeTestSnapshot();
    snapshot.shared.windows.push({ ...snapshot.shared.windows[1], id: "viewer-window-top", z: 5 });
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    transport.emit({ event: "app.open_requested", app_id: "md-viewer" });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "window.raise", window_id: "viewer-window-top" }));
    store.dispose();
  });

  it("ignores a request for an app absent from the latest snapshot", async () => {
    const transport = createFakeTransport(makeTestSeed());
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    spy.mockClear();

    transport.emit({ event: "app.open_requested", app_id: "missing-app" });

    expect(spy).not.toHaveBeenCalled();
    store.dispose();
  });

  it("opens a workspace-targeted app on that workspace desktop without changing the visible workspace", async () => {
    const snapshot = makeTestSnapshot();
    snapshot.shared.workspaces.push({
      id: "workspace-2", name: "다른 작업", created_at: "2026-10-29T00:00:00Z", updated_at: "2026-10-29T00:00:00Z",
    });
    snapshot.shared.desktops.push({
      id: "desktop-2", workspace_id: "workspace-2", name: "작업 화면", position: 0,
      created_at: "2026-10-29T00:00:00Z", updated_at: "2026-10-29T00:00:00Z",
    });
    snapshot.shared.desktops.push({
      id: "desktop-3", workspace_id: "workspace-2", name: "마지막 화면", position: 1,
      created_at: "2026-10-29T00:00:00Z", updated_at: "2026-10-29T00:00:00Z",
    });
    snapshot.device.active_desktop_ids["workspace-2"] = "desktop-3";
    snapshot.shared.windows = snapshot.shared.windows.filter((window) => window.app_id !== "md-viewer");
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    transport.emit({ event: "app.open_requested", app_id: "md-viewer", workspace_id: "workspace-2" });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({
      op: "window.open",
      desktop_id: "desktop-3",
      app_id: "md-viewer",
      rect: { x: 48, y: 48, width: 880, height: 440 },
    }));
    expect(store.getSnapshot()?.device.active_workspace_id).toBe("workspace-1");
    expect(store.getSnapshot()?.device.active_desktop_ids["workspace-2"]).toBe("desktop-3");
    store.dispose();
  });

  it("ignores a workspace-targeted request for a workspace absent from the latest snapshot", async () => {
    const transport = createFakeTransport(makeTestSeed());
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    spy.mockClear();

    transport.emit({ event: "app.open_requested", app_id: "md-viewer", workspace_id: "missing-workspace" });

    expect(spy).not.toHaveBeenCalled();
    store.dispose();
  });
});

describe("shell server link control", () => {
  it("pairs with the entered remote URL and keeps the code visible", async () => {
    const seed = makeTestSeed(); seed.snapshot.embedded_available = true;
    const transport = createFakeTransport(seed);
    transport.setLink({ state: "connected", mode: "embedded", server_url: "http://127.0.0.1:4219", device_name: "내 PC" });
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "내 PC 서버" }));
    expect(screen.getByRole("region", { name: "설정" })).toBeTruthy();
    const input = screen.getByRole("textbox", { name: "원격 서버 주소" });
    expect(document.activeElement).toBe(input);
    const connect = screen.getByRole("button", { name: "연결" }) as HTMLButtonElement;
    expect(connect.disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy.mock.calls.some(([request]) => request.op === "link.start")).toBe(false);
    fireEvent.change(input, { target: { value: "https://remote.example" } });
    expect(connect.disabled).toBe(false);
    fireEvent.blur(input);
    expect(spy.mock.calls.some(([request]) => request.op === "link.start")).toBe(false);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "link.start", server_url: "https://remote.example" }));
    expect(await screen.findByRole("button", { name: "코드 복사" })).toBeTruthy();
    expect(screen.getByText("https://remote.example")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "내 PC 서버로 돌아가기" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "link.use_local" })); store.dispose();
  });
  it("opens the same server control in an empty workspace and groups its action", async () => {
    const seed = makeTestSeed(); seed.snapshot.embedded_available = true;
    seed.snapshot.shared.workspaces = []; seed.snapshot.shared.desktops = []; seed.snapshot.shared.windows = [];
    const transport = createFakeTransport(seed);
    transport.setLink({ state: "connected", mode: "embedded", server_url: "http://127.0.0.1:4219", device_name: "내 PC" });
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    const button = screen.getByRole("button", { name: "내 PC 서버" });
    expect(button.closest(".ks-shell-actions")).toBeTruthy();
    expect(button.querySelector(".shell-server-dot")).toBeTruthy();
    expect(button.hasAttribute("aria-expanded")).toBe(false);
    expect(screen.getByRole("button", { name: "작업 만들기" }).closest(".ks-empty-state-action")).toBeTruthy();
    fireEvent.click(button);
    expect(screen.getByRole("region", { name: "설정" })).toBeTruthy();
    expect(button.hasAttribute("aria-expanded")).toBe(false);
    store.dispose();
  });
  it("offers prefilled remote re-pairing after revocation", async () => {
    const seed = makeTestSeed(); seed.snapshot.embedded_available = true;
    const transport = createFakeTransport(seed);
    transport.setLink({ state: "revoked", server_url: "https://revoked.example" });
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "원격 연결 거부됨" }));
    expect(screen.queryByRole("button", { name: "내 PC 앱과 데이터 가져오기" })).toBeNull();
    const input = screen.getByRole("textbox", { name: "원격 서버 주소" }) as HTMLInputElement;
    expect((screen.getByRole("button", { name: "연결" }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "내 PC 서버로 전환" }));
    expect(input.value).toBe("https://revoked.example");
    expect(screen.getByRole("button", { name: "내 PC 서버로 전환" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "link.start", server_url: "https://revoked.example" }));
    store.dispose();
  });
  it("names an unlinked panel without claiming a local connection", async () => {
    const store = createShellStore(createFakeTransport(makeTestSeed()));
    render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "연결 해제됨" }));
    expect(screen.getByText("서버 연결")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "원격 서버 주소" })).toBeTruthy();
    expect(screen.queryByText("내 PC 내장 서버")).toBeNull(); store.dispose();
  });
  it("copies a pairing code and updates the open panel on approval", async () => {
    const transport = createFakeTransport(makeTestSeed());
    transport.setLink({ state: "pairing", server_url: "https://remote.example", user_code: "123456", expires_at: "2099-01-01T00:00:00Z" });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "페어링 코드 123456" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "코드 복사" }));
    fireEvent.click(screen.getByRole("button", { name: "코드 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("123456"));
    expect(await screen.findByText("코드 복사됨")).toBeTruthy();
    transport.setLink({ state: "connected", mode: "remote", server_url: "https://remote.example", device_name: "집" });
    expect(await screen.findByText("집")).toBeTruthy();
    expect(screen.getByRole("button", { name: "연결 끊기" })).toBeTruthy(); store.dispose();
  });
  it("복사하지 못하면 코드와 직접 복사할 안내를 보인다", async () => {
    const transport = createFakeTransport(makeTestSeed());
    transport.setLink({ state: "pairing", server_url: "https://remote.example", user_code: "123456", expires_at: "2099-01-01T00:00:00Z" });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("거부")) } });
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "페어링 코드 123456" }));
    fireEvent.click(screen.getByRole("button", { name: "코드 복사" }));
    expect(await screen.findByText("페어링 코드를 복사하지 못했습니다. 표시된 코드를 직접 복사하세요.")).toBeTruthy();
    expect(screen.getByText("SHELL_SERVER_PAIRING_CODE_COPY_FAILED")).toBeTruthy();
    store.dispose();
  });
  it("reports import results and switches back to the local server", async () => {
    const seed = makeTestSeed(); seed.snapshot.embedded_available = true;
    const transport = createFakeTransport(seed);
    transport.setLink({ state: "connected", mode: "remote", server_url: "https://remote.example", device_name: "집" });
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "원격 서버 (remote.example)" }));
    fireEvent.click(screen.getByRole("button", { name: "내 PC 앱과 데이터 가져오기" }));
    expect(await screen.findByText("가져오기 완료 3개")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "내 PC 서버로 전환" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "link.use_local" })); store.dispose();
  });
  it("가져오는 동안 누른 서버 단추 자리에 진행 표시를 둔다", async () => {
    const seed = makeTestSeed(); seed.snapshot.embedded_available = true;
    const transport = createFakeTransport(seed);
    transport.setLink({ state: "connected", mode: "remote", server_url: "https://remote.example", device_name: "집" });
    const original = transport.call.bind(transport);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(transport, "call").mockImplementation((async (request) => {
      if (request.op === "link.sync_local_to_remote") await waiting;
      return original(request);
    }) as typeof transport.call);
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "원격 서버 (remote.example)" }));
    const button = screen.getByRole("button", { name: "내 PC 앱과 데이터 가져오기" });
    fireEvent.click(button);
    expect(button.classList.contains("is-progress")).toBe(true);
    expect(button.querySelector(".ks-button-progress")).toBeTruthy();
    await act(async () => release());
    store.dispose();
  });
  it("shows offline state and disables importing until reconnected", async () => {
    const seed = makeTestSeed(); seed.snapshot.embedded_available = true;
    const transport = createFakeTransport(seed);
    transport.setLink({ state: "offline", mode: "remote", server_url: "https://remote.example", device_name: "집", reason: { id: "CONN_EVENTS_SEND_FAILED", code: "server", message: "연결 끊김", details: ["host=remote.example"] } });
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "원격 오프라인" }));
    expect(screen.getByText("연결 끊김")).toBeTruthy();
    expect(screen.getByText("CONN_EVENTS_SEND_FAILED")).toBeTruthy();
    expect(screen.queryByText("host=remote.example")).toBeNull();
    expect((screen.getByRole("button", { name: "내 PC 앱과 데이터 가져오기" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("region", { name: "설정" }), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "설정" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "원격 오프라인" })); store.dispose();
  });
  it("톱니와 뒤로 단추로 설정을 열고 닫으며 초점을 되돌린다", async () => {
    const store = createShellStore(createFakeTransport(makeTestSeed()));
    render(<Shell store={store} />); await store.ready;
    const gear = screen.getByRole("button", { name: "설정" });
    fireEvent.click(gear);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "설정" }));
    expect(document.querySelector(".app-root")?.hasAttribute("data-settings-open")).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole("region", { name: "설정" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "작업 화면으로 돌아가기" }));
    expect(screen.queryByRole("region", { name: "설정" })).toBeNull();
    expect(document.activeElement).toBe(gear);
    store.dispose();
  });
  it.each([
    [{ state: "pairing", server_url: "https://remote.example", user_code: "123456", expires_at: "2099-01-01T00:00:00Z" } as const, "연결 취소", "link.cancel"],
    [{ state: "connected", mode: "remote", server_url: "https://remote.example", device_name: "집" } as const, "연결 끊기", "link.unlink"],
  ])("내 PC 서버가 없을 때 기존 원격 연결 조작을 유지한다", async (link, label, op) => {
    const seed = makeTestSeed(); seed.snapshot.embedded_available = false;
    const transport = createFakeTransport(seed); transport.setLink(link);
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op }));
    store.dispose();
  });
  it("열린 설정에서 서버 단추는 서버 구역에 초점을 옮기고 데스크톱 선택은 설정을 닫는다", async () => {
    const seed = makeTestSeed(); seed.snapshot.embedded_available = true;
    const transport = createFakeTransport(seed);
    transport.setLink({ state: "connected", mode: "embedded", server_url: "http://127.0.0.1:4219", device_name: "내 PC" });
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    const desktop = screen.getByRole("button", { name: "Desktop" });
    expect(desktop.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "내 PC 서버" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "원격 서버 주소" }));
    fireEvent.click(desktop);
    expect(screen.queryByRole("region", { name: "설정" })).toBeNull();
    expect(desktop.getAttribute("aria-pressed")).toBe("true");
    store.dispose();
  });
  it("연결 후 작업이 생겨도 설정을 연 단추로 초점을 돌린다", async () => {
    const seed = makeTestSeed();
    const next = makeTestSnapshot();
    seed.snapshot.shared.workspaces = []; seed.snapshot.shared.desktops = []; seed.snapshot.shared.windows = [];
    const transport = createFakeTransport(seed);
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    const current = store.getSnapshot()!;
    transport.emit({ event: "state.changed", snapshot: { ...current, shared: { ...current.shared, workspaces: next.shared.workspaces, desktops: next.shared.desktops }, device: next.device } });
    await waitFor(() => expect(screen.getByRole("button", { name: "데스크톱 추가" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "작업 화면으로 돌아가기" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "설정" }));
    store.dispose();
  });
});
