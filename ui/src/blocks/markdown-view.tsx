import { useCallback, useEffect, useRef, useState } from "react";
import type { Block, FileRef } from "../contract/contract";
import { Notice, StatusText } from "../components/primitives";
import type { BlockContext } from "./block-context";
import { resolveFilePath } from "./file-path";
import { toCoreError } from "../core/core-transport";
import { useShareDescriber } from "../share/visible";
import { MarkdownText } from "./markdown-text";
import { createDocumentEditorTarget } from "./file-editor-session";

type MarkdownViewBlockData = Extract<Block, { type: "markdown_view" }>;
type FileMarkdownViewBlockData = MarkdownViewBlockData & { file: FileRef };

export function MarkdownViewBlock({ block, context }: { block: MarkdownViewBlockData; context: BlockContext }) {
  if (block.document) return <DocumentMarkdownViewBlock entry={block.document.entry} context={context} />;
  if (!block.file) return null;
  return <FileMarkdownViewBlock block={{ ...block, file: block.file }} context={context} />;
}

function DocumentMarkdownViewBlock({ entry, context }: { entry: string; context: BlockContext }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const shareRef = useRef<HTMLElement>(null);
  useShareDescriber(shareRef, () => ({ text: "[마크다운 보기]", visual: false, continue: true }));
  const read = useCallback(async () => {
    const current = ++version.current;
    try {
      const result = await createDocumentEditorTarget(context.store, context.window.id, entry).read(entry);
      if (current === version.current) { setText(result.text); setError(null); }
    } catch (reason) {
      if (current === version.current) setError(toCoreError(reason).message);
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, [context.store, context.window.id, entry]);
  useEffect(() => {
    void read();
    const unsubscribe = context.store.subscribeEvents((event) => {
      if (event.event === "storage.update" && event.window_id === context.window.id &&
        (event.update.kind === "snapshot" || event.update.changed.item.entry_id === entry)) void read();
    });
    window.addEventListener("focus", read);
    return () => { version.current++; unsubscribe(); window.removeEventListener("focus", read); };
  }, [context.store, context.window.id, entry, read]);
  if (loading) return <div className="ks-markdown-loading"><StatusText>불러오는 중</StatusText></div>;
  if (error) return <div className="ks-markdown-error"><Notice role="alert">{error}</Notice></div>;
  return <article className="ks-markdown-view" ref={shareRef}><MarkdownText>{text}</MarkdownText></article>;
}

function FileMarkdownViewBlock({ block, context }: { block: FileMarkdownViewBlockData; context: BlockContext }) {
  const path = resolveFilePath(block.file, context.window);
  const grantRoot = context.snapshot.device.grants.find(
    (item) => item.window_id === context.window.id && item.permission === block.file.permission,
  )?.root_path ?? null;
  const grant = grantRoot !== null;
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      if (version === readVersion.current) setError(toCoreError(reason).message);
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
  if (path === null) return <article className="ks-markdown-view" ref={shareRef} />;
  if (loading) return <div className="ks-markdown-loading"><StatusText>불러오는 중</StatusText></div>;
  if (error) return <div className="ks-markdown-error"><Notice role="alert">{error}</Notice></div>;

  return (
    <article className="ks-markdown-view" ref={shareRef}>
      <MarkdownText>{text}</MarkdownText>
    </article>
  );
}
