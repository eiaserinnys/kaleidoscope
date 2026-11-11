import { encodeCommentKey } from "../comments/key";
import { useBlockRootProps } from "../comments/block-root";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Block, ChatClient, ConversationAttachment, ConversationItem } from "../contract/contract";
import type { ClientChatAttachment, ClientChatQueuedMessage } from "../data/client-chat";
import { useBinding, useChatDraft, useWindowData } from "../data/window-data";
import type { BlockContext } from "./block-context";
import { ChatComposer, chatAreaPaste } from "./chat-composer";
import { ChatHistory, messageContextMenu, type ChatPendingMessage } from "./chat-history";
import { fromBase64, HistoryAttachmentView, ImagePreview, openPayload, PendingAttachment, type Preview } from "./agent-attachments";
import { useFrameCoalesced } from "./frame-coalesced";
import { renderBlock } from "../render/render-block";
import { toCoreError } from "../core/core-transport";

export type ClientChatBlockData = Extract<Block, { type: "chat" }> & { client: ChatClient };
type PendingMessage = ChatPendingMessage & { requestId: string; generation: number; knownIds: Set<string> };

function toBase64(bytes: ArrayBuffer) {
  const data = new Uint8Array(bytes);
  let binary = "";
  for (let index = 0; index < data.length; index += 32768) binary += String.fromCharCode(...data.subarray(index, index + 32768));
  return btoa(binary);
}

function matchesPending(item: ConversationItem, pending: PendingMessage) {
  if (item.kind !== "user" || pending.knownIds.has(item.id)) return false;
  if (item.id === pending.requestId) return true;
  if (item.text !== pending.text) return false;
  const expected = pending.attachments.map((attachment) => attachment.name).sort();
  const actual = (item.attachments ?? []).map((attachment) => attachment.name).sort();
  return expected.length === actual.length && expected.every((name, index) => name === actual[index]);
}

