import ReactMarkdown, { type Components } from "react-markdown";
import { memo, type CSSProperties } from "react";
import remarkGfm from "remark-gfm";
import { useOptionalWindowData } from "../data/window-data";
import { toCoreError } from "../core/core-transport";

const remarkPlugins = [remarkGfm];

const MarkdownPre: NonNullable<Components["pre"]> = ({ node, children: _children, ...props }) => {
  const code = node?.children.find((child) => child.type === "element" && child.tagName === "code");
  const text = code?.type === "element"
    ? code.children.filter((child) => child.type === "text").map((child) => child.value).join("")
    : "";
  const lines = text.replace(/\n$/, "").split(/(?<=\n)/);

  return <pre {...props}><code>{lines.map((line, index) => {
    let columns = 0;
    for (const char of line) {
      if (char === " ") columns += 1;
      else if (char === "\t") columns += 4 - columns % 4;
      else break;
    }
    const style = columns ? { "--ks-code-indent": `${columns}ch` } as CSSProperties : undefined;
    const indent = line.match(/^[ \t]+[^\s]/u)?.[0];
    return <span className="ks-code-line" key={index} style={style}>{indent
      ? <><span className="ks-code-indent">{indent}</span>{line.slice(indent.length)}</>
      : line}</span>;
  })}</code></pre>;
};

export const MarkdownText = memo(function MarkdownText({ children }: { children: string }) {
  const data = useOptionalWindowData();
  return (
    <div className="ks-markdown-text">
      <ReactMarkdown
        components={{
          pre: MarkdownPre,
          a: ({ href, children: linkText }) => (
            <a href={href} onClick={(event) => {
              event.preventDefault();
              if (!href) return;
              let url: URL;
              try { url = new URL(href); } catch { return; }
              if (url.protocol !== "http:" && url.protocol !== "https:") return;
              if (data) void data.store.call({ op: "external.open", window_id: data.windowId, url: url.href }).catch((error: unknown) => data.setNotice(toCoreError(error).message));
              else globalThis.window.open(url.href, "_blank", "noopener,noreferrer");
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
