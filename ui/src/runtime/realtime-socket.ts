import type { CoreError } from "../contract/contract";

type Opened = { handle: string; protocol: string };
type RealtimeBridge = {
  open(permission: string, path: string, protocols: string[]): { result: Promise<Opened>; cancel(): void };
  send(handle: string, data: string | ArrayBuffer): Promise<unknown>;
  close(handle: string, code?: number, reason?: string): Promise<unknown>;
  login(permission: string): Promise<unknown>;
};
type Errors = { urlInvalid: CoreError; sendTypeInvalid: CoreError; sendConnecting: CoreError; binaryTypeUnsupported: CoreError; protocolInvalid: CoreError; queueFull: CoreError; messageTooLarge: CoreError; closeInvalid?: CoreError };
type FrameEvent = { handle: string; event: "message" | "close" | "error"; data?: string | ArrayBuffer; code?: number; reason?: string; wasClean?: boolean; error?: CoreError };
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_COUNT = 256;
const encoder = new TextEncoder();

function problem(error: CoreError, name: string): DOMException {
  const exception = new DOMException(error.message, name);
  Object.defineProperty(exception, "id", { value: error.id });
  return exception;
}

export function createRealtime(bridge: RealtimeBridge, errors: Errors, names: Record<string, string> = {}) {
  const sockets = new Map<string, Socket>();
  class Socket extends EventTarget {
    static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSING = 2; static readonly CLOSED = 3;
    readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSING = 2; readonly CLOSED = 3;
    readyState = 0; protocol = ""; readonly extensions = ""; bufferedAmount = 0;
    readonly url: string;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    private handle = "";
    private cancel: () => void;
    private writes: Array<{ data: string | ArrayBuffer; size: number }> = [];
    private writing = false;
    private pendingClose?: { code?: number; reason?: string };

    constructor(private permission: string, address: string | URL, protocols?: string | string[]) {
      super();
      const value = String(address);
      let path: string;
      try {
        const parsed = new URL(value, "wss://kaleidoscope.invalid");
        if ((!value.startsWith("/") && !value.startsWith("wss://kaleidoscope.invalid/")) || value.startsWith("//") || parsed.origin !== "wss://kaleidoscope.invalid" || parsed.search || parsed.hash || parsed.username || parsed.password) throw problem(errors.urlInvalid, "SyntaxError");
        path = parsed.pathname;
        this.url = parsed.href;
      } catch {
        const safePath = value.replace(/[?#].*$/, "").replace(/^(wss?:\/\/)[^/@]*@/i, "$1");
        throw problem({ ...errors.urlInvalid, message: errors.urlInvalid.message.replace("__PATH__", safePath) }, "SyntaxError");
      }
      const requested = protocols === undefined ? [] : typeof protocols === "string" ? [protocols] : protocols;
      if (!Array.isArray(requested) || new Set(requested).size !== requested.length || requested.some((v) => typeof v !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(v))) throw problem(errors.protocolInvalid, "SyntaxError");
      const pending = bridge.open(permission, path, requested);
      this.cancel = pending.cancel;
      void pending.result.then(({ handle, protocol }) => {
        if (this.readyState !== this.CONNECTING) return;
        this.handle = handle; this.protocol = protocol; sockets.set(handle, this); this.readyState = this.OPEN;
        this.emit(new Event("open"));
      }).catch((error: CoreError) => {
        if (this.readyState !== this.CONNECTING) return;
        this.readyState = this.CLOSED;
        this.emitError(error);
        this.emitClose(1006, "", false, error);
      });
    }
    get binaryType(): BinaryType { return "arraybuffer"; }
    set binaryType(value: BinaryType) { if (value !== "arraybuffer") throw problem(errors.binaryTypeUnsupported, "NotSupportedError"); }
    private emit(event: Event) {
      this.dispatchEvent(event);
      const handler = event.type === "open" ? this.onopen : event.type === "message" ? this.onmessage : event.type === "close" ? this.onclose : this.onerror;
      if (handler) {
        try { (handler as (event: Event) => void).call(this, event); }
        catch (error) { if (typeof globalThis.reportError === "function") globalThis.reportError(error); else console.error(error); }
      }
    }
    private emitError(error: CoreError) {
      const event = new Event("error");
      const retry = error.details?.map((detail) => /^retry_after_secs=(\d+)$/.exec(detail)).find(Boolean);
      Object.assign(event, { error: { id: error.id, code: error.code, message: error.message.replace("__NAME__", names[this.permission] ?? this.permission), details: error.details, permission: this.permission, ...(retry ? { retry_after_secs: Number(retry[1]) } : {}) } });
      this.emit(event);
    }
    private emitClose(code: number, reason: string, wasClean: boolean, error?: CoreError) {
      const event = new CloseEvent("close", { code, reason, wasClean });
      if (error) Object.assign(event, { error });
      this.emit(event);
    }
    receive(event: FrameEvent) {
      if (this.readyState === this.CLOSED) return;
      if (event.event === "message") { if (this.readyState === this.OPEN || this.readyState === this.CLOSING) this.emit(new MessageEvent("message", { data: event.data })); return; }
      if (event.event === "error") { if (event.error) this.emitError(event.error); return; }
      this.readyState = this.CLOSED; sockets.delete(this.handle);
      if (event.error) this.emitError(event.error);
      this.emitClose(event.code ?? 1006, event.reason ?? "", event.wasClean ?? false, event.error);
    }
    private drain() {
      if (this.writing) return;
      const item = this.writes.shift();
      if (!item) {
        if (this.pendingClose) { const close = this.pendingClose; this.pendingClose = undefined; void bridge.close(this.handle, close.code, close.reason); }
        return;
      }
      this.writing = true;
      void bridge.send(this.handle, item.data).then(() => {
        this.bufferedAmount -= item.size; this.writing = false; this.drain();
      }).catch((error: CoreError) => {
        this.bufferedAmount -= item.size; this.writing = false; this.writes = [];
        if (this.readyState !== this.CLOSED) { this.readyState = this.CLOSED; sockets.delete(this.handle); this.emitError(error); this.emitClose(error.id === "CONN_REALTIME_MESSAGE_TOO_LARGE" ? 1009 : error.id === "CONN_REALTIME_SEND_QUEUE_FULL" ? 1013 : 1006, "", false, error); }
      });
    }
    send(value: string | ArrayBuffer | ArrayBufferView) {
      if (this.readyState === this.CONNECTING) throw problem(errors.sendConnecting, "InvalidStateError");
      if (this.readyState !== this.OPEN) return;
      let size: number;
      if (typeof value === "string") size = value.length > MAX_BYTES ? MAX_BYTES + 1 : encoder.encode(value).byteLength;
      else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) size = value.byteLength;
      else throw problem(errors.sendTypeInvalid, "TypeError");
      if (size > MAX_BYTES || this.bufferedAmount + size > MAX_BYTES || this.writes.length + Number(this.writing) >= MAX_COUNT) {
        const template = size > MAX_BYTES ? errors.messageTooLarge : errors.queueFull;
        const error = { ...template, message: template.message.replace("__NAME__", names[this.permission] ?? this.permission) };
        this.readyState = this.CLOSED; sockets.delete(this.handle); this.writes = [];
        this.emitError(error); this.emitClose(size > MAX_BYTES ? 1009 : 1013, "", false, error);
        void bridge.close(this.handle);
        return;
      }
      const data = typeof value === "string" ? value : value instanceof ArrayBuffer ? value.slice(0) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer;
      this.bufferedAmount += size; this.writes.push({ data, size }); this.drain();
    }
    close(code?: number, reason?: string) {
      if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999) || reason !== undefined && encoder.encode(reason).byteLength > 123) throw problem(errors.closeInvalid ?? errors.protocolInvalid, "InvalidAccessError");
      if (this.readyState === this.CONNECTING) { this.readyState = this.CLOSED; this.cancel(); this.emitClose(1006, "", false); return; }
      if (this.readyState !== this.OPEN) return;
      this.readyState = this.CLOSING; this.pendingClose = { code, reason }; this.drain();
    }
  }
  return {
    webSocketConstructor(permission: string) {
      return class BoundSocket extends Socket { constructor(address: string | URL, protocols?: string | string[]) { super(permission, address, protocols); } };
    },
    login: (permission: string) => bridge.login(permission),
    event(event: FrameEvent) { sockets.get(event.handle)?.receive(event); },
  };
}

(globalThis as typeof globalThis & { __ksCreateRealtime?: typeof createRealtime }).__ksCreateRealtime = createRealtime;
