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

  constructor(
    private readonly transport: Pick<CoreTransport, "call">,
    private readonly windowId: string,
    private readonly permission: string,
  ) {
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
      const reply = await this.transport.call({
        op: "files.read",
        window_id: this.windowId,
        permission: this.permission,
        path,
      });
      if (reply.op !== "files.read" || version !== this.readVersion) return false;
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
    if (!this.snapshot.loaded || this.snapshot.path === null) return;
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
    if (this.snapshot.path === null || this.snapshot.revision === null) return false;
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

  private async write(path: string, text: string, expectedRevision: string): Promise<boolean> {
    try {
      const reply = await this.transport.call({
        op: "files.write",
        window_id: this.windowId,
        permission: this.permission,
        path,
        text,
        expected_revision: expectedRevision,
      });
      if (reply.op !== "files.write") return false;
      const unchanged = this.snapshot.path === path && this.snapshot.text === text;
      this.update({
        revision: reply.revision,
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
    } catch (error) {
      const coreError = toCoreError(error);
      if (coreError.code === "conflict") {
        this.update({ status: "unsaved", conflict: coreError, error: null });
      } else {
        this.update({ status: "unsaved", error: coreError.message });
      }
      return false;
    }
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
      const reply = await this.transport.call({
        op: "files.read",
        window_id: this.windowId,
        permission: this.permission,
        path,
      });
      if (reply.op !== "files.read" || this.snapshot.path !== path) return;
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
      const latest = await this.transport.call({
        op: "files.read",
        window_id: this.windowId,
        permission: this.permission,
        path,
      });
      if (latest.op !== "files.read" || this.snapshot.path !== path) return;
      this.update({ revision: latest.revision });
      const text = this.snapshot.text;
      const saved = await this.transport.call({
        op: "files.write",
        window_id: this.windowId,
        permission: this.permission,
        path,
        text,
        expected_revision: latest.revision,
      });
      if (saved.op !== "files.write" || this.snapshot.path !== path) return;
      const unchanged = this.snapshot.text === text;
      this.update({
        revision: saved.revision,
        status: unchanged ? "saved" : "unsaved",
        dirty: !unchanged,
        conflict: null,
        error: null,
      });
      if (unchanged) await this.followPendingPath();
      else this.scheduleSave();
    } catch (error) {
      const coreError = toCoreError(error);
      if (coreError.code === "conflict") this.update({ status: "unsaved", conflict: coreError, error: null });
      else this.update({ status: "unsaved", error: coreError.message });
    }
  }

  async refreshOnFocus(): Promise<void> {
    const path = this.snapshot.path;
    const revision = this.snapshot.revision;
    if (path === null || revision === null || !this.snapshot.loaded || this.snapshot.dirty || this.snapshot.conflict) return;
    try {
      const reply = await this.transport.call({
        op: "files.read",
        window_id: this.windowId,
        permission: this.permission,
        path,
      });
      if (reply.op !== "files.read" || this.snapshot.path !== path || this.snapshot.dirty) return;
      if (reply.revision !== revision) {
        this.update({
          text: reply.text,
          revision: reply.revision,
          status: "saved",
          error: null,
          lineSeparator: reply.text.includes("\r\n") ? "\r\n" : "\n",
        });
      }
    } catch (error) {
      this.update({ error: toCoreError(error).message });
    }
  }

  dispose() {
    activeSessions.delete(this);
    this.clearTimer();
    if (this.snapshot.dirty) void this.saveNow();
  }
}
