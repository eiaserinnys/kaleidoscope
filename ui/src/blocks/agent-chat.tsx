import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Block, ConversationAttachment, ConversationEvent, ConversationItem, ConversationModel, ConversationProfile, ConversationThread, CoreEvent, CoreError, ConversationUpload } from "../contract/contract";
import { useConversationHistory } from "./conversation-history";
import { DataState } from "../components/data-state";
import { Button, EmptyState, Notice, StatusText } from "../components/primitives";
import { MessageSquare } from "../components/icons";
import { toCoreError } from "../core/core-transport";
import type { LegacyBlockContext as BlockContext } from "./block-context";
import { useShareDescriber } from "../share/visible";
import { flushShareViews } from "../share/share-view";
import { HistoryAttachmentView, ImagePreview, PendingAttachment, makeDraftAttachment, readUpload, type DraftAttachment, type Preview } from "./agent-attachments";
import { ChatComposer } from "./chat-composer";
import { ChatHistory } from "./chat-history";
import { Select } from "../components/select-toggle";
import { Dialog } from "../components/dialog";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { executionPlaces, keepStartModel, pickModel, placeIdOf } from "./agent-chat-places";

export type AgentChatBlockData = Extract<Block, { type: "chat" }>;

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
  const [models, setModels] = useState<ConversationModel[]>([]);
  const [profiles, setProfiles] = useState<ConversationProfile[]>([]);
  const [thread, setThread] = useState<ConversationThread | null>(null);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [loading, setLoading] = useState(true);
  const [loginRequired, setLoginRequired] = useState(false);
  const [bindingConflict, setBindingConflict] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [loadingChoices, setLoadingChoices] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<{ profile?: string; model?: string; label: string } | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
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
  useShareDescriber(shareRef, () => ({ text: "[채팅]", visual: false }));
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  const renderAttachment = useCallback((attachment: ConversationAttachment, item: ConversationItem, index: number) => <HistoryAttachmentView
    key={index}
    attachment={attachment}
    cacheKey={["conversation", windowId, item.id, attachment.id]}
    load={async () => {
      const reply = await context.store.call({ op: "conversation.attachment", window_id: windowId, item_id: item.id, attachment_id: attachment.id });
      if (reply.op !== "conversation.attachment") throw new Error("첨부를 불러오지 못했습니다");
      return { mime: reply.mime, data_base64: reply.data_base64 };
    }}
    open={async () => { await context.store.call({ op: "conversation.attachment_open", window_id: windowId, item_id: item.id, attachment_id: attachment.id }); }}
    onPreview={setPreview}
    onError={(reason) => setSendError(toCoreError(reason).message)}
  />, [context.store, windowId]);

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

  const load = useCallback(async (initialEvents: CoreEvent[] = [], profile?: string) => {
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
        const reply = await context.store.call({ op: "conversation.get", window_id: windowId, ...(profile ? { profile } : {}) });
        if (generation !== loadGeneration.current) return;
        const sameThread = threadId.current !== null && threadId.current === reply.thread?.id;
        threadId.current = reply.thread?.id ?? null;
        setAgent(Boolean(reply.thread));
        setThread(reply.thread);
        setItems(uniqueItems(reply.items));
        acknowledge(reply.items);
        setNextBefore(reply.next_before);
        setModels(reply.models);
        setProfiles(reply.profiles);
        if (!reply.thread) {
          setSelectedProfile(reply.start.profile);
          setSelectedPreset(reply.start.model ?? "");
        }
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

  const loadModelChoices = async (profile: string, previous: ConversationModel | undefined) => {
    setLoadingChoices(true);
    setLoadError(null);
    try {
      const reply = await context.store.call({ op: "conversation.get", window_id: windowId, profile });
      if (reply.op !== "conversation.get") return;
      setModels(reply.models);
      setProfiles(reply.profiles);
      if (!reply.thread) setSelectedPreset(keepStartModel(reply.models, reply.start.model, previous) ?? "");
    } catch (reason) {
      const error = toCoreError(reason);
      if (!handleError(error)) setLoadError(error.message);
    } finally {
      setLoadingChoices(false);
    }
  };

  const switchConversation = async (selection: { profile?: string; model?: string }) => {
    if (!thread || switching || busy) return;
    setSwitching(true);
    setLoadError(null);
    try {
      const reply = await context.store.call({ op: "conversation.switch", window_id: windowId, ...selection });
      if (reply.op !== "conversation.switch") return;
      setThread(reply.thread);
      setAgent(true);
      setNotices(reply.notices);
      setPendingSwitch(null);
      await load([], reply.thread.profile?.id);
    } catch (reason) {
      const error = toCoreError(reason);
      if (!handleError(error)) setLoadError(error.message);
    } finally {
      setSwitching(false);
    }
  };

  const selectProfile = (value: JsonValue) => {
    if (typeof value !== "string" || busy || switching) return;
    const profile = profiles.find((item) => item.id === value);
    if (!profile?.available) return;
    if (!agent) {
      const previous = models.find((item) => item.id === selectedPreset);
      setSelectedProfile(value);
      setSelectedPreset("");
      void loadModelChoices(value, previous);
      return;
    }
    if (!thread?.profile || thread.profile.id === value) return;
    setPendingSwitch({ profile: value, label: profile.label });
  };

  const selectModel = (value: JsonValue) => {
    if (typeof value !== "string" || busy || switching) return;
    const model = models.find((item) => item.id === value);
    if (!model?.available) return;
    if (!agent) { setSelectedPreset(value); return; }
    if (!thread || thread.model.id === value) return;
    void switchConversation({ model: value });
  };

  const visibleProfiles = thread?.profile && !profiles.some((item) => item.id === thread.profile?.id)
    ? [...profiles, { ...thread.profile, available: true }]
    : profiles;
  const profileGroups = [{ options: visibleProfiles.map((profile) => ({
    value: profile.id,
    label: profile.label,
    disabled: !profile.available,
    description: !profile.available ? profile.reason ?? "쓸 수 없음" : undefined,
  })) }];
  const visibleModels = thread && !models.some((item) => item.id === thread.model.id)
    ? [...models, { ...thread.model, available: true }]
    : models;
  const places = executionPlaces(visibleModels);
  const selectedStartModel = models.find((item) => item.id === selectedPreset);
  const currentPlaceId = agent && thread ? placeIdOf(thread.model)
    : selectedStartModel ? placeIdOf(selectedStartModel)
    : places.find((place) => place.available)?.id;
  const currentPlace = places.find((place) => place.id === currentPlaceId);
  const modelOptions = currentPlace?.models.map((model) => ({
    value: model.id,
    label: model.label,
    disabled: !model.available,
    description: !model.available ? modelAvailabilityDescription(model) : undefined,
  })) ?? [];
  const selectPlace = (value: JsonValue) => {
    if (typeof value !== "string" || busy || switching) return;
    const place = places.find((item) => item.id === value);
    if (!place?.available) return;
    const model = pickModel(place, (agent ? thread?.model : selectedStartModel)?.label);
    if (!model) return;
    if (!agent) { setSelectedPreset(model.id); return; }
    if (!thread || placeIdOf(thread.model) === value) return;
    setPendingSwitch({ model: model.id, label: `${place.label}의 ${model.label}` });
  };
  const selectedStartProfile = profiles.find((item) => item.id === selectedProfile);
  const selectorsDisabled = busy || switching || loadingChoices;
  const selectorRow = (
    <div className="ks-file-tree-header ks-web-toolbar ks-agent-chat-toolbar">
      <Select
        groups={profileGroups}
        value={agent ? thread?.profile?.id : selectedProfile}
        label="프로필"
        placeholder={agent && !thread?.profile ? "" : "프로필 선택"}
        disabled={selectorsDisabled || (agent ? !thread?.profile : visibleProfiles.length === 0)}
        onChange={selectProfile}
      />
      {places.length >= 2 ? (
        <Select
          groups={[{ options: places.map((place) => ({
            value: place.id,
            label: place.label,
            disabled: !place.available,
            description: place.available ? undefined : modelAvailabilityDescription(place.models[0]),
          })) }]}
          value={currentPlaceId}
          label="실행 위치"
          placeholder="실행 위치 선택"
          disabled={selectorsDisabled}
          onChange={selectPlace}
        />
      ) : null}
      <Select
        groups={[{ options: modelOptions }]}
        value={agent ? thread?.model.id : selectedPreset}
        label="모델"
        placeholder="모델 선택"
        disabled={selectorsDisabled || modelOptions.length === 0}
        onChange={selectModel}
      />
      {agent && busy ? <span className="ks-agent-chat-change-hint">답변이 끝난 뒤 바꿀 수 있습니다</span> : null}
    </div>
  );

  const start = async () => {
    const profile = profiles.find((item) => item.id === selectedProfile);
    const model = models.find((item) => item.id === selectedPreset);
    if (!profile?.available || !model?.available || creating || loadingChoices) return;
    setCreating(true);
    setCreateError(null);
    const events: CoreEvent[] = [];
    conversationQueue.current = events; creatingConversation.current = true;
    try {
      await context.store.call({ op: "conversation.create", window_id: windowId, model: selectedPreset, profile: selectedProfile });
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
        {selectorRow}
        <div className="ks-agent-chat-start-action">
          <Button disabled={!selectedStartProfile?.available || !selectedStartModel?.available || creating || switching || loadingChoices} variant="emphasis" onClick={() => void start()}>시작</Button>
          {creating ? <StatusText>시작하는 중</StatusText> : null}
          {createError ? <Notice role="alert">{createError}</Notice> : null}
        </div>
      </div>
    );
  }

  return (
    <section className="ks-agent-chat" ref={shareRef}>
      {selectorRow}
      {notices.length ? <Notice>{notices.join("\n")}</Notice> : null}
      <ChatHistory
        items={items}
        pending={pending}
        delta={delta}
        busy={busy}
        tool={tool}
        historyRef={historyRef}
        onScroll={(event) => {
          const history = event.currentTarget;
          const threshold = Number.parseFloat(getComputedStyle(history).getPropertyValue("--ks-space-6")) || 0;
          followTail.current = history.scrollHeight - history.clientHeight - history.scrollTop <= threshold;
          if (hasProvider && nextBefore && history.scrollTop <= threshold) loadOlder();
        }}
        renderAttachment={renderAttachment}
        renderPendingAttachment={(attachment, index) => <PendingAttachment key={index} attachment={attachment} onPreview={setPreview} />}
      />
      <ChatComposer
        draft={draft}
        onDraft={setDraft}
        inputRef={inputRef}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        onSend={(returnFocus) => { void send(returnFocus); }}
        disabled={false}
        busy={sending}
        sharedWindows={sharedWindows}
        onRemoveShared={(id) => { void context.store.call({ op: "share.set", window_id: id, on: false }); }}
        onPreview={setPreview}
        error={sendError}
        onError={setSendError}
      />
      {preview ? <ImagePreview preview={preview} onClose={closePreview} /> : null}
      {pendingSwitch ? (() => {
        const host = shareRef.current?.closest<HTMLElement>(".ks-data-window") ?? shareRef.current?.parentElement;
        return host ? <Dialog
          host={host}
          title={`${pendingSwitch.label}(으)로 바꾸면 새 세션으로 이어집니다. 지난 대화는 요약으로 넘어갑니다.`}
          ok="바꾸기"
          onCancel={() => setPendingSwitch(null)}
          onConfirm={() => void switchConversation({ ...(pendingSwitch.profile ? { profile: pendingSwitch.profile } : {}), ...(pendingSwitch.model ? { model: pendingSwitch.model } : {}) })}
        /> : null;
      })() : null}
    </section>
  );
}

export function modelAvailabilityDescription(model: { reason?: string; resets_at?: string }, now = new Date()): string {
  const reason = model.reason;
  if (!model.resets_at) return reason || "쓸 수 없음";
  const resetsAt = new Date(model.resets_at);
  if (!Number.isFinite(resetsAt.getTime())) return reason || "쓸 수 없음";
  const formatDay = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const day = formatDay(resetsAt) === formatDay(now)
    ? "오늘"
    : formatDay(resetsAt) === formatDay(nextDay)
      ? "내일"
      : `${resetsAt.getMonth() + 1}월 ${resetsAt.getDate()}일`;
  const time = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(resetsAt);
  const reset = `${day} ${time} 풀림`;
  return reason ? `${reason}, ${reset}` : reset;
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
