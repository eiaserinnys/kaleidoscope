import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, FeedMedia } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { WindowDataProvider } from "../data/window-data";
import type { AttachmentSource } from "../data/attachments";
import { AttachmentPreview } from "../blocks/attachment-preview";
import { HistoryAttachmentView } from "../blocks/agent-attachments";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed, mdViewerDefinition } from "./fixtures";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function definition(ui: AppDefinition["ui"]): AppDefinition {
  return { ...mdViewerDefinition, requires: { blocks: 12, modules: {} }, permissions: [], state: {}, ui };
}

function setupViewer(source: AttachmentSource, name: string, options: { media?: Record<string, string>; saveCancelled?: boolean; saveLocation?: string; nativeFiles?: boolean } = {}) {
  const app = definition({ type: "text", value: "빈 창" });
  const seed = makeTestSeed({ definitions: [app] });
  const transport = createFakeTransport({ ...seed, media: options.media ?? {}, saveCancelled: options.saveCancelled, saveLocation: options.saveLocation });
  if (options.nativeFiles) transport.nativeFiles = true;
  const store = createShellStore(transport);
  const trigger = document.createElement("button");
  document.body.append(trigger);
  const onClose = vi.fn();
  render(<WindowDataProvider store={store} windowId="viewer-window" definition={app}>
    <AttachmentPreview request={{ source, name, trigger }} onClose={onClose} />
  </WindowDataProvider>);
  return { transport, onClose, trigger };
}

function setupFeed(media: FeedMedia[], files: Record<string, string>) {
  const app = definition({ type: "feed", entries: [{ key: "post", body: "본문", media }] } as unknown as AppDefinition["ui"]);
  const seed = makeTestSeed({ definitions: [app] });
  const transport = createFakeTransport({ ...seed, media: files });
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  return { transport };
}

function stubBlobUrls() {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:첨부") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
}

afterEach(() => {
  cleanup();
  delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
  vi.restoreAllMocks();
});

it("받은 형식에 따라 그림, 영상, 소리, 마크다운, 글, 기타 화면을 그린다", async () => {
  stubBlobUrls();
  setupViewer({ kind: "bytes", mime: "image/png", data_base64: PNG }, "그림.png");
  expect(await screen.findByRole("img", { name: "그림.png" })).toBeTruthy();
  cleanup();

  setupViewer({ kind: "bytes", mime: "video/mp4", data_base64: "AAAA" }, "시연.mp4");
  const video = await waitFor(() => {
    const element = document.querySelector("video");
    if (!element) throw new Error("영상 없음");
    return element;
  });
  expect(video.controls).toBe(true);
  cleanup();

  setupViewer({ kind: "bytes", mime: "audio/wav", data_base64: "AAAA" }, "소리.wav");
  await waitFor(() => expect(document.querySelector("audio")).not.toBeNull());
  expect(document.querySelector("audio")?.controls).toBe(true);
  cleanup();

  setupViewer({ kind: "bytes", mime: "text/markdown", data_base64: toBase64("# 회의록\n\n- 하나") }, "회의록.md");
  expect(await screen.findByRole("heading", { name: "회의록" })).toBeTruthy();
  cleanup();

  const plain = "# 그대로 보이는 글\n둘째 줄";
  setupViewer({ kind: "bytes", mime: "text/plain", data_base64: toBase64(plain) }, "메모.txt");
  await waitFor(() => expect(document.querySelector("pre.ks-attachment-viewer-plain")).not.toBeNull());
  expect(document.querySelector("pre.ks-attachment-viewer-plain")?.textContent).toBe(plain);
  cleanup();

  setupViewer({ kind: "bytes", mime: "application/zip", data_base64: toBase64("zip") }, "묶음.zip");
  expect(await screen.findByText("묶음.zip")).toBeTruthy();
  expect(screen.getByText("application/zip")).toBeTruthy();
  expect(screen.getByText("3B")).toBeTruthy();
});

it("받은 형식이 비었으면 파일 이름의 확장자로 가른다", async () => {
  setupViewer({ kind: "bytes", mime: "application/octet-stream", data_base64: toBase64("# 확장자로 가른 문서") }, "문서.md");
  expect(await screen.findByRole("heading", { name: "확장자로 가른 문서" })).toBeTruthy();
});

