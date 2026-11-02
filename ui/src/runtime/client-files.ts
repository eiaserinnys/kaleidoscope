import type { FileAccept } from "../contract/contract";
import { CLIENT_PICK_FILE_MAX_BYTES } from "../contract/limits";
import * as shellErrors from "../contract/shell-errors";

const FILE_LIMIT = CLIENT_PICK_FILE_MAX_BYTES;
const BLOB_LIMIT = 64 * 1024 * 1024;
type Sink = { name: string; mime: string; stream?: FileSystemWritableFileStream; handle?: FileSystemFileHandle; bytes?: Uint8Array<ArrayBuffer>; retainOnClose?: boolean };
type PickerWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle> };

export class BrowserFiles {
  private files = new Map<string, File>();
  private sinks = new Map<string, Sink>();

  pick(accept: FileAccept[], multiple: boolean): Promise<{ cancelled: boolean; files: { id: string; name: string; size: number; mime: string }[] }> {
    const input = document.createElement("input");
    input.type = "file"; input.multiple = multiple;
    input.accept = accept.flatMap((item) => [item.mime, ...(item.extensions ?? []).map((extension) => extension.startsWith(".") ? extension : `.${extension}`)]).filter(Boolean).join(",");
    input.hidden = true; document.body.append(input);
    return new Promise((resolve, reject) => {
      input.addEventListener("cancel", () => { input.remove(); resolve({ cancelled: true, files: [] }); }, { once: true });
      input.addEventListener("change", () => {
        const selected = Array.from(input.files ?? []); input.remove();
        const oversized = selected.find((file) => file.size > FILE_LIMIT);
        if (oversized) { reject(shellErrors.SHELL_CLIENT_FILE_PICK_TOO_LARGE({ name: oversized.name, limit: "512MB" })); return; }
        const files = selected.map((file) => { const id = crypto.randomUUID(); this.files.set(id, file); return { id, name: file.name, size: file.size, mime: file.type || "application/octet-stream" }; });
        resolve({ cancelled: !files.length, files });
      }, { once: true });
      input.click();
    });
  }

  async read(id: string): Promise<ArrayBuffer> {
    const file = this.files.get(id);
    if (!file) throw { ...shellErrors.SHELL_CLIENT_FILE_NOT_FOUND(), details: [id] };
    if (file.size > FILE_LIMIT) throw shellErrors.SHELL_CLIENT_FILE_READ_TOO_LARGE({ name: file.name, limit: "512MB" });
    return file.arrayBuffer();
  }

  async save(name: string, mime: string, retainOnClose = false): Promise<{ cancelled: boolean; sink?: string }> {
    const picker = (window as PickerWindow).showSaveFilePicker;
    let stream: FileSystemWritableFileStream | undefined;
    let handle: FileSystemFileHandle | undefined;
    if (picker) {
      const extension = name.match(/\.[a-z0-9]{1,10}$/i)?.[0];
      const options = { suggestedName: name, ...(extension ? { types: [{ description: mime, accept: { [mime]: [extension] } }] } : {}) };
      try { handle = await picker(options); stream = await handle.createWritable(); }
      catch (error) { if (error instanceof DOMException && error.name === "AbortError") return { cancelled: true }; throw error; }
    }
    const id = crypto.randomUUID();
    this.sinks.set(id, { name, mime, stream, handle, bytes: stream ? undefined : new Uint8Array(0), retainOnClose });
    return { cancelled: false, sink: id };
  }

  savePrompt(name: string, mime: string) { return this.save(name, mime, true); }

  async write(id: string, offset: number, data: ArrayBuffer) {
    const sink = this.sinks.get(id);
    if (!sink) throw shellErrors.SHELL_CLIENT_FILE_WRITE_TARGET_MISSING();
    if (!Number.isSafeInteger(offset) || offset < 0) throw shellErrors.SHELL_CLIENT_FILE_WRITE_OFFSET_INVALID({ offset: String(offset) });
    if (sink.stream) { await sink.stream.write({ type: "write", position: offset, data }); return; }
    const previous = sink.bytes!;
    const end = offset + data.byteLength;
    if (end > BLOB_LIMIT) throw shellErrors.SHELL_CLIENT_FILE_WRITE_TOO_LARGE();
    if (end > previous.length) { sink.bytes = new Uint8Array(end); sink.bytes.set(previous); }
    sink.bytes!.set(new Uint8Array(data), offset);
  }

  async truncate(id: string, size: number) {
    const sink = this.sinks.get(id);
    if (!sink) throw shellErrors.SHELL_CLIENT_FILE_TRUNCATE_TARGET_MISSING();
    if (!Number.isSafeInteger(size) || size < 0) throw shellErrors.SHELL_CLIENT_FILE_TRUNCATE_SIZE_INVALID({ size: String(size) });
    if (sink.stream) { await sink.stream.truncate(size); return; }
    if (size > BLOB_LIMIT) throw shellErrors.SHELL_CLIENT_FILE_TRUNCATE_TOO_LARGE();
    const next = new Uint8Array(size);
    next.set(sink.bytes!.subarray(0, size));
    sink.bytes = next;
  }

  async close(id: string) {
    const sink = this.sinks.get(id); if (!sink) throw shellErrors.SHELL_CLIENT_FILE_CLOSE_TARGET_MISSING();
    if (sink.stream) await sink.stream.close();
    else {
      const url = URL.createObjectURL(new Blob([sink.bytes!], { type: sink.mime }));
      const link = document.createElement("a"); link.href = url; link.download = sink.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (sink.retainOnClose) {
      const file = sink.handle
        ? await sink.handle.getFile()
        : new File([sink.bytes!.slice().buffer], sink.name, { type: sink.mime });
      this.files.set(id, file);
    }
    this.sinks.delete(id);
  }

  async abort(id: string) {
    const sink = this.sinks.get(id); if (!sink) throw shellErrors.SHELL_CLIENT_FILE_ABORT_TARGET_MISSING();
    if (sink.stream) await sink.stream.abort();
    this.sinks.delete(id);
  }

  async dispose() { await Promise.all([...this.sinks.keys()].map((id) => this.abort(id))); this.files.clear(); }
}
