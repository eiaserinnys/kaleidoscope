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

type Operation = { kind: "write"; value: JsonValue } | { kind: "reset"; editVersion: number };
const equal = (a: JsonValue, b: JsonValue) => JSON.stringify(a) === JSON.stringify(b);

export class SettingsEntrySession {
  private state: SettingsEntrySnapshot;
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private queue: Operation[] = [];
  private failed: Operation | null = null;
  private retryRead = true;
  private readVersion = 0;
  private editVersion = 0;
  private refreshPending = false;
  private savedTimer?: ReturnType<typeof setTimeout>;
  private committedValue: JsonValue;
  private confirmedValue: JsonValue;

  constructor(private store: ShellStore, private windowId: string, readonly entry: StorageEntryDecl) {
    this.committedValue = entry.default;
    this.confirmedValue = entry.default;
    this.state = { loaded: false, value: entry.default, revision: null, exists: false, dirty: false, editing: false, saving: false, saved: false, conflict: false, error: null };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<SettingsEntrySnapshot>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()); }
  private accept(result: StorageReadReply) {
    this.committedValue = result.content;
    this.confirmedValue = result.content;
    this.failed = null;
    this.queue = [];
    this.update({ loaded: true, value: result.content, revision: result.revision, exists: result.exists, dirty: false, editing: false, conflict: false, error: null, saved: false });
  }
  async load(force = false) {
    const version = ++this.readVersion;
    this.retryRead = true;
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
  edit(value: JsonValue) {
    if (!equal(value, this.state.value)) this.editVersion++;
    this.update({ value, dirty: !equal(value, this.committedValue), saved: false, error: null });
  }
  cancel() {
    this.editVersion++;
    this.update({ value: this.confirmedValue, dirty: !equal(this.confirmedValue, this.committedValue), editing: false, error: null });
    if (this.refreshPending) void this.refresh();
  }
  finishEdit() {
    this.update({ editing: false });
    if (!this.state.dirty && !this.running && this.refreshPending) return this.refresh();
    return this.save();
  }
  save() {
    if (!this.state.loaded || this.state.conflict) return Promise.resolve();
    if (!this.running && !this.state.dirty) return Promise.resolve();
    const operation: Operation = { kind: "write", value: this.state.value };
    this.confirmedValue = operation.value;
    // 아직 시작하지 않은 연속 쓰기는 마지막으로 확정한 값만 필요하다.
    if (this.queue.at(-1)?.kind === "write") this.queue[this.queue.length - 1] = operation;
    else this.queue.push(operation);
    return this.start();
  }
  reset() {
    if (!this.state.loaded || this.state.conflict || (!this.state.exists && !this.running)) return Promise.resolve();
    this.queue.push({ kind: "reset", editVersion: this.editVersion });
    return this.start();
  }
  private start(): Promise<void> {
    if (this.running) return this.running;
    this.retryRead = false;
    this.running = this.drain();
    return this.running;
  }
  private async drain() {
    try {
      while (this.queue.length && !this.state.conflict) {
        const operation = this.queue.shift()!;
        const revision = this.state.revision;
        this.update({ saving: true, error: null, saved: false });
        try {
          if (operation.kind === "write") {
            const result = await this.store.call({ op: "storage.write", window_id: this.windowId, entry: this.entry.id, content: operation.value, expected_revision: revision });
            this.committedValue = operation.value;
            const dirty = !equal(this.state.value, operation.value);
            this.update({ revision: result.revision, exists: true, dirty, saved: !dirty && !this.queue.length });
          } else {
            await this.store.call({ op: "storage.reset", window_id: this.windowId, entry: this.entry.id, expected_revision: revision });
            this.committedValue = this.entry.default;
            if (!this.queue.some((item) => item.kind === "write")) this.confirmedValue = this.entry.default;
            const value = this.editVersion === operation.editVersion ? this.entry.default : this.state.value;
            this.update({ value, revision: null, exists: false, dirty: !equal(value, this.entry.default), conflict: false });
          }
          this.failed = null;
          if (this.state.saved) {
            clearTimeout(this.savedTimer);
            this.savedTimer = setTimeout(() => this.update({ saved: false }), 2000);
          }
        } catch (error) {
          const reason = toCoreError(error);
          this.failed = operation;
          this.update({ conflict: reason.code === "conflict", error: reason.code === "conflict" ? null : reason });
          break;
        }
      }
    } finally {
      this.running = null;
      this.update({ saving: false });
    }
  }
  async reload() { await this.load(true); }
  async overwrite() {
    try {
      const { result } = await this.store.call({ op: "storage.get", window_id: this.windowId, entry: this.entry.id });
      this.update({ revision: result.revision, exists: result.exists, conflict: false, error: null });
      if (this.failed?.kind === "reset") { this.queue.unshift(this.failed); await this.start(); }
      else { this.queue = []; this.update({ dirty: true }); await this.save(); }
    } catch (error) { this.update({ error: toCoreError(error) }); }
  }
  retry() {
    if (this.state.conflict) return this.overwrite();
    if (this.retryRead || !this.failed) return this.load(true);
    const operation = this.failed;
    this.queue.unshift(operation);
    return this.start();
  }
  dispose() { clearTimeout(this.savedTimer); }
}
