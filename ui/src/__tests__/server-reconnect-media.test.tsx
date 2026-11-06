import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, CoreReply, ShellSnapshot } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { WindowDataProvider } from "../data/window-data";
import { useMedia } from "../data/use-media";
import { useWindowData } from "../data/window-data";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed } from "./fixtures";
import { BlockRenderContext } from "../render/render-probe";

beforeEach(() => { vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.querySelector(".ks-client-frames")?.remove(); });

const base: AppDefinition = { id: "reconnect-test", name: "연결 시험", requires: { blocks: 12, modules: { assets: 1 } }, permissions: [], state: {}, assets: [{ id: "sample", version: 1 }], ui: { type: "text", value: "시험" } };
const offline = { state: "offline", mode: "remote", server_url: "http://test", device_name: "시험", reason: null } as const;
const connected = { state: "connected", mode: "remote", server_url: "http://test", device_name: "시험" } as const;

function setup(definition: AppDefinition, mime: string, content: string) {
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.link = offline;
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  const original = store.call.bind(store);
  const calls = vi.spyOn(store, "call").mockImplementation(async (request) => {
    if (request.op === "data.media" || request.op === "data.media.open") {
      if (store.getSnapshot()?.link.state !== "connected") throw { code: "unavailable", message: "서버에 연결되어 있지 않습니다", details: [] };
      const media = { mime, data_base64: btoa(content), width: null, height: null };
      return request.op === "data.media" ? { op: "data.media", media } : { op: "data.media.open", playback: { kind: "inline", media } };
    }
    return original(request);
  });
  const reconnect = () => act(() => {
    const snapshot = structuredClone(store.getSnapshot()) as ShellSnapshot;
    snapshot.link = connected;
    transport.emit({ event: "state.changed", snapshot });
  });
  const setHidden = (hidden: boolean) => act(() => {
    const snapshot = structuredClone(store.getSnapshot()) as ShellSnapshot;
    snapshot.shared.windows[0].minimized = hidden;
    transport.emit({ event: "state.changed", snapshot });
  });
  const setCovered = (covered: boolean) => act(() => {
    const snapshot = structuredClone(store.getSnapshot()) as ShellSnapshot;
    snapshot.shared.windows = snapshot.shared.windows.filter((window) => window.id !== "cover");
    if (covered) snapshot.shared.windows.push({ ...snapshot.shared.windows[0], id: "cover", z: snapshot.shared.windows[0].z + 1, maximized: true });
    transport.emit({ event: "state.changed", snapshot });
  });
  return { store, transport, calls, reconnect, setHidden, setCovered, windowId: seed.snapshot.shared.windows[0].id };
}

it("이미지 자산은 재연결 시 실패한 요청을 다시 읽는다", async () => {
  const state = setup(base, "image/png", "image");
  function Image() { const result = useMedia({ asset: "sample", version: 1 }, 100); return <div>{result.status === "ready" ? result.url : result.status === "failed" ? result.error.message : "불러오는 중"}</div>; }
  render(<WindowDataProvider store={state.store} windowId={state.windowId} definition={base}><Image /></WindowDataProvider>);
  await screen.findByText("서버에 연결되어 있지 않습니다");
  state.reconnect();
  await screen.findByText("data:image/png;base64,aW1hZ2U=");
  state.store.dispose();
});

it("이미 받은 이미지는 연결이 복구되어도 다시 요청하지 않는다", async () => {
  const state = setup(base, "image/png", "image");
  await state.store.ready;
  state.reconnect();
  function Image() { const result = useMedia({ asset: "sample", version: 1 }, 100); return <div>{result.status === "ready" ? result.url : "불러오는 중"}</div>; }
  render(<WindowDataProvider store={state.store} windowId={state.windowId} definition={base}><Image /></WindowDataProvider>);
  await screen.findByText("data:image/png;base64,aW1hZ2U=");
  act(() => {
    const snapshot = structuredClone(state.store.getSnapshot()) as ShellSnapshot;
    snapshot.link = offline;
    state.transport.emit({ event: "state.changed", snapshot });
  });
  state.reconnect();
  await act(async () => { await Promise.resolve(); });
  expect(state.calls.mock.calls.filter(([request]) => request.op === "data.media")).toHaveLength(1);
  state.store.dispose();
});

