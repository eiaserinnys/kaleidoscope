import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Block, ChatClient, ConversationAttachment, ConversationItem, CoreError } from "../contract/contract";
import type { ClientChatAttachment, ClientChatQueuedMessage } from "../data/client-chat";
import { useWindowData } from "../data/window-data";
import type { BlockContext } from "./block-context";
import { ChatComposer } from "./chat-composer";
import { ChatHistory, type ChatPendingMessage } from "./chat-history";
import { HistoryAttachmentView, ImagePreview, PendingAttachment, type DraftAttachment, type Preview } from "./agent-attachments";
import { useFrameCoalesced } from "./frame-coalesced";
import { renderBlock } from "../render/render-block";
import { toCoreError } from "../core/core-transport";
import { ThinkingOrb } from "thinking-orbs";

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

function openPayload(payload: ClientChatAttachment, name: string) {
  const url = URL.createObjectURL(new Blob([payload.bytes], { type: payload.mime }));
  const tab = window.open("about:blank", "_blank");
  if (tab) {
    tab.opener = null;
    tab.location.href = url;
  } else {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    link.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ClientChatBlock({ block, context, pointer }: { block: ClientChatBlockData; context: BlockContext; pointer: string }) {
  const data = useWindowData();
  const { channel: channelName, on_send, on_cancel, on_attachment } = block.client;
  const subscribe = useCallback((listener: () => void) => data.subscribeClientChat(channelName, listener), [channelName, data]);
  const getState = useCallback(() => data.getClientChat(channelName), [channelName, data]);
  const chat = useSyncExternalStore(subscribe, getState, getState);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingMessage | null>(null);
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [actionError, setActionError] = useState<CoreError | null>(null);
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
  }, [block.footer]);

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

  const renderAttachment = useCallback((attachment: ConversationAttachment, item: ConversationItem) => <HistoryAttachmentView
    key={`${item.id}:${attachment.id}`}
    attachment={attachment}
    cacheKey={["client-chat", context.window.id, channelName, chat.generation, item.id, attachment.id]}
    load={async () => {
      const payload = await requestAttachment(item.id, attachment);
      return payload ? { mime: payload.mime, data_base64: toBase64(payload.bytes) } : { mime: attachment.mime, data_base64: "" };
    }}
    open={async () => { const payload = await requestAttachment(item.id, attachment); if (payload) openPayload(payload, attachment.name); }}
    onPreview={setPreview}
    onError={(reason) => setActionError(toCoreError(reason))}
  />, [channelName, context.window.id, chat.generation, requestAttachment]);

  const renderQueuedMessage = useCallback((message: ClientChatQueuedMessage) => <div className="ks-agent-chat-user is-pending" key={message.id}>
    {message.text}
    {message.attachments.length ? <div className={`ks-agent-attachment-history${message.text ? " has-text" : ""}`}>
      {message.attachments.map((attachment) => <HistoryAttachmentView
        key={`${message.id}:${attachment.id}`}
        attachment={attachment}
        cacheKey={["client-chat-queued", context.window.id, channelName, chat.generation, message.id, attachment.id]}
        load={async () => {
          const payload = await requestAttachment(message.id, attachment);
          return payload ? { mime: payload.mime, data_base64: toBase64(payload.bytes) } : { mime: attachment.mime, data_base64: "" };
        }}
        open={async () => { const payload = await requestAttachment(message.id, attachment); if (payload) openPayload(payload, attachment.name); }}
        onPreview={setPreview}
        onError={(reason) => setActionError(toCoreError(reason))}
      />)}
    </div> : null}
  </div>, [channelName, context.window.id, chat.generation, requestAttachment]);

  const send = async (returnFocus = false) => {
    const submittedDraft = draft;
    const text = submittedDraft.trim();
    const submittedAttachments = attachments;
    if ((!text && submittedAttachments.length === 0) || sending) return;
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
    void data.requestClientAction(on_cancel, { stream_id: chat.stream_id }).catch((reason) => setActionError(toCoreError(reason)));
  };

  const footer = <>
    {chat.loading ? <div className="ks-agent-chat-working"><ThinkingOrb aria-label="불러오는 중" size={20} state="working" theme="auto" /><span>불러오는 중…</span></div> : null}
    {block.footer ? <div className="ks-agent-chat-footer" ref={footerRef}>{renderBlock(block.footer, context, `${pointer}/footer`)}</div> : null}
  </>;
  const pendingForDisplay = pending?.generation === chat.generation && !chat.queued.some((message) => message.id === pending.requestId)
    && !chat.items.some((item) => matchesPending(item, pending)) ? pending : null;

  return <section className="ks-agent-chat">
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
    />
    <ChatComposer
      draft={draft}
      onDraft={setDraft}
      inputRef={inputRef}
      attachments={attachments}
      onAttachmentsChange={setAttachments}
      onSend={(returnFocus) => { void send(returnFocus); }}
      disabled={false}
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