it("HTML은 그리지 않고 글 그대로 보여 준다", async () => {
  const html = "<b>굵게</b>";
  setupViewer({ kind: "bytes", mime: "text/html", data_base64: toBase64(html) }, "쪽.html");
  await waitFor(() => expect(document.querySelector("pre.ks-attachment-viewer-plain")).not.toBeNull());
  const pre = document.querySelector("pre.ks-attachment-viewer-plain")!;
  expect(pre.textContent).toBe(html);
  expect(pre.querySelector("b")).toBeNull();
});

it("1MiB를 넘는 글은 앞부분만 보여 주고 안내한다", async () => {
  setupViewer({ kind: "bytes", mime: "text/plain", data_base64: toBase64("가".repeat(1024 * 1024 + 16)) }, "긴글.txt");
  expect(await screen.findByText(/앞부분만 보입니다/)).toBeTruthy();
});

it("데스크톱 받기는 저장 대화상자를 한 번 열고 제안 이름을 표시 이름으로 준다", async () => {
  const { transport } = setupViewer({ kind: "bytes", mime: "text/markdown", data_base64: toBase64("# 문서") }, "회의록.md", { nativeFiles: true });
  fireEvent.click(await screen.findByRole("button", { name: "받기" }));
  await waitFor(() => expect(transport.getCalls().some((call) => call.op === "data.media.save")).toBe(true));
  const call = transport.getCalls().find((item) => item.op === "data.media.save");
  if (call?.op !== "data.media.save") throw new Error("저장 요청 없음");
  expect(call.suggested_name).toBe("회의록.md");
  expect(call.source.kind).toBe("bytes");
});

it("이미 받아 둔 미디어 원본은 다시 받지 않고 바이트 원천으로 한 번만 저장한다", async () => {
  const media = { permission: "docs", path: "notes.md" };
  const { transport } = setupViewer({ kind: "media", media }, "회의록.md", { nativeFiles: true, media: { "notes.md": `data:text/markdown;base64,${toBase64("# 문서")}` } });
  expect(await screen.findByRole("heading", { name: "문서" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "받기" }));
  await waitFor(() => expect(transport.getCalls().filter((call) => call.op === "data.media.save")).toHaveLength(1));
  const call = transport.getCalls().find((item) => item.op === "data.media.save");
  if (call?.op !== "data.media.save") throw new Error("저장 요청 없음");
  expect(call.source).toEqual({ kind: "bytes", mime: "text/markdown", data_base64: toBase64("# 문서") });
  expect(transport.getCalls().filter((item) => item.op === "data.media")).toHaveLength(1);
});

it("호스트가 스스로 고른 저장 위치를 받으면 머리 아래에 보인다", async () => {
  const location = "파일 앱 › 나의 iPad › kaleidoscope › 회의록.md";
  setupViewer({ kind: "bytes", mime: "text/markdown", data_base64: toBase64("# 문서") }, "회의록.md", { nativeFiles: true, saveLocation: location });
  fireEvent.click(await screen.findByRole("button", { name: "받기" }));
  expect(await screen.findByText(`${location}에 저장했습니다`)).toBeTruthy();
});

