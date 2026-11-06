import type { ClientFile } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { BrowserFiles } from "./client-files";

type FileInfo = Pick<ClientFile, "id" | "name" | "mime">;
type FileSource = "browser" | "core";

export class ClientFileRegistry {
  private entries = new Map<string, { source: FileSource; name: string; mime: string }>();

  constructor(private store: ShellStore, private windowId: string, private files: BrowserFiles) {}

  register(file: FileInfo, source: FileSource) {
    this.entries.set(file.id, { source, name: file.name, mime: file.mime });
  }

  registerBrowserFile(file: File) {
    const info = { id: crypto.randomUUID(), name: file.name, size: file.size, mime: file.type || "application/octet-stream" };
    this.files.add(info.id, file);
    this.register(info, "browser");
    return info;
  }

  get(id: string) { return this.entries.get(id); }

  usesCore(id: string) {
    const source = this.get(id)?.source;
    return source === "core" || (source === undefined && this.store.nativeFiles === true);
  }

  read(id: string) {
    if (this.usesCore(id) && this.store.bytes) {
      return this.store.bytes({ op: "files.read_bytes", window_id: this.windowId, handle: id });
    }
    return this.files.read(id);
  }

  remove(id: string) { this.entries.delete(id); this.files.remove(id); }
  hasCoreFiles() { return [...this.entries.values()].some((entry) => entry.source === "core"); }
  clear() { this.entries.clear(); }
}
