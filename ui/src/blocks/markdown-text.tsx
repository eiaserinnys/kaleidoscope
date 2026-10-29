import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownText({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={{
        a: ({ href, children: linkText }) => (
          <a href={href} onClick={(event) => event.preventDefault()}>{linkText}</a>
        ),
        img: ({ alt }) => <span className="ks-markdown-image-alt">{alt ?? ""}</span>,
      }}
      remarkPlugins={[remarkGfm]}
    >
      {children}
    </ReactMarkdown>
  );
}
