import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { Block, ConversationEvent, ConversationItem, CoreEvent, CoreError, ConversationUpload } from "../contract/contract";
import { useConversationHistory } from "./conversation-history";
import { DataState } from "../components/data-state";
import { Button, EmptyState, IconButton, Notice, StatusText } from "../components/primitives";
import { ArrowUp, MessageSquare, Paperclip, ScreenShare } from "../components/icons";
import { AGENT_ATTACHMENTS_MAX, AGENT_ATTACHMENT_MAX_BYTES, AGENT_ATTACHMENTS_TOTAL_MAX_BYTES } from "../contract/limits";
import { toCoreError } from "../core/core-transport";
import type { BlockContext } from "./block-context";
import { MarkdownText } from "./markdown-text";
import { ThinkingOrb } from "thinking-orbs";
import { useShareDescriber } from "../share/visible";
import { flushShareViews } from "../share/share-view";
import { AttachmentChip, DraftChip, HistoryAttachment, ImagePreview, PendingAttachment, makeDraftAttachment, readUpload, type DraftAttachment, type Preview } from "./agent-attachments";

type AgentChatBlockData = Extract<Block, { type: "agent_chat" }>;

export function AgentChatBlock({ block: _block, context }: { block: AgentChatBlockData; context: BlockContext }) {
  const provider = context.definition.agent;
  const windowId = context.window.id;
  const hasProvider = Boolean(provider);
  const providerEntry = provider?.thread_entry;
  const appVersion = context.window.app_version;
  const desktop = context.snapshot.shared.desktops.find((item) => item.id === context.window.desktop_id);
  const workspaceId = desktop?.workspace_id ?? "";
  const connected = context.snapshot.link.state === "connected";
  const sharedWindows = context.snapshot.sharing.flatMap((id) => {
    const shared = context.snapshot.shared.windows.find((item) => item.id === id);
    if (!shared || !context.snapshot.shared.desktops.some((item) => item.id === shared.desktop_id && item.workspace_id === workspaceId)) return [];
    const name = context.snapshot.shared.app_versions.find((item) => item.app_id === shared.app_id && item.version === shared.app_version)?.definition.name ?? shared.app_id;
    return [{ id, name }];
  });
  const [agent, setAgent] = useState(false);
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [models, setModels] = useState<{ preset: string; label: string; available?: boolean; reason?: string }[]>([]);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [loading, setLoading] = useState(true);
  const [loginRequired, setLoginRequired] = useState(false);
  const [bindingConflict, setBindingConflict] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingMessage | null>(null);
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [delta, setDelta] = useState("");
  const shareRef = useRef<HTMLElement>(null);
  useShareDescriber(shareRef, () => ({ text: "[작업 PAS 대화]", visual: false }));
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const focusAfterLogin = useRef(false);
  const followTail = useRef(true);
  const loadGeneration = useRef(0);
  const threadId = useRef<string | null>(null);
  const streamId = useRef<string | null>(null);
  const conversationQueue = useRef<CoreEvent[] | null>(null);
  const creatingConversation = useRef(false);
  const retryDraft = useRef<{ id: string; text: string; attachments: DraftAttachment[]; failed: boolean } | null>(null);
  const restored = useRef(new Set<string>());
  const closePreview = useCallback(() => setPreview(null), []);

  const acknowledge = useCallback((incoming: ConversationItem[]) => {
    setPending((current) => current && incoming.some((item) => matchesPending(item, current)) ? null : current);
  }, []);

  const handleError = useCallback((error: CoreError) => {
    if (error.code === "login_required") { setLoginRequired(true); return true; }
    if (error.code === "binding_conflict") { setBindingConflict(true); return true; }
    return false;
  }, []);

  const applyConversation = useCallback((update: ConversationEvent) => {
    if (update.kind === "snapshot") {
      setItems((current) => uniqueItems([...current, ...update.snapshot.items]));
      acknowledge(update.snapshot.items);
      setBusy(update.snapshot.busy);
      setTool(update.snapshot.tool);
      streamId.current = update.snapshot.stream_id;
      setDelta(update.snapshot.text ?? "");
    } else if (update.kind === "item") {
      setItems((current) => uniqueItems([...current, update.item]));
      acknowledge([update.item]);
      if (update.item.kind === "assistant") { streamId.current = null; setDelta(""); }
    } else if (update.kind === "text") {
      streamId.current = update.stream_id;
      setDelta(update.text);
    } else {
      setBusy(update.busy);
      setTool(update.tool);
      if (!update.busy) { streamId.current = null; setDelta(""); }
    }
  }, [acknowledge]);

  const restoreDraft = useCallback((id: string, text: string, uploads: ConversationUpload[], failed: boolean) => {
    if (retryDraft.current?.id === id) {
      retryDraft.current.failed = failed;
      restored.current.add(id);
      return;
    }
    if (restored.current.has(id)) return;
    restored.current.add(id);
    const files = uploads.map((upload) => {
      const bytes = Uint8Array.from(atob(upload.data_base64), (char) => char.charCodeAt(0));
      return makeDraftAttachment(new File([bytes], upload.name, { type: upload.mime }), upload.name);
    });
    retryDraft.current = { id, text, attachments: files, failed };
    setDraft((current) => current ? `${text}\n${current}` : text);
    setAttachments((current) => [...files, ...current]);
  }, []);

  const load = useCallback(async (initialEvents: CoreEvent[] = []) => {
    if (!connected || !workspaceId || !hasProvider) return;
    const generation = ++loadGeneration.current;
    const events = initialEvents;
    conversationQueue.current = events;
    setCreating(false);
    setLoading(true);
    setLoadError(null);
    setLoginRequired(false);
    setBindingConflict(false);
    try {
      {
        const reply = await context.store.call({ op: "conversation.get", window_id: windowId });
        if (generation !== loadGeneration.current) return;
        const sameThread = threadId.current !== null && threadId.current === reply.thread?.id;
        threadId.current = reply.thread?.id ?? null;
        setAgent(Boolean(reply.thread));
        setItems(uniqueItems(reply.items));
        acknowledge(reply.items);
        setNextBefore(reply.next_before);
        setModels(reply.models.map((model) => ({ preset: model.id, label: model.label, available: model.available, reason: model.reason })));
        setSelectedPreset(reply.models.find((model) => model.available)?.id ?? "");
        if (!sameThread) { setBusy(false); setTool(null); setDelta(""); }
        conversationQueue.current = null;
        events.forEach((event) => {
          if (event.event === "conversation.update" && event.thread_id === threadId.current) applyConversation(event.update);
          if (event.event === "conversation.error" && event.thread_id === threadId.current && !handleError({ code: event.code, message: "대화 연결이 끊겼습니다", details: [] })) setLoadError("대화 연결이 끊겼습니다");
        });
        return;
      }
    } catch (reason) {
      if (generation === loadGeneration.current) { const error = toCoreError(reason); if (!handleError(error)) setLoadError(error.message); }
    } finally {
      if (generation === loadGeneration.current) {
        conversationQueue.current = null;
        setLoading(false);
      }
    }
  }, [acknowledge, applyConversation, connected, context.store, workspaceId, hasProvider, windowId, appVersion, handleError]);

  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
      conversationQueue.current = null;
    };
  }, [load]);

  useEffect(() => context.store.subscribeEvents((event) => {
    if (hasProvider) {
      if (event.event === "conversation.draft" && event.window_id === windowId) restoreDraft(event.request_id, event.text, event.attachments, event.failed);
      else if (event.event === "storage.update" && event.window_id === windowId && !threadId.current && !creatingConversation.current && event.update.kind === "changed" && event.update.changed.item.entry_id === providerEntry) void load();
      else if (event.event === "conversation.update" || event.event === "conversation.error") {
        if (conversationQueue.current) conversationQueue.current.push(event);
        else if (event.thread_id === threadId.current) {
          if (event.event === "conversation.update") applyConversation(event.update);
          else if (!handleError({ code: event.code, message: "대화 연결이 끊겼습니다", details: [] })) setLoadError("대화 연결이 끊겼습니다");
        }
      }
      return;
    }
  }), [applyConversation, context.store, workspaceId, hasProvider, providerEntry, windowId, restoreDraft, handleError, load]);

  useLayoutEffect(() => {
    const history = historyRef.current;
    if (history && followTail.current) history.scrollTop = history.scrollHeight;
  }, [items, pending, delta, busy, tool]);

  useLayoutEffect(() => {
    if (!focusAfterLogin.current || loading || loginRequired || loadError || bindingConflict) return;
    const target = agent ? inputRef.current : startRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    if (target) { target.focus(); focusAfterLogin.current = false; }
  }, [agent, loading, loginRequired, loadError, bindingConflict, models]);

  const loadOlder = useConversationHistory({
    historyRef, nextBefore, enabled: hasProvider && Boolean(agent) && !loading && !loginRequired && !loadError && !bindingConflict,
    store: context.store, windowId, onItems: (older, before) => { setItems((current) => uniqueItems([...older, ...current])); setNextBefore(before); },
    onError: (reason) => { const error = toCoreError(reason); if (!handleError(error)) setSendError(error.message); },
    items,
  });

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const style = getComputedStyle(input);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const verticalPadding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const border = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
    if (!Number.isFinite(lineHeight) || !Number.isFinite(verticalPadding + border)) {
      input.style.height = "";
      input.style.maxHeight = "";
      input.style.overflowY = "hidden";
      return;
    }
    const maxHeight = lineHeight * 8 + verticalPadding + border;
    input.style.height = "auto";
    const contentHeight = input.scrollHeight + border;
    input.style.maxHeight = `${maxHeight}px`;
    input.style.height = `${Math.min(contentHeight, maxHeight)}px`;
    input.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }, [draft, agent]);

  const start = async () => {
    if (!selectedPreset || creating) return;
    setCreating(true);
    setCreateError(null);
    const events: CoreEvent[] = [];
    conversationQueue.current = events; creatingConversation.current = true;
    try {
      await context.store.call({ op: "conversation.create", window_id: windowId, model: selectedPreset });
      await load(events);
    } catch (reason) {
      const error = toCoreError(reason);
      if (!handleError(error)) setCreateError(error.message);
      setCreating(false);
    } finally {
      creatingConversation.current = false;
      if (conversationQueue.current === events) conversationQueue.current = null;
    }
  };

  const send = async (returnFocus = false) => {
    const submittedDraft = draft;
    const text = submittedDraft.trim();
    const submittedAttachments = attachments;
    if ((!text && submittedAttachments.length === 0) || sending) return;
    const retry = retryDraft.current;
    const requestId = retry && !retry.failed && retry.text === text && retry.attachments.length === submittedAttachments.length && retry.attachments.every((item, index) => item.id === submittedAttachments[index].id) ? retry.id : crypto.randomUUID();
    followTail.current = true;
    setPending({ text, attachments: submittedAttachments, knownIds: new Set(items.map((item) => item.id)) });
    setDraft("");
    setAttachments([]);
    setSending(true);
    setSendError(null);
    if (returnFocus) inputRef.current?.focus();
    try {
      const uploads = await Promise.all(submittedAttachments.map(readUpload));
      await flushShareViews();
      await context.store.call({ op: "conversation.send", window_id: windowId, request_id: requestId, text, attachments: uploads });
      retryDraft.current = null;
    } catch (reason) {
      setPending(null);
      const error = toCoreError(reason);
      if (!handleError(error)) setSendError(error.message);
      retryDraft.current = { id: requestId, text, attachments: submittedAttachments, failed: false };
      setDraft((current) => current ? `${submittedDraft}\n${current}` : submittedDraft);
      setAttachments((current) => [...submittedAttachments, ...current]);
      if (error.code !== "login_required" && error.code !== "binding_conflict") void load();
    } finally {
      setSending(false);
    }
  };

  const addAttachments = (newAttachments: DraftAttachment[]) => {
    setSendError(null);
    const accepted = [...attachments];
    let total = accepted.reduce((sum, item) => sum + item.file.size, 0);
    for (const attachment of newAttachments) {
      if (accepted.length >= AGENT_ATTACHMENTS_MAX) { setSendError("첨부는 한 번에 10개까지입니다"); break; }
      if (attachment.file.size > AGENT_ATTACHMENT_MAX_BYTES) { setSendError(`${attachment.name}은 20MB를 넘어 첨부할 수 없습니다`); continue; }
      if (total + attachment.file.size > AGENT_ATTACHMENTS_TOTAL_MAX_BYTES) { setSendError("첨부의 합은 30MB까지입니다"); continue; }
      accepted.push(attachment);
      total += attachment.file.size;
    }
    setAttachments(accepted);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const data = event.clipboardData;
    const files = Array.from(data.files);
    const pasted = files.length ? files : Array.from(data.items).filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file): file is File => file !== null);
    if (!pasted.length) return;
    if (!Array.from(data.types).includes("text/plain")) event.preventDefault();
    const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
    addAttachments(pasted.map((file) => makeDraftAttachment(file, extensions[file.type] ? `붙여넣은 이미지.${extensions[file.type]}` : file.name || "붙여넣은 파일")));
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    void send();
  };

  if (!provider) return <div className="ks-agent-chat-state"><EmptyState icon={<MessageSquare size="empty" />} text="이 앱 판에는 대화 제공자가 없습니다" /></div>;
  if (!connected) {
    return <div className="ks-agent-chat-state"><EmptyState icon={<MessageSquare size="empty" />} text="서버에 연결하면 대화할 수 있습니다" /></div>;
  }
  if (!workspaceId) return null;
  if (loading) return <div className="ks-agent-chat-state"><StatusText>불러오는 중</StatusText></div>;
  if (loginRequired && provider) return <DataState value={{ status: "login_required", permission: provider.permission }} onLogin={() => { focusAfterLogin.current = true; void load(); }} />;
  if (bindingConflict) return <div className="ks-agent-chat-state"><Notice role="alert">저장된 대화와 제공자의 대화가 다릅니다.</Notice></div>;
  if (loadError) {
    return (
      <div className="ks-agent-chat-state">
        <Notice role="alert" actions={[<Button key="retry" onClick={() => void load()}>다시 시도</Button>]}>{loadError}</Notice>
      </div>
    );
  }
  if (!agent) {
    return (
      <div className="ks-agent-chat-start" ref={startRef}>
        <div className="ks-agent-chat-models">
          {models.map((model) => (
            <Button
              key={model.preset}
              aria-pressed={selectedPreset === model.preset}
              disabled={creating || model.available === false}
              onClick={() => setSelectedPreset(model.preset)}
            >
              {model.label}{model.reason ? ` · ${model.reason}` : ""}
            </Button>
          ))}
        </div>
        <Button disabled={!selectedPreset || creating} variant="emphasis" onClick={() => void start()}>시작</Button>
        {creating ? <StatusText>시작하는 중</StatusText> : null}
        {createError ? <Notice role="alert">{createError}</Notice> : null}
      </div>
    );
  }

  return (
    <section className="ks-agent-chat" ref={shareRef}>
      <div
        aria-label="대화 기록"
        className="ks-agent-chat-history"
        onScroll={(event) => {
          const history = event.currentTarget;
          const threshold = Number.parseFloat(getComputedStyle(history).getPropertyValue("--ks-space-6")) || 0;
          followTail.current = history.scrollHeight - history.clientHeight - history.scrollTop <= threshold;
          if (hasProvider && nextBefore && history.scrollTop <= threshold) loadOlder();
        }}
        ref={historyRef}
        role="log"
      >
        {items.map((item) => <HistoryItem key={item.id} item={item} windowId={windowId} store={context.store} onPreview={setPreview} onError={setSendError} />)}
        {pending !== null ? <div className="ks-agent-chat-user is-pending">{pending.text}{pending.attachments.length ? <div className={`ks-agent-attachment-history${pending.text ? " has-text" : ""}`}>{pending.attachments.map((attachment) => <PendingAttachment key={attachment.id} attachment={attachment} onPreview={setPreview} />)}</div> : null}</div> : null}
        {delta ? <div className="ks-agent-chat-assistant"><div className="ks-agent-chat-assistant-content"><MarkdownText>{delta}</MarkdownText></div></div> : null}
        {(busy || pending !== null) && !delta ? (
          <div className="ks-agent-chat-working">
            <ThinkingOrb aria-label="생각 중입니다" size={20} state="working" theme="auto" />
            <span>생각 중입니다…{tool ? ` · ${tool}` : ""}</span>
          </div>
        ) : null}
      </div>
      <div className="ks-agent-chat-input-area">
        {sendError ? <Notice role="alert">{sendError}</Notice> : null}
        {sharedWindows.length ? <div className="ks-agent-attachment-list">{sharedWindows.map(({ id, name }) => <AttachmentChip key={id} name={name} preview={<span className="ks-agent-attachment-chip-preview ks-share-chip-icon"><ScreenShare /></span>} removeLabel={`${name} 같이 보기 끄기`} onRemove={() => void context.store.call({ op: "share.set", window_id: id, on: false })} />)}</div> : null}
        {attachments.length ? <div className="ks-agent-attachment-list">{attachments.map((attachment) => <DraftChip key={attachment.id} attachment={attachment} onPreview={setPreview} onRemove={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} />)}</div> : null}
        <div className="ks-agent-chat-input-row">
          <input type="file" multiple hidden ref={fileRef} onChange={(event) => {
            addAttachments(Array.from(event.currentTarget.files ?? []).map((file) => makeDraftAttachment(file, file.name)));
            event.currentTarget.value = "";
          }} />
          <IconButton aria-label="파일 첨부" onClick={() => fileRef.current?.click()}><Paperclip /></IconButton>
          <textarea
            aria-label="메시지"
            className="ks-text-input ks-agent-chat-input"
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={onInputKeyDown}
            onPaste={onPaste}
            ref={inputRef}
            rows={1}
            value={draft}
          />
          <IconButton aria-label="보내기" disabled={(!draft.trim() && !attachments.length) || sending} onClick={() => void send(true)}>
            <ArrowUp />
          </IconButton>
        </div>
      </div>
      {preview ? <ImagePreview preview={preview} onClose={closePreview} /> : null}
    </section>
  );
}

