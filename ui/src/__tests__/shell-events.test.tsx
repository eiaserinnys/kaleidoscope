import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shell } from "../../../app/src/shell/shell";
import type { CoreEvent } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { makeTestSeed, makeTestSnapshot } from "./fixtures";

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
  it("starts pairing from the unlinked menu", async () => {
    const transport = createFakeTransport(makeTestSeed());
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    fireEvent.click(screen.getByRole("button", { name: "서버에 연결" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "서버에 연결" }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "link.start" }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "K7PQ-4XMR 복사" })).toBeTruthy());
    store.dispose();
  });

  it("shows the pairing code and copies it from the menu", async () => {
    const transport = createFakeTransport(makeTestSeed());
    transport.setLink({
      state: "pairing",
      server_url: "https://kaleidoscope.example",
      user_code: "K7PQ-4XMR",
      expires_at: "2026-10-29T00:10:00Z",
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    fireEvent.click(screen.getByRole("button", { name: "연결 코드 K7PQ-4XMR" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "K7PQ-4XMR 복사" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("K7PQ-4XMR"));
    store.dispose();
  });

  it("cancels a pairing request from the code menu", async () => {
    const transport = createFakeTransport(makeTestSeed());
    transport.setLink({
      state: "pairing",
      server_url: "https://kaleidoscope.example",
      user_code: "K7PQ-4XMR",
      expires_at: "2026-10-29T00:10:00Z",
    });
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    fireEvent.click(screen.getByRole("button", { name: "연결 코드 K7PQ-4XMR" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "연결 취소" }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "link.cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "서버에 연결" })).toBeTruthy());
    store.dispose();
  });

  it("unlinks a connected device from its menu", async () => {
    const transport = createFakeTransport(makeTestSeed());
    transport.setLink({ state: "connected", server_url: "https://kaleidoscope.example", device_name: "Office PC" });
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    fireEvent.click(screen.getByTitle("연결됨 · Office PC"));
    fireEvent.click(screen.getByRole("menuitem", { name: "연결 끊기" }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "link.unlink" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "서버에 연결" })).toBeTruthy());
    store.dispose();
  });

  it("updates an open pairing menu when the server approves the link", async () => {
    const transport = createFakeTransport(makeTestSeed());
    transport.setLink({
      state: "pairing",
      server_url: "https://kaleidoscope.example",
      user_code: "K7PQ-4XMR",
      expires_at: "2026-10-29T00:10:00Z",
    });
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    fireEvent.click(screen.getByRole("button", { name: "연결 코드 K7PQ-4XMR" }));
    expect(screen.getByRole("menuitem", { name: "연결 취소" })).toBeTruthy();
    transport.setLink({ state: "connected", server_url: "https://kaleidoscope.example", device_name: "Office PC" });

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "kaleidoscope.example 연결됨" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "연결 끊기" })).toBeTruthy();
      expect(screen.queryByRole("menuitem", { name: "연결 취소" })).toBeNull();
    });
    store.dispose();
  });

  it("updates an open connected menu when the link goes offline", async () => {
    const transport = createFakeTransport(makeTestSeed());
    transport.setLink({ state: "connected", server_url: "https://kaleidoscope.example", device_name: "Office PC" });
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    fireEvent.click(screen.getByTitle("연결됨 · Office PC"));
    transport.setLink({
      state: "offline",
      server_url: "https://kaleidoscope.example",
      device_name: "Office PC",
      reason: "서버 응답 없음",
    });

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "다시 연결하는 중" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "연결 끊기" })).toBeTruthy();
      expect(screen.queryByRole("menuitem", { name: "kaleidoscope.example 연결됨" })).toBeNull();
    });
    store.dispose();
  });

  it.each([
    ["unlinked", { state: "unlinked" } as const, "서버에 연결"],
    ["pairing", { state: "pairing", server_url: "https://kaleidoscope.example", user_code: "K7PQ-4XMR", expires_at: "2026-10-29T00:10:00Z" } as const, "연결 코드 K7PQ-4XMR"],
    ["connected", { state: "connected", server_url: "https://kaleidoscope.example", device_name: "Office PC" } as const, "연결됨"],
    ["offline", { state: "offline", server_url: "https://kaleidoscope.example", device_name: "Office PC", reason: "서버 응답 없음" } as const, "다시 연결하는 중"],
    ["revoked", { state: "revoked", server_url: "https://kaleidoscope.example" } as const, "연결이 끊겼습니다"],
  ])("renders %s as one shell IconButton with its status shape", async (state, link, label) => {
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot: { ...makeTestSeed().snapshot, link } });
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    expect(screen.getByRole("button", { name: label })).toBeTruthy();
    const controls = [...document.querySelectorAll(".ks-shell-actions > button")];
    expect(controls).toHaveLength(3);
    expect(controls.every((button) => button.classList.contains("ks-icon-button"))).toBe(true);
    const icon = controls.at(-1)?.querySelector("svg");
    expect(icon).toBeTruthy();
    if (state === "pairing") {
      expect(icon?.classList.contains("ks-link-icon-accent")).toBe(true);
      expect(icon?.querySelectorAll("circle")).toHaveLength(3);
    } else if (state === "offline") {
      expect(icon?.classList.contains("lucide-cloud")).toBe(true);
      expect(icon?.getAttribute("stroke-dasharray")).toBe("3 2");
    } else if (state === "connected") {
      expect(icon?.classList.contains("lucide-cloud")).toBe(true);
      expect(icon?.querySelectorAll("path")).toHaveLength(1);
      expect(icon?.querySelector("path")?.hasAttribute("stroke-dasharray")).toBe(false);
    } else {
      expect(icon?.classList.contains("lucide-cloud-off")).toBe(true);
      expect(icon?.querySelectorAll("circle")).toHaveLength(0);
    }
    store.dispose();
  });
});
