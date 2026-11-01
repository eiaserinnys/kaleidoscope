import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      observe() {
        this.callback([{ contentRect: { width: 960, height: 552 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
    },
  });
}

afterEach(() => cleanup());

describe("shell core events", () => {
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
    await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "window.open", app_id: "custom-a" })));
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
      rect: { x: 80, y: 80, width: 868, height: 460 },
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
      rect: { x: 48, y: 48, width: 880, height: 492 },
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
    fireEvent.change(screen.getByRole("textbox", { name: "원격 서버 URL" }), { target: { value: "https://remote.example" } });
    fireEvent.click(screen.getByRole("button", { name: "원격 서버 연결" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "link.start", server_url: "https://remote.example" }));
    expect(await screen.findByRole("button", { name: "123456 복사" })).toBeTruthy();
    expect(screen.getByText("https://remote.example")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "내 PC 서버로 돌아가기" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "link.use_local" })); store.dispose();
  });
  it("copies a pairing code and updates the open panel on approval", async () => {
    const transport = createFakeTransport(makeTestSeed());
    transport.setLink({ state: "pairing", server_url: "https://remote.example", user_code: "123456", expires_at: "2099-01-01T00:00:00Z" });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "페어링 코드 123456" }));
    fireEvent.click(screen.getByRole("button", { name: "123456 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("123456"));
    transport.setLink({ state: "connected", mode: "remote", server_url: "https://remote.example", device_name: "집" });
    expect(await screen.findByText("집")).toBeTruthy();
    expect(screen.getByRole("button", { name: "연결 끊기" })).toBeTruthy(); store.dispose();
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
  it("shows offline state and disables importing until reconnected", async () => {
    const seed = makeTestSeed(); seed.snapshot.embedded_available = true;
    const transport = createFakeTransport(seed);
    transport.setLink({ state: "offline", mode: "remote", server_url: "https://remote.example", device_name: "집", reason: "연결 끊김" });
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "원격 오프라인" }));
    expect((screen.getByRole("button", { name: "내 PC 앱과 데이터 가져오기" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "서버 연결" })).toBeNull(); store.dispose();
  });
});