it("저장을 취소해도 오류를 보이지 않는다", async () => {
  const { transport } = setupViewer({ kind: "bytes", mime: "text/plain", data_base64: toBase64("글") }, "메모.txt", { nativeFiles: true, saveCancelled: true });
  fireEvent.click(await screen.findByRole("button", { name: "받기" }));
  await waitFor(() => expect(transport.getCalls().some((call) => call.op === "data.media.save")).toBe(true));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText(/저장했습니다/)).toBeNull();
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("브라우저 받기는 코어 저장 대신 download를 일으킨다", async () => {
  stubBlobUrls();
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const { transport } = setupViewer({ kind: "bytes", mime: "text/plain", data_base64: toBase64("글") }, "메모.txt");
  fireEvent.click(await screen.findByRole("button", { name: "받기" }));
  await waitFor(() => expect(click).toHaveBeenCalled());
  const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
  expect(anchor.download).toBe("메모.txt");
  expect(transport.getCalls().some((call) => call.op === "data.media.save")).toBe(false);
});

it("피드의 그림과 파일 칩은 새 탭이 아니라 뷰어를 연다", async () => {
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  const markdown = `data:text/markdown;base64,${toBase64("# 문서")}`;
  const { transport } = setupFeed([
    { image: { permission: "docs", path: "그림.png" }, alt: "그림.png" },
    { image: { permission: "docs", path: "문서.md" }, alt: "문서.md" },
  ], { "그림.png": `data:image/png;base64,${PNG}`, "문서.md": markdown });
  fireEvent.click(await screen.findByRole("button", { name: "그림.png" }));
  expect((await screen.findByRole("dialog")).getAttribute("aria-label")).toBe("그림.png");
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(await screen.findByRole("button", { name: "문서.md" }));
  expect((await screen.findByRole("dialog")).getAttribute("aria-label")).toBe("문서.md");
  expect(open).not.toHaveBeenCalled();
  expect(transport.getCalls().some((call) => call.op === "data.media.open")).toBe(false);
});

it("영상 첨부는 누르기 전에 원본을 받지 않는다", async () => {
  stubBlobUrls();
  const { transport } = setupFeed([{ image: { permission: "docs", path: "시연.mp4" }, kind: "video", alt: "시연.mp4" }], { "시연.mp4": "data:video/mp4;base64,AAAA" });
  const button = await screen.findByRole("button", { name: "시연.mp4" });
  const mediaCalls = () => transport.getCalls().filter((call) => call.op === "data.media" && "media" in call && "path" in call.media && call.media.path === "시연.mp4");
  expect(mediaCalls()).toHaveLength(0);
  fireEvent.click(button);
  await screen.findByRole("dialog");
  await waitFor(() => expect(mediaCalls().length).toBe(1));
  expect(transport.getCalls().some((call) => call.op === "data.media.open")).toBe(false);
});

it("대화 첨부 칩은 뷰어 요청을 열고 영상과 소리 종류를 보인다", async () => {
  const app = definition({ type: "text", value: "빈 창" });
  const seed = makeTestSeed({ definitions: [app] });
  const transport = createFakeTransport({ ...seed, media: {} });
  const store = createShellStore(transport);
  const onPreview = vi.fn();
  render(<WindowDataProvider store={store} windowId="viewer-window" definition={app}>
    <HistoryAttachmentView attachment={{ id: "md", name: "회의록.md", mime: "text/markdown" }} cacheKey={["chat-md"]} load={async () => ({ mime: "text/markdown", data_base64: toBase64("# 회의록") })} onPreview={onPreview} />
    <HistoryAttachmentView attachment={{ id: "v", name: "시연.mp4", mime: "video/mp4" }} cacheKey={["chat-video"]} load={async () => ({ mime: "video/mp4", data_base64: "AAAA" })} onPreview={onPreview} />
    <HistoryAttachmentView attachment={{ id: "a", name: "소리.wav", mime: "audio/wav" }} cacheKey={["chat-audio"]} load={async () => ({ mime: "audio/wav", data_base64: "AAAA" })} onPreview={onPreview} />
  </WindowDataProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "회의록.md" }));
  expect(onPreview).toHaveBeenCalledTimes(1);
  expect(onPreview.mock.calls[0][0]).toMatchObject({ name: "회의록.md", source: { kind: "later" } });
  expect(screen.getByRole("button", { name: "시연.mp4" }).textContent).toContain("영상");
  expect(screen.getByRole("button", { name: "소리.wav" }).textContent).toContain("소리");
});

it("그림 대화 첨부를 누르면 뷰어 요청을 연다", async () => {
  const app = definition({ type: "text", value: "빈 창" });
  const seed = makeTestSeed({ definitions: [app] });
  const transport = createFakeTransport({ ...seed, media: {} });
  const store = createShellStore(transport);
  const onPreview = vi.fn();
  const load = vi.fn(async () => ({ mime: "image/png", data_base64: PNG }));
  render(<WindowDataProvider store={store} windowId="viewer-window" definition={app}>
    <HistoryAttachmentView attachment={{ id: "img", name: "그림.png", mime: "image/png" }} cacheKey={["chat-image"]} load={load} onPreview={onPreview} />
  </WindowDataProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "그림.png" }));
  expect(onPreview).toHaveBeenCalledTimes(1);
  expect(onPreview.mock.calls[0][0]).toMatchObject({ name: "그림.png", source: { kind: "later" } });
});
