import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeTransport } from "../core/fake-transport";
import { FileEditorSession } from "../blocks/file-editor-session";
import { createMarkdownEditorState } from "../blocks/markdown-editor-state";
import { grantFor, makeTestSeed } from "./fixtures";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
