import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { EmptyState } from "../components/primitives";
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

it("미디어의 폴더 미선택 오류에서 폴더를 고르면 다시 받는다", async () => {
  const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 4, modules: { files: 1 } }, permissions: [{ module: "files", id: "docs", access: "read", label: "문서" }], state: {}, ui: { type: "media", src: { permission: "docs", path: "file.wav" } } };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  let selected = false;
  const calls = vi.spyOn(transport, "call").mockImplementation((request) => {
    if (request.op === "data.media") return selected
      ? Promise.resolve({ op: "data.media", media: { mime: "audio/wav", data_base64: "YQ==", width: null, height: null } } as never)
      : Promise.reject({ code: "not_granted", id: "FILE_ACCESS_FOLDER_NOT_CHOSEN", message: "폴더를 고르세요", details: [] });
    if (request.op === "files.pick_folder") { selected = true; return Promise.resolve({ op: "files.pick_folder", grant: { permission: "docs" } } as never); }
    return original(request as never);
  });
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  fireEvent.click(await screen.findByRole("button", { name: "폴더 선택" }));
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "files.pick_folder", permission: "docs" })));
  await waitFor(() => expect((screen.getByRole("button", { name: "재생" }) as HTMLButtonElement).disabled).toBe(false));
});

it("폴더 선택이 실패한 뒤 다른 미디어를 열면 새 오류를 보인다", async () => {
  const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 4, modules: { files: 1 } }, permissions: [{ module: "files", id: "docs", access: "read", label: "문서" }], state: {}, ui: { type: "media", src: { expr: "$state.track" } } };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  vi.spyOn(transport, "call").mockImplementation((request) => {
    if (request.op === "files.pick_folder") return Promise.reject({ code: "server", id: "FILE_PICK_FAILED", message: "선택 실패", details: [] });
    if (request.op === "data.media") return Promise.reject("path" in request.media && request.media.path === "first.wav"
      ? { code: "not_granted", id: "FILE_ACCESS_FOLDER_NOT_CHOSEN", message: "폴더 선택", details: [] }
      : { code: "not_found", id: "MEDIA_LOAD_NOT_FOUND", message: "다른 파일 없음", details: [] });
    return original(request as never);
  });
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  const send = (path: string) => act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/src": { status: "ready", value: { permission: "docs", path } } } } }));
  await screen.findByRole("button", { name: "재생" });
  send("first.wav");
  fireEvent.click(await screen.findByRole("button", { name: "폴더 선택" }));
  await screen.findByText("FILE_PICK_FAILED");
  send("second.wav");
  await screen.findByText("MEDIA_LOAD_NOT_FOUND");
  expect(screen.queryByText("FILE_PICK_FAILED")).toBeNull();
});

it("빈 상태는 아이콘이 없으면 아이콘 칸을 두지 않고 전달된 아이콘은 표시한다", () => {
  const view = render(<EmptyState text="알림" action={<button>다시 받기</button>} />);
  expect(view.container.querySelector(".ks-empty-state-icon")).toBeNull();
  expect(screen.getByText("알림")).toBeTruthy();
  expect(screen.getByRole("button", { name: "다시 받기" })).toBeTruthy();
  view.rerender(<EmptyState icon={<span>그림</span>} text="알림" />);
  expect(view.container.querySelector(".ks-empty-state-icon")?.textContent).toBe("그림");
});

it("코드 편집은 CRLF를 지켜 자동 저장하고 외부 변경 충돌을 알린다", async () => {
  const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 4, modules: { files: 1 } }, permissions: [{ module: "files", id: "docs", access: "readwrite", label: "문서" }], state: {}, ui: { type: "code", file: { permission: "docs", path: "settings.json" } } };
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

it("code 편집기의 wrap 설정을 CodeMirror에 적용한다", async () => {
  const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 4, modules: { files: 1 } }, permissions: [{ module: "files", id: "docs", access: "readwrite", label: "문서" }], state: {}, ui: { type: "code", file: { permission: "docs", path: "long.txt" }, wrap: true } };
  const seed = makeTestSeed({ definitions: [definition], grants: [grantFor("viewer-window", "docs")], files: { "long.txt": "long line" } });
  const rendered = render(<AppWindowContent store={createShellStore(createFakeTransport(seed))} windowId="viewer-window" />);
  const content = await screen.findByRole("textbox", { name: "코드 편집기" });
  expect(content.classList.contains("cm-lineWrapping")).toBe(true);
  rendered.unmount();
});

it("code 편집기는 wrap을 생략하면 줄바꿈하고 false면 끈다", async () => {
  for (const [wrap, expected] of [[undefined, true], [false, false]] as const) {
    const block: Block = { type: "code", file: { permission: "docs", path: "long.txt" }, ...(wrap === undefined ? {} : { wrap }) };
    const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 4, modules: { files: 1 } }, permissions: [{ module: "files", id: "docs", access: "readwrite", label: "문서" }], state: {}, ui: block };
    const seed = makeTestSeed({ definitions: [definition], grants: [grantFor("viewer-window", "docs")], files: { "long.txt": "long line" } });
    const rendered = render(<AppWindowContent store={createShellStore(createFakeTransport(seed))} windowId="viewer-window" />);
    const content = await screen.findByRole("textbox", { name: "코드 편집기" });
    expect(content.classList.contains("cm-lineWrapping")).toBe(expected);
    rendered.unmount();
  }
});

