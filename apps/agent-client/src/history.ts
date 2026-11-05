import type { Item } from "./reducer.ts";
import { agentError } from "./errors.ts";

export interface BlobStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array | null>;
  remove?(key: string): Promise<void>;
}

type Manifest = { pages: number; sessionId: string | null; controls: Record<string, string | boolean>; identity: string | null; cwd: string | null };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const manifestKey = "record/manifest.json";
const pageKey = (index: number) => `record/page-${index}.json`;
const pageSize = 100;
const comparableCwd = (cwd: string | null): string | null => {
  if (cwd?.startsWith("\\\\?\\UNC\\")) return "\\\\" + cwd.slice(8);
  if (cwd?.startsWith("\\\\?\\")) return cwd.slice(4);
  return cwd;
};

/** Window-scoped pages avoid rewriting the entire conversation on every completed message. */
export class History {
  private manifest: Manifest = { pages: 0, sessionId: null, controls: {}, identity: null, cwd: null };
  private pages: Item[][] = [];
  private cachedItems: Item[] | null = null;
  private readonly blobs: BlobStore;
  constructor(blobs: BlobStore) { this.blobs = blobs; }

  async load(): Promise<void> {
    const bytes = await this.blobs.read(manifestKey);
    if (!bytes) return;
    this.manifest = JSON.parse(decoder.decode(bytes)) as Manifest;
    this.pages = [];
    this.cachedItems = null;
    for (let index = 0; index < this.manifest.pages; index++) {
      const page = await this.blobs.read(pageKey(index));
      if (!page) throw agentError("AGENT_RECORD_PAGE_NOT_FOUND", String(index));
      this.pages.push(JSON.parse(decoder.decode(page)) as Item[]);
    }
  }

  get items(): Item[] { return this.cachedItems ??= this.pages.flat(); }
  get sessionId(): string | null { return this.manifest.sessionId; }
  get controls(): Record<string, string | boolean> { return { ...this.manifest.controls }; }

  async bind(identity: string, cwd: string): Promise<void> {
    if (this.manifest.identity !== null && (this.manifest.identity !== identity || comparableCwd(this.manifest.cwd) !== comparableCwd(cwd))) {
      this.manifest = { pages: 0, sessionId: null, controls: {}, identity, cwd };
      this.pages = [];
      this.cachedItems = null;
    } else {
      this.manifest.identity = identity;
      this.manifest.cwd = cwd;
    }
    await this.writeManifest();
  }

  async setSession(sessionId: string | null): Promise<void> {
    this.manifest.sessionId = sessionId;
    await this.writeManifest();
  }

  async replace(sessionId: string, items: Item[]): Promise<void> {
    this.manifest = { ...this.manifest, pages: 0, sessionId, controls: {} };
    this.pages = [];
    this.cachedItems = null;
    await this.writeManifest();
    await this.append(items);
  }

  async setControl(id: string, value: string | boolean): Promise<void> {
    this.manifest.controls[id] = value;
    await this.writeManifest();
  }

  async append(items: Item[]): Promise<void> {
    for (const item of items) {
      let index = this.pages.findIndex((page) => page.some((old) => old.id === item.id));
      if (index < 0) {
        index = this.pages.length - 1;
        if (index < 0 || this.pages[index].length >= pageSize) {
          index++;
          this.pages.push([]);
        }
      }
      const page = this.pages[index];
      const position = page.findIndex((old) => old.id === item.id);
      if (position < 0) page.push(item); else page[position] = item;
      this.cachedItems = null;
      await this.blobs.put(pageKey(index), encoder.encode(JSON.stringify(page)));
      if (index >= this.manifest.pages) {
        this.manifest.pages = index + 1;
        await this.writeManifest();
      }
    }
  }

  private async writeManifest(): Promise<void> {
    await this.blobs.put(manifestKey, encoder.encode(JSON.stringify(this.manifest)));
  }
}
