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

  it.each([
    [{ state: "unlinked" } as const, "서버에 연결", ""],
    [{ state: "pairing", server_url: "https://kaleidoscope.example", user_code: "K7PQ-4XMR", expires_at: "2026-10-29T00:10:00Z" } as const, "연결 코드 K7PQ-4XMR", "ks-link-icon-accent"],
    [{ state: "connected", server_url: "https://kaleidoscope.example", device_name: "Office PC" } as const, "연결됨", ""],
    [{ state: "offline", server_url: "https://kaleidoscope.example", device_name: "Office PC", reason: "서버 응답 없음" } as const, "다시 연결하는 중", "ks-link-icon-muted"],
    [{ state: "revoked", server_url: "https://kaleidoscope.example" } as const, "연결이 끊겼습니다", ""],
  ])("renders %s as one shell IconButton", async (link, label, iconClass) => {
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot: { ...makeTestSeed().snapshot, link } });
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    expect(screen.getByRole("button", { name: label })).toBeTruthy();
    const controls = [...document.querySelectorAll(".ks-shell-actions > button")];
    expect(controls).toHaveLength(3);
    expect(controls.every((button) => button.classList.contains("ks-icon-button"))).toBe(true);
    if (iconClass) expect(controls.at(-1)?.querySelector("svg")?.classList.contains(iconClass)).toBe(true);
    store.dispose();
  });
});
