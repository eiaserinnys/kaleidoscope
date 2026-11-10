import ReactMarkdown, { type Components } from "react-markdown";
import { memo, useLayoutEffect, useRef, type CSSProperties } from "react";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "../components/external-link";
import { openContextMenu, writeMenuClipboard } from "../components/context-menu";
import { watchTableFit } from "./table-fit";

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

const MarkdownTable: NonNullable<Components["table"]> = ({ node: _node, children, ...props }) => {
  const wrap = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  // 표 내용이 바뀌어 다시 그리면 관찰을 새로 걸어 첫 알림으로 다시 맞춘다.
  useLayoutEffect(() => {
    if (!wrap.current || !table.current || !probe.current) return;
    return watchTableFit(wrap.current, probe.current, table.current);
  });
  return (
    <div className="ks-table-fit" ref={wrap}>
      <table {...props} ref={table}>{children}</table>
      <div className="ks-table-fit-probe" aria-hidden="true" ref={probe} />
    </div>
  );
};

export const MarkdownText = memo(function MarkdownText({ children }: { children: string }) {
  return (
    <div className="ks-markdown-text">
      <ReactMarkdown
        components={{
          pre: MarkdownPre,
          table: MarkdownTable,
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
