import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "../../../app/src/shell/shell";
import { releaseWallpaperCache } from "../../../app/src/shell/wallpaper-layer";
import type { LinkStatus, ShellSnapshot } from "../contract/contract";
import { createFakeTransport, type FakeTransport, type FakeTransportSeed } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { makeTestSeed } from "./fixtures";

// iPad처럼 원격 서버만 있는 기기에서, 첫 읽기가 연결 전에 실패한 뒤 연결되면 다시 읽는지 본다.
const IMAGE = btoa("AAAAAAA");
const objectUrls = new Map<string, Blob>();
let objectCount = 0;

beforeEach(() => {
  objectUrls.clear();
  objectCount = 0;
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn((value: Blob) => {
      const url = `blob:wallpaper-${++objectCount}`;
      objectUrls.set(url, value);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => { objectUrls.delete(url); }),
  }));
  // jsdom은 그림을 실제로 풀지 못하므로 decode를 통과시킨다.
  vi.stubGlobal("Image", class {
    src = "";
    decode() { return Promise.resolve(); }
  });
});

afterEach(() => {
  cleanup();
  releaseWallpaperCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SERVER = "https://kaleidoscope.example";
const CONNECTED: LinkStatus = { state: "connected", mode: "remote", server_url: SERVER, device_name: "아이패드" };
const OFFLINE: LinkStatus = { state: "offline", mode: "remote", server_url: SERVER, device_name: "아이패드", reason: null };
const CONNECTED_FAILURE = "저장된 배경 그림을 읽지 못했습니다. 기본 배경으로 보여 줍니다. 서버 연결을 확인하세요.";

function wallpaperSnapshot(link: LinkStatus): ShellSnapshot {
  const snapshot = makeTestSeed().snapshot;
  snapshot.link = link;
  snapshot.shared.desktop_wallpapers = [{
    id: "desktop-1", desktop_id: "desktop-1", asset: { id: "wall-a", version: 1 }, updated_at: "2026-11-07T00:00:00Z",
  }];
  return snapshot;
}

async function openShell(snapshot: ShellSnapshot, extra: Partial<FakeTransportSeed> = {}) {
  const transport = createFakeTransport({
    ...makeTestSeed(),
    snapshot,
    wallpaperMedia: { "wall-a": { data_base64: IMAGE, mime: "image/png" } },
    ...extra,
  });
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  return { transport, store };
}

function mediaCalls(transport: FakeTransport): number {
  return transport.getCalls().filter((request) => request.op === "desktop.wallpaper.media").length;
}

function layerShown(): boolean {
  return document.querySelector(".ks-wallpaper-layer") !== null;
}

/// 실패 응답이 effect에 닿을 때까지 기다린다.
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("연결 전 배경 그림", () => {
  it("연결 전 읽기 실패는 알리지 않고 연결되면 다시 읽는다", async () => {
    const { transport } = await openShell(wallpaperSnapshot(OFFLINE));
    await waitFor(() => expect(mediaCalls(transport)).toBe(1));
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(layerShown()).toBe(false);

    act(() => transport.setLink(CONNECTED));
    await waitFor(() => expect(layerShown()).toBe(true));
    expect(mediaCalls(transport)).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("연결된 상태의 읽기 실패는 지금처럼 알린다", async () => {
    await openShell(wallpaperSnapshot(CONNECTED), { wallpaperMediaError: CONNECTED_FAILURE });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(CONNECTED_FAILURE);
    expect(alert.textContent).toContain("DESK_WALLPAPER_MEDIA_READ_FAILED");
  });

  it("그림을 보인 뒤 연결이 끊겼다 돌아와도 알리지 않고 다시 부르지 않는다", async () => {
    const { transport } = await openShell(wallpaperSnapshot(CONNECTED));
    await waitFor(() => expect(layerShown()).toBe(true));

    act(() => transport.setLink(OFFLINE));
    await settle();
    act(() => transport.setLink(CONNECTED));
    await waitFor(() => expect(layerShown()).toBe(true));

    expect(mediaCalls(transport)).toBe(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
