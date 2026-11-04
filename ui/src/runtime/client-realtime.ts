import type { CoreError, CoreEvent } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { toCoreError } from "../core/core-transport";
import * as errors from "../contract/shell-errors";

type Send = (message: object, transfer?: Transferable[]) => void;
type Reply = (id: string, result?: unknown, error?: CoreError) => void;
type Handle = { after: number; reading: boolean; again: boolean; awaiting: number | null; terminal: boolean; writes: Promise<void> };

export class ClientRealtime {
  private session = "";
  private stopped = false;
  private opening = new Map<string, { cancelled: boolean }>();
  private handles = new Map<string, Handle>();
  private earlyClosed = new Map<string, Extract<CoreEvent, { event: "connection.realtime.closed" }>>();

  constructor(private store: ShellStore, private windowId: string, private permissions: string[], private send: Send, private reply: Reply) {}

  get sessionId() { return this.session; }

  async start() {
    if (!this.store.bytes) throw errors.SHELL_REALTIME_NATIVE_CORE_REQUIRED();
    const result = await this.store.call({ op: "connection.realtime.session", window_id: this.windowId });
    this.session = result.session;
    if (this.stopped) await this.store.call({ op: "connection.realtime.release", window_id: this.windowId, session: this.session });
  }

  async request(requestId: string, method: string, params: any) {
    if (method === "close" && !params.handle) {
      const pending = this.opening.get(requestId);
      if (pending) pending.cancelled = true;
      return;
    }
    try {
      if (method === "open") {
        if (!this.permissions.includes(params.permission)) throw errors.CONN_REALTIME_CLIENT_PERMISSION_MISSING({ permission: String(params.permission) });
        const attempt = { cancelled: false }; this.opening.set(requestId, attempt);
        try {
          const result = await this.store.call({ op: "connection.realtime.open", window_id: this.windowId, session: this.session, permission: params.permission, kind: "websocket", path: params.path, protocols: params.protocols });
          if (attempt.cancelled || this.stopped) {
            this.earlyClosed.delete(result.handle);
            await this.store.call({ op: "connection.realtime.close", window_id: this.windowId, session: this.session, handle: result.handle }).catch(() => undefined);
            return;
          }
          this.handles.set(result.handle, { after: 0, reading: false, again: false, awaiting: null, terminal: false, writes: Promise.resolve() });
          this.reply(requestId, { handle: result.handle, protocol: result.protocol ?? "" });
          const closed = this.earlyClosed.get(result.handle);
          if (closed) { this.earlyClosed.delete(result.handle); this.closed(closed); }
          else void this.pump(result.handle);
        } catch (error) { if (!attempt.cancelled && !this.stopped) throw error; }
        finally { this.opening.delete(requestId); if (!this.opening.size) this.earlyClosed.clear(); }
        return;
      }
      if (method === "login") {
        if (!this.permissions.includes(params.permission)) throw errors.CONN_REALTIME_CLIENT_PERMISSION_MISSING({ permission: String(params.permission) });
        await this.store.call({ op: "connection.login", window_id: this.windowId, permission: params.permission });
        this.reply(requestId, null); return;
      }
      const state = this.handles.get(params.handle);
      if (!state) return;
      if (method === "send") {
        const payload = typeof params.data === "string" ? new TextEncoder().encode(params.data) : new Uint8Array(params.data as ArrayBuffer);
        const metadata = new TextEncoder().encode(JSON.stringify({ session: this.session, kind: typeof params.data === "string" ? "text" : "binary" }));
        const packet = new Uint8Array(4 + metadata.length + payload.length);
        new DataView(packet.buffer).setUint32(0, metadata.length); packet.set(metadata, 4); packet.set(payload, 4 + metadata.length);
        const write = state.writes.then(async () => { await this.store.bytes!({ op: "connection.realtime.send", window_id: this.windowId, handle: params.handle }, packet.buffer); });
        state.writes = write.catch(() => undefined);
        await write;
        this.reply(requestId, null); return;
      }
      if (method === "close") {
        const close = state.writes.then(async () => { await this.store.call({ op: "connection.realtime.close", window_id: this.windowId, session: this.session, handle: params.handle, code: params.code, reason: params.reason }); });
        state.writes = close.catch(() => undefined);
        await close;
        this.reply(requestId, null);
      }
    } catch (error) {
      this.reply(requestId, undefined, toCoreError(error));
    }
  }

