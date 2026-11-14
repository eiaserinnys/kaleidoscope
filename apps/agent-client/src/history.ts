import type { Item } from "./reducer.ts";
import { agentError } from "./errors.ts";

export interface BlobStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array | null>;
  remove?(key: string): Promise<void>;
}

/** 세션 하나의 기록. ns는 페이지 파일을 두는 이름 공간이고, 빈 문자열은 예전 판의 record/page-N.json 자리다. */
type SessionRecord = { ns: string; pages: number; controls: Record<string, string | boolean> };
/**
 * 창 하나의 기록 목록. foreground는 화면에 보이는 세션, held는 프로세스가 들고 있는 세션이다.
 * 세션이 정해지기 전의 기록은 빈 문자열 열쇠에 둔다.
 */
type Manifest = { version: 2; identity: string | null; cwd: string | null; foreground: string | null; held: string[]; next: number; sessions: Record<string, SessionRecord> };
type LegacyManifest = { pages: number; sessionId: string | null; controls: Record<string, string | boolean>; identity: string | null; cwd: string | null };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const manifestKey = "record/manifest.json";
const pageKey = (ns: string, index: number) => ns ? `record/${ns}/page-${index}.json` : `record/page-${index}.json`;
const pageSize = 100;
const keyOf = (sessionId: string | null | undefined) => sessionId ?? "";
const empty = (): Manifest => ({ version: 2, identity: null, cwd: null, foreground: null, held: [], next: 1, sessions: {} });
const comparableCwd = (cwd: string | null): string | null => {
  if (cwd?.startsWith("\\\\?\\UNC\\")) return "\\\\" + cwd.slice(8);
  if (cwd?.startsWith("\\\\?\\")) return cwd.slice(4);
  return cwd;
};

/** Window-scoped pages avoid rewriting the entire conversation on every completed message. */
export class History {
  private manifest: Manifest = empty();
  private pages = new Map<string, Item[][]>();
  private cachedItems = new Map<string, Item[]>();
  private readonly blobs: BlobStore;
  constructor(blobs: BlobStore) { this.blobs = blobs; }

  async load(): Promise<void> {
    const bytes = await this.blobs.read(manifestKey);
    if (!bytes) return;
    const raw = JSON.parse(decoder.decode(bytes)) as Manifest | LegacyManifest;
    this.manifest = "version" in raw && raw.version === 2 ? raw : {
      ...empty(), identity: raw.identity, cwd: raw.cwd, foreground: (raw as LegacyManifest).sessionId,
      sessions: { [keyOf((raw as LegacyManifest).sessionId)]: { ns: "", pages: (raw as LegacyManifest).pages, controls: (raw as LegacyManifest).controls ?? {} } },
    };
    this.pages.clear();
    this.cachedItems.clear();
    for (const [key, record] of Object.entries(this.manifest.sessions)) {
      const pages: Item[][] = [];
      for (let index = 0; index < record.pages; index++) {
        const page = await this.blobs.read(pageKey(record.ns, index));
        if (!page) throw agentError("AGENT_RECORD_PAGE_NOT_FOUND", String(index));
        pages.push(JSON.parse(decoder.decode(page)) as Item[]);
      }
      this.pages.set(key, pages);
    }
  }

  /** 전경 세션의 기록. */
  get items(): Item[] { return this.itemsOf(this.manifest.foreground); }
  itemsOf(sessionId: string | null): Item[] {
    const key = keyOf(sessionId);
    let items = this.cachedItems.get(key);
    if (!items) { items = (this.pages.get(key) ?? []).flat(); this.cachedItems.set(key, items); }
    return items;
  }
  get sessionId(): string | null { return this.manifest.foreground; }
  get held(): string[] { return [...this.manifest.held]; }
  get controls(): Record<string, string | boolean> { return this.controlsOf(this.manifest.foreground); }
  controlsOf(sessionId: string | null): Record<string, string | boolean> { return { ...(this.manifest.sessions[keyOf(sessionId)]?.controls ?? {}) }; }

  async bind(identity: string, cwd: string): Promise<void> {
    if (this.manifest.identity !== null && (this.manifest.identity !== identity || comparableCwd(this.manifest.cwd) !== comparableCwd(cwd))) {
      this.manifest = { ...empty(), identity, cwd };
      this.pages.clear();
      this.cachedItems.clear();
    } else {
      this.manifest.identity = identity;
      this.manifest.cwd = cwd;
    }
    await this.writeManifest();
  }

