import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, CoreReply, MediaRef } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { WindowDataProvider } from "../data/window-data";
import { useMedia } from "../data/use-media";
import { MediaThumbnail } from "../components/media-thumbnail";
import { makeTestSeed } from "./fixtures";

const definition: AppDefinition = { id: "media-test", name: "미디어 시험", requires: { blocks: 12, modules: { assets: 1 } }, permissions: [], state: {}, assets: [], ui: { type: "text", value: "시험" } };
const photo: MediaRef = { permission: "files", path: "photo.jpg" };
const asset: MediaRef = { asset: "icon", version: 1 };
let width = 100;
let resize: () => void;

beforeEach(() => {
  width = 100;
  vi.stubGlobal("devicePixelRatio", 1);
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width, height: width } as DOMRect));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const seed = makeTestSeed({ definitions: [definition] });
  const store = createShellStore(createFakeTransport(seed));
  const original = store.call.bind(store);
  const requests: { size: number; resolve: (value: CoreReply) => void; reject: (reason: unknown) => void }[] = [];
  vi.spyOn(store, "call").mockImplementation((request) => {
    if (request.op !== "data.media") return original(request);
    return new Promise<CoreReply>((resolve, reject) => requests.push({ size: request.max_px!, resolve, reject })) as ReturnType<typeof store.call>;
  });
  const wrap = (child: React.ReactNode) => <WindowDataProvider store={store} windowId={seed.snapshot.shared.windows[0].id} definition={definition}>{child}</WindowDataProvider>;
  const reply = (index: number, text: string, mime = "image/png") => act(async () => requests[index].resolve({ op: "data.media", media: { mime, data_base64: btoa(text), width: null, height: null } }));
  return { store, requests, wrap, reply };
}

it("불러오기, 실패, 미디어 없음은 서로 다른 표시를 쓴다", async () => {
  const s = setup();
  const view = render(s.wrap(<MediaThumbnail media={photo} size={160} />));
  await waitFor(() => expect(s.requests).toHaveLength(1));
  expect(view.container.querySelector(".is-loading svg")).toBeNull();
  await act(async () => s.requests[0].reject({ code: "unavailable", message: "파일을 읽을 수 없습니다", id: "TEST_ERROR", details: [] }));
  expect(view.container.querySelector(".is-failed .lucide-image-off")).not.toBeNull();
  expect(view.container.querySelector(".is-failed")?.getAttribute("title")).toContain("파일을 읽을 수 없습니다");
  view.rerender(s.wrap(<MediaThumbnail media={null} size={160} />));
  expect(view.container.querySelector(".lucide-image")).not.toBeNull();
  s.store.dispose();
});

it("썸네일 크기 단계 안에서는 호출하지 않고 커진 뒤 줄여도 다시 호출하지 않는다", async () => {
  const s = setup();
  const view = render(s.wrap(<MediaThumbnail media={photo} size={160} />));
  await waitFor(() => expect(s.requests.map((r) => r.size)).toEqual([128]));
  await s.reply(0, "small");
  const img = () => view.container.querySelector("img")?.getAttribute("src");
  expect(img()).toContain(btoa("small"));
  width = 120; act(() => resize());
  expect(s.requests).toHaveLength(1);
  width = 129; act(() => resize());
  await waitFor(() => expect(s.requests.map((r) => r.size)).toEqual([128, 256]));
  expect(img()).toContain(btoa("small"));
  await s.reply(1, "large");
  expect(img()).toContain(btoa("large"));
  width = 80; act(() => resize());
  expect(s.requests).toHaveLength(2);
  expect(img()).toContain(btoa("large"));
  s.store.dispose();
});

it("큰 판이 실패해도 작은 판은 유지하고 다른 미디어는 로딩으로 시작한다", async () => {
  const s = setup();
  function Image({ media, size }: { media: MediaRef; size: number }) {
    const result = useMedia(media, size);
    return <div>{result.status === "ready" ? result.url : result.status}</div>;
  }
  const draw = (media: MediaRef, size: number) => s.wrap(<Image media={media} size={size} />);
  const view = render(draw(photo, 64));
  await waitFor(() => expect(s.requests).toHaveLength(1));
  await s.reply(0, "small");
  view.rerender(draw(photo, 128));
  await waitFor(() => expect(s.requests).toHaveLength(2));
  expect(screen.getByText(/c21hbGw=/)).toBeTruthy();
  await act(async () => s.requests[1].reject({ code: "unavailable", message: "실패", details: [] }));
  expect(screen.getByText(/c21hbGw=/)).toBeTruthy();
  view.rerender(draw({ permission: "files", path: "other.jpg" }, 128));
  expect(screen.getByText("loading")).toBeTruthy();
  s.store.dispose();
});

it("늦은 작은 판이 큰 판을 덮지 않는다", async () => {
  const s = setup();
  function Image({ size }: { size: number }) { const r = useMedia(photo, size); return <div>{r.status === "ready" ? r.url : r.status}</div>; }
  const draw = (size: number) => s.wrap(<Image size={size} />);
  const view = render(draw(64));
  await waitFor(() => expect(s.requests).toHaveLength(1));
  view.rerender(draw(128));
  await waitFor(() => expect(s.requests).toHaveLength(2));
  await s.reply(1, "large");
  await s.reply(0, "small");
  expect(screen.getByText(/bGFyZ2U=/)).toBeTruthy();
  s.store.dispose();
});

it("소수 배율에서도 크기 단계를 정확히 요청한다", async () => {
  vi.stubGlobal("devicePixelRatio", 1.1);
  const s = setup();
  render(s.wrap(<MediaThumbnail media={photo} size={160} />));
  await waitFor(() => expect(s.requests.map((request) => request.size)).toEqual([128]));
  s.store.dispose();
});

it("아이콘 배치의 사진은 채우고 앱 자산과 SVG는 맞춰 넣는다", async () => {
  const s = setup();
  const view = render(s.wrap(<MediaThumbnail media={photo} size={32} icon />));
  await waitFor(() => expect(s.requests).toHaveLength(1));
  expect(view.container.querySelector(".ks-icon-skeleton-icon")).not.toBeNull();
  await s.reply(0, "photo");
  expect(view.container.querySelector("img.ks-app-icon")).toBeNull();
  expect(view.container.querySelector("img")).not.toBeNull();
  view.rerender(s.wrap(<MediaThumbnail media={asset} size={32} icon />));
  await waitFor(() => expect(s.requests).toHaveLength(2));
  await s.reply(1, "icon");
  expect(view.container.querySelector("img.ks-app-icon")).not.toBeNull();
  view.rerender(s.wrap(<MediaThumbnail media={{ permission: "files", path: "logo.svg" }} size={32} icon />));
  await waitFor(() => expect(s.requests).toHaveLength(3));
  await s.reply(2, '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red" width="1" height="1"/></svg>', "image/svg+xml");
  expect(view.container.querySelector("img.ks-app-icon")).not.toBeNull();
  s.store.dispose();
});
