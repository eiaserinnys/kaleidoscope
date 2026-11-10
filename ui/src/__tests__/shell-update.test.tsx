import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shell } from "../../../app/src/shell/shell";
import { FileEditorSession, flushEditors } from "../blocks/file-editor-session";
import type { AppDefinition, CoreEvent, CoreRequest } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { grantFor, makeTestSeed } from "./fixtures";

if (!globalThis.ResizeObserver) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width: 960, height: 552 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    },
  });
}
if (!Element.prototype.scrollIntoView) {
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => {} });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function readySeed() {
  const seed = makeTestSeed({
    editorPath: "README.md",
    grants: [grantFor("editor-window", "docs")],
  });
  seed.snapshot.update = { state: "ready", current_version: "0.4.1", version: "0.5.0", changes: [{ version: "0.5.0", items: ["새로운 기능"] }] };
  return seed;
}

describe("shell update action", () => {
  it("opens automatically, stays dismissed for the same version, and reopens from the bar", async () => {
    const seed = readySeed();
    const transport = createFakeTransport(seed);
    const calls = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    const dialog = await screen.findByRole("dialog", { name: "0.5.0판으로 업데이트할까요?" });
    expect(within(dialog).queryByText("0.4.1 → 0.5.0")).toBeNull();
    expect(within(dialog).getByText("새로운 기능")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "나중에" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.mock.calls.some(([request]) => request.op === "update.restart")).toBe(false);
    act(() => transport.emit({ event: "state.changed", snapshot: { ...seed.snapshot, update: { ...seed.snapshot.update } } }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "새 판 0.5.0 받음" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    store.dispose();
  });

  it("shows an empty description and the action when no changes exist", async () => {
    const seed = readySeed();
    if (seed.snapshot.update.state === "ready") seed.snapshot.update.changes = [];
    const store = createShellStore(createFakeTransport(seed));
    render(<Shell store={store} />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("바뀐 것 목록이 없습니다")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "다시 시작해서 업데이트" })).toBeTruthy();
    store.dispose();
  });

  it("shows multiple versions in order", async () => {
    const seed = readySeed();
    if (seed.snapshot.update.state === "ready") seed.snapshot.update.changes.push({ version: "0.4.9", items: ["앞 판 내용"] });
    const store = createShellStore(createFakeTransport(seed));
    render(<Shell store={store} />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/0\.5\.0판.*새로운 기능.*0\.4\.9판.*앞 판 내용/s);
    store.dispose();
  });
  it.each([
    { state: "unavailable" },
    { state: "idle", current_version: "0.4.1" },
    { state: "downloading", current_version: "0.4.1", version: "0.5.0" },
    { state: "failed", current_version: "0.4.1", version: "0.5.0", reason: "서명 확인 실패" },
  ] as const)("does not show an action for update state $state", async (update) => {
    const seed = makeTestSeed();
    seed.snapshot.update = update;
    const store = createShellStore(createFakeTransport(seed));
    render(<Shell store={store} />);
    await store.ready;

    expect(screen.queryByRole("button", { name: /새 판/ })).toBeNull();
    store.dispose();
  });

  it("saves active editor content before restarting from the ready menu", async () => {
    const transport = createFakeTransport(readySeed());
    const originalCall = transport.call.bind(transport);
    const calls: CoreRequest[] = [];
    vi.spyOn(transport, "call").mockImplementation(async (request) => {
      calls.push(request as CoreRequest);
      if (request.op === "update.restart") return { op: "update.restart" } as never;
      return originalCall(request as never) as never;
    });
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    const editor = new FileEditorSession(transport, "editor-window", "docs");
    await editor.open("README.md");
    editor.setText("# Saved before restart");
    calls.length = 0;

    fireEvent.click(await screen.findByRole("button", { name: "다시 시작해서 업데이트" }));

    await waitFor(() => expect(calls.some((request) => request.op === "update.restart")).toBe(true));
    expect(calls.map((request) => request.op).filter((op) => op === "files.write" || op === "update.restart"))
      .toEqual(["files.write", "update.restart"]);
    expect(transport.getFiles()["README.md"]).toBe("# Saved before restart");
    editor.dispose();
    store.dispose();
  });

  it("keeps the shell open and restores the button when an editor save fails", async () => {
    const transport = createFakeTransport(readySeed());
    const originalCall = transport.call.bind(transport);
    const calls: CoreRequest[] = [];
    vi.spyOn(transport, "call").mockImplementation(async (request) => {
      calls.push(request as CoreRequest);
      if (request.op === "files.write") throw { code: "io", message: "파일을 쓸 수 없습니다", details: [] };
      return originalCall(request as never) as never;
    });
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    const editor = new FileEditorSession(transport, "editor-window", "docs");
    await editor.open("README.md");
    editor.setText("# Unsaved");
    calls.length = 0;

    fireEvent.click(await screen.findByRole("button", { name: "다시 시작해서 업데이트" }));

    expect((await screen.findByRole("alert")).textContent).toContain("저장하지 못한 편집이 있어 다시 시작하지 않았습니다");
    expect(calls.map((request) => request.op)).toEqual(["files.write"]);
    expect(screen.getByRole("dialog")).toBeTruthy();
    editor.dispose();
    store.dispose();
  });

  it("shows the core error and restores the ready button when restart fails", async () => {
    const seed = readySeed();
    const transport = createFakeTransport({ ...seed, updateRestartError: "설치를 시작할 수 없습니다" });
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    fireEvent.click(await screen.findByRole("button", { name: "다시 시작해서 업데이트" }));

    expect((await screen.findByRole("alert")).textContent).toContain("설치를 시작할 수 없습니다");
    expect(screen.getByRole("dialog")).toBeTruthy();
    store.dispose();
  });

  it("scrolls the failure notice into view", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    const transport = createFakeTransport({ ...readySeed(), updateRestartError: "설치를 시작할 수 없습니다" });
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    fireEvent.click(await screen.findByRole("button", { name: "다시 시작해서 업데이트" }));
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: "nearest" }));
    expect(scroll.mock.contexts.some((element) => element instanceof Element && element.contains(alert))).toBe(true);
    store.dispose();
  });
});