it("code 보기는 wrap을 생략하면 줄바꿈하고 false면 끈다", async () => {
  for (const [wrap, expected] of [[undefined, true], [false, false]] as const) {
    const block: Block = { type: "code", value: { expr: "$state.log" }, ...(wrap === undefined ? {} : { wrap }) };
    const rendered = setup(block);
    const { transport } = rendered;
    act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/value": { status: "ready", value: "long line" } } } }));
    const content = await rendered.findByRole("textbox", { name: "코드 보기" });
    expect(content.classList.contains("cm-lineWrapping")).toBe(expected);
    rendered.unmount();
  }
});

it("code는 값을 읽기만 하며 변경 시 위치를 지킨다", async () => {
  const { transport } = setup({ type: "code", value: { expr: "$state.log" }, follow: true });
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

it("재생기는 미디어 원본을 캐시하고 키보드로 이동한다", async () => {
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
  await waitFor(() => expect(transport.call).toHaveBeenCalledWith(expect.objectContaining({ op: "data.media", media: { permission: "media", path: "one.wav" } })));
  const audio = rendered.container.querySelector("audio")!;
  Object.defineProperty(audio, "duration", { configurable: true, value: 60 });
  fireEvent.durationChange(audio);
  audio.currentTime = 10;
  fireEvent.timeUpdate(audio);
  fireEvent.keyDown(screen.getByRole("slider", { name: "재생 위치" }), { key: "ArrowRight" });
  expect(audio.currentTime).toBe(15);
  send("two.wav");
  await waitFor(() => expect(transport.call).toHaveBeenCalledWith(expect.objectContaining({ op: "data.media", media: { permission: "media", path: "two.wav" } })));
  rendered.unmount();
  expect(create).not.toHaveBeenCalled();
  expect(revoke).not.toHaveBeenCalled();
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
  await waitFor(() => expect(rendered.container.querySelector("video")?.getAttribute("src")).toBe("data:video/webm;base64,YQ=="));
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
    ? (++calls === 1 ? Promise.reject({ id: "SHELL_CALL_UNEXPECTED_FAILURE", code: "io", message: "이미지 원본을 읽지 못했습니다", details: [] }) : Promise.resolve({ op: "data.media", media: { mime: "image/png", data_base64: "YQ==", width: 1, height: 1 } })) as never
    : original(request as never));
  const result = render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  expect(await screen.findByText("이미지 원본을 읽지 못했습니다")).toBeTruthy();
  expect(screen.getByText("SHELL_CALL_UNEXPECTED_FAILURE")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "다시 받기" }));
  await waitFor(() => expect(result.container.querySelector(".ks-image-frame img")).toBeTruthy());
  expect(calls).toBe(2);
});

it("미리보기 이미지는 대기 막대를 보이고 실패해도 조작부를 그리지 않는다", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 500, height: 400 } as DOMRect);
  const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 19, modules: {} }, permissions: [], state: {}, ui: {
    type: "button", label: "견본", on_click: [], preview: { type: "image", zoom: true, src: { permission: "media", path: "image.png" } },
  } };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  let fail!: (reason: unknown) => void;
  vi.spyOn(transport, "call").mockImplementation((request) => request.op === "data.media"
    ? new Promise((_resolve, reject) => { fail = reject; }) as never : original(request as never));
  const view = render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  await waitFor(() => expect(fail).toBeTypeOf("function"));
  expect(view.container.querySelector(".ks-image-view .ks-data-progress.is-indeterminate")).toBeTruthy();
  await act(async () => fail({ id: "FILE_PATH_NOT_FOUND", code: "not_found", message: "이미지 없음", details: [] }));
  await waitFor(() => expect(view.container.querySelector(".ks-image-view [title*='FILE_PATH_NOT_FOUND']")).toBeTruthy());
  expect(view.container.querySelector(".ks-data-button-card")?.getAttribute("title")).toContain("FILE_PATH_NOT_FOUND");
  expect(view.container.querySelector(".ks-data-button-card-preview button")).toBeNull();
  expect(view.container.querySelector(".ks-image-controls")).toBeNull();
});

it("확대를 선언한 미리보기 이미지도 그림만 표시한다", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 500, height: 400 } as DOMRect);
  const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 19, modules: {} }, permissions: [], state: {}, ui: {
    type: "button", label: "견본", on_click: [], preview: { type: "image", zoom: true, src: { permission: "media", path: "image.png" } },
  } };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  vi.spyOn(transport, "call").mockImplementation((request) => request.op === "data.media"
    ? Promise.resolve({ op: "data.media", media: { mime: "image/png", data_base64: "YQ==", width: 1, height: 1 } }) as never : original(request as never));
  const view = render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  await waitFor(() => expect(view.container.querySelector(".ks-image-frame img")).toBeTruthy());
  expect(view.container.querySelector(".ks-image-controls")).toBeNull();
  expect(view.container.querySelector(".ks-image-view")?.hasAttribute("tabindex")).toBe(false);
});

