import type { CoreError } from "../contract/contract";
import { toCoreError, type CoreTransport } from "../core/core-transport";

export type EditorStatus = "saved" | "saving" | "unsaved";

export interface FileEditorSnapshot {
  path: string | null;
  text: string;
  revision: string | null;
  status: EditorStatus;
  loaded: boolean;
  dirty: boolean;
  conflict: CoreError | null;
  error: string | null;
  lineSeparator: "\n" | "\r\n";
}

export interface EditorTarget {
  read(path: string): Promise<{ text: string; revision: string | null }>;
  write(path: string, text: string, revision: string | null): Promise<string>;
  readonly allowsMissingRevision: boolean;
}

export function createFileEditorTarget(transport: Pick<CoreTransport, "call">, windowId: string, permission: string): EditorTarget {
  return {
    allowsMissingRevision: false,
    async read(path) {
      const reply = await transport.call({ op: "files.read", window_id: windowId, permission, path });
      return { text: reply.text, revision: reply.revision };
    },
    async write(path, text, revision) {
      if (revision === null) throw new Error("파일 revision이 없습니다");
      const reply = await transport.call({ op: "files.write", window_id: windowId, permission, path, text, expected_revision: revision });
      return reply.revision;
    },
  };
}

export function createDocumentEditorTarget(transport: Pick<CoreTransport, "call">, windowId: string, entry: string): EditorTarget {
  return {
    allowsMissingRevision: true,
    async read() {
      const { result } = await transport.call({ op: "storage.get", window_id: windowId, entry });
      if (result.kind !== "md" || typeof result.content !== "string") throw new Error("마크다운 문서가 아닙니다");
      return { text: result.content, revision: result.revision };
    },
    async write(_path, text, revision) {
      const reply = await transport.call({ op: "storage.write", window_id: windowId, entry, content: text, expected_revision: revision });
      return reply.revision;
    },
  };
}

const activeSessions = new Set<FileEditorSession>();

export async function flushEditors(): Promise<boolean> {
  const results = await Promise.all([...activeSessions].map((session) => session.saveNow()));
  return results.every(Boolean);
}

export class FileEditorSession {
  private snapshot: FileEditorSnapshot = {
    path: null,
    text: "",
    revision: null,
    status: "saved",
    loaded: false,
    dirty: false,
    conflict: null,
    error: null,
    lineSeparator: "\n",
  };
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private savePromise: Promise<boolean> | null = null;
  private pendingPath: string | null | undefined;
  private readVersion = 0;
  private opened = false;
  private readonly target: EditorTarget;

  constructor(target: EditorTarget);
  constructor(transport: Pick<CoreTransport, "call">, windowId: string, permission: string);
  constructor(targetOrTransport: EditorTarget | Pick<CoreTransport, "call">, windowId?: string, permission?: string) {
    this.target = "read" in targetOrTransport ? targetOrTransport : createFileEditorTarget(targetOrTransport, windowId!, permission!);
    activeSessions.add(this);
  }

  getSnapshot = (): FileEditorSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<FileEditorSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private clearTimer() {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }

