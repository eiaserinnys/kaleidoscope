import { useBlockRootProps } from "../comments/block-root";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Binding, Block, DocumentRef, FileRef } from "../contract/contract";
import { ErrorNotice, Notice, StatusText } from "../components/primitives";
import { DataState } from "../components/data-state";
import type { BlockContext } from "./block-context";
import { resolveFilePath } from "./file-path";
import { toCoreError } from "../core/core-transport";
import * as shellErrors from "../contract/shell-errors";
import { useShareDescriber } from "../share/visible";
import { MarkdownText } from "./markdown-text";
import { documentEditorSession } from "./document-editor-session";
import { useBinding } from "../data/window-data";
import { useWindowGrant, useWindowStateValue } from "../data/window-state";

type MarkdownViewBlockData = Extract<Block, { type: "markdown" }>;
type FileMarkdownViewBlockData = MarkdownViewBlockData & { file: FileRef };

export function MarkdownViewBlock({ block, context, pointer }: { block: MarkdownViewBlockData; context: BlockContext; pointer: string }) {
  if (block.value !== undefined) return <BoundMarkdownViewBlock binding={block.value} pointer={pointer} context={context} />;
  if (block.document) return <DocumentMarkdownViewBlock document={block.document} context={context} />;
  if (!block.file) return null;
  return <FileMarkdownViewBlock block={{ ...block, file: block.file }} context={context} />;
}

function BoundMarkdownViewBlock({ binding, pointer, context }: { binding: Binding; pointer: string; context: BlockContext }) {
  const blockRoot = useBlockRootProps();
  const value = useBinding(`${pointer}/value`, binding);
  const shareRef = useRef<HTMLElement>(null);
  useShareDescriber(shareRef, () => ({ text: `[${context.definition.name || "Markdown 보기"}]`, visual: false, continue: true }));
  if (value.status !== "ready") return <DataState rootProps={blockRoot} value={value} />;
  if (typeof value.value !== "string") { const error = shellErrors.SHELL_MARKDOWN_VALUE_NOT_TEXT(); return <div {...blockRoot} className="ks-markdown-error"><Notice role="alert" errorId={error.id}>{error.message}</Notice></div>; }
  return <article {...blockRoot} className="ks-markdown-view" ref={shareRef}><MarkdownText>{value.value}</MarkdownText></article>;
}

function DocumentMarkdownViewBlock({ document, context }: { document: DocumentRef; context: BlockContext }) {
  const blockRoot = useBlockRootProps();
  const { entry } = document;
  const stateKey = typeof document.doc === "object" ? document.doc.state : null;
  const value = useWindowStateValue(context, stateKey);
  const collection = document.doc !== undefined;
  const fixedDoc = typeof document.doc === "string" ? document.doc : undefined;
  const doc = typeof document.doc === "string" ? document.doc : typeof value === "string" ? value : null;
  const path = collection ? doc : entry;
  const session = useMemo(() => documentEditorSession(context.store, context.window.id, entry, { context, collection, stateKey, fixedDoc, readOnly: true }), [context, entry, collection, stateKey, fixedDoc]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const shareRef = useRef<HTMLElement>(null);
  useShareDescriber(shareRef, () => ({ text: "[마크다운 보기]", visual: false, continue: true }));
  useEffect(() => { void session.open(path); }, [path, session]);
  if (path === null) return <article {...blockRoot} className="ks-markdown-view" ref={shareRef} />;
  if (!state.loaded) return <div {...blockRoot} className="ks-markdown-loading"><StatusText>불러오는 중</StatusText></div>;
  if (state.error) return <div {...blockRoot} className="ks-markdown-error"><ErrorNotice error={state.error} /></div>;
  return <article {...blockRoot} className="ks-markdown-view" ref={shareRef}><MarkdownText>{state.text}</MarkdownText></article>;
}

function FileMarkdownViewBlock({ block, context }: { block: FileMarkdownViewBlockData; context: BlockContext }) {
  const blockRoot = useBlockRootProps();
  const stateValue = useWindowStateValue(context, typeof block.file.path === "string" ? null : block.file.path.state);
  const path = resolveFilePath(block.file, stateValue);
  const grantRoot = useWindowGrant(context, block.file.permission)?.root_path ?? null;
  const grant = grantRoot !== null;
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ReturnType<typeof toCoreError> | null>(null);
  const readVersion = useRef(0);
  const shareRef = useRef<HTMLElement>(null);
  useShareDescriber(shareRef, () => ({ text: path ? `[파일 ${path}]` : "[마크다운 보기]", visual: false, continue: true }));

  const readFile = useCallback(async () => {
    const version = ++readVersion.current;
    if (path === null) {
      setText("");
      setError(null);
      setLoading(false);
      return;
    }
    if (!grant) {
      setText("");
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const reply = await context.store.call({
        op: "files.read",
        window_id: context.window.id,
        permission: block.file.permission,
        path,
      });
      if (reply.op === "files.read" && version === readVersion.current) setText(reply.text);
    } catch (reason) {
      if (version === readVersion.current) setError(toCoreError(reason));
    } finally {
      if (version === readVersion.current) setLoading(false);
    }
  }, [block.file.permission, context.store, context.window.id, grant, grantRoot, path]);

  useEffect(() => {
    void readFile();
  }, [readFile]);

  useEffect(() => {
    const refresh = () => void readFile();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [readFile]);

  if (!grant) return null;
  if (path === null) return <article {...blockRoot} className="ks-markdown-view" ref={shareRef} />;
  if (loading) return <div {...blockRoot} className="ks-markdown-loading"><StatusText>불러오는 중</StatusText></div>;
  if (error) return <div {...blockRoot} className="ks-markdown-error"><Notice role="alert" errorId={error.id}>{error.message}</Notice></div>;

  return (
    <article {...blockRoot} className="ks-markdown-view" ref={shareRef}>
      <MarkdownText>{text}</MarkdownText>
    </article>
  );
}
