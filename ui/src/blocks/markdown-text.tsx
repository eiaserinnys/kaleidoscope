import ReactMarkdown, { type Components } from "react-markdown";
import { memo, type CSSProperties } from "react";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "../components/external-link";
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
  return (
    <div className="ks-markdown-text">
      <ReactMarkdown
        components={{
          pre: MarkdownPre,
          a: ({ href, children: linkText }) => <ExternalLink href={href}>{linkText}</ExternalLink>,
          img: ({ alt }) => <span className="ks-markdown-image-alt">{alt ?? ""}</span>,
        }}
        remarkPlugins={remarkPlugins}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
