import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shell } from "../../../app/src/shell/shell";
import { FileEditorSession, flushEditors } from "../blocks/file-editor-session";
import type { CoreRequest } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { grantFor, makeTestSeed } from "./fixtures";

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function readySeed() {
  const seed = makeTestSeed({
    editorPath: "README.md",
    grants: [grantFor("editor-window", "docs")],
  });
  seed.snapshot.update = { state: "ready", current_version: "0.4.1", version: "0.5.0" };
  return seed;
}

describe("shell update action", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "새 판 0.5.0 받음" }));
    expect(screen.getByRole("menuitem", { name: "0.4.1 → 0.5.0" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("menu").querySelector(".ks-menu-separator")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "다시 시작해서 업데이트" }));

    await waitFor(() => expect(calls.some((request) => request.op === "update.restart")).toBe(true));
    expect(calls.map((request) => request.op)).toEqual(["files.write", "update.restart"]);
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

    fireEvent.click(screen.getByRole("button", { name: "새 판 0.5.0 받음" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "다시 시작해서 업데이트" }));

    expect((await screen.findByRole("alert")).textContent).toContain("저장하지 못한 편집이 있어 다시 시작하지 않았습니다");
    expect(calls.map((request) => request.op)).toEqual(["files.write"]);
    expect(screen.getByRole("button", { name: "새 판 0.5.0 받음" })).toBeTruthy();
    editor.dispose();
    store.dispose();
  });

  it("shows the core error and restores the ready button when restart fails", async () => {
    const seed = readySeed();
    const transport = createFakeTransport({ ...seed, updateRestartError: "설치를 시작할 수 없습니다" });
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    fireEvent.click(screen.getByRole("button", { name: "새 판 0.5.0 받음" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "다시 시작해서 업데이트" }));

    expect((await screen.findByRole("alert")).textContent).toContain("설치를 시작할 수 없습니다");
    expect(screen.getByRole("button", { name: "새 판 0.5.0 받음" })).toBeTruthy();
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