  private scheduleSave() {
    this.clearTimer();
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, 1000);
  }

  async open(path: string | null): Promise<void> {
    // Editor effects are replayed by React StrictMode after their cleanup.
    activeSessions.add(this);
    if (path === this.snapshot.path && this.snapshot.loaded && !this.snapshot.error) return;
    if (this.snapshot.path !== null && this.snapshot.dirty) {
      this.pendingPath = path;
      await this.saveNow();
      return;
    }
    await this.load(path);
  }

  private async load(path: string | null): Promise<boolean> {
    this.clearTimer();
    const version = ++this.readVersion;
    this.opened = false;
    if (path === null) {
      this.pendingPath = undefined;
      this.update({
        path: null,
        text: "",
        revision: null,
        status: "saved",
        loaded: true,
        dirty: false,
        conflict: null,
        error: null,
        lineSeparator: "\n",
      });
      return true;
    }

    this.update({
      path,
      text: "",
      revision: null,
      status: "saved",
      loaded: false,
      dirty: false,
      conflict: null,
      error: null,
      lineSeparator: "\n",
    });

    try {
      const reply = await this.target.read(path);
      if (version !== this.readVersion) return false;
      this.opened = true;
      this.update({
        text: reply.text,
        revision: reply.revision,
        loaded: true,
        dirty: false,
        status: "saved",
        conflict: null,
        error: null,
        lineSeparator: reply.text.includes("\r\n") ? "\r\n" : "\n",
      });
      return true;
    } catch (error) {
      if (version === this.readVersion) {
        this.update({ loaded: true, dirty: false, error: toCoreError(error).message });
      }
      return false;
    }
  }

  setText(text: string) {
    if (!this.opened || !this.snapshot.loaded || this.snapshot.path === null) return;
    const normalized = text.replace(/\r\n?/g, "\n");
    const storedText = this.snapshot.lineSeparator === "\r\n"
      ? normalized.replace(/\n/g, "\r\n")
      : normalized;
    if (storedText === this.snapshot.text) return;
    this.update({ text: storedText, dirty: true, status: "unsaved", error: null });
    this.scheduleSave();
  }

  async saveNow(): Promise<boolean> {
    this.clearTimer();
    if (!this.snapshot.dirty) return true;
    if (!this.opened || this.snapshot.path === null || (this.snapshot.revision === null && !this.target.allowsMissingRevision)) return false;
    if (this.savePromise) return this.savePromise;

    const path = this.snapshot.path;
    const text = this.snapshot.text;
    const revision = this.snapshot.revision;
    this.update({ status: "saving", error: null });
    this.savePromise = this.write(path, text, revision);
    try {
      return await this.savePromise;
    } finally {
      this.savePromise = null;
    }
  }

  private async write(path: string, text: string, expectedRevision: string | null): Promise<boolean> {
    try {
      const revision = await this.target.write(path, text, expectedRevision);
      return await this.saved(path, text, revision);
    } catch (error) {
      const coreError = toCoreError(error);
      if (this.target.allowsMissingRevision) {
        try {
          const current = await this.target.read(path);
          if (current.revision !== null && current.text === text) return await this.saved(path, text, current.revision);
        } catch {
          // 읽기도 실패하면 초안과 원래 revision을 유지한다.
        }
      }
      if (coreError.code === "conflict") {
        this.update({ status: "unsaved", conflict: coreError, error: null });
      } else {
        this.update({ status: "unsaved", error: coreError.message });
      }
      return false;
    }
  }

  private async saved(path: string, text: string, revision: string): Promise<boolean> {
    const unchanged = this.snapshot.path === path && this.snapshot.text === text;
    this.update({
      revision,
      status: unchanged ? "saved" : "unsaved",
      dirty: !unchanged,
      conflict: null,
      error: null,
    });
    if (unchanged) {
      await this.followPendingPath();
      return true;
    }
    this.scheduleSave();
    return false;
  }

  private async followPendingPath() {
    if (this.pendingPath === undefined) return;
    const path = this.pendingPath;
    this.pendingPath = undefined;
    await this.load(path);
  }

  async reload(): Promise<void> {
    const path = this.snapshot.path;
    if (path === null || this.snapshot.conflict === null) return;
    this.clearTimer();
    try {
      const reply = await this.target.read(path);
      if (this.snapshot.path !== path) return;
      this.update({
        text: reply.text,
        revision: reply.revision,
        status: "saved",
        loaded: true,
        dirty: false,
        conflict: null,
        error: null,
        lineSeparator: reply.text.includes("\r\n") ? "\r\n" : "\n",
      });
      await this.followPendingPath();
    } catch (error) {
      this.update({ status: "unsaved", error: toCoreError(error).message });
    }
  }

  async overwrite(): Promise<void> {
    const path = this.snapshot.path;
    if (path === null || this.snapshot.conflict === null) return;
    this.clearTimer();
    try {
      const latest = await this.target.read(path);
      if (this.snapshot.path !== path) return;
      this.update({ revision: latest.revision });
      const text = this.snapshot.text;
      await this.write(path, text, latest.revision);
    } catch (error) {
      const coreError = toCoreError(error);
      if (coreError.code === "conflict") this.update({ status: "unsaved", conflict: coreError, error: null });
      else this.update({ status: "unsaved", error: coreError.message });
    }
  }

  async refreshOnFocus(): Promise<void> {
    const path = this.snapshot.path;
    const revision = this.snapshot.revision;
    if (path === null || !this.snapshot.loaded || this.snapshot.conflict) return;
    if (!this.opened) {
      if (this.target.allowsMissingRevision && this.snapshot.error) await this.load(path);
      return;
    }
    if (this.snapshot.dirty) {
      if (this.target.allowsMissingRevision && this.snapshot.error) await this.saveNow();
      return;
    }
    const version = ++this.readVersion;
    try {
      const reply = await this.target.read(path);
      if (version !== this.readVersion || this.snapshot.path !== path || this.snapshot.dirty || this.snapshot.revision !== revision) return;
      if (reply.revision !== revision || reply.text !== this.snapshot.text) {
        this.update({
          text: reply.text,
          revision: reply.revision,
          status: "saved",
          error: null,
          lineSeparator: reply.text.includes("\r\n") ? "\r\n" : "\n",
        });
      } else if (this.snapshot.error) {
        this.update({ error: null });
      }
    } catch (error) {
      if (version === this.readVersion && this.snapshot.path === path && !this.snapshot.dirty) this.update({ error: toCoreError(error).message });
    }
  }

  dispose() {
    activeSessions.delete(this);
    this.clearTimer();
    if (this.snapshot.dirty) void this.saveNow();
  }
}