it("여러 호출자가 진행 중인 더 큰 미디어 요청을 공유한다", async () => {
  const state = setup(base, "image/png", "image");
  await state.store.ready;
  state.reconnect();
  let resolve!: (reply: CoreReply) => void;
  const original = vi.mocked(state.store.call).getMockImplementation()!;
  vi.mocked(state.store.call).mockImplementation((request) => request.op === "data.media"
    ? new Promise<CoreReply>((done) => { resolve = done; }) as ReturnType<typeof state.store.call>
    : original(request));
  function Image({ size }: { size: number }) {
    const result = useMedia({ asset: "sample", version: 1 }, size);
    return <div>{result.status === "ready" ? result.url : "불러오는 중"}</div>;
  }
  render(<WindowDataProvider store={state.store} windowId={state.windowId} definition={base}><Image size={1024} /><Image size={512} /></WindowDataProvider>);
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  expect(state.calls.mock.calls.filter(([request]) => request.op === "data.media")).toHaveLength(1);
  await act(async () => resolve({ op: "data.media", media: { mime: "image/png", data_base64: btoa("large"), width: null, height: null } }));
  expect(screen.getAllByText(/data:image/)).toHaveLength(2);
  state.store.dispose();
});

it("숨겨진 창의 실패 자산은 연결 후 창을 볼 때 다시 읽는다", async () => {
  const state = setup(base, "image/png", "image");
  function Image() { const result = useMedia({ asset: "sample", version: 1 }, 100); return <div>{result.status === "ready" ? result.url : result.status === "failed" ? result.error.message : "불러오는 중"}</div>; }
  render(<WindowDataProvider store={state.store} windowId={state.windowId} definition={base}><Image /></WindowDataProvider>);
  await screen.findByText("서버에 연결되어 있지 않습니다");
  state.setHidden(true);
  state.reconnect();
  expect(state.calls.mock.calls.filter(([request]) => request.op === "data.media")).toHaveLength(1);
  state.setHidden(false);
  await screen.findByText("data:image/png;base64,aW1hZ2U=");
  state.store.dispose();
});

it("숨겨진 창과 휴면 블록은 새 이미지를 요청하지 않고 다시 보이면 요청한다", async () => {
  const state = setup(base, "image/png", "image");
  await state.store.ready;
  state.reconnect();
  let data!: ReturnType<typeof useWindowData>;
  function Image({ path }: { path: string }) {
    data = useWindowData();
    const result = useMedia({ permission: "catalog", path, query: { server: "https://store.example" } }, 100);
    return <div>{result.status}</div>;
  }
  const draw = (path: string) => <WindowDataProvider store={state.store} windowId={state.windowId} definition={base}>
    <BlockRenderContext.Provider value={{ windowId: state.windowId, pointer: "/ui/child", type: "image" }}><Image path={path} /></BlockRenderContext.Provider>
  </WindowDataProvider>;
  const view = render(draw("one.png"));
  await screen.findByText("ready");
  state.setHidden(true);
  view.rerender(draw("two.png"));
  await act(async () => { await Promise.resolve(); });
  expect(state.calls.mock.calls.filter(([request]) => request.op === "data.media")).toHaveLength(1);
  act(() => data.setDormant("/ui", true));
  state.setHidden(false);
  await act(async () => { await Promise.resolve(); });
  expect(state.calls.mock.calls.filter(([request]) => request.op === "data.media")).toHaveLength(1);
  act(() => data.setDormant("/ui", false));
  await waitFor(() => expect(state.calls.mock.calls.filter(([request]) => request.op === "data.media")).toHaveLength(2));
  state.store.dispose();
});

