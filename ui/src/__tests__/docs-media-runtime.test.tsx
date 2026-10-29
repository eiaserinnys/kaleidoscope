import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { grantFor, makeTestSeed } from "./fixtures";

function setup(block: Block) {
  const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 4, modules: {} }, permissions: [], state: {}, ui: block };
  const seed = makeTestSeed({ definitions: [definition] });
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  const result = render(<AppWindowContent store={store} windowId="viewer-window" />);
  return { ...result, transport };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("코드 편집은 CRLF를 지켜 자동 저장하고 외부 변경 충돌을 알린다", async () => {
  const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 4, modules: { files: 1 } }, permissions: [{ module: "files", id: "docs", access: "readwrite", label: "문서" }], state: {}, ui: { type: "code_editor", file: { permission: "docs", path: "settings.json" } } };
  const seed = makeTestSeed({ definitions: [definition], grants: [grantFor("viewer-window", "docs")], files: { "settings.json": "{\r\n  \"a\": 1\r\n}\r\n" } });
  const transport = createFakeTransport(seed);
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  const content = await screen.findByRole("textbox", { name: "코드 편집기" });
  const view = EditorView.findFromDOM(content)!;
  act(() => view.dispatch({ changes: { from: view.state.doc.line(2).from, insert: " " } }));
  await waitFor(() => expect(transport.getFiles()["settings.json"]).toBe("{\r\n   \"a\": 1\r\n}\r\n"), { timeout: 3000 });
  const original = await transport.call({ op: "files.read", window_id: "viewer-window", permission: "docs", path: "settings.json" });
  await transport.call({ op: "files.write", window_id: "viewer-window", permission: "docs", path: "settings.json", text: "external", expected_revision: original.revision });
  act(() => view.dispatch({ changes: { from: 0, insert: "x" } }));
  expect((await screen.findByRole("alert", {}, { timeout: 3000 })).textContent).toContain("디스크에서 바뀌었습니다");
  fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "코드 편집기" }).textContent).toContain("external"));
});

it("code_view는 값을 읽기만 하며 변경 시 위치를 지킨다", async () => {
  const { transport } = setup({ type: "code_view", value: { expr: "$state.log" }, follow: true });
  act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/value": { status: "ready", value: "처음" } } } }));
  const content = await screen.findByRole("textbox", { name: "코드 보기" });
  expect(content.getAttribute("contenteditable")).toBe("false");
  const scroll = content.closest(".cm-scroller") as HTMLElement;
  Object.defineProperties(scroll, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } });
  scroll.scrollTop = 100;
  act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/value": { status: "ready", value: "다음" } } } }));
  await waitFor(() => expect(content.textContent).toContain("다음"));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(scroll.scrollTop).toBe(100);
  scroll.scrollTop = 800;
  act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/value": { status: "ready", value: "끝" } } } }));
  await waitFor(() => expect(content.textContent).toContain("끝"));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(scroll.scrollTop).toBe(1000);
});

it("재생기는 원본 Blob URL을 만들고 바뀌면 해제하며 키보드로 이동한다", async () => {
  const create = vi.fn().mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
  const revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 4, modules: {} }, permissions: [], state: {}, ui: { type: "media", src: { expr: "$state.track" } } };
  const seed = makeTestSeed({ definitions: [definition] });
  const transport = createFakeTransport(seed);
  const original = transport.call.bind(transport);
  vi.spyOn(transport, "call").mockImplementation((request) => request.op === "data.media" ? Promise.resolve({ op: "data.media", media: { mime: "audio/wav", data_base64: "YQ==", width: null, height: null } }) as never : original(request as never));
  const rendered = render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  const send = (path: string) => act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/src": { status: "ready", value: { permission: "media", path } } } } }));
  await screen.findByRole("button", { name: "재생" });
  send("one.wav");
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  const audio = rendered.container.querySelector("audio")!;
  Object.defineProperty(audio, "duration", { configurable: true, value: 60 });
  fireEvent.durationChange(audio);
  audio.currentTime = 10;
  fireEvent.timeUpdate(audio);
  fireEvent.keyDown(screen.getByRole("slider", { name: "재생 위치" }), { key: "ArrowRight" });
  expect(audio.currentTime).toBe(15);
  send("two.wav");
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(revoke).toHaveBeenCalledWith("blob:first");
  rendered.unmount();
  expect(revoke).toHaveBeenCalledWith("blob:second");
  vi.unstubAllGlobals();
});

