import { useCallback, useEffect, useRef, useState } from "react";
import type { Block } from "../contract/contract";
import { Notice, StatusText } from "../components/primitives";
import type { BlockContext } from "./block-context";
import { resolveFilePath } from "./file-path";
import { toCoreError } from "../core/core-transport";
import { MarkdownText } from "./markdown-text";

type MarkdownViewBlockData = Extract<Block, { type: "markdown_view" }>;

export function MarkdownViewBlock({ block, context }: { block: MarkdownViewBlockData; context: BlockContext }) {
  const path = resolveFilePath(block.file, context.window);
  const grantRoot = context.snapshot.device.grants.find(
    (item) => item.window_id === context.window.id && item.permission === block.file.permission,
  )?.root_path ?? null;
  const grant = grantRoot !== null;
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readVersion = useRef(0);

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

  if (!grant || path === null) return null;
  if (loading) return <div className="ks-markdown-loading"><StatusText>불러오는 중</StatusText></div>;
  if (error) return <div className="ks-markdown-error"><Notice role="alert">{error}</Notice></div>;

  return (
    <article className="ks-markdown-view">
      <MarkdownText>{text}</MarkdownText>
    </article>
  );
}