  event(event: CoreEvent) {
    if ((event.event !== "connection.realtime.ready" && event.event !== "connection.realtime.closed") || event.window_id !== this.windowId || event.session !== this.session) return;
    if (event.event === "connection.realtime.closed") this.closed(event);
    else if (this.handles.has(event.handle)) void this.pump(event.handle);
  }

  private closed(event: Extract<CoreEvent, { event: "connection.realtime.closed" }>) {
    if (!this.handles.has(event.handle)) { if (this.opening.size) this.earlyClosed.set(event.handle, event); return; }
    this.handles.delete(event.handle);
    this.send({ type: "ks-realtime-event", session: this.session, handle: event.handle, event: "close", code: event.code, reason: event.reason, wasClean: false, error: event.error });
  }

  private async pump(handle: string) {
    const state = this.handles.get(handle);
    if (!state || state.awaiting !== null || this.stopped) return;
    if (state.reading) { state.again = true; return; }
    state.reading = true;
    try {
      const body = new TextEncoder().encode(JSON.stringify({ session: this.session, after: state.after })).buffer;
      const packet = await this.store.bytes!({ op: "connection.realtime.read", window_id: this.windowId, handle }, body);
      if (this.handles.get(handle) !== state) return;
      const length = new DataView(packet).getUint32(0);
      const metadata = JSON.parse(new TextDecoder().decode(packet.slice(4, 4 + length)));
      if (metadata.session !== this.session || metadata.kind === "empty") return;
      state.awaiting = metadata.sequence; state.terminal = metadata.kind === "terminal";
      if (metadata.kind === "terminal") this.send({ type: "ks-realtime-event", session: this.session, handle, sequence: metadata.sequence, event: "close", code: metadata.terminal.code, reason: metadata.terminal.reason, wasClean: metadata.terminal.was_clean, error: metadata.terminal.error });
      else if (metadata.kind === "text") this.send({ type: "ks-realtime-event", session: this.session, handle, sequence: metadata.sequence, event: "message", data: new TextDecoder().decode(packet.slice(4 + length)) });
      else { const data = packet.slice(4 + length); this.send({ type: "ks-realtime-event", session: this.session, handle, sequence: metadata.sequence, event: "message", data }, [data]); }
    } catch (error) {
      const problem = toCoreError(error);
      if (this.handles.get(handle) === state && problem.id !== "CONN_REALTIME_HANDLE_MISSING" && problem.id !== "CONN_REALTIME_SESSION_STALE") {
        this.handles.delete(handle);
        this.send({ type: "ks-realtime-event", session: this.session, handle, event: "close", code: 1006, reason: "", wasClean: false, error: problem });
      }
    } finally {
      state.reading = false;
      if (state.again && state.awaiting === null) { state.again = false; void this.pump(handle); }
    }
  }

  async delivered(handle: string, sequence: number) {
    const state = this.handles.get(handle);
    if (!state || state.awaiting !== sequence) return;
    try {
      await this.store.call({ op: "connection.realtime.ack", window_id: this.windowId, session: this.session, handle, through: sequence });
    } catch (error) {
      const problem = toCoreError(error);
      if (problem.id === "CONN_REALTIME_HANDLE_MISSING" || problem.id === "CONN_REALTIME_SESSION_STALE") return;
      throw error;
    }
    state.after = sequence; state.awaiting = null;
    if (state.terminal) this.handles.delete(handle); else void this.pump(handle);
  }

  async stop() {
    this.stopped = true;
    this.handles.clear(); this.earlyClosed.clear();
    if (this.session) await this.store.call({ op: "connection.realtime.release", window_id: this.windowId, session: this.session });
  }
}
