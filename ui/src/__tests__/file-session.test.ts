import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeTransport } from "../core/fake-transport";
import { FileEditorSession, createDocumentEditorTarget, editorRevision, flushEditors } from "../blocks/file-editor-session";
import { createMarkdownEditorState } from "../blocks/markdown-editor-state";
import { documentEditorSession } from "../blocks/document-editor-session";
import { createShellStore } from "../core/shell-store";
import { grantFor, makeTestSeed } from "./fixtures";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("markdown storage document", () => {
  it("reads and writes a collection document at its current address", async () => {
    const call = vi.fn(async (request: { op: string }) => request.op === "storage.get"
      ? { op: "storage.get", result: { kind: "md", content: "원문", revision: "r1", exists: true } }
      : { op: "storage.write", revision: "r2" });
    const session = new FileEditorSession(createDocumentEditorTarget({ call } as never, "editor-window", "docs", true));
    await session.open("a.md");
    session.setText("초안");
    session.retarget("a.md", "b.md");
    expect(await session.saveNow()).toBe(true);
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.get", doc: "a.md" }));
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.write", doc: "b.md", expected_revision: "r1", content: "초안" }));
    session.dispose();
  });

  it("scopes document flushes and returns false when the selected save fails", async () => {
    const seed = structuredClone(makeTestSeed());
    seed.snapshot.shared.app_versions[0].definition.storage = { entries: [{ id: "docs", key: "documents", kind: "md", collection: true, default: "", label: "문서", presentation: "hidden" }] };
    const store = createShellStore(createFakeTransport(seed));
    await store.ready;
    const target = { allowsMissingRevision: true, conflictMessage: "충돌", read: vi.fn(async () => ({ text: "원문", revision: "r1" })), write: vi.fn(async () => { throw { code: "server", message: "저장 실패", details: [] }; }) };
    const first = new FileEditorSession(target);
    const second = new FileEditorSession(target);
    const resource = { kind: "document" as const, store, windowId: "editor-window", entry: "docs" };
    first.setResource(resource);
    second.setResource(resource);
    await first.open("folder/a.md"); await second.open("other/b.md");
    first.setText("첫 초안"); second.setText("둘째 초안");
    expect(await flushEditors({ ...resource, doc: "folder" })).toBe(false);
    expect(target.write).toHaveBeenCalledTimes(1);
    expect(first.getSnapshot()).toMatchObject({ dirty: true, text: "첫 초안" });
    expect(second.getSnapshot()).toMatchObject({ dirty: true, text: "둘째 초안" });
    first.dispose(); second.dispose(); store.dispose();
  });

  it("exposes the revision after flushing the active document editor", async () => {
    const seed = structuredClone(makeTestSeed());
    seed.snapshot.shared.app_versions[0].definition.storage = { entries: [{ id: "docs", key: "documents", kind: "md", collection: true, default: "", label: "문서", presentation: "hidden" }] };
    const store = createShellStore(createFakeTransport(seed));
    await store.ready;
    const resource = { kind: "document" as const, store, windowId: "editor-window", entry: "docs" };
    const session = new FileEditorSession({
      allowsMissingRevision: true,
      conflictMessage: "충돌",
      read: vi.fn(async () => ({ text: "원문", revision: "r1" })),
      write: vi.fn(async () => "r2"),
    });
    session.setResource(resource);
    await session.open("draft.md");
    const address = { ...resource, doc: "draft.md" };
    expect(editorRevision(address)).toBe("r1");
    session.setText("저장된 초안");
    expect(await flushEditors(address)).toBe(true);
    expect(editorRevision(address)).toBe("r2");
    session.dispose();
    store.dispose();
  });

  function setup() {
    const seed = structuredClone(makeTestSeed());
    const definition = seed.snapshot.shared.app_versions.find((v) => v.app_id === "md-editor")!.definition;
    definition.storage = { entries: [{ id: "role", key: "role", kind: "md", default: "기본 글\r\n", label: "역할", presentation: "hidden" }] };
    const transport = createFakeTransport(seed);
    const session = new FileEditorSession(createDocumentEditorTarget(transport, "editor-window", "role"));
    return { transport, session };
  }

  it("opens the default without creating a row and creates it with null revision on first edit", async () => {
    const { transport, session } = setup();
    const call = vi.spyOn(transport, "call");
    await session.open("role");
    expect(session.getSnapshot()).toMatchObject({ text: "기본 글\r\n", revision: null, loaded: true });
    session.setText("새 글\n둘째 줄");
    expect(await session.saveNow()).toBe(true);
    expect(call).toHaveBeenCalledWith({ op: "storage.write", window_id: "editor-window", entry: "role", content: "새 글\r\n둘째 줄", expected_revision: null });
    expect((await transport.call({ op: "storage.get", window_id: "editor-window", entry: "role" })).result).toMatchObject({ exists: true, content: "새 글\r\n둘째 줄" });
    session.dispose();
  });

  it("refreshes clean content but preserves dirty text until conflict, reload, or overwrite", async () => {
    const { transport, session } = setup();
    await session.open("role");
    await transport.call({ op: "storage.write", window_id: "editor-window", entry: "role", content: "다른 글", expected_revision: null });
    await session.refreshOnFocus();
    expect(session.getSnapshot().text).toBe("다른 글");
    const revision = session.getSnapshot().revision;
    session.setText("내 초안");
    await transport.call({ op: "storage.write", window_id: "editor-window", entry: "role", content: "다시 바뀜", expected_revision: revision });
    await session.refreshOnFocus();
    expect(session.getSnapshot().text).toBe("내 초안");
    expect(await session.saveNow()).toBe(false);
    expect(session.getSnapshot().conflict).not.toBeNull();
    await session.reload();
    expect(session.getSnapshot().text).toBe("다시 바뀜");
    session.setText("최종 초안");
    await transport.call({ op: "storage.write", window_id: "editor-window", entry: "role", content: "원격", expected_revision: session.getSnapshot().revision });
    await session.saveNow();
    await session.overwrite();
    expect((await transport.call({ op: "storage.get", window_id: "editor-window", entry: "role" })).result.content).toBe("최종 초안");
    session.dispose();
  });

  it("keeps an offline draft and retries the same revision, and accepts a lost write response when content matches", async () => {
    const { transport, session } = setup();
    const original = transport.call.bind(transport);
    let mode: "offline" | "lost" | "online" = "online";
    const call = vi.spyOn(transport, "call").mockImplementation(async (request) => {
      if (request.op === "storage.write" && mode !== "online") {
        if (mode === "lost") await original(request);
        throw { code: "server", message: "연결 끊김", details: [] };
      }
      if (request.op === "storage.get" && mode === "offline") throw { code: "server", message: "연결 끊김", details: [] };
      return original(request);
    });
    await session.open("role");
    mode = "offline";
    session.setText("초안");
    expect(await session.saveNow()).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ text: "초안", revision: null, dirty: true });
    mode = "lost";
    await session.refreshOnFocus();
    expect(session.getSnapshot()).toMatchObject({ text: "초안", dirty: false, status: "saved" });
    expect(call.mock.calls.filter(([r]) => r.op === "storage.write").every(([r]) => r.op === "storage.write" && r.expected_revision === null)).toBe(true);
    session.dispose();
  });

  it("does not create a missing local file after a failed read", async () => {
    const { transport, session } = createSession({});
    await session.open("missing.md");
    session.setText("초안");
    expect(await session.saveNow()).toBe(true);
    expect(transport.getFiles()).toEqual({});
    session.dispose();
  });

  it("keeps an offline document draft across block remount and retries on reconnect", async () => {
    const seed = structuredClone(makeTestSeed());
    seed.snapshot.shared.app_versions[0].definition.storage = { entries: [{ id: "role", key: "role", kind: "md", default: "기본", label: "역할", presentation: "hidden" }] };
    const transport = createFakeTransport(seed);
    const original = transport.call.bind(transport);
    let offline = false;
    vi.spyOn(transport, "call").mockImplementation(async (request) => {
      if (offline && (request.op === "storage.get" || request.op === "storage.write")) throw { code: "server", message: "연결 끊김", details: [] };
      return original(request);
    });
    const store = createShellStore(transport);
    await store.ready;
    const session = documentEditorSession(store, "editor-window", "role");
    await session.open("role");
    offline = true;
    session.setText("탭을 바꿔도 남는 초안");
    expect(await session.saveNow()).toBe(false);
    expect(documentEditorSession(store, "editor-window", "role")).toBe(session);
    offline = false;
    transport.setLink({ state: "connected", mode: "remote", server_url: "https://example.com", device_name: "시험" });
    await vi.waitFor(() => expect(session.getSnapshot().dirty).toBe(false));
    expect((await original({ op: "storage.get", window_id: "editor-window", entry: "role" })).result.content).toBe("탭을 바꿔도 남는 초안");
    session.dispose();
    store.dispose();
  });
});

