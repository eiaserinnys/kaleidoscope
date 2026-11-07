import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "../../../app/src/shell/shell";
import { releaseWallpaperCache } from "../../../app/src/shell/wallpaper-layer";
import type { ShellSnapshot } from "../contract/contract";
import { createFakeTransport, type FakeTransportSeed } from "../core/fake-transport";
import { createShellStore, type ShellStore } from "../core/shell-store";
import { makeTestSeed } from "./fixtures";

// 배경 그림은 Blob URL로 그리므로 시험에서 URL을 붙잡아 두고 크기로 어느 그림인지 구분한다.
const IMAGE_A = btoa("AAAAAAAA");
const IMAGE_B = btoa("BBBBBBBBB");
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

function wallpaperSnapshot(wallpapers: Array<{ desktop: string; asset: string }>): ShellSnapshot {
  const snapshot = makeTestSeed().snapshot;
  snapshot.link = { state: "connected", mode: "remote", server_url: "https://kaleidoscope.example", device_name: "시험 PC" };
  snapshot.shared.desktops.push({
    id: "desktop-2", workspace_id: "workspace-1", name: "작업 화면", position: 1,
    created_at: "2026-10-28T00:00:00Z", updated_at: "2026-10-28T00:00:00Z",
  });
  snapshot.shared.desktop_wallpapers = wallpapers.map(({ desktop, asset }) => ({
    id: desktop, desktop_id: desktop, asset: { id: asset, version: 1 }, updated_at: "2026-11-07T00:00:00Z",
  }));
  return snapshot;
}

function seed(snapshot: ShellSnapshot, extra: Partial<FakeTransportSeed> = {}): FakeTransportSeed {
  return {
    ...makeTestSeed(),
    snapshot,
    wallpaperMedia: {
      "wall-a": { data_base64: IMAGE_A, mime: "image/png" },
      "wall-b": { data_base64: IMAGE_B, mime: "image/png" },
    },
    ...extra,
  };
}

async function openShell(snapshot: ShellSnapshot, extra: Partial<FakeTransportSeed> = {}) {
  const transport = createFakeTransport(seed(snapshot, extra));
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  return { transport, store };
}

async function openSettings() {
  fireEvent.click(within(document.querySelector(".ks-shell-bar") as HTMLElement).getByRole("button", { name: "설정" }));
  await screen.findByRole("heading", { name: "바탕화면" });
}

function backgroundUrl(element: HTMLElement | null): string | null {
  if (!element) return null;
  const match = /url\("([^"]+)"\)/.exec(element.style.backgroundImage);
  return match ? match[1] : null;
}

function marker(url: string | null): string | null {
  if (!url) return null;
  const blob = objectUrls.get(url);
  if (!blob) return null;
  return blob.size === 8 ? "A" : blob.size === 9 ? "B" : `size:${blob.size}`;
}

const layerMarker = () => marker(backgroundUrl(document.querySelector<HTMLElement>(".ks-wallpaper-layer")));
const previewMarker = () => marker(backgroundUrl(document.querySelector<HTMLElement>(".ks-wallpaper-preview")));

async function waitForActiveDesktop(store: ShellStore, desktopId: string) {
  await waitFor(() => expect(store.getSnapshot()!.device.active_desktop_ids["workspace-1"]).toBe(desktopId));
}

