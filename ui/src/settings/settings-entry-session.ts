import type { CoreError, StorageEntryDecl, StorageReadReply } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { toCoreError } from "../core/core-transport";
import type { ShellStore } from "../core/shell-store";

export interface SettingsEntrySnapshot {
  loaded: boolean;
  value: JsonValue;
  revision: string | null;
  exists: boolean;
  dirty: boolean;
  editing: boolean;
  saving: boolean;
  saved: boolean;
  conflict: boolean;
  error: CoreError | null;
}

const equal = (a: JsonValue, b: JsonValue) => JSON.stringify(a) === JSON.stringify(b);

export class SettingsEntrySession {
  private state: SettingsEntrySnapshot;
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private retryOperation: "read" | "write" | "reset" = "read";
  private readVersion = 0;
  private refreshPending = false;
  private savedTimer?: ReturnType<typeof setTimeout>;
  private committedValue: JsonValue;

  constructor(private store: ShellStore, private windowId: string, readonly entry: StorageEntryDecl) {
    this.committedValue = entry.default;
    this.state = { loaded: false, value: entry.default, revision: null, exists: false, dirty: false, editing: false, saving: false, saved: false, conflict: false, error: null };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<SettingsEntrySnapshot>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()); }
  private accept(result: StorageReadReply) {
    this.committedValue = result.content;
    this.update({ loaded: true, value: result.content, revision: result.revision, exists: result.exists, dirty: false, editing: false, conflict: false, error: null, saved: false });
  }
  async load(force = false) {
    const version = ++this.readVersion;
    this.retryOperation = "read";
    try {
      const { result } = await this.store.call({ op: "storage.get", window_id: this.windowId, entry: this.entry.id });
      if (version !== this.readVersion || (!force && (this.state.dirty || this.state.editing || this.state.saving || this.state.conflict))) return;
      this.accept(result);
    } catch (error) { if (version === this.readVersion) this.update({ error: toCoreError(error) }); }
  }
  refresh() {
    if (this.state.dirty || this.state.editing || this.state.saving || this.state.conflict) { this.refreshPending = true; return Promise.resolve(); }
    this.refreshPending = false;
    return this.load();
  }
  beginEdit() { this.update({ editing: true }); }
  edit(value: JsonValue) { this.update({ value, dirty: !equal(value, this.committedValue), saved: false, error: null }); }
  cancel() {
    this.update({ value: this.committedValue, dirty: false, editing: false, error: null });
    if (this.refreshPending) void this.refresh();
  }
  finishEdit() {
    this.update({ editing: false });
    if (!this.state.dirty && this.refreshPending) return this.refresh();
    return this.save();
  }
  async save() {
    if (!this.state.loaded || this.state.conflict) return;
    if (this.running) return this.running;
    this.retryOperation = "write";
    this.running = this.saveLoop();
    try { await this.running; } finally { this.running = null; }
  }
  private async saveLoop() {
    while (this.state.dirty && !this.state.conflict) {
      const value = this.state.value;
      const revision = this.state.revision;
      this.update({ saving: true, error: null, saved: false });
      try {
        const result = await this.store.call({ op: "storage.write", window_id: this.windowId, entry: this.entry.id, content: value, expected_revision: revision });
        this.committedValue = value;
        this.update({ revision: result.revision, exists: true, dirty: !equal(this.state.value, value), saving: false, saved: true });
        clearTimeout(this.savedTimer);
        this.savedTimer = setTimeout(() => this.update({ saved: false }), 2000);
      } catch (error) {
        const reason = toCoreError(error);
        this.update({ saving: false, conflict: reason.code === "conflict", error: reason.code === "conflict" ? null : reason });
        return;
      }
    }
  }
  async reset() {
    if (!this.state.loaded || !this.state.exists || this.running) return;
    this.retryOperation = "reset";
    this.update({ saving: true, error: null, saved: false });
    try {
      await this.store.call({ op: "storage.reset", window_id: this.windowId, entry: this.entry.id, expected_revision: this.state.revision });
      this.committedValue = this.entry.default;
      this.update({ value: this.entry.default, revision: null, exists: false, dirty: false, editing: false, saving: false, conflict: false });
    } catch (error) {
      const reason = toCoreError(error);
      this.update({ saving: false, conflict: reason.code === "conflict", error: reason.code === "conflict" ? null : reason });
    }
  }
  async reload() { await this.load(true); }
  async overwrite() {
    try {
      const { result } = await this.store.call({ op: "storage.get", window_id: this.windowId, entry: this.entry.id });
      if (this.retryOperation === "reset" && !result.exists) { this.accept(result); return; }
      this.update({ revision: result.revision, exists: result.exists, conflict: false, error: null });
      if (this.retryOperation === "reset") await this.reset();
      else { this.update({ dirty: true }); await this.save(); }
    } catch (error) { this.update({ error: toCoreError(error) }); }
  }
  retry() { return this.retryOperation === "read" ? this.load(true) : this.retryOperation === "reset" ? this.reset() : this.save(); }
  dispose() { clearTimeout(this.savedTimer); }
}
