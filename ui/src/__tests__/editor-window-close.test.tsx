import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";
import { Shell } from "../../../app/src/shell/shell";
import { FileEditorSession } from "../blocks/file-editor-session";
import { registerSandboxFlush } from "../blocks/sandbox-flush";
import type { CoreRequest } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { grantFor, makeTestSeed } from "./fixtures";

if (!globalThis.ResizeObserver) {
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class { observe() {} disconnect() {} } });
}

const sessions: FileEditorSession[] = [];
const disposers: Array<() => void> = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach((session) => session.dispose());
  disposers.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
});

async function setup(kind: "file" | "document", options: { delay?: boolean; conflict?: boolean; extraDesktop?: boolean; extraWorkspace?: boolean } = {}) {
  const seed = structuredClone(makeTestSeed({ editorPath: "README.md", grants: [grantFor("editor-window", "docs")] }));
  const definition = seed.snapshot.shared.app_versions[0].definition;
  if (kind === "document") {
    definition.storage = { entries: [{ id: "docs", key: "documents", kind: "md", default: "원문", label: "문서", presentation: "hidden" }] };
    definition.ui = { type: "markdown", document: { entry: "docs" } };
  } else {
    definition.ui = { type: "markdown", file: { permission: "docs", path: { state: "current_file" } } };
  }
  if (options.extraDesktop) {
    seed.snapshot.shared.desktops.push({ ...seed.snapshot.shared.desktops[0], id: "desktop-2", name: "다른 화면", position: 1 });
  }
  if (options.extraWorkspace) {
    seed.snapshot.shared.workspaces.push({ ...seed.snapshot.shared.workspaces[0], id: "workspace-2", name: "다른 작업" });
    seed.snapshot.shared.desktops.push({ ...seed.snapshot.shared.desktops[0], id: "desktop-2", workspace_id: "workspace-2", name: "다른 화면" });
    seed.snapshot.device.active_desktop_ids["workspace-2"] = "desktop-2";
  }
  const transport = createFakeTransport(seed);
  const original = transport.call.bind(transport);
  const calls: CoreRequest[] = [];
  let release: (() => void) | undefined;
  let writeStarted = false;
  let documentContent: unknown;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const store = createShellStore(transport);
  const setText = FileEditorSession.prototype.setText;
  vi.spyOn(FileEditorSession.prototype, "setText").mockImplementation(function (this: FileEditorSession, text) {
    if (!sessions.includes(this)) sessions.push(this);
    setText.call(this, text);
  });
  vi.spyOn(transport, "call").mockImplementation(async (request) => {
    calls.push(request as CoreRequest);
    if (request.op === "files.write" || request.op === "storage.write") {
      writeStarted = true;
      if (options.delay) await gate;
      if (options.conflict) throw { code: "conflict", message: "다른 곳에서 바뀌었습니다", details: [] };
    }
    if (request.op === "window.close" || request.op === "desktop.delete" || request.op === "workspace.delete") {
      if (kind === "document") documentContent = (await original({ op: "storage.get", window_id: "editor-window", entry: "docs" })).result.content;
      const snapshot = structuredClone(store.getSnapshot()!);
      const desktopIds = request.op === "workspace.delete"
        ? snapshot.shared.desktops.filter((desktop) => desktop.workspace_id === request.workspace_id).map((desktop) => desktop.id)
        : request.op === "desktop.delete" ? [request.desktop_id] : [];
      snapshot.shared.windows = snapshot.shared.windows.filter((window) => request.op === "window.close" ? window.id !== request.window_id : !desktopIds.includes(window.desktop_id));
      transport.emit({ event: "state.changed", snapshot });
      return { op: request.op } as never;
    }
    return original(request as never) as never;
  });
  disposers.push(() => store.dispose());
  const { container } = render(<Shell store={store} />);
  await store.ready;
  await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
  const editor = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
  act(() => editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "마지막 입력" } }));
  expect(sessions).toHaveLength(1);
  calls.length = 0;
  return { transport, calls, release: () => release!(), writeStarted: () => writeStarted, documentContent: () => documentContent, session: sessions[0] };
}

function closeWindow() {
  const appWindow = screen.getByTestId("app-window-md-editor");
  fireEvent.click(within(appWindow).getByRole("button", { name: "창 닫기" }));
}

