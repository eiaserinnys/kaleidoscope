import { memo, useEffect, useId, useLayoutEffect, useRef, type MouseEvent, type ReactNode, type Ref, type UIEvent } from "react";
import type { BindingValue, ConversationAttachment, ConversationItem } from "../contract/contract";
import { DataState } from "../components/data-state";
import { Notice } from "../components/primitives";
import { ThinkingOrb } from "thinking-orbs";
import { MarkdownText } from "./markdown-text";
import type { DraftAttachment } from "./agent-attachments";
import { markResponding } from "../profiler/chat-responding";
import { openContextMenu, writeMenuClipboard } from "../components/context-menu";

export function messageContextMenu(event: MouseEvent<HTMLElement>, text: string) {
  if (event.defaultPrevented || !text) return;
  openContextMenu(event, [{ id: "message-copy", label: "메시지 복사", onSelect: () => { void writeMenuClipboard(text, "메시지 복사"); } }]);
}

export type ChatPendingMessage = { text: string; attachments: DraftAttachment[]; afterResponse?: boolean };

export function ChatHistory({ items, pending, delta, busy, tool, historyRef, followTail, onReachTop, renderAttachment, renderPendingAttachment, queued = null, footer = null, hideThinking = false, state = null }: {
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
  queued?: ReactNode;
  footer?: ReactNode;
  hideThinking?: boolean;
  state?: Exclude<BindingValue, { status: "ready" }> | null;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);
  const previousState = useRef(state);
  const previousItems = useRef(items);
  const respondingKey = useId();
  const responding = busy || pending !== null || Boolean(delta);

  useEffect(() => {
    markResponding(respondingKey, responding);
    return () => markResponding(respondingKey, false);
  }, [respondingKey, responding]);

  useLayoutEffect(() => {
    if (previousState.current === null && state !== null) followTail.current = true;
    previousState.current = state;
    const lastItem = previousItems.current.at(-1);
    if (lastItem && !items.some((item) => item.id === lastItem.id)) {
      followTail.current = true;
      const history = contentRef.current?.parentElement;
      if (history) history.scrollTop = history.scrollHeight;
    }
    previousItems.current = items;
  }, [state, items, followTail]);

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

  const pendingRow = pending !== null ? <div className="ks-agent-chat-user is-pending" tabIndex={pending.text ? 0 : undefined} onContextMenu={(event) => messageContextMenu(event, pending.text)}>{pending.text}{pending.attachments.length ? <div className={`ks-agent-attachment-history${pending.text ? " has-text" : ""}`}>{pending.attachments.map((attachment, index) => renderPendingAttachment(attachment, index))}</div> : null}</div> : null;
  return <div aria-label="대화 기록" className="ks-agent-chat-history" onScroll={handleScroll} ref={historyRef} role="log">
    <div className="ks-agent-chat-content" ref={contentRef}>
      {state ? <DataState value={state} /> : <>
      <ChatItems items={items} renderAttachment={renderAttachment} />
      {!pending?.afterResponse ? pendingRow : null}
      {delta ? <div className="ks-agent-chat-assistant" tabIndex={0} onContextMenu={(event) => messageContextMenu(event, delta)}><div className="ks-agent-chat-assistant-content"><MarkdownText>{delta}</MarkdownText></div></div> : null}
      {queued}
      {pending?.afterResponse ? pendingRow : null}
      {(busy || pending !== null) && !delta && !hideThinking ? (
        <div className="ks-agent-chat-working">
          <ThinkingOrb aria-label="생각 중입니다" size={20} state="working" theme="auto" />
          <span>생각 중입니다…{tool ? ` · ${tool}` : ""}</span>
        </div>
      ) : null}
      {footer}
      </>}
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
  if (item.kind === "user") return <div className="ks-agent-chat-user" tabIndex={item.text ? 0 : undefined} onContextMenu={(event) => messageContextMenu(event, item.text)}>{item.text}{item.attachments?.length ? <div className={`ks-agent-attachment-history${item.text ? " has-text" : ""}`}>{item.attachments.map((attachment, index) => renderAttachment(attachment, item, index))}</div> : null}</div>;
  if (item.kind === "assistant") return <div className="ks-agent-chat-assistant" tabIndex={item.text ? 0 : undefined} onContextMenu={(event) => messageContextMenu(event, item.text)}><div className="ks-agent-chat-assistant-content"><MarkdownText>{item.text}</MarkdownText></div></div>;
  if (item.kind === "error") return <Notice role="alert">{item.text}</Notice>;
  return <div className="ks-agent-chat-notice">{item.text}</div>;
});