describe("shell install consent failure", () => {
  it("shows the failure in the shell notice after an approved install fails", async () => {
    const transport = createFakeTransport(makeTestSeed());
    const originalCall = transport.call.bind(transport);
    vi.spyOn(transport, "call").mockImplementation(async (request) => {
      if (request.op === "app.respond_install_permission") {
        throw {
          id: "STORECLIENT_INSTALL_CONTEXT_CHANGED",
          code: "invalid_request",
          message: "설치하던 서버 연결이 바뀌었습니다. 다시 설치하세요.",
          details: [],
        };
      }
      return originalCall(request as never) as never;
    });
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    act(() => transport.emit({
      event: "app.install_permission",
      owner: { kind: "shell", generation: 0, request_id: "shell-fail" },
      request_id: "shell-fail",
      app_name: "자료 수집",
      release: 3,
      store_url: "https://store.example.org/apps",
      digest: "digest-shell",
      definition: {
        id: "research", name: "자료 수집", requires: { blocks: 1, modules: {} }, permissions: [], state: {},
        ui: { type: "text", text: "안녕" },
      } as unknown as AppDefinition,
    } as CoreEvent));
    const dialog = await screen.findByRole("dialog");
    const approve = within(dialog).getByRole("button", { name: "허용하고 설치" });
    // jsdom은 isTrusted가 참인 사용자 입력을 만들 수 없어 React가 단추에 넘긴 처리기를 직접 부른다.
    const propsKey = Object.getOwnPropertyNames(approve).find((name) => name.startsWith("__reactProps$"));
    const onClick = (approve as unknown as Record<string, { onClick?: (event: { nativeEvent: { isTrusted: boolean } }) => void }>)[propsKey!].onClick!;
    act(() => onClick({ nativeEvent: { isTrusted: true } }));
    const notice = await screen.findByRole("alert");
    expect(notice.textContent).toContain("STORECLIENT_INSTALL_CONTEXT_CHANGED");
    expect(notice.textContent).toContain("설치하던 서버 연결이 바뀌었습니다");
    store.dispose();
  });
});

describe("flushEditors", () => {
  it("saves dirty sessions and returns false when a write fails", async () => {
    const seed = readySeed();
    const transport = createFakeTransport(seed);
    const editor = new FileEditorSession(transport, "editor-window", "docs");
    await editor.open("README.md");
    editor.setText("# Saved by flush");

    expect(await flushEditors()).toBe(true);
    expect(transport.getFiles()["README.md"]).toBe("# Saved by flush");

    const failed = new FileEditorSession(transport, "editor-window", "docs");
    await failed.open("README.md");
    failed.setText("# Still unsaved");
    const originalCall = transport.call.bind(transport);
    vi.spyOn(transport, "call").mockImplementation(async (request) => {
      if (request.op === "files.write") throw { code: "io", message: "쓰기 실패", details: [] };
      return originalCall(request as never) as never;
    });

    expect(await flushEditors()).toBe(false);
    editor.dispose();
    failed.dispose();
  });
});
