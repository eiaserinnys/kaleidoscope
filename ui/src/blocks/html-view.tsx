import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Binding, Block, FileRef } from "../contract/contract";
import { Notice, StatusText } from "../components/primitives";
import { DataState } from "../components/data-state";
import { toCoreError } from "../core/core-transport";
import { useShareDescriber } from "../share/visible";
import { useBinding } from "../data/window-data";
import { useWindowGrant, useWindowStateValue } from "../data/window-state";
import type { BlockContext } from "./block-context";
import { resolveFilePath } from "./file-path";
import { FileGrant } from "./file-grant";
import { htmlViewSource } from "./html-view-frame";
import { htmlText } from "./html-view-model";
import { HtmlDocumentViewBlock } from "./html-document/view";
import * as shellErrors from "../contract/shell-errors";

type HtmlViewData = Extract<Block, { type: "html_view" }>;

export function HtmlViewBlock({ block, context, pointer = "/ui" }: { block: HtmlViewData; context: BlockContext; pointer?: string }) {
  if (block.value !== undefined) return <BoundHtmlViewBlock binding={block.value} pointer={pointer} context={context} />;
  if (block.file !== undefined) return <FileHtmlViewBlock file={block.file} context={context} />;
  if (block.document !== undefined) return <HtmlDocumentViewBlock block={{ ...block, document: block.document }} context={context} />;
  return null;
}

function BoundHtmlViewBlock({ binding, pointer, context }: { binding: Binding; pointer: string; context: BlockContext }) {
  const value = useBinding(`${pointer}/value`, binding);
  const root = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [visibleText, setVisibleText] = useState("");
  const rawHtml = value.status === "ready" && typeof value.value === "string" ? value.value : "";
  const source = useMemo(() => htmlViewSource(rawHtml), [rawHtml]);
  useLayoutEffect(() => { setVisibleText(""); }, [rawHtml]);
  useLayoutEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== "ks-html-visible-text" || typeof event.data.text !== "string") return;
      setVisibleText(event.data.text);
    };
    window.addEventListener("message", receive); return () => window.removeEventListener("message", receive);
  }, []);
  const appName = context.definition.name || "HTML 보기";
  useShareDescriber(root, () => ({ text: `[${appName}]\n\n${visibleText || htmlText(rawHtml)}`, visual: true }));
  if (value.status !== "ready") return <DataState value={value} />;
  if (typeof value.value !== "string") { const error = shellErrors.SHELL_HTML_VALUE_NOT_TEXT(); return <div className="ks-html-state"><Notice role="alert" errorId={error.id}>{error.message}</Notice></div>; }
  return <section className="ks-html-view" ref={root}><div className="ks-html-content"><iframe ref={frame} title={appName} sandbox="allow-scripts" srcDoc={source} /></div></section>;
}

function FileHtmlViewBlock({ file, context }: { file: FileRef; context: BlockContext }) {
  const stateValue = useWindowStateValue(context, typeof file.path === "string" ? null : file.path.state);
  const path = resolveFilePath(file, stateValue);
  const rootPath = useWindowGrant(context, file.permission)?.root_path ?? null;
  const [rawHtml, setRawHtml] = useState("");
  const source = useMemo(() => htmlViewSource(rawHtml), [rawHtml]);
  const [visibleText, setVisibleText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ReturnType<typeof toCoreError> | null>(null);
  const version = useRef(0);
  const root = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useLayoutEffect(() => { setVisibleText(""); }, [rawHtml]);
  useLayoutEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== "ks-html-visible-text" || typeof event.data.text !== "string") return;
      setVisibleText(event.data.text);
    };
    window.addEventListener("message", receive); return () => window.removeEventListener("message", receive);
  }, []);
  const appName = context.definition.name || "HTML 보기";
  useShareDescriber(root, () => ({ text: path ? `[파일 ${path}]\n\n${visibleText || htmlText(rawHtml)}` : `[${appName}]`, visual: true }));
  const read = useCallback(async (initial = false) => {
    const current = ++version.current;
    if (!rootPath || path === null) { setRawHtml(""); setError(null); setLoading(false); return; }
    if (initial) setLoading(true);
    try {
      const reply = await context.store.call({ op: "files.read", window_id: context.window.id, permission: file.permission, path });
      if (reply.op === "files.read" && current === version.current) { setRawHtml(reply.text); setError(null); }
    } catch (reason) { if (current === version.current) setError(toCoreError(reason)); }
    finally { if (current === version.current) setLoading(false); }
  }, [context.store, context.window.id, file.permission, path, rootPath]);
  useEffect(() => { void read(true); return () => { version.current++; }; }, [read]);
  useEffect(() => { const refresh = () => void read(); window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, [read]);
  if (!rootPath) return <FileGrant context={context} permission={file.permission} />;
  if (loading) return <div className="ks-html-state"><StatusText>불러오는 중</StatusText></div>;
  if (error) return <div className="ks-html-state"><Notice role="alert" errorId={error.id}>{error.message}</Notice></div>;
  return <section className="ks-html-view" ref={root}><div className="ks-html-content"><iframe ref={frame} title={appName} sandbox="allow-scripts" srcDoc={source} /></div></section>;
}