function HistoryItem({ item, windowId, store, onPreview, onError }: { item: ConversationItem; windowId: string; store: BlockContext["store"]; onPreview: (preview: Preview) => void; onError: (message: string) => void }) {
  if (item.kind === "user") return <div className="ks-agent-chat-user">{item.text}{item.attachments?.length ? <div className={`ks-agent-attachment-history${item.text ? " has-text" : ""}`}>{item.attachments.map((attachment, index) => <HistoryAttachment key={index} attachment={attachment} windowId={windowId} itemId={item.id} store={store} onPreview={onPreview} onError={onError} />)}</div> : null}</div>;
  if (item.kind === "assistant") {
    return <div className="ks-agent-chat-assistant"><div className="ks-agent-chat-assistant-content"><MarkdownText>{item.text}</MarkdownText></div></div>;
  }
  if (item.kind === "error") return <Notice role="alert">{item.text}</Notice>;
  return <div className="ks-agent-chat-notice">{item.text}</div>;
}

function uniqueItems(items: ConversationItem[]): ConversationItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}


type PendingMessage = { text: string; attachments: DraftAttachment[]; knownIds: Set<string> };

function matchesPending(item: ConversationItem, pending: PendingMessage): boolean {
  if (item.kind !== "user" || pending.knownIds.has(item.id) || item.text !== pending.text) return false;
  const attachments = item.attachments ?? [];
  return attachments.length >= pending.attachments.length && pending.attachments.every((draft, index) =>
    attachments[index].name === draft.name && (!draft.file.type || attachments[index].mime === draft.file.type));
}
