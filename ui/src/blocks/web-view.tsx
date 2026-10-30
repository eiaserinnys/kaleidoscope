import { useEffect, useRef, useState } from "react";
import type { Block, WebPage } from "../contract/contract";
import { EmptyState, IconButton, Notice } from "../components/primitives";
import { ArrowLeft, ArrowRight, Globe, RotateCw, X } from "../components/icons";
import { TextInput } from "../components/text-input";
import { toCoreError } from "../core/core-transport";
import type { BlockContext } from "./block-context";
import { isHttpAddress, normalizeWebAddress } from "./web-address";
import { useShareDescriber } from "../share/visible";
import { registerWebSurface, type WebSurfaceState } from "./web-surface-layer";

type WebViewBlockData = Extract<Block, { type: "web_view" }>;

function resolveAddress(block: WebViewBlockData, context: BlockContext): string | null {
  const value = typeof block.url === "string" ? block.url : context.window.state[block.url.state];
  return typeof value === "string" ? value : null;
}

function pageHeading(page: WebPage | null): string {
  if (!page) return "";
  if (page.title) return page.title;
  try {
    return new URL(page.url).host;
  } catch {
    return page.url;
  }
}

export function WebViewBlock({ block, context }: { block: WebViewBlockData; context: BlockContext }) {
  const address = resolveAddress(block, context);
  const validAddress = isHttpAddress(address) ? address : null;
  const windowId = context.window.id;
  const store = context.store;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLDivElement>(null);
  const attached = useRef(false);
  const attaching = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const desiredAddress = useRef<string | null>(validAddress);
  const pendingAddress = useRef<string | null>(null);
  const pageRef = useRef<WebPage | null>(null);
  const openAddressRef = useRef<((url: string) => Promise<void>) | null>(null);
  const [page, setPage] = useState<WebPage | null>(null);
  useShareDescriber(shareRef, () => ({ text: `[웹 화면: ${page?.title ?? ""}, ${page?.url ?? validAddress ?? ""}]`, visual: true }));
  const [webReady, setWebReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingAddress, setEditingAddress] = useState(false);
  const [surface, setSurface] = useState<WebSurfaceState>({ kind: "hidden" });

  const applyPage = (next: WebPage) => {
    pageRef.current = next;
    setPage(next);
    setError(null);
    if (pendingAddress.current === next.url) pendingAddress.current = null;
  };

  openAddressRef.current = async (url) => {
    if (!isHttpAddress(url)) return;
    desiredAddress.current = url;
    setUnavailable(false);
    setError(null);

    if (!attached.current) {
      attached.current = true;
      attaching.current = true;
      const requestGeneration = ++generation.current;
      setWebReady(false);
      try {
        const reply = await store.call({ op: "web.attach", window_id: windowId, url });
        if (reply.op !== "web.attach") return;
        if (!mounted.current || generation.current !== requestGeneration) {
          void store.call({ op: "web.detach", window_id: windowId }).catch(() => undefined);
          return;
        }
        applyPage(reply.page);
        setWebReady(true);
        const latest = desiredAddress.current;
        if (latest && latest !== reply.page.url) void openAddressRef.current?.(latest);
      } catch (reason) {
        if (!mounted.current || generation.current !== requestGeneration) return;
        attached.current = false;
        setWebReady(false);
        const coreError = toCoreError(reason);
        if (coreError.code === "unavailable") setUnavailable(true);
        else setError(coreError.message);
      } finally {
        attaching.current = false;
      }
      return;
    }

    if (attaching.current || pageRef.current?.url === url || pendingAddress.current === url) return;
    pendingAddress.current = url;
    try {
      await store.call({ op: "web.navigate", window_id: windowId, url });
    } catch (reason) {
      pendingAddress.current = null;
      setError(toCoreError(reason).message);
    }
  };

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = store.subscribeEvents((event) => {
      if (event.event !== "web.update" || event.window_id !== windowId) return;
      applyPage(event.page);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      generation.current += 1;
      if (attached.current) {
        attached.current = false;
        void store.call({ op: "web.detach", window_id: windowId }).catch(() => undefined);
      }
    };
  }, [store, windowId]);

  useEffect(() => {
    desiredAddress.current = validAddress;
    if (!validAddress) {
      setPage(null);
      pageRef.current = null;
      setWebReady(false);
      setUnavailable(false);
      pendingAddress.current = null;
      if (attached.current) {
        generation.current += 1;
        attached.current = false;
        void store.call({ op: "web.detach", window_id: windowId }).catch(() => undefined);
      }
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (active) void openAddressRef.current?.(validAddress);
    });
    return () => { active = false; };
  }, [store, validAddress, windowId]);

  useEffect(() => {
    const element = surfaceRef.current;
    if (!element || !webReady) return;
    return registerWebSurface(element, windowId, store, setSurface);
  }, [store, webReady, windowId]);

  const navigate = (value: string) => {
    setEditingAddress(false);
    void openAddressRef.current?.(normalizeWebAddress(value));
  };

  const history = (action: "back" | "forward" | "reload" | "stop") => {
    void store.call({ op: "web.history", window_id: windowId, action }).catch((reason) => {
      setError(toCoreError(reason).message);
    });
  };

  const live = surface.kind === "live";
  const frozen = surface.kind === "covered";

  return (
    <div className="ks-web-view" ref={shareRef}>
      <div className="ks-file-tree-header ks-web-toolbar">
        <IconButton aria-label="뒤로" disabled={!page?.can_go_back} onClick={() => history("back")}><ArrowLeft /></IconButton>
        <IconButton aria-label="앞으로" disabled={!page?.can_go_forward} onClick={() => history("forward")}><ArrowRight /></IconButton>
        <IconButton
          aria-label={page?.loading ? "멈춤" : "새로고침"}
          disabled={!page}
          onClick={() => history(page?.loading ? "stop" : "reload")}
        >
          {page?.loading ? <X /> : <RotateCw />}
        </IconButton>
        {block.address_bar ? editingAddress ? (
          <TextInput
            aria-label="주소"
            onCancel={() => setEditingAddress(false)}
            onCommit={navigate}
            size="compact"
            value={page?.url ?? validAddress ?? ""}
          />
        ) : (
          <input
            aria-label="주소"
            className="ks-text-input ks-text-input-compact ks-web-address-input"
            onClick={() => setEditingAddress(true)}
            onFocus={() => setEditingAddress(true)}
            readOnly
            value={page?.url ?? validAddress ?? ""}
          />
        ) : (
          <span className="ks-file-tree-root-name ks-web-page-title" title={pageHeading(page)}>{pageHeading(page)}</span>
        )}
      </div>
      <div className="ks-web-surface" data-ks-web-surface ref={surfaceRef}>
        {error ? <div className="ks-web-error" data-ks-overlay><Notice role="alert">{error}</Notice></div> : null}
        {!webReady && unavailable ? (
          <EmptyState icon={<Globe size="empty" />} text="이 쉘에서는 웹 화면을 열 수 없습니다" />
        ) : !page ? (
          <EmptyState icon={<Globe size="empty" />} />
        ) : frozen ? (
          surface.kind === "covered" && surface.image
            ? <img alt="" className="ks-web-frozen-image" src={surface.image} />
            : <span className="ks-web-frozen-title">{pageHeading(page)}</span>
        ) : live ? null : null}
      </div>
    </div>
  );
}