export function ClientChatBlock({ block, context, pointer }: { block: ClientChatBlockData; context: BlockContext; pointer: string }) {
  const blockRoot = useBlockRootProps();
  const data = useWindowData();
  const { channel: channelName, on_send, on_cancel, on_attachment } = block.client;
  const subscribe = useCallback((listener: () => void) => data.subscribeClientChat(channelName, listener), [channelName, data]);
  const getState = useCallback(() => data.getClientChat(channelName), [channelName, data]);
  const chat = useSyncExternalStore(subscribe, getState, getState);
  const loadingBinding = useBinding(`${pointer}/loading`, block.loading ?? false);
  const historyState = loadingBinding.status !== "ready" ? loadingBinding
    : loadingBinding.value === true || chat.loading ? { status: "loading" as const } : null;
  const disabled = historyState !== null;
  /* 카드나 세션이 바뀌면 초안·첨부·동작 오류도 그 자리에 따로 둔다. 돌아오면 쓰던 초안이 그대로 있다. */
  const draftKey = chat.scope ? `client:${channelName}:${chat.scope}` : `client:${channelName}`;
  const { draft, setDraft, attachments, setAttachments, error: actionError, setError: setActionError } = useChatDraft(draftKey);
  const [pending, setPending] = useState<PendingMessage | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [delta, setDelta] = useState("");
  const coalescedDelta = useFrameCoalesced(setDelta);
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [waitingForFooter, setWaitingForFooter] = useState(false);
  const followTail = useRef(true);
  const [sending, setSending] = useState(false);

  useLayoutEffect(() => {
    const footer = footerRef.current;
    if (!footer) { setWaitingForFooter(false); return; }
    const refresh = () => setWaitingForFooter(Boolean(footer.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')));
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(footer, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    return () => observer.disconnect();
  }, [block.footer, disabled]);

  useEffect(() => {
    if (chat.loading) {
      coalescedDelta.cancel();
      setDelta("");
      setPending(null);
      return;
    }
    if (chat.stream_id || chat.text) coalescedDelta.schedule(chat.text);
    else {
      coalescedDelta.flush();
      setDelta("");
    }
  }, [chat.loading, chat.stream_id, chat.text, coalescedDelta]);

  useEffect(() => {
    setPending((current) => current && (
      current.generation !== chat.generation
      || chat.items.some((item) => matchesPending(item, current))
      || chat.queued.some((message) => message.id === current.requestId)
    ) ? null : current);
  }, [chat.generation, chat.items, chat.queued]);

  const requestAttachment = useCallback((itemId: string, attachment: ConversationAttachment) => {
    const requestId = crypto.randomUUID();
    const generation = data.getClientChat(channelName).generation;
    return new Promise<ClientChatAttachment | null>((resolve, reject) => {
      let actionFinished = false;
      let settled = false;
      let unsubscribe: () => void = () => undefined;
      const finish = () => {
        if (settled) return;
        const state = data.getClientChat(channelName);
        if (state.generation !== generation) {
          settled = true;
          unsubscribe();
          resolve(null);
          return;
        }
        if (!actionFinished) return;
        const payload = data.takeClientChatAttachment(channelName, requestId);
        if (!payload) return;
        settled = true;
        unsubscribe();
        resolve(payload);
      };
      unsubscribe = data.subscribeClientChat(channelName, finish);
      void data.requestClientAction(on_attachment, {
        request_id: requestId,
        item_id: itemId,
        attachment_id: attachment.id,
      }).then(() => {
        actionFinished = true;
        finish();
      }, (reason) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        reject(reason);
      });
    });
  }, [channelName, data, on_attachment]);

  const resolveAttachmentPayload = useCallback(async (itemId: string, attachment: ConversationAttachment): Promise<{ mime: string; bytes: ArrayBuffer; data_base64: string } | null> => {
    const payload = await requestAttachment(itemId, attachment);
    if (!payload) return null;
    if ("media" in payload) {
      const reply = await context.store.call({ op: "data.media", window_id: context.window.id, media: payload.media });
      if (reply.op !== "data.media") return null;
      return { mime: reply.media.mime, data_base64: reply.media.data_base64, bytes: fromBase64(reply.media.data_base64) };
    }
    return { mime: payload.mime, bytes: payload.bytes, data_base64: toBase64(payload.bytes) };
  }, [context.store, context.window.id, requestAttachment]);

  const renderAttachment = useCallback((attachment: ConversationAttachment, item: ConversationItem) => <HistoryAttachmentView
    key={`${item.id}:${attachment.id}`}
    attachment={attachment}
    cacheKey={["client-chat", context.window.id, channelName, chat.generation, item.id, attachment.id]}
    load={async () => {
      const resolved = await resolveAttachmentPayload(item.id, attachment);
      return resolved ? { mime: resolved.mime, data_base64: resolved.data_base64 } : { mime: attachment.mime, data_base64: "" };
    }}
    open={async () => { const resolved = await resolveAttachmentPayload(item.id, attachment); if (resolved) openPayload({ mime: resolved.mime, bytes: resolved.bytes }, attachment.name); }}
    onPreview={setPreview}
    onError={(reason) => setActionError(toCoreError(reason))}
  />, [channelName, context.window.id, chat.generation, resolveAttachmentPayload]);

  const renderQueuedMessage = useCallback((message: ClientChatQueuedMessage) => <div data-ks-comment-key={encodeCommentKey(message.id)} className="ks-agent-chat-user is-pending" key={message.id} tabIndex={message.text ? 0 : undefined} onContextMenu={(event) => messageContextMenu(event, message.text)}>
    {message.text}
    {message.attachments.length ? <div className={`ks-agent-attachment-history${message.text ? " has-text" : ""}`}>
      {message.attachments.map((attachment) => <HistoryAttachmentView
        key={`${message.id}:${attachment.id}`}
        attachment={attachment}
        cacheKey={["client-chat-queued", context.window.id, channelName, chat.generation, message.id, attachment.id]}
        load={async () => {
          const resolved = await resolveAttachmentPayload(message.id, attachment);
          return resolved ? { mime: resolved.mime, data_base64: resolved.data_base64 } : { mime: attachment.mime, data_base64: "" };
        }}
        open={async () => { const resolved = await resolveAttachmentPayload(message.id, attachment); if (resolved) openPayload({ mime: resolved.mime, bytes: resolved.bytes }, attachment.name); }}
        onPreview={setPreview}
        onError={(reason) => setActionError(toCoreError(reason))}
      />)}
    </div> : null}
  </div>, [channelName, context.window.id, chat.generation, resolveAttachmentPayload]);

  const send = async (returnFocus = false) => {
    const submittedDraft = draft;
    const text = submittedDraft.trim();
    const submittedAttachments = attachments;
    if (disabled || (!text && submittedAttachments.length === 0) || sending) return;
    const requestId = crypto.randomUUID();
    setSending(true);
    followTail.current = true;
    setPending({ requestId, generation: chat.generation, text, attachments: submittedAttachments, knownIds: new Set(chat.items.map((item) => item.id)), afterResponse: chat.busy || chat.queued.length > 0 });
    setDraft("");
    setAttachments([]);
    setActionError(null);
    if (returnFocus) inputRef.current?.focus();
    try {
      const uploads = await Promise.all(submittedAttachments.map(async ({ file, name }) => ({
        name,
        mime: file.type,
        bytes: await file.arrayBuffer(),
      })));
      await data.requestClientAction(on_send, {
        request_id: requestId,
        text,
        attachments: uploads,
      }, uploads.map((upload) => upload.bytes));
    } catch (reason) {
      setPending(null);
      setActionError(toCoreError(reason));
      setDraft((current) => current ? `${submittedDraft}\n${current}` : submittedDraft);
      setAttachments((current) => [...submittedAttachments, ...current]);
    } finally {
      setSending(false);
    }
  };

  const cancel = () => {
    if (disabled) return;
    void data.requestClientAction(on_cancel, { stream_id: chat.stream_id }).catch((reason) => setActionError(toCoreError(reason)));
  };

  const footer = <>
    {block.footer ? <div className="ks-agent-chat-footer" ref={footerRef}>{renderBlock(block.footer, context, `${pointer}/footer`)}</div> : null}
  </>;
  const pendingForDisplay = pending?.generation === chat.generation && !chat.queued.some((message) => message.id === pending.requestId)
    && !chat.items.some((item) => matchesPending(item, pending)) ? pending : null;

  return <section {...blockRoot} className="ks-agent-chat" onPaste={(event) => chatAreaPaste(event, inputRef.current, disabled)}>
    <ChatHistory
      items={chat.items}
      pending={pendingForDisplay}
      delta={chat.loading ? "" : delta}
      busy={chat.busy}
      tool={chat.tool}
      historyRef={historyRef}
      followTail={followTail}
      renderAttachment={renderAttachment}
      renderPendingAttachment={(attachment, index) => <PendingAttachment key={index} attachment={attachment} onPreview={setPreview} />}
      queued={chat.queued.map(renderQueuedMessage)}
      hideThinking={waitingForFooter}
      footer={footer}
      state={historyState}
    />
    <ChatComposer
      draft={draft}
      onDraft={setDraft}
      inputRef={inputRef}
      attachments={attachments}
      onAttachmentsChange={setAttachments}
      onSend={(returnFocus) => { void send(returnFocus); }}
      disabled={disabled}
      busy={sending || chat.busy}
      onCancel={chat.busy ? cancel : undefined}
      sharedWindows={[]}
      onRemoveShared={() => undefined}
      onPreview={setPreview}
      error={actionError ?? chat.error}
      onError={setActionError}
    />
    {preview ? <ImagePreview preview={preview} onClose={() => setPreview(null)} /> : null}
  </section>;
}
