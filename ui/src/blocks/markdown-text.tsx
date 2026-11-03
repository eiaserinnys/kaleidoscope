import ReactMarkdown, { type Components } from "react-markdown";
import { memo, type CSSProperties } from "react";
import remarkGfm from "remark-gfm";
import { useOptionalWindowData } from "../data/window-data";
import { toCoreError } from "../core/core-transport";
import { openContextMenu, writeMenuClipboard } from "../components/context-menu";

const remarkPlugins = [remarkGfm];

// 얕은 줄만 들여쓰기와 첫 글자를 묶는다. 들여쓰기가 내용 폭을 넘는 줄까지 묶으면 글자가 창 밖으로 나간다.
const GLUE_MAX_COLUMNS = 24;

const MarkdownPre: NonNullable<Components["pre"]> = ({ node, children: _children, ...props }) => {
  const code = node?.children.find((child) => child.type === "element" && child.tagName === "code");
  const text = code?.type === "element"
    ? code.children.filter((child) => child.type === "text").map((child) => child.value).join("")
    : "";
  const lines = text.replace(/\n$/, "").split(/(?<=\n)/);

  return <pre {...props} tabIndex={0} onContextMenu={(event) => openContextMenu(event, [{ id: "code-copy", label: "코드 복사", onSelect: () => { void writeMenuClipboard(text, "코드 복사"); } }])}><code>{lines.map((line, index) => {
    let columns = 0;
    for (const char of line) {
      if (char === " ") columns += 1;
      else if (char === "\t") columns += 4 - columns % 4;
      else break;
    }
    const style = columns ? { "--ks-code-indent": `${columns}ch` } as CSSProperties : undefined;
    const indent = columns <= GLUE_MAX_COLUMNS ? line.match(/^[ \t]+[^\s]/u)?.[0] : undefined;
    return <span className="ks-code-line" key={index} style={style}>{indent
      ? <><span className="ks-code-indent">{indent}</span>{line.slice(indent.length)}</>
      : line}</span>;
  })}</code></pre>;
};

export const MarkdownText = memo(function MarkdownText({ children }: { children: string }) {
  const data = useOptionalWindowData();
  const externalUrl = (href: string | undefined) => {
    if (!href) return null;
    try { const url = new URL(href); return url.protocol === "http:" || url.protocol === "https:" ? url : null; } catch { return null; }
  };
  const openLink = (url: URL) => {
    if (data) void data.store.call({ op: "external.open", window_id: data.windowId, url: url.href }).catch((error: unknown) => data.setNotice(toCoreError(error)));
    else globalThis.window.open(url.href, "_blank", "noopener,noreferrer");
  };
  return (
    <div className="ks-markdown-text">
      <ReactMarkdown
        components={{
          pre: MarkdownPre,
          a: ({ href, children: linkText }) => (
            <a href={href} onContextMenu={(event) => {
              const url = externalUrl(href);
              openContextMenu(event, [
                ...(url ? [{ id: "link-open", label: "링크 열기", onSelect: () => openLink(url) }] : []),
                ...(href ? [{ id: "link-copy", label: "링크 주소 복사", onSelect: () => { void writeMenuClipboard(href, "링크 주소 복사"); } }] : []),
              ]);
            }} onClick={(event) => {
              event.preventDefault();
              const url = externalUrl(href);
              if (url) openLink(url);
            }}>{linkText}</a>
          ),
          img: ({ alt }) => <span className="ks-markdown-image-alt">{alt ?? ""}</span>,
        }}
        remarkPlugins={remarkPlugins}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