function createSession(files: Record<string, string>) {
  const transport = createFakeTransport(makeTestSeed({
    grants: [grantFor("editor-window", "docs")],
    files,
  }));
  return { transport, session: new FileEditorSession(transport, "editor-window", "docs") };
}

describe("markdown editor file session", () => {
  it("가짜 코어가 파일을 쓰면 실제 코어처럼 변경 이벤트를 보낸다", async () => {
    const { transport, session } = createSession({});
    const listener = vi.fn();
    const unsubscribe = transport.subscribe(listener);
    await transport.call({ op: "files.write", window_id: "editor-window", permission: "docs", path: "새 문서.md", text: "" });
    expect(listener).toHaveBeenCalledWith({
      event: "files.changed", root: grantFor("editor-window", "docs").root_path,
      changes: [{ to: "새 문서.md" }],
    });
    unsubscribe();
    session.dispose();
  });

  it("retargets a dirty descendant without reloading and saves to the new path", async () => {
    const target = { allowsMissingRevision: false, conflictMessage: "충돌", read: vi.fn(async () => ({ text: "원문", revision: "r1" })), write: vi.fn(async () => "r2") };
    const session = new FileEditorSession(target);
    await session.open("old/note.md");
    const identity = session.getSnapshot().contentIdentity;
    session.setText("초안");
    session.retarget("old", "new");
    await session.open("new/note.md");
    expect(session.getSnapshot()).toMatchObject({ path: "new/note.md", text: "초안", revision: "r1", contentIdentity: identity });
    expect(target.read).toHaveBeenCalledTimes(1);
    expect(await session.saveNow()).toBe(true);
    expect(target.write).toHaveBeenCalledWith("new/note.md", "초안", "r1");
    session.dispose();
  });

  it("ignores an old in-flight read after a retarget", async () => {
    let finish!: (value: { text: string; revision: string }) => void;
    const target = { allowsMissingRevision: false, conflictMessage: "충돌", read: vi.fn(() => new Promise<{ text: string; revision: string }>((resolve) => { finish = resolve; })), write: vi.fn(async () => "r2") };
    const session = new FileEditorSession(target);
    const opening = session.open("old.md");
    session.retarget("old.md", "new.md");
    finish({ text: "오래된 응답", revision: "old" });
    await opening;
    expect(session.getSnapshot()).not.toMatchObject({ path: "new.md", text: "오래된 응답" });
    session.dispose();
  });

  it("retries a save at the new path when the old in-flight write fails after a move", async () => {
    vi.useFakeTimers();
    let failOld!: (reason: unknown) => void;
    const target = {
      allowsMissingRevision: false,
      conflictMessage: "충돌",
      read: vi.fn(async () => ({ text: "원문", revision: "r1" })),
      write: vi.fn().mockImplementationOnce(() => new Promise<string>((_resolve, reject) => { failOld = reject; })).mockResolvedValue("r2"),
    };
    const session = new FileEditorSession(target);
    await session.open("old.md");
    session.setText("초안");
    const saving = session.saveNow();
    session.retarget("old.md", "new.md");
    failOld({ code: "not_found", message: "이전 경로가 없습니다", details: [] });
    expect(await saving).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(target.write).toHaveBeenLastCalledWith("new.md", "초안", "r1");
    expect(session.getSnapshot()).toMatchObject({ path: "new.md", text: "초안", dirty: false });
    session.dispose();
  });

  it("clears a clean deletion and retains a dirty deletion for explicit recreation", async () => {
    const target = { allowsMissingRevision: false, conflictMessage: "충돌", read: vi.fn(async () => ({ text: "원문", revision: "r1" })), write: vi.fn(async () => "r2") };
    const clean = new FileEditorSession(target);
    await clean.open("clean.md");
    clean.removed();
    expect(clean.getSnapshot()).toMatchObject({ path: null, text: "", dirty: false });
    const dirty = new FileEditorSession(target);
    await dirty.open("draft.md");
    dirty.setText("초안");
    dirty.removed();
    expect(dirty.getSnapshot()).toMatchObject({ path: "draft.md", text: "초안", dirty: true, conflict: { code: "conflict" } });
    expect(await dirty.saveNow()).toBe(false);
    await dirty.overwrite();
    expect(target.write).toHaveBeenCalledWith("draft.md", "초안", null);
    clean.dispose(); dirty.dispose();
  });

  it("does not let an earlier save response erase a deletion conflict", async () => {
    let finish!: (revision: string) => void;
    const target = { allowsMissingRevision: false, conflictMessage: "충돌", read: vi.fn(async () => ({ text: "원문", revision: "r1" })), write: vi.fn(() => new Promise<string>((resolve) => { finish = resolve; })) };
    const session = new FileEditorSession(target);
    await session.open("note.md");
    session.setText("초안");
    const saving = session.saveNow();
    session.removed();
    finish("r2");
    expect(await saving).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ text: "초안", dirty: true, conflict: { code: "conflict" } });
    session.dispose();
  });

  it("keeps the draft and shows the save error when the deleted parent cannot be recreated", async () => {
    const target = {
      allowsMissingRevision: false,
      conflictMessage: "충돌",
      read: vi.fn(async () => ({ text: "원문", revision: "r1" })),
      write: vi.fn(async () => { throw { code: "io", message: "상위 폴더가 없습니다", details: [] }; }),
    };
    const session = new FileEditorSession(target);
    await session.open("notes/note.md");
    session.setText("보존할 초안");
    session.removed();
    await session.overwrite();
    expect(session.getSnapshot()).toMatchObject({ path: "notes/note.md", text: "보존할 초안", dirty: true, error: { message: "상위 폴더가 없습니다" } });
    expect(await session.saveNow()).toBe(false);
    session.dispose();
  });

  it("flushes only sessions under the requested resource address", async () => {
    const { transport, session: first } = createSession({ "a/one.md": "one", "b/two.md": "two" });
    const second = new FileEditorSession(transport, "editor-window", "docs");
    first.setResource({ kind: "file", root: "/fake/docs" });
    second.setResource({ kind: "file", root: "/fake/docs" });
    await first.open("a/one.md"); await second.open("b/two.md");
    first.setText("바뀜 1"); second.setText("바뀜 2");
    expect(await flushEditors({ kind: "file", root: "/fake/docs", path: "a" })).toBe(true);
    expect(first.getSnapshot().dirty).toBe(false);
    expect(second.getSnapshot().dirty).toBe(true);
    first.dispose(); second.dispose();
  });
  it("reads the file when its path changes", async () => {
    const { session } = createSession({ "README.md": "# One", "notes/next.md": "# Two" });

    await session.open("README.md");
    expect(session.getSnapshot().text).toBe("# One");

    await session.open("notes/next.md");
    expect(session.getSnapshot().path).toBe("notes/next.md");
    expect(session.getSnapshot().text).toBe("# Two");
  });

  it("writes one second after typing with the revision that was read", async () => {
    vi.useFakeTimers();
    const { transport, session } = createSession({ "README.md": "# Before" });
    const call = vi.spyOn(transport, "call");
    await session.open("README.md");
    const revision = session.getSnapshot().revision;

    session.setText("# After");
    await vi.advanceTimersByTimeAsync(999);
    expect(call).not.toHaveBeenCalledWith(expect.objectContaining({ op: "files.write" }));
    await vi.advanceTimersByTimeAsync(1);

    expect(call).toHaveBeenCalledWith({
      op: "files.write",
      window_id: "editor-window",
      permission: "docs",
      path: "README.md",
      text: "# After",
      expected_revision: revision,
    });
    expect(transport.getFiles()["README.md"]).toBe("# After");
    expect(session.getSnapshot().status).toBe("saved");
  });

  it("flushes edits before opening the next path", async () => {
    const { transport, session } = createSession({ "README.md": "# Before", "next.md": "# Next" });
    await session.open("README.md");
    session.setText("# Saved before switch");

    await session.open("next.md");

    expect(transport.getFiles()["README.md"]).toBe("# Saved before switch");
    expect(session.getSnapshot().path).toBe("next.md");
    expect(session.getSnapshot().text).toBe("# Next");
  });

  it("offers reload after a revision conflict", async () => {
    const { transport, session } = createSession({ "README.md": "# Original" });
    await session.open("README.md");
    const oldRevision = session.getSnapshot().revision;
    if (oldRevision === null) throw new Error("파일 revision을 읽지 못했습니다");
    await transport.call({
      op: "files.write",
      window_id: "editor-window",
      permission: "docs",
      path: "README.md",
      text: "# External",
      expected_revision: oldRevision,
    });
    session.setText("# Local");

    await session.saveNow();
    expect(session.getSnapshot().conflict).toBeTruthy();
    await session.reload();

    expect(session.getSnapshot().text).toBe("# External");
    expect(session.getSnapshot().conflict).toBeNull();
    expect(session.getSnapshot().status).toBe("saved");
  });

  it("rereads the revision before overwriting a conflicting file", async () => {
    const { transport, session } = createSession({ "README.md": "# Original" });
    await session.open("README.md");
    const oldRevision = session.getSnapshot().revision;
    if (oldRevision === null) throw new Error("파일 revision을 읽지 못했습니다");
    await transport.call({
      op: "files.write",
      window_id: "editor-window",
      permission: "docs",
      path: "README.md",
      text: "# External",
      expected_revision: oldRevision,
    });
    session.setText("# Local wins");

    await session.saveNow();
    await session.overwrite();

    expect(transport.getFiles()["README.md"]).toBe("# Local wins");
    expect(session.getSnapshot().conflict).toBeNull();
    expect(session.getSnapshot().status).toBe("saved");
  });

  it("keeps CRLF when CodeMirror edits and saves the document", async () => {
    const { transport, session } = createSession({ "windows.md": "first\r\nsecond\r\n" });
    await session.open("windows.md");
    const state = createMarkdownEditorState(session.getSnapshot().text);
    const changed = state.update({ changes: { from: state.doc.length, insert: "third" } }).state.doc.toString();
    session.setText(changed);
    await session.saveNow();

    expect(transport.getFiles()["windows.md"]).toBe("first\r\nsecond\r\nthird");
  });

  it("reloads an unchanged editor on focus when the file revision changed", async () => {
    const { transport, session } = createSession({ "README.md": "# Original" });
    await session.open("README.md");
    const oldRevision = session.getSnapshot().revision;
    if (oldRevision === null) throw new Error("파일 revision을 읽지 못했습니다");
    await transport.call({
      op: "files.write",
      window_id: "editor-window",
      permission: "docs",
      path: "README.md",
      text: "# Updated elsewhere",
      expected_revision: oldRevision,
    });

    await session.refreshOnFocus();

    expect(session.getSnapshot().text).toBe("# Updated elsewhere");
    expect(session.getSnapshot().status).toBe("saved");
  });
});
