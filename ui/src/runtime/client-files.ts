import type { FileAccept } from "../contract/contract";
import { CLIENT_PICK_FILE_MAX_BYTES } from "../contract/limits";

const FILE_LIMIT = CLIENT_PICK_FILE_MAX_BYTES;
const BLOB_LIMIT = 64 * 1024 * 1024;
type Sink = { name: string; mime: string; stream?: FileSystemWritableFileStream; bytes?: Uint8Array<ArrayBuffer> };
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
        if (selected.some((file) => file.size > FILE_LIMIT)) { reject(new Error("고른 파일이 너무 큽니다")); return; }
        const files = selected.map((file) => { const id = crypto.randomUUID(); this.files.set(id, file); return { id, name: file.name, size: file.size, mime: file.type || "application/octet-stream" }; });
        resolve({ cancelled: !files.length, files });
      }, { once: true });
      input.click();
    });
  }

  async read(id: string): Promise<ArrayBuffer> {
    const file = this.files.get(id);
    if (!file) throw new Error("고른 파일을 찾을 수 없습니다");
    if (file.size > FILE_LIMIT) throw new Error("고른 파일이 너무 큽니다");
    return file.arrayBuffer();
  }

  async save(name: string, mime: string): Promise<{ cancelled: boolean; sink?: string }> {
    const picker = (window as PickerWindow).showSaveFilePicker;
    let stream: FileSystemWritableFileStream | undefined;
    if (picker) {
      const extension = name.match(/\.[a-z0-9]{1,10}$/i)?.[0];
      const options = { suggestedName: name, ...(extension ? { types: [{ description: mime, accept: { [mime]: [extension] } }] } : {}) };
      try { stream = await (await picker(options)).createWritable(); }
      catch (error) { if (error instanceof DOMException && error.name === "AbortError") return { cancelled: true }; throw error; }
    }
    const id = crypto.randomUUID();
    this.sinks.set(id, { name, mime, stream, bytes: stream ? undefined : new Uint8Array(0) });
    return { cancelled: false, sink: id };
  }

  async write(id: string, offset: number, data: ArrayBuffer) {
    const sink = this.sinks.get(id);
    if (!sink || !Number.isSafeInteger(offset) || offset < 0) throw new Error("출력 대상을 찾을 수 없습니다");
    if (sink.stream) { await sink.stream.write({ type: "write", position: offset, data }); return; }
    const previous = sink.bytes!;
    const end = offset + data.byteLength;
    if (end > BLOB_LIMIT) throw new Error("이 브라우저는 64MiB보다 큰 파일을 저장할 수 없습니다");
    if (end > previous.length) { sink.bytes = new Uint8Array(end); sink.bytes.set(previous); }
    sink.bytes!.set(new Uint8Array(data), offset);
  }

  async close(id: string) {
    const sink = this.sinks.get(id); if (!sink) throw new Error("출력 대상을 찾을 수 없습니다");
    if (sink.stream) await sink.stream.close();
    else {
      const url = URL.createObjectURL(new Blob([sink.bytes!], { type: sink.mime }));
      const link = document.createElement("a"); link.href = url; link.download = sink.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    this.sinks.delete(id);
  }

  async abort(id: string) {
    const sink = this.sinks.get(id); if (!sink) throw new Error("출력 대상을 찾을 수 없습니다");
    if (sink.stream) await sink.stream.abort();
    this.sinks.delete(id);
  }

  async dispose() { await Promise.all([...this.sinks.keys()].map((id) => this.abort(id))); this.files.clear(); }
}