it("이미지 폴더 미선택 오류는 넓은 칸과 작은 칸에서 폴더를 고른 뒤 다시 받는다", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  for (const width of [500, 200]) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width, height: 400 } as DOMRect);
    const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 4, modules: { files: 1 } }, permissions: [{ module: "files", id: "docs", access: "read", label: "그림" }], state: {}, ui: { type: "image", src: { permission: "docs", path: "image.png" } } };
    const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
    const original = transport.call.bind(transport);
    let selected = false;
    const calls = vi.spyOn(transport, "call").mockImplementation((request) => {
      if (request.op === "files.pick_folder") { selected = true; return Promise.resolve({ op: "files.pick_folder", grant: { permission: "docs" } } as never); }
      if (request.op === "data.media") return selected ? Promise.resolve({ op: "data.media", media: { mime: "image/png", data_base64: "YQ==", width: 1, height: 1 } } as never) : Promise.reject({ id: "FILE_ACCESS_FOLDER_NOT_CHOSEN", code: "not_granted", message: "폴더 선택", details: [] });
      return original(request as never);
    });
    const view = render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
    fireEvent.click(await screen.findByRole("button", { name: "폴더 선택" }));
    await waitFor(() => expect(view.container.querySelector(".ks-image-frame img")).toBeTruthy());
    expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "files.pick_folder", permission: "docs" }));
    view.unmount();
    vi.restoreAllMocks();
  }
});

it("이미지 오류의 전체 문구가 칸을 넘으면 원문을 툴팁에 둔 짧은 표시로 바뀐다", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { left: 0, top: 0, right: 500, bottom: this.classList.contains("ks-empty-state-action") ? 440 : 400, width: 500, height: 400 } as DOMRect;
  });
  const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 4, modules: {} }, permissions: [], state: {}, ui: { type: "image", src: { permission: "docs", path: "image.png" } } };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  vi.spyOn(transport, "call").mockImplementation((request) => request.op === "data.media" ? Promise.reject({ id: "FILE_PATH_NOT_FOUND", code: "not_found", message: "긴 경로 오류", details: [] }) : original(request as never));
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  expect((await screen.findByText("이미지를 불러오지 못했습니다")).getAttribute("title")).toBe("긴 경로 오류");
  expect(screen.getByRole("button", { name: "다시 받기" })).toBeTruthy();
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
  const playbackError = await screen.findByRole("alert");
  expect(playbackError.textContent).toContain("이 파일의 미디어 데이터를 재생할 수 없습니다.");
  expect(playbackError.textContent).toContain("SHELL_MEDIA_PLAYBACK_UNSUPPORTED");
  expect((screen.getByRole("button", { name: "재생" }) as HTMLButtonElement).disabled).toBe(true);
  send("good.wav");
  await waitFor(() => expect((screen.getByRole("button", { name: "재생" }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText("SHELL_MEDIA_PLAYBACK_UNSUPPORTED")).toBeNull();
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
  expect(screen.queryByText("SHELL_MEDIA_PLAYBACK_UNSUPPORTED")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "재생" }));
  const playbackError = await screen.findByRole("alert");
  expect(playbackError.textContent).toContain("이 파일의 미디어 데이터를 재생할 수 없습니다.");
  expect(playbackError.textContent).toContain("SHELL_MEDIA_PLAYBACK_UNSUPPORTED");
});

it("앞 원본의 늦은 재생 실패는 새 원본에 오류를 보이지 않는다", async () => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn().mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second"), revokeObjectURL: vi.fn() }));
  let rejectFirst: (reason: unknown) => void = () => {};
  const first = new Promise<void>((_, reject) => { rejectFirst = reject; });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockReturnValueOnce(first).mockResolvedValue(undefined);
  const definition: AppDefinition = { id: "test", name: "test", requires: { blocks: 4, modules: {} }, permissions: [], state: {}, ui: { type: "media", autoplay: true, src: { expr: "$state.track" } } };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  vi.spyOn(transport, "call").mockImplementation((request) => request.op === "data.media" ? Promise.resolve({ op: "data.media", media: { mime: "audio/wav", data_base64: "YQ==", width: null, height: null } }) as never : original(request as never));
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  const send = (path: string) => act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/src": { status: "ready", value: { permission: "media", path } } } } }));
  await screen.findByRole("button", { name: "재생" });
  send("one.wav");
  await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));
  send("two.wav");
  await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
  await act(async () => { rejectFirst(new DOMException("bad", "NotSupportedError")); await first.catch(() => undefined); });
  expect(screen.queryByText("SHELL_MEDIA_PLAYBACK_UNSUPPORTED")).toBeNull();
  expect((screen.getByRole("button", { name: /재생|일시 정지/ }) as HTMLButtonElement).disabled).toBe(false);
});
