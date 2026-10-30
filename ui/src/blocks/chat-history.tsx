import type { ReactNode, Ref, UIEventHandler } from "react";
import type { ConversationAttachment, ConversationItem } from "../contract/contract";
import { Notice } from "../components/primitives";
import { ThinkingOrb } from "thinking-orbs";
import { MarkdownText } from "./markdown-text";
import type { DraftAttachment } from "./agent-attachments";

export type ChatPendingMessage = { text: string; attachments: DraftAttachment[] };

export function ChatHistory({ items, pending, delta, busy, tool, historyRef, onScroll, renderAttachment, renderPendingAttachment, footer = null }: {
  items: ConversationItem[];
  pending: ChatPendingMessage | null;
  delta: string;
  busy: boolean;
  tool: string | null;
  historyRef: Ref<HTMLDivElement>;
  onScroll: UIEventHandler<HTMLDivElement>;
  renderAttachment: (attachment: ConversationAttachment, item: ConversationItem, index: number) => ReactNode;
  renderPendingAttachment: (attachment: DraftAttachment, index: number) => ReactNode;
  footer?: ReactNode;
}) {
  return <div aria-label="대화 기록" className="ks-agent-chat-history" onScroll={onScroll} ref={historyRef} role="log">
    {items.map((item) => <ChatItem key={item.id} item={item} renderAttachment={renderAttachment} />)}
    {pending !== null ? <div className="ks-agent-chat-user is-pending">{pending.text}{pending.attachments.length ? <div className={`ks-agent-attachment-history${pending.text ? " has-text" : ""}`}>{pending.attachments.map((attachment, index) => renderPendingAttachment(attachment, index))}</div> : null}</div> : null}
    {delta ? <div className="ks-agent-chat-assistant"><div className="ks-agent-chat-assistant-content"><MarkdownText>{delta}</MarkdownText></div></div> : null}
    {(busy || pending !== null) && !delta ? (
      <div className="ks-agent-chat-working">
        <ThinkingOrb aria-label="생각 중입니다" size={20} state="working" theme="auto" />
        <span>생각 중입니다…{tool ? ` · ${tool}` : ""}</span>
      </div>
    ) : null}
    {footer}
  </div>;
}

export function ChatItem({ item, renderAttachment }: {
  item: ConversationItem;
  renderAttachment: (attachment: ConversationAttachment, item: ConversationItem, index: number) => ReactNode;
}) {
  if (item.kind === "user") return <div className="ks-agent-chat-user">{item.text}{item.attachments?.length ? <div className={`ks-agent-attachment-history${item.text ? " has-text" : ""}`}>{item.attachments.map((attachment, index) => renderAttachment(attachment, item, index))}</div> : null}</div>;
  if (item.kind === "assistant") return <div className="ks-agent-chat-assistant"><div className="ks-agent-chat-assistant-content"><MarkdownText>{item.text}</MarkdownText></div></div>;
  if (item.kind === "error") return <Notice role="alert">{item.text}</Notice>;
  return <div className="ks-agent-chat-notice">{item.text}</div>;
}