it("영상 MIME을 받으면 영상으로 자동 재생한다", async () => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:video"), revokeObjectURL: vi.fn() }));
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 4, modules: {} }, permissions: [], state: {}, ui: { type: "media", autoplay: true, src: { permission: "media", path: "movie.webm" } } };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  vi.spyOn(transport, "call").mockImplementation((request) => request.op === "data.media" ? Promise.resolve({ op: "data.media", media: { mime: "video/webm", data_base64: "YQ==", width: null, height: null } }) as never : original(request as never));
  const rendered = render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  await waitFor(() => expect(rendered.container.querySelector("video")?.getAttribute("src")).toBe("blob:video"));
  await waitFor(() => expect(play).toHaveBeenCalled());
  vi.unstubAllGlobals();
});

it("이미지 요청 실패를 알리고 다시 받으면 성공한다", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 500, height: 400 } as DOMRect);
  const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 4, modules: {} }, permissions: [], state: {}, ui: { type: "image", src: { permission: "media", path: "image.png" } } };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  let calls = 0;
  vi.spyOn(transport, "call").mockImplementation((request) => request.op === "data.media"
    ? (++calls === 1 ? Promise.reject(new Error("받지 못했습니다")) : Promise.resolve({ op: "data.media", media: { mime: "image/png", data_base64: "YQ==", width: 1, height: 1 } })) as never
    : original(request as never));
  const result = render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  expect(await screen.findByText("이미지를 불러오지 못했습니다")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "다시 받기" }));
  await waitFor(() => expect(result.container.querySelector(".ks-image-frame img")).toBeTruthy());
  expect(calls).toBe(2);
});

it("재생 실패를 알리고 원천 변경 뒤 조작부를 복구한다", async () => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:media"), revokeObjectURL: vi.fn() }));
  const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 4, modules: {} }, permissions: [], state: {}, ui: { type: "media", src: { expr: "$state.track" } } };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  vi.spyOn(transport, "call").mockImplementation((request) => request.op === "data.media" ? Promise.resolve({ op: "data.media", media: { mime: "audio/wav", data_base64: "YQ==", width: null, height: null } }) as never : original(request as never));
  const result = render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  const send = (path: string) => act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/src": { status: "ready", value: { permission: "media", path } } } } }));
  await screen.findByRole("button", { name: "재생" });
  send("bad.wav");
  await waitFor(() => expect((screen.getByRole("button", { name: "재생" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.error(result.container.querySelector("audio")!);
  expect(await screen.findByText("재생할 수 없는 파일입니다")).toBeTruthy();
  expect((screen.getByRole("button", { name: "재생" }) as HTMLButtonElement).disabled).toBe(true);
  send("good.wav");
  await waitFor(() => expect((screen.getByRole("button", { name: "재생" }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText("재생할 수 없는 파일입니다")).toBeNull();
});

it("자동 재생 정책 거부는 오류로 보이지 않고 다른 재생 실패는 알린다", async () => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:media"), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError")).mockRejectedValueOnce(new DOMException("bad", "NotSupportedError"));
  const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 4, modules: {} }, permissions: [], state: {}, ui: { type: "media", autoplay: true, src: { permission: "media", path: "file.wav" } } };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  vi.spyOn(transport, "call").mockImplementation((request) => request.op === "data.media" ? Promise.resolve({ op: "data.media", media: { mime: "audio/wav", data_base64: "YQ==", width: null, height: null } }) as never : original(request as never));
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("재생할 수 없는 파일입니다")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "재생" }));
  expect(await screen.findByText("재생할 수 없는 파일입니다")).toBeTruthy();
});