describe("바탕화면 설정", () => {
  it("설정에서 데스크톱 둘의 다른 그림을 미리 보고 고른다", async () => {
    const { store } = await openShell(wallpaperSnapshot([
      { desktop: "desktop-1", asset: "wall-a" },
      { desktop: "desktop-2", asset: "wall-b" },
    ]));
    await waitFor(() => expect(layerMarker()).toBe("A"));
    await openSettings();
    await waitFor(() => expect(previewMarker()).toBe("A"));
    const select = screen.getByRole("button", { name: "바탕화면 데스크톱" });
    expect(select.textContent).toContain("Desktop");
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("menuitem", { name: "작업 화면" }));
    await waitFor(() => expect(previewMarker()).toBe("B"));
    // 설정에서 고른 데스크톱은 미리보기만 바꾸고 실제 데스크톱은 그대로 둔다.
    expect(store.getSnapshot()!.device.active_desktop_ids["workspace-1"]).toBe("desktop-1");
    expect(layerMarker()).toBe("A");
    store.dispose();
  });

  it("데스크톱을 전환하면 그 데스크톱 그림을 보이고 기본 배경은 레코드를 지운다", async () => {
    const { store } = await openShell(wallpaperSnapshot([
      { desktop: "desktop-1", asset: "wall-a" },
      { desktop: "desktop-2", asset: "wall-b" },
    ]));
    await waitFor(() => expect(layerMarker()).toBe("A"));
    fireEvent.click(screen.getByRole("button", { name: "다음 데스크톱" }));
    await waitForActiveDesktop(store, "desktop-2");
    await waitFor(() => expect(layerMarker()).toBe("B"));
    fireEvent.click(screen.getByRole("button", { name: "이전 데스크톱" }));
    await waitForActiveDesktop(store, "desktop-1");
    await waitFor(() => expect(layerMarker()).toBe("A"));

    await openSettings();
    await waitFor(() => expect(previewMarker()).toBe("A"));
    fireEvent.click(screen.getByRole("button", { name: "기본 배경" }));
    await waitFor(() => expect(store.getSnapshot()!.shared.desktop_wallpapers).toHaveLength(1));
    expect(store.getSnapshot()!.shared.desktop_wallpapers?.[0].desktop_id).toBe("desktop-2");
    await waitFor(() => expect(document.querySelector(".ks-wallpaper-layer")).toBeNull());
    expect(previewMarker()).toBeNull();
    expect((screen.getByRole("button", { name: "기본 배경" }) as HTMLButtonElement).disabled).toBe(true);
    store.dispose();
  });

  it("업로드가 실패하면 이전 그림을 그대로 둔다", async () => {
    const snapshot = wallpaperSnapshot([{ desktop: "desktop-1", asset: "wall-a" }]);
    const { transport, store } = await openShell(snapshot, { wallpaperUploadError: "서버가 그림을 받지 않았습니다" });
    await waitFor(() => expect(layerMarker()).toBe("A"));
    await openSettings();
    await waitFor(() => expect(previewMarker()).toBe("A"));
    const input = screen.getByLabelText("배경 그림 파일");
    fireEvent.change(input, { target: { files: [new File(["새 그림"], "new.png", { type: "image/png" })] } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("서버가 그림을 받지 않았습니다");
    expect(transport.getCalls()).toContainEqual(expect.objectContaining({ op: "desktop.wallpaper.upload", desktop_id: "desktop-1", format: "png" }));
    expect(store.getSnapshot()!.shared.desktop_wallpapers).toEqual([snapshot.shared.desktop_wallpapers![0]]);
    expect(layerMarker()).toBe("A");
    expect(previewMarker()).toBe("A");
    expect((screen.getByRole("button", { name: "기본 배경" }) as HTMLButtonElement).disabled).toBe(false);
    store.dispose();
  });

  it("빠른 전환에서 늦은 그림 응답이 이전 그림을 덮지 않는다", async () => {
    const { store } = await openShell(wallpaperSnapshot([
      { desktop: "desktop-1", asset: "wall-a" },
      { desktop: "desktop-2", asset: "wall-b" },
    ]), { wallpaperMediaDelayMs: { "desktop-1": 120 } });
    fireEvent.click(screen.getByRole("button", { name: "다음 데스크톱" }));
    await waitForActiveDesktop(store, "desktop-2");
    await waitFor(() => expect(layerMarker()).toBe("B"));
    // 앞 데스크톱의 늦은 응답이 도착한 뒤에도 화면은 지금 데스크톱 그림이어야 한다.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    expect(layerMarker()).toBe("B");
    store.dispose();
  });
});
