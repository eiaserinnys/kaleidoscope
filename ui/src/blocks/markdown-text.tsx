import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useOptionalWindowData } from "../data/window-data";
import { toCoreError } from "../core/core-transport";

export function MarkdownText({ children }: { children: string }) {
  const data = useOptionalWindowData();
  return (
    <div className="ks-markdown-text">
      <ReactMarkdown
        components={{
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
        remarkPlugins={[remarkGfm]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