it.each(["file", "document"] as const)("%s 편집 직후 창을 닫으면 마지막 입력을 먼저 저장한다", async (kind) => {
  const { calls, transport, documentContent } = await setup(kind);
  closeWindow();
  await waitFor(() => expect(calls.some((call) => call.op === "window.close")).toBe(true));
  const writeOp = kind === "file" ? "files.write" : "storage.write";
  const relevant = calls.filter((call) => call.op === writeOp || call.op === "window.close");
  expect(relevant.map((call) => call.op)).toEqual([writeOp, "window.close"]);
  expect(relevant[0]).toMatchObject(kind === "file" ? { text: "마지막 입력" } : { content: "마지막 입력" });
  if (kind === "file") expect(transport.getFiles()["README.md"]).toBe("마지막 입력");
  else expect(documentContent()).toBe("마지막 입력");
});

it("저장 응답을 받을 때까지 창을 닫지 않는다", async () => {
  const { calls, release, writeStarted } = await setup("file", { delay: true });
  closeWindow();
  await waitFor(() => expect(writeStarted()).toBe(true));
  expect(calls.some((call) => call.op === "window.close")).toBe(false);
  await act(async () => release());
  await waitFor(() => expect(calls.some((call) => call.op === "window.close")).toBe(true));
});

it("다른 창의 편집은 닫는 창과 함께 저장하지 않는다", async () => {
  const { calls } = await setup("file");
  const write = vi.fn(async () => "r2");
  const other = new FileEditorSession({ windowId: "viewer-window", allowsMissingRevision: false, conflictMessage: "충돌", read: async () => ({ text: "원문", revision: "r1" }), write });
  sessions.push(other);
  await other.open("other.md");
  other.setText("다른 창의 초안");
  closeWindow();
  await waitFor(() => expect(calls.some((call) => call.op === "window.close")).toBe(true));
  expect(write).not.toHaveBeenCalled();
  expect(other.getSnapshot()).toMatchObject({ text: "다른 창의 초안", dirty: true });
});

it("저장 충돌이면 창과 마지막 초안을 유지하고 알린다", async () => {
  const { calls, session } = await setup("file", { conflict: true });
  closeWindow();
  await screen.findByText("저장하지 못한 내용이 있어 창을 닫지 않았습니다. 내용을 저장한 뒤 다시 닫으세요.");
  expect(calls.some((call) => call.op === "window.close")).toBe(false);
  expect(session.getSnapshot()).toMatchObject({ text: "마지막 입력", dirty: true, conflict: { code: "conflict" } });
  expect(screen.getByTestId("app-window-md-editor")).toBeTruthy();
});

it("데스크톱을 지우기 전에 열린 편집기를 저장한다", async () => {
  const { calls, transport } = await setup("file", { extraDesktop: true });
  fireEvent.contextMenu(screen.getByRole("button", { name: "Desktop" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "지우기" }));
  await waitFor(() => expect(calls.some((call) => call.op === "desktop.delete")).toBe(true));
  expect(calls.filter((call) => call.op === "files.write" || call.op === "desktop.delete").map((call) => call.op)).toEqual(["files.write", "desktop.delete"]);
  expect(transport.getFiles()["README.md"]).toBe("마지막 입력");
});

it("작업의 창 저장이 실패하면 작업을 지우지 않는다", async () => {
  const { calls, session } = await setup("file", { extraWorkspace: true, conflict: true });
  fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "지우기" }));
  await screen.findByText("저장하지 못한 내용이 있어 작업을 지우지 않았습니다. 내용을 저장한 뒤 다시 지우세요.");
  expect(calls.some((call) => call.op === "workspace.delete")).toBe(false);
  expect(session.getSnapshot()).toMatchObject({ text: "마지막 입력", dirty: true });
});

it("데스크톱의 샌드박스 저장이 실패하면 데스크톱을 지우지 않는다", async () => {
  const { calls } = await setup("file", { extraDesktop: true });
  disposers.push(registerSandboxFlush("editor-window", async () => false));
  fireEvent.contextMenu(screen.getByRole("button", { name: "Desktop" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "지우기" }));
  await screen.findByText("저장하지 못한 내용이 있어 데스크톱을 지우지 않았습니다. 내용을 저장한 뒤 다시 지우세요.");
  expect(calls.some((call) => call.op === "desktop.delete")).toBe(false);
});
