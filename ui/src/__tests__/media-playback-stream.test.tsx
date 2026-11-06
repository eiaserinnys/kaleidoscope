import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block, MediaPlayback } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed } from "./fixtures";

const media = { permission: "media", path: "first.mp4" };
const inline: MediaPlayback = { kind: "inline", media: { mime: "video/webm", data_base64: "YQ==", width: null, height: null } };
const stream: MediaPlayback = { kind: "stream", handle: "lease", url: "http://127.0.0.1/media", mime: "video/mp4" };
const problem = { id: "FILE_PATH_NOT_FOUND", code: "not_found" as const, message: "파일을 찾을 수 없습니다", details: [] };

function setup(block: Block, open: () => Promise<MediaPlayback> = async () => stream, status: () => Promise<typeof problem | null> = async () => null) {
  const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 4, modules: {} }, permissions: [], state: {}, ui: block };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  const call = vi.spyOn(transport, "call").mockImplementation((request) => {
    if (request.op === "data.media.open") return open().then((playback) => ({ op: "data.media.open", playback })) as never;
    if (request.op === "data.media.close") return Promise.resolve({ op: "data.media.close" }) as never;
    if (request.op === "data.media.status") return status().then((error) => ({ op: "data.media.status", error })) as never;
    return original(request as never);
  });
  const view = render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  return { ...view, transport, call };
}
const count = (call: ReturnType<typeof setup>["call"], op: string) => call.mock.calls.filter(([request]) => request.op === op).length;
beforeEach(() => { vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each([["inline", inline, "data:video/webm;base64,YQ==", null], ["stream", stream, stream.url, "anonymous"]] as const)("%s의 MIME과 주소로 재생 요소를 만든다", async (_, playback, url, cors) => {
  const view = setup({ type: "media", src: media }, async () => playback);
  await waitFor(() => expect(view.container.querySelector("video")?.getAttribute("src")).toBe(url));
  expect(view.container.querySelector("video")?.getAttribute("crossorigin")).toBe(cors);
});

it("한 창에서 같은 원본을 공유하고 마지막 재생기가 떠나면 한 번 닫는다", async () => {
  const child: Block = { type: "media", src: media };
  const view = setup({ type: "stack", direction: "column", children: [child, child] });
  await waitFor(() => expect(view.container.querySelectorAll("video[src]")).toHaveLength(2));
  expect(count(view.call, "data.media.open")).toBe(1);
  view.unmount();
  await waitFor(() => expect(count(view.call, "data.media.close")).toBe(1));
});

it("열기를 기다리는 동안 떠나도 늦게 열린 스트림을 닫는다", async () => {
  let resolve!: (value: MediaPlayback) => void;
  const pending = new Promise<MediaPlayback>((done) => { resolve = done; });
  const view = setup({ type: "media", src: media }, () => pending);
  await waitFor(() => expect(count(view.call, "data.media.open")).toBe(1));
  view.unmount();
  await act(async () => { resolve(stream); await pending; });
  await waitFor(() => expect(count(view.call, "data.media.close")).toBe(1));
});

it("연결 회복으로 세대가 바뀌면 같은 원본도 다시 연다", async () => {
  let opens = 0;
  const view = setup({ type: "media", src: media }, async () => ({ ...stream, handle: `lease-${++opens}`, url: `http://127.0.0.1/${opens}` }));
  await waitFor(() => expect(view.container.querySelector("video")?.getAttribute("src")).toBe("http://127.0.0.1/1"));
  act(() => view.transport.setLink({ state: "connected", mode: "remote", server_url: "http://test", device_name: "시험" }));
  await waitFor(() => expect(view.container.querySelector("video")?.getAttribute("src")).toBe("http://127.0.0.1/2"));
  expect(count(view.call, "data.media.open")).toBe(2);
  expect(count(view.call, "data.media.close")).toBe(1);
});

it("스트림 재생 오류에서 코어의 원인을 보인다", async () => {
  const view = setup({ type: "media", src: media }, async () => stream, async () => problem);
  await waitFor(() => expect(view.container.querySelector("video")?.getAttribute("src")).toBe(stream.url));
  fireEvent.error(view.container.querySelector("video")!);
  expect((await screen.findByRole("alert")).textContent).toContain(problem.message);
  expect(count(view.call, "data.media.status")).toBe(1);
});

it("늦은 스트림 오류는 바뀐 원본에 표시하지 않는다", async () => {
  let resolve!: (value: typeof problem | null) => void;
  const pending = new Promise<typeof problem | null>((done) => { resolve = done; });
  let opens = 0;
  const view = setup({ type: "media", src: { expr: "$state.track" } }, async () => ({ ...stream, handle: `lease-${++opens}`, url: `http://127.0.0.1/${opens}` }), () => pending);
  const send = (path: string) => act(() => view.transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/src": { status: "ready", value: { permission: "media", path } } } } }));
  await screen.findByRole("button", { name: "재생" });
  send("first.mp4");
  await waitFor(() => expect(view.container.querySelector("video")?.getAttribute("src")).toBe("http://127.0.0.1/1"));
  fireEvent.error(view.container.querySelector("video")!);
  send("second.mp4");
  await waitFor(() => expect(view.container.querySelector("video")?.getAttribute("src")).toBe("http://127.0.0.1/2"));
  await act(async () => { resolve(problem); await pending; });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("기기 저장소의 소리는 스트림으로 열고 inline 데이터를 요청하지 않는다", async () => {
  const blob = { blob: "media/clip.mp4" };
  const view = setup({ type: "media", src: blob });
  await waitFor(() => expect(view.container.querySelector("video")?.getAttribute("src")).toBe(stream.url));
  expect(view.container.querySelector("video")?.getAttribute("crossorigin")).toBe("anonymous");
  expect(view.call).toHaveBeenCalledWith(expect.objectContaining({ op: "data.media.open", media: blob }));
  expect(count(view.call, "data.media")).toBe(0);
});

it("기기 저장소 원본을 바꾸면 앞 스트림을 닫고 실패를 status로 알린다", async () => {
  let opens = 0;
  const view = setup({ type: "media", src: { expr: "$state.track" } }, async () => ({ ...stream, handle: `lease-${++opens}`, url: `http://127.0.0.1/${opens}` }), async () => problem);
  const send = (blob: string) => act(() => view.transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/src": { status: "ready", value: { blob } } } } }));
  await screen.findByRole("button", { name: "재생" });
  send("media/first.mp4");
  await waitFor(() => expect(view.container.querySelector("video")?.getAttribute("src")).toBe("http://127.0.0.1/1"));
  send("media/second.mp4");
  await waitFor(() => expect(view.container.querySelector("video")?.getAttribute("src")).toBe("http://127.0.0.1/2"));
  await waitFor(() => expect(count(view.call, "data.media.close")).toBe(1));
  fireEvent.error(view.container.querySelector("video")!);
  expect((await screen.findByRole("alert")).textContent).toContain(problem.message);
  expect(count(view.call, "data.media.status")).toBe(1);
  view.unmount();
  await waitFor(() => expect(count(view.call, "data.media.close")).toBe(2));
});

it("시킹과 음량 조작은 코어를 부르지 않는다", async () => {
  const view = setup({ type: "media", src: media });
  await waitFor(() => expect(view.container.querySelector("video")?.getAttribute("src")).toBe(stream.url));
  const video = view.container.querySelector("video")!;
  Object.defineProperty(video, "duration", { configurable: true, value: 120 });
  fireEvent.durationChange(video);
  view.call.mockClear();
  fireEvent.change(screen.getByRole("slider", { name: "재생 위치" }), { target: { value: "60" } });
  fireEvent.change(screen.getByRole("slider", { name: "소리 크기" }), { target: { value: "0.5" } });
  expect(video.currentTime).toBe(60);
  expect(video.volume).toBe(0.5);
  expect(view.call).not.toHaveBeenCalled();
});
