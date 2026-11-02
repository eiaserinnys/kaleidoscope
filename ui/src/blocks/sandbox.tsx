import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Block } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { Notice, StatusText } from "../components/primitives";
import { DataState } from "../components/data-state";
import { toCoreError } from "../core/core-transport";
import { useBinding, useWindowData } from "../data/window-data";
import { useShareDescriber } from "../share/visible";
import type { BlockContext } from "./block-context";
import { FileGrant } from "./file-grant";
import { resolveFilePath } from "./file-path";
import { sandboxSource } from "./sandbox-frame";
import { registerSandboxFlush } from "./sandbox-flush";

type SandboxData = Extract<Block, { type: "sandbox" }>;

export function SandboxBlock({ block, context, pointer }: { block: SandboxData; context: BlockContext; pointer: string }) {
  const bound = useBinding(`${pointer}/value`, block.value ?? null);
  const boundStatus = bound.status;
  const boundValue = bound.status === "ready" ? bound.value : null;
  const [rawHtml, setRawHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const permission = block.file?.permission;
  const path = block.file ? resolveFilePath(block.file, context.window) : null;
  const grant = permission ? context.snapshot.device.grants.find((item) => item.window_id === context.window.id && item.permission === permission)?.root_path : null;
  const read = useCallback(async () => {
    try {
      let text = "";
      if (block.asset !== undefined) {
        const reply = await context.store.call({ op: "data.media", window_id: context.window.id, media: { asset: block.asset } });
        if (reply.op === "data.media") {
          if (reply.media.mime.split(";")[0] !== "text/html") throw new Error("HTML 자산이 아닙니다");
          text = new TextDecoder().decode(Uint8Array.from(atob(reply.media.data_base64), (char) => char.charCodeAt(0)));
        }
      } else if (block.file && permission && path !== null && grant) {
        const reply = await context.store.call({ op: "files.read", window_id: context.window.id, permission, path });
        if (reply.op === "files.read") text = reply.text;
      } else if (block.document) {
        const reply = await context.store.call({ op: "storage.get", window_id: context.window.id, entry: block.document.entry });
        if (reply.op === "storage.get" && typeof reply.result.content === "string") text = reply.result.content;
      } else if (block.value !== undefined && boundStatus === "ready" && typeof boundValue === "string") text = boundValue;
      setRawHtml(text); setError(null);
    } catch (reason) { setError(toCoreError(reason).message); }
    finally { setLoading(false); }
  }, [block.asset, block.file, block.document, block.value, boundStatus, boundValue, context.store, context.window.id, permission, path, grant]);
  useEffect(() => { void read(); }, [read]);
  useEffect(() => {
    if (!block.file) return;
    const refresh = () => { void read(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [block.file, read]);
  useEffect(() => {
    if (!block.document) return;
    return context.store.subscribeEvents((event) => {
      if (event.event === "storage.update" && event.window_id === context.window.id && (event.update.kind === "snapshot" || (event.update.kind === "changed" && event.update.changed.item.entry_id === block.document?.entry))) void read();
    });
  }, [block.document, context.store, context.window.id, read]);
  if (block.file && !grant && permission) return <FileGrant context={context} permission={permission} />;
  if (block.value !== undefined && bound.status !== "ready") return <DataState value={bound} />;
  if (loading) return <div className="ks-html-state"><StatusText>불러오는 중</StatusText></div>;
  if (error) return <div className="ks-html-state"><Notice role="alert">{error}</Notice></div>;
  return <SandboxFrame block={block} context={context} rawHtml={rawHtml} />;
}

function SandboxFrame({ block, context, rawHtml }: { block: SandboxData; context: BlockContext; rawHtml: string }) {
  const dataRuntime = useWindowData();
  const root = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const revisions = useRef<Record<string, string | null>>({});
  const pendingRevisions = useRef<Record<string, string | null>>({});
  const ownWrites = useRef<Record<string, string>>({});
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const loaded = useRef(false);
  const active = useRef(true);
  const currentToken = useRef("");
  const flushes = useRef(new Map<string, (ok: boolean) => void>());
  const [sequence, setSequence] = useState(0);
  const [share, setShare] = useState({ text: "", image: "", sequence: 0 });
  const stateKeys = block.state_keys ?? [];
  const storageEntries = block.storage_entries ?? [];
  const stateSignature = JSON.stringify(stateKeys);
  const storageSignature = JSON.stringify(storageEntries);
  const source = useMemo(() => {
    const token = crypto.randomUUID();
    const state = Object.fromEntries(stateKeys.filter((key) => key in context.window.state).map((key) => [key, context.window.state[key]]));
    return { token, html: sandboxSource(rawHtml, { token, state, stateKeys, storageEntries }) };
  // 창 상태가 바뀌어도 프레임을 다시 시작하지 않는다.
  }, [rawHtml, stateSignature, storageSignature, sequence]);
  const send = useCallback((data: object) => {
    if (active.current && currentToken.current === source.token) frame.current?.contentWindow?.postMessage(data, "*");
  }, [source.token]);
  const state = Object.fromEntries(stateKeys.filter((key) => key in context.window.state).map((key) => [key, context.window.state[key]]));
  const stateJson = JSON.stringify(state);
  useEffect(() => { send({ type: "ks-sandbox-state-sync", state: JSON.parse(stateJson) }); }, [stateJson, send]);
  useLayoutEffect(() => {
    active.current = true;
    currentToken.current = source.token;
    loaded.current = false;
    revisions.current = {};
    pendingRevisions.current = {};
    ownWrites.current = {};
    setShare({ text: "", image: "", sequence: 0 });
  }, [source.token]);
  const readStorage = useCallback(async (entry: string) => {
    const reply = await context.store.call({ op: "storage.get", window_id: context.window.id, entry });
    if (reply.op !== "storage.get") throw new Error("저장 항목을 읽지 못했습니다");
    return reply.result;
  }, [context.store, context.window.id]);
  const getStorage = useCallback(async (entry: string) => {
    const result = await readStorage(entry);
    revisions.current[entry] = result.revision;
    return result.content;
  }, [readStorage]);
  useEffect(() => registerSandboxFlush(context.window.id, () => new Promise<boolean>((resolve) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { flushes.current.delete(requestId); resolve(false); }, 5000);
    flushes.current.set(requestId, (ok) => { clearTimeout(timer); resolve(ok); });
    send({ type: "ks-sandbox-flush", requestId });
  })), [context.window.id, send]);
  useEffect(() => context.store.subscribeEvents((event) => {
    if (event.event !== "storage.update" || event.window_id !== context.window.id) return;
    for (const entry of storageEntries) {
      if (event.update.kind === "snapshot" || (event.update.kind === "changed" && event.update.changed.item.entry_id === entry)) {
        void readStorage(entry).then(({ content, revision }) => {
          if (ownWrites.current[entry] === JSON.stringify(content)) return;
          delete ownWrites.current[entry];
          pendingRevisions.current[entry] = revision;
          send({ type: "ks-sandbox-storage-sync", entry, content, revision });
        }).catch((reason) => console.error("저장 항목 갱신 실패", reason));
      }
    }
  }), [context.store, context.window.id, readStorage, send, storageSignature]);
  useLayoutEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!active.current || event.source !== frame.current?.contentWindow || !["null", ""].includes(event.origin) || !event.data || event.data.token !== source.token) return;
      const data = event.data;
      if (data.type === "ks-sandbox-ready") {
        send({ type: "ks-sandbox-state-sync", state: JSON.parse(stateJson) });
        for (const entry of storageEntries) void getStorage(entry).then((content) => send({ type: "ks-sandbox-storage-sync", entry, content })).catch((reason) => console.error("저장 항목 읽기 실패", reason));
      } else if (data.type === "ks-sandbox-flushed" && typeof data.requestId === "string") {
        flushes.current.get(data.requestId)?.(data.ok === true);
        flushes.current.delete(data.requestId);
      } else if (data.type === "ks-sandbox-storage-applied" && typeof data.entry === "string" && storageEntries.includes(data.entry) && data.entry in pendingRevisions.current && pendingRevisions.current[data.entry] === data.revision) {
        revisions.current[data.entry] = data.revision;
        delete pendingRevisions.current[data.entry];
      } else if (data.type === "ks-sandbox-state-set" && data.patch && typeof data.patch === "object") {
        const patch = Object.fromEntries(Object.entries(data.patch).filter(([key]) => stateKeys.includes(key))) as Record<string, JsonValue>;
        const current = context.store.getSnapshot()?.shared.windows.find((item) => item.id === context.window.id)?.state ?? context.window.state;
        void context.store.call({ op: "window.set_state", window_id: context.window.id, state: { ...current, ...patch } }).catch((reason) => console.error("창 상태 변경 실패", reason));
      } else if ((data.type === "ks-sandbox-storage-get" || data.type === "ks-sandbox-storage-set") && typeof data.entry === "string" && storageEntries.includes(data.entry)) {
        const entry = data.entry, requestId = data.requestId;
        const run = async () => {
          if (data.type === "ks-sandbox-storage-get") return getStorage(entry);
          if (!(entry in revisions.current)) await getStorage(entry);
          ownWrites.current[entry] = JSON.stringify(data.content);
          let reply;
          try { reply = await context.store.call({ op: "storage.write", window_id: context.window.id, entry, content: data.content as JsonValue, expected_revision: revisions.current[entry] }); }
          catch (reason) { delete ownWrites.current[entry]; throw reason; }
          if (reply.op !== "storage.write") throw new Error("저장 항목을 쓰지 못했습니다");
          revisions.current[entry] = reply.revision;
          return data.content;
        };
        const task = writes.current.catch(() => undefined).then(run);
        writes.current = task;
        void task.then((content) => send({ type: "ks-sandbox-storage-reply", requestId, content })).catch((reason) => {
          const message = toCoreError(reason).message;
          dataRuntime.setNotice(message);
          send({ type: "ks-sandbox-storage-reply", requestId, error: message });
        });
      } else if (data.type === "ks-sandbox-share") {
        const text = typeof data.text === "string" ? data.text : "";
        const image = typeof data.imageBase64 === "string" ? data.imageBase64.replace(/^data:image\/png;base64,/, "") : "";
        setShare((previous) => previous.text === text && previous.image === image ? previous : { text, image, sequence: previous.sequence + 1 });
      }
    };
    window.addEventListener("message", receive); return () => window.removeEventListener("message", receive);
  }, [context.store, context.window, dataRuntime, getStorage, send, source.token, stateJson, stateSignature, storageSignature]);
  const appName = context.definition.name || "샌드박스";
  useShareDescriber(root, () => ({ text: `[${appName}]\n\n${share.text}`.trim(), visual: true, ...(share.image ? { image_base64: share.image } : {}) }));
  return <section className="ks-sandbox" ref={root} data-share-seq={share.sequence}>
    <iframe key={`${source.token}-${sequence}`} ref={frame} title={block.title ?? appName} sandbox="allow-scripts allow-downloads allow-modals" allow="autoplay" srcDoc={source.html}
      style={block.height ? { minHeight: block.height } : undefined}
      onLoad={() => { if (loaded.current) { active.current = false; loaded.current = false; setSequence((value) => value + 1); } else loaded.current = true; }} />
  </section>;
}