it("최대화 창에 가린 실패 자산은 가림이 풀릴 때 다시 읽는다", async () => {
  const state = setup(base, "image/png", "image");
  function Image() { const result = useMedia({ asset: "sample", version: 1 }, 100); return <div>{result.status === "ready" ? result.url : result.status === "failed" ? result.error.message : "불러오는 중"}</div>; }
  render(<WindowDataProvider store={state.store} windowId={state.windowId} definition={base}><Image /></WindowDataProvider>);
  await screen.findByText("서버에 연결되어 있지 않습니다");
  state.setCovered(true);
  state.reconnect();
  expect(state.calls.mock.calls.filter(([request]) => request.op === "data.media")).toHaveLength(1);
  state.setCovered(false);
  await screen.findByText("data:image/png;base64,aW1hZ2U=");
  state.store.dispose();
});

it("미디어와 격리 HTML 자산은 재연결 시 다시 읽는다", async () => {
  for (const ui of [{ type: "media", src: { asset: "sample", version: 1 }, kind: "audio" }, { type: "sandbox", asset: "sample", title: "격리 화면" }] as AppDefinition["ui"][]) {
    const definition = { ...base, ui };
    const state = setup(definition, ui.type === "sandbox" ? "text/html" : "audio/mpeg", "test");
    render(<AppWindowContent store={state.store} windowId={state.windowId} />);
    await screen.findByText("서버에 연결되어 있지 않습니다");
    state.reconnect();
    await waitFor(() => expect(screen.queryByText("서버에 연결되어 있지 않습니다")).toBeNull());
    if (ui.type === "sandbox") expect(screen.getByTitle("격리 화면")).toBeTruthy();
    else expect(document.querySelector("audio")?.getAttribute("src")).toContain("data:audio/mpeg");
    cleanup(); state.store.dispose();
  }
});

it("재연결 뒤 성공한 격리 화면을 이전 요청의 늦은 실패가 덮지 않는다", async () => {
  const definition: AppDefinition = { ...base, ui: { type: "sandbox", asset: "sample", title: "격리 화면" } };
  const state = setup(definition, "text/html", "test");
  const original = vi.mocked(state.store.call).getMockImplementation()!;
  let rejectOld!: (reason: unknown) => void;
  let first = true;
  vi.mocked(state.store.call).mockImplementation(async (request) => {
    if (request.op === "data.media" && first) {
      first = false;
      return new Promise<CoreReply>((_, reject) => { rejectOld = reject; });
    }
    return original(request);
  });
  render(<AppWindowContent store={state.store} windowId={state.windowId} />);
  await waitFor(() => expect(rejectOld).toBeDefined());
  state.reconnect();
  await screen.findByTitle("격리 화면");
  await act(async () => { rejectOld({ code: "unavailable", message: "서버에 연결되어 있지 않습니다", details: [] }); });
  expect(screen.getByTitle("격리 화면")).toBeTruthy();
  expect(screen.queryByText("서버에 연결되어 있지 않습니다")).toBeNull();
  state.store.dispose();
});

it("클라이언트 자산 실패 뒤 재연결하면 런타임을 새로 시작한다", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 320, height: 180 } as DOMRect);
  const transfer = vi.fn(() => ({}));
  Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", { configurable: true, value: transfer });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const definition: AppDefinition = { ...base, ui: { type: "canvas", surface: "preview" }, requires: { blocks: 12, modules: { assets: 1, client: 1 } }, client: { runtime: "javascript", entry: { id: "sample", version: 1 }, inputs: {}, outputs: {}, actions: [], commands: {}, state_keys: [], storage_entries: [] } };
  const state = setup(definition, "text/javascript", "");
  render(<AppWindowContent store={state.store} windowId={state.windowId} />);
  await screen.findByText("서버에 연결되어 있지 않습니다");
  const oldCanvas = document.querySelector("canvas");
  state.reconnect();
  await waitFor(() => expect(document.querySelector(".ks-client-frames iframe")).toBeTruthy());
  expect(document.querySelector("canvas")).not.toBe(oldCanvas);
  expect(transfer).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("서버에 연결되어 있지 않습니다")).toBeNull();
  cleanup();
  delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
  vi.unstubAllGlobals();
  state.store.dispose();
});
