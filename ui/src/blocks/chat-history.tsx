import { memo, useEffect, useId, useLayoutEffect, useRef, type ReactNode, type Ref, type UIEvent } from "react";
import type { ConversationAttachment, ConversationItem } from "../contract/contract";
import { Notice } from "../components/primitives";
import { ThinkingOrb } from "thinking-orbs";
import { MarkdownText } from "./markdown-text";
import type { DraftAttachment } from "./agent-attachments";
import { markResponding } from "../profiler/chat-responding";

export type ChatPendingMessage = { text: string; attachments: DraftAttachment[] };

export function ChatHistory({ items, pending, delta, busy, tool, historyRef, followTail, onReachTop, renderAttachment, renderPendingAttachment, footer = null }: {
  items: ConversationItem[];
  pending: ChatPendingMessage | null;
  delta: string;
  busy: boolean;
  tool: string | null;
  historyRef: Ref<HTMLDivElement>;
  followTail: { current: boolean };
  onReachTop?: () => void;
  renderAttachment: (attachment: ConversationAttachment, item: ConversationItem, index: number) => ReactNode;
  renderPendingAttachment: (attachment: DraftAttachment, index: number) => ReactNode;
  footer?: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);
  const respondingKey = useId();
  const responding = busy || pending !== null || Boolean(delta);

  useEffect(() => {
    markResponding(respondingKey, responding);
    return () => markResponding(respondingKey, false);
  }, [respondingKey, responding]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const history = content?.parentElement;
    if (!content || !history) return;
    const follow = () => { if (followTail.current) history.scrollTop = history.scrollHeight; };
    follow();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    observer.observe(history);
    return () => observer.disconnect();
  }, [followTail]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const history = event.currentTarget;
    const threshold = Number.parseFloat(getComputedStyle(history).getPropertyValue("--ks-space-6")) || 0;
    const distance = history.scrollHeight - history.clientHeight - history.scrollTop;
    followTail.current = distance <= threshold || (followTail.current && history.scrollTop >= lastScrollTop.current);
    lastScrollTop.current = history.scrollTop;
    if (history.scrollTop <= threshold) onReachTop?.();
  };

  return <div aria-label="대화 기록" className="ks-agent-chat-history" onScroll={handleScroll} ref={historyRef} role="log">
    <div className="ks-agent-chat-content" ref={contentRef}>
      <ChatItems items={items} renderAttachment={renderAttachment} />
      {pending !== null ? <div className="ks-agent-chat-user is-pending">{pending.text}{pending.attachments.length ? <div className={`ks-agent-attachment-history${pending.text ? " has-text" : ""}`}>{pending.attachments.map((attachment, index) => renderPendingAttachment(attachment, index))}</div> : null}</div> : null}
      {delta ? <div className="ks-agent-chat-assistant"><div className="ks-agent-chat-assistant-content"><MarkdownText>{delta}</MarkdownText></div></div> : null}
      {(busy || pending !== null) && !delta ? (
        <div className="ks-agent-chat-working">
          <ThinkingOrb aria-label="생각 중입니다" size={20} state="working" theme="auto" />
          <span>생각 중입니다…{tool ? ` · ${tool}` : ""}</span>
        </div>
      ) : null}
      {footer}
    </div>
  </div>;
}

const ChatItems = memo(function ChatItems({ items, renderAttachment }: {
  items: ConversationItem[];
  renderAttachment: (attachment: ConversationAttachment, item: ConversationItem, index: number) => ReactNode;
}) {
  return <>{items.map((item) => <ChatItem key={item.id} item={item} renderAttachment={renderAttachment} />)}</>;
});

export const ChatItem = memo(function ChatItem({ item, renderAttachment }: {
  item: ConversationItem;
  renderAttachment: (attachment: ConversationAttachment, item: ConversationItem, index: number) => ReactNode;
}) {
  if (item.kind === "user") return <div className="ks-agent-chat-user">{item.text}{item.attachments?.length ? <div className={`ks-agent-attachment-history${item.text ? " has-text" : ""}`}>{item.attachments.map((attachment, index) => renderAttachment(attachment, item, index))}</div> : null}</div>;
  if (item.kind === "assistant") return <div className="ks-agent-chat-assistant"><div className="ks-agent-chat-assistant-content"><MarkdownText>{item.text}</MarkdownText></div></div>;
  if (item.kind === "error") return <Notice role="alert">{item.text}</Notice>;
  return <div className="ks-agent-chat-notice">{item.text}</div>;
});
