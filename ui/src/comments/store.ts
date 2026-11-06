import type { AppCommentSummary, AppCommentThread, CoreError } from "../contract/contract";
import { toCoreError } from "../core/core-transport";
import type { ShellStore } from "../core/shell-store";

type State = { items: AppCommentSummary[]; nextCursor?: string; revision: number; loading: boolean; error: CoreError | null };
const stores = new WeakMap<ShellStore, Map<string, CommentStore>>();

export function appCommentStore(store: ShellStore, appId: string): CommentStore {
  let apps = stores.get(store);
  if (!apps) {
    apps = new Map(); stores.set(store, apps);
    const cached = apps;
    const server = () => { const link = store.getSnapshot()?.link; return link && "server_url" in link ? link.server_url : ""; };
    let previous = server();
    store.subscribe(() => {
      const next = server();
      if (next !== previous) { previous = next; cached.forEach((entry) => entry.reset()); }
    });
  }
  let current = apps.get(appId);
  if (!current) { current = new CommentStore(store, appId); apps.set(appId, current); }
  return current;
}

export class CommentStore {
  private value: State = { items: [], revision: -1, loading: false, error: null };
  private listeners = new Set<() => void>();
  private drafts = new Map<string, string>();
  private request = 0;
  constructor(private store: ShellStore, private appId: string) {}
  snapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(patch: Partial<State>) { this.value = { ...this.value, ...patch }; this.listeners.forEach((listener) => listener()); }
  reset() { this.request++; this.drafts.clear(); this.set({ items: [], nextCursor: undefined, revision: -1, loading: false, error: null }); }
  draft(id: string) { return this.drafts.get(id) ?? ""; }
  setDraft(id: string, value: string) { if (value) this.drafts.set(id, value); else this.drafts.delete(id); }
  async load(revision: number, force = false) {
    if (!force && (this.value.revision === revision || this.value.loading)) return;
    const request = ++this.request;
    this.set({ loading: true, error: null });
    try {
      const reply = await this.store.call({ op: "comment.list", app_id: this.appId });
      if (request === this.request) this.set({ items: reply.items, nextCursor: reply.next_cursor, revision: reply.app_revision, loading: false });
    } catch (error) { if (request === this.request) this.set({ loading: false, error: toCoreError(error) }); }
  }
  async more() {
    const cursor = this.value.nextCursor;
    if (!cursor || this.value.loading) return;
    const request = ++this.request;
    this.set({ loading: true, error: null });
    try {
      const reply = await this.store.call({ op: "comment.list", app_id: this.appId, cursor });
      if (request !== this.request) return;
      if (reply.app_revision !== this.value.revision) { await this.load(reply.app_revision, true); return; }
      const known = new Set(this.value.items.map((item) => item.id));
      this.set({ items: [...this.value.items, ...reply.items.filter((item) => !known.has(item.id))], nextCursor: reply.next_cursor, revision: reply.app_revision, loading: false });
    } catch (error) { if (request === this.request) this.set({ loading: false, error: toCoreError(error) }); }
  }
  async all(): Promise<AppCommentSummary[]> {
    const items: AppCommentSummary[] = []; let cursor: string | undefined;
    do {
      const reply = await this.store.call({ op: "comment.list", app_id: this.appId, ...(cursor ? { cursor } : {}) });
      items.push(...reply.items); cursor = reply.next_cursor;
    } while (cursor);
    return items;
  }
  async thread(id: string): Promise<AppCommentThread> {
    const reply = await this.store.call({ op: "comment.get", app_id: this.appId, id });
    return reply.thread;
  }
}
