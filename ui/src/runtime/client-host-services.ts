import type { AppDefinition, ClientCapability } from "../contract/contract";
import { ClientFileRegistry } from "./client-file-registry";

type Client = NonNullable<AppDefinition["client"]>;
type HostWakeLockSentinel = { released: boolean; release(): Promise<void>; addEventListener(type: "release", listener: () => void): void };
type HostNavigator = Navigator & {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
  wakeLock?: { request(type: "screen"): Promise<HostWakeLockSentinel> };
};

export class ClientHostServices {
  private wakeLock: HostWakeLockSentinel | null = null;
  private wakeLockGeneration = 0;

  constructor(
    private client: Client,
    private files: ClientFileRegistry,
    private isVisible: () => boolean,
  ) {}

  hasCapability(capability: ClientCapability) {
    return this.client.capabilities?.includes(capability) === true;
  }

  private async hostFile(fileId: unknown): Promise<File | null> {
    if (typeof fileId !== "string" || typeof File === "undefined") return null;
    const info = this.files.get(fileId);
    if (!info) return null;
    try {
      const bytes = await this.files.read(fileId);
      return new File([bytes], info.name, { type: info.mime });
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
  }
}
