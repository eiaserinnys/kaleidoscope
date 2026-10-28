import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Block } from "../contract/contract";
import { EmptyState, Notice, StatusText } from "../components/primitives";
import type { BlockContext } from "./block-context";
import { resolveFilePath } from "./file-path";
import { toCoreError } from "../core/core-transport";

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

  if (path === null) return <EmptyState icon={<DocumentIcon />} text="파일을 선택하세요" />;
  if (!grant) return <EmptyState icon={<DocumentIcon />} text="폴더를 먼저 선택하세요" />;
  if (loading) return <div className="ks-markdown-loading"><StatusText>불러오는 중</StatusText></div>;
  if (error) return <div className="ks-markdown-error"><Notice role="alert">{error}</Notice></div>;

  return (
    <article className="ks-markdown-view">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => (
            <a href={href} onClick={(event) => event.preventDefault()}>{children}</a>
          ),
          img: ({ alt }) => <span className="ks-markdown-image-alt">{alt ?? ""}</span>,
        }}
        remarkPlugins={[remarkGfm]}
      >
        {text}
      </ReactMarkdown>
    </article>
  );
}

function DocumentIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M6 3.5h8l4 4v13H6z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M14 3.5v4h4M9 12h6M9 15.5h6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}