  /** 화면에 보이는 세션만 바꾼다. 기록은 세션마다 따로 남는다. */
  async setForeground(sessionId: string | null): Promise<void> {
    if (this.manifest.foreground === sessionId) return;
    this.manifest.foreground = sessionId;
    await this.writeManifest();
  }

  /** 전경 기록을 다른 세션 id로 넘긴다. 앞 세션을 이어받지 못해 새로 연 세션이 앞 기록을 그대로 잇는다. */
  async setSession(sessionId: string | null): Promise<void> {
    const from = keyOf(this.manifest.foreground), to = keyOf(sessionId);
    if (from !== to && this.manifest.sessions[from]) {
      await this.drop(to);
      this.manifest.sessions[to] = this.manifest.sessions[from];
      delete this.manifest.sessions[from];
      this.pages.set(to, this.pages.get(from) ?? []);
      this.pages.delete(from);
      this.cachedItems.delete(from);
      this.cachedItems.delete(to);
    }
    this.manifest.foreground = sessionId;
    await this.writeManifest();
  }

  /** 세션의 기록을 새로 채우고 전경으로 삼는다. */
  async replace(sessionId: string, items: Item[]): Promise<void> {
    const key = keyOf(sessionId);
    const ns = this.manifest.sessions[key]?.ns ?? `s${this.manifest.next++}`;
    this.manifest.sessions[key] = { ns, pages: 0, controls: {} };
    this.manifest.foreground = sessionId;
    this.pages.set(key, []);
    this.cachedItems.delete(key);
    await this.writeManifest();
    await this.append(items, sessionId);
  }

  async setControl(id: string, value: string | boolean, sessionId: string | null = this.manifest.foreground): Promise<void> {
    this.record(sessionId).controls[id] = value;
    await this.writeManifest();
  }

  /** 프로세스가 들고 있는 세션 목록을 적고, 들고 있지도 보이지도 않는 세션의 기록은 지운다. 다시 열면 에이전트가 기록을 재생한다. */
  async retain(held: string[]): Promise<void> {
    const keep = new Set([...held, keyOf(this.manifest.foreground)].map(keyOf));
    const dropped = Object.keys(this.manifest.sessions).filter((key) => !keep.has(key));
    const changed = dropped.length > 0 || JSON.stringify(held) !== JSON.stringify(this.manifest.held);
    for (const key of dropped) await this.drop(key);
    this.manifest.held = [...held];
    if (changed) await this.writeManifest();
  }

  async append(items: Item[], sessionId: string | null = this.manifest.foreground): Promise<void> {
    if (!items.length) return;
    const key = keyOf(sessionId);
    const record = this.record(sessionId);
    const pages = this.pages.get(key) ?? [];
    this.pages.set(key, pages);
    for (const item of items) {
      let index = pages.findIndex((page) => page.some((old) => old.id === item.id));
      if (index < 0) {
        index = pages.length - 1;
        if (index < 0 || pages[index].length >= pageSize) {
          index++;
          pages.push([]);
        }
      }
      const page = pages[index];
      const position = page.findIndex((old) => old.id === item.id);
      if (position < 0) page.push(item); else page[position] = item;
      this.cachedItems.delete(key);
      await this.blobs.put(pageKey(record.ns, index), encoder.encode(JSON.stringify(page)));
      if (index >= record.pages) {
        record.pages = index + 1;
        await this.writeManifest();
      }
    }
  }

  private record(sessionId: string | null): SessionRecord {
    const key = keyOf(sessionId);
    let record = this.manifest.sessions[key];
    if (!record) {
      // 예전 판 자리(빈 ns)가 비어 있으면 그대로 쓰고, 아니면 새 이름 공간을 받는다.
      const legacyUsed = Object.values(this.manifest.sessions).some((entry) => entry.ns === "");
      record = { ns: legacyUsed ? `s${this.manifest.next++}` : "", pages: 0, controls: {} };
      this.manifest.sessions[key] = record;
    }
    return record;
  }

  private async drop(key: string): Promise<void> {
    const record = this.manifest.sessions[key];
    if (!record) return;
    delete this.manifest.sessions[key];
    this.pages.delete(key);
    this.cachedItems.delete(key);
    if (this.blobs.remove) for (let index = 0; index < record.pages; index++) {
      await this.blobs.remove(pageKey(record.ns, index)).catch((error) => console.warn("지난 세션 기록 정리 실패", error));
    }
  }

  private async writeManifest(): Promise<void> {
    await this.blobs.put(manifestKey, encoder.encode(JSON.stringify(this.manifest)));
  }
}
