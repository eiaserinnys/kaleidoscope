import type { AppDefinition, ClientCapability, ClientFile } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { BrowserFiles } from "./client-files";

type Client = NonNullable<AppDefinition["client"]>;
type HostWakeLockSentinel = { released: boolean; release(): Promise<void>; addEventListener(type: "release", listener: () => void): void };
type HostNavigator = Navigator & {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
  wakeLock?: { request(type: "screen"): Promise<HostWakeLockSentinel> };
};
type ClientFileInfo = Pick<ClientFile, "name" | "mime">;

export class ClientHostServices {
  private filesById = new Map<string, ClientFileInfo>();
  private wakeLock: HostWakeLockSentinel | null = null;
  private wakeLockGeneration = 0;

  constructor(
    private client: Client,
    private store: ShellStore,
    private windowId: string,
    private files: BrowserFiles,
    private isVisible: () => boolean,
  ) {}

  hasCapability(capability: ClientCapability) {
    return this.client.capabilities?.includes(capability) === true;
  }

  registerFile(file: Pick<ClientFile, "id" | "name" | "mime">) {
    this.filesById.set(file.id, { name: file.name, mime: file.mime });
  }

  removeFile(fileId: string) {
    this.filesById.delete(fileId);
  }

  private async hostFile(fileId: unknown): Promise<File | null> {
    if (typeof fileId !== "string" || typeof File === "undefined") return null;
    const info = this.filesById.get(fileId);
    if (!info) return null;
    try {
      const bytes = this.store.nativeFiles
        ? this.store.bytes ? await this.store.bytes({ op: "files.read_bytes", window_id: this.windowId, handle: fileId }) : null
        : await this.files.read(fileId);
      return bytes === null ? null : new File([bytes], info.name, { type: info.mime });
    } catch { return null; }
  }

  async canShare(fileId: unknown) {
    const hostNavigator = window.navigator as HostNavigator;
    if (typeof hostNavigator.canShare !== "function" || typeof hostNavigator.share !== "function") return false;
    const file = await this.hostFile(fileId);
    if (!file) return false;
    try { return hostNavigator.canShare({ files: [file] }); }
    catch { return false; }
  }

  async share(fileId: unknown, title: unknown): Promise<{ status: "shared" | "cancelled" | "failed" }> {
    const hostNavigator = window.navigator as HostNavigator;
    if (typeof hostNavigator.share !== "function") return { status: "failed" };
    const file = await this.hostFile(fileId);
    if (!file) return { status: "failed" };
    try {
      if (typeof hostNavigator.canShare === "function" && !hostNavigator.canShare({ files: [file] })) return { status: "failed" };
      await hostNavigator.share({ files: [file], ...(typeof title === "string" ? { title } : {}) });
      return { status: "shared" };
    } catch (error) {
      return { status: error instanceof DOMException && error.name === "AbortError" ? "cancelled" : "failed" };
    }
  }

  async keepAwake(enabled: boolean) {
    const wakeLock = (window.navigator as HostNavigator).wakeLock;
    if (!wakeLock) {
      if (!enabled) this.releaseWakeLock();
      return false;
    }
    if (!enabled) {
      this.releaseWakeLock();
      return true;
    }
    if (!this.isVisible()) return false;
    if (this.wakeLock && !this.wakeLock.released) return true;
    const generation = ++this.wakeLockGeneration;
    try {
      const sentinel = await wakeLock.request("screen");
      if (generation !== this.wakeLockGeneration || !this.isVisible()) {
        await sentinel.release().catch(() => undefined);
        return false;
      }
      this.wakeLock = sentinel;
      sentinel.addEventListener("release", () => {
        if (this.wakeLock === sentinel) this.wakeLock = null;
      });
      return true;
    } catch { return false; }
  }

  releaseWakeLock() {
    this.wakeLockGeneration += 1;
    const sentinel = this.wakeLock;
    this.wakeLock = null;
    if (sentinel && !sentinel.released) void sentinel.release().catch(() => undefined);
  }

  dispose() {
    this.releaseWakeLock();
    this.filesById.clear();
  }
}
