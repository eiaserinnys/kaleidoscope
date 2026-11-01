import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeTransport } from "../core/fake-transport";
import { FileEditorSession, createDocumentEditorTarget } from "../blocks/file-editor-session";
import { createMarkdownEditorState } from "../blocks/markdown-editor-state";
import { documentEditorSession } from "../blocks/document-editor-session";
import { createShellStore } from "../core/shell-store";
import { grantFor, makeTestSeed } from "./fixtures";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("markdown storage document", () => {
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
