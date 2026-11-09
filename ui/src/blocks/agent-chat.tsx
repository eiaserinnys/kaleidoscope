import { useBlockRootProps } from "../comments/block-root";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type ReactElement } from "react";
import type { AdoptableConversation, Block, ConversationAttachment, ConversationEvent, ConversationItem, ConversationModel, ConversationProfile, ConversationThread, CoreEvent, CoreError, ConversationUpload, ShellSnapshot } from "../contract/contract";
import { useConversationHistory } from "./conversation-history";
import { DataState } from "../components/data-state";
import { Button, EmptyState, IconButton, Notice, StatusText } from "../components/primitives";
import { DataIcon } from "../components/data-icons";
import { MessageSquare } from "../components/icons";
import { toCoreError } from "../core/core-transport";
import type { BlockContext } from "./block-context";
import { useShellSelector } from "../core/shell-store";
import { useBinding, useChatDraft } from "../data/window-data";
import { useShareDescriber } from "../share/visible";
import { prepareShareForSend } from "../share/share-view";
import { HistoryAttachmentView, ImagePreview, PendingAttachment, makeDraftAttachment, readUpload, type DraftAttachment, type Preview } from "./agent-attachments";
import { ChatComposer } from "./chat-composer";
import { ChatHistory } from "./chat-history";
import { useFrameCoalesced } from "./frame-coalesced";
import { Select } from "../components/select-toggle";
import { Tooltip } from "../components/tooltip";
import { Dialog } from "../components/dialog";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { executionPlaces, keepStartModel, pickModel, placeIdOf } from "./agent-chat-places";
import * as shellErrors from "../contract/shell-errors";

export type AgentChatBlockData = Extract<Block, { type: "chat" }>;

function revealInStart(panel: HTMLElement | null, element: HTMLElement | null) {
  if (!panel || !element) return;
  const style = getComputedStyle(panel);
  const top = panel.getBoundingClientRect().top + parseFloat(style.paddingBlockStart);
  const bottom = panel.getBoundingClientRect().bottom - parseFloat(style.paddingBlockEnd);
  const box = element.getBoundingClientRect();
  if (box.bottom > bottom) panel.scrollTop += Math.min(box.bottom - bottom, box.top - top);
  else if (box.top < top) panel.scrollTop -= top - box.top;
}

export function AgentChatBlock({ block, context, pointer }: { block: AgentChatBlockData; context: BlockContext; pointer: string }) {
  const blockRoot = useBlockRootProps();
  const loadingBinding = useBinding(`${pointer}/loading`, block.loading ?? false);
  const provider = context.definition.agent;
  const windowId = context.window.id;
  const hasProvider = Boolean(provider);
  const providerEntry = provider?.thread_entry;
  const appVersion = context.window.app_version;
  const workspaceId = useShellSelector(context.store, (snapshot) =>
    snapshot?.shared.desktops.find((item) => item.id === context.window.desktop_id)?.workspace_id ?? "");
  const connected = useShellSelector(context.store, (snapshot) => snapshot?.link.state === "connected");
  const linkTarget = useShellSelector(context.store, (snapshot) => snapshot?.link.state === "connected"
    ? `${snapshot.link.mode}:${snapshot.link.server_url}`
    : "");
  const sharedWindows = useShellSelector(context.store, (snapshot) => selectSharedWindows(snapshot, workspaceId), sameSharedWindows);
  const [agent, setAgent] = useState(false);
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [models, setModels] = useState<ConversationModel[]>([]);
  const [profiles, setProfiles] = useState<ConversationProfile[]>([]);
  const [thread, setThread] = useState<ConversationThread | null>(null);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [loading, setLoading] = useState(true);
  const historyState = loadingBinding.status !== "ready" ? loadingBinding
    : loadingBinding.value === true || loading ? { status: "loading" as const } : null;
  const inputDisabled = historyState !== null;
  const [loginRequired, setLoginRequired] = useState(false);
  const [bindingConflict, setBindingConflict] = useState<CoreError | null>(null);
  const [nextBefore, setNextBefore] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<CoreError | null>(null);
  const [createError, setCreateError] = useState<CoreError | null>(null);
  const [switchError, setSwitchError] = useState<CoreError | null>(null);
  const [creating, setCreating] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [attached, setAttached] = useState(false);
  const [own, setOwn] = useState<ConversationThread | null>(null);
  const [adoptable, setAdoptable] = useState<AdoptableConversation[]>([]);
  const [attachId, setAttachId] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [detaching, setDetaching] = useState(false);
  const [attachError, setAttachError] = useState<CoreError | null>(null);
  const [loadingChoices, setLoadingChoices] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<{ profile?: string; model?: string; label: string } | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const { draft, setDraft, attachments, setAttachments, error: sendError, setError: setSendError, updateComposer, getComposer } = useChatDraft("conversation");
  const [pending, setPending] = useState<PendingMessage | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [delta, setDelta] = useState("");
  const coalescedDelta = useFrameCoalesced(setDelta);
  const shareRef = useRef<HTMLElement>(null);
  useShareDescriber(shareRef, () => ({ text: "[채팅]", visual: false }));
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const createHeadRef = useRef<HTMLDivElement>(null);
  const attachHeadRef = useRef<HTMLDivElement>(null);
  const createNoticeRef = useRef<HTMLDivElement>(null);
  const attachNoticeRef = useRef<HTMLDivElement>(null);
  // 진행 글이 뜨는 구역 제목 줄과 실패 알림이 시작 판 안에 보이게 판만 스크롤한다. 창이나 쉘은 움직이지 않는다.
  useLayoutEffect(() => {
    if (creating) revealInStart(startRef.current, createHeadRef.current);
  }, [creating]);
  useLayoutEffect(() => {
    if (attaching) revealInStart(startRef.current, attachHeadRef.current);
  }, [attaching]);
  useLayoutEffect(() => {
    if (createError) revealInStart(startRef.current, createNoticeRef.current);
  }, [createError]);
  useLayoutEffect(() => {
    if (attachError) revealInStart(startRef.current, attachNoticeRef.current);
  }, [attachError]);
  const restoreFocus = useRef(false);
  const followTail = useRef(true);
  const loadGeneration = useRef(0);
  const threadId = useRef<string | null>(null);
  const streamId = useRef<string | null>(null);
  const conversationQueue = useRef<CoreEvent[] | null>(null);
  const creatingConversation = useRef(false);
  const closePreview = useCallback(() => setPreview(null), []);

  const renderAttachment = useCallback((attachment: ConversationAttachment, item: ConversationItem, index: number) => <HistoryAttachmentView
    key={index}
    attachment={attachment}
    cacheKey={["conversation", windowId, item.id, attachment.id]}
    load={async () => {
      const reply = await context.store.call({ op: "conversation.attachment", window_id: windowId, item_id: item.id, attachment_id: attachment.id });
      if (reply.op !== "conversation.attachment") throw shellErrors.SHELL_CONVERSATION_ATTACHMENT_REPLY_INVALID();
      return { mime: reply.mime, data_base64: reply.data_base64 };
    }}
    open={async () => { await context.store.call({ op: "conversation.attachment_open", window_id: windowId, item_id: item.id, attachment_id: attachment.id }); }}
    onPreview={setPreview}
    onError={(reason) => setSendError(toCoreError(reason))}
  />, [context.store, windowId, setSendError]);

  const acknowledge = useCallback((incoming: ConversationItem[]) => {
    setPending((current) => current && incoming.some((item) => matchesPending(item, current)) ? null : current);
  }, []);

  const handleError = useCallback((error: CoreError) => {
    if (error.code === "login_required") { setLoginRequired(true); return true; }
    if (error.code === "binding_conflict") { setBindingConflict(error); return true; }
    return false;
  }, []);

  const applyConversation = useCallback((update: ConversationEvent) => {
    if (update.kind === "text") {
      streamId.current = update.stream_id;
      coalescedDelta.schedule(update.text);
      return;
    }
    coalescedDelta.flush();
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
    } else {
      setBusy(update.busy);
      setTool(update.tool);
      if (!update.busy) { streamId.current = null; setDelta(""); }
    }
  }, [acknowledge, coalescedDelta]);

  const restoreDraft = useCallback((id: string, text: string, uploads: ConversationUpload[], failed: boolean) => {
    updateComposer((current) => {
      if (current.retry?.id === id) {
        return { ...current, retry: { ...current.retry, failed }, restored: new Set([...current.restored, id]) };
      }
      if (current.restored.has(id)) return current;
      const files = uploads.map((upload) => {
        const bytes = Uint8Array.from(atob(upload.data_base64), (char) => char.charCodeAt(0));
        return makeDraftAttachment(new File([bytes], upload.name, { type: upload.mime }), upload.name);
      });
      return { ...current, retry: { id, text, attachments: files, failed }, restored: new Set([...current.restored, id]),
        text: current.text ? `${text}\n${current.text}` : text, attachments: [...files, ...current.attachments] };
    });
  }, [updateComposer]);

  const load = useCallback(async (initialEvents: CoreEvent[] = [], profile?: string, quiet = false) => {
    if (!connected || !workspaceId || !hasProvider) return;
    const generation = ++loadGeneration.current;
    const events = initialEvents;
    conversationQueue.current = events;
    setCreating(false);
    setAttaching(false);
    if (!quiet) setLoading(true);
    setLoadError(null);
    setLoginRequired(false);
    setBindingConflict(null);
    try {
      {
        const reply = await context.store.call({ op: "conversation.get", window_id: windowId, ...(profile ? { profile } : {}) });
        if (generation !== loadGeneration.current) return;
        const sameThread = threadId.current !== null && threadId.current === reply.thread?.id;
        threadId.current = reply.thread?.id ?? null;
        setAgent(Boolean(reply.thread));
        setThread(reply.thread);
        setAttached(reply.attached ?? false);
        setOwn(reply.own ?? null);
        setAdoptable(reply.adoptable ?? []);
        setAttachId(reply.own?.id ?? "");
        setItems(uniqueItems(reply.items));
        acknowledge(reply.items);
        setNextBefore(reply.next_before);
        setModels(reply.models);
        setProfiles(reply.profiles);
        if (!reply.thread) {
          setSelectedProfile(reply.start.profile);
          setSelectedPreset(reply.start.model ?? "");
        }
        if (!sameThread) { coalescedDelta.cancel(); setBusy(false); setTool(null); setDelta(""); }
        conversationQueue.current = null;
        events.forEach((event) => {
          if (event.event === "conversation.update" && event.thread_id === threadId.current) applyConversation(event.update);
          if (event.event === "conversation.error" && event.thread_id === threadId.current && !handleError(event.error)) setLoadError(event.error);
        });
        return;
      }
    } catch (reason) {
      if (generation === loadGeneration.current) { const error = toCoreError(reason); if (!handleError(error)) setLoadError(error); }
    } finally {
      if (generation === loadGeneration.current) {
        conversationQueue.current = null;
        setLoading(false);
      }
    }
  }, [acknowledge, applyConversation, connected, linkTarget, context.store, workspaceId, hasProvider, windowId, appVersion, handleError, coalescedDelta]);

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
          else if (!handleError(event.error)) setLoadError(event.error);
        }
      }
      return;
    }
  }), [applyConversation, context.store, workspaceId, hasProvider, providerEntry, windowId, restoreDraft, handleError, load]);

  useLayoutEffect(() => {
    if (!restoreFocus.current || loading || loginRequired || loadError || bindingConflict) return;
    const target = agent ? inputRef.current : startRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    if (target) { target.focus(); restoreFocus.current = false; }
  }, [agent, loading, loginRequired, loadError, bindingConflict, models, switching]);

  const loadOlder = useConversationHistory({
    historyRef, nextBefore, enabled: hasProvider && Boolean(agent) && !loading && !loginRequired && !loadError && !bindingConflict,
    store: context.store, windowId, onItems: (older, before) => { setItems((current) => uniqueItems([...older, ...current])); setNextBefore(before); },
    onError: (reason) => { const error = toCoreError(reason); if (!handleError(error)) setSendError(error); },
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
      if (!handleError(error)) setLoadError(error);
    } finally {
      setLoadingChoices(false);
    }
  };

  const switchConversation = async (selection: { profile?: string; model?: string }) => {
    if (!thread || switching || busy) return;
    restoreFocus.current = true;
    setSwitching(true);
    setSwitchError(null);
    try {
      const reply = await context.store.call({ op: "conversation.switch", window_id: windowId, ...selection });
      if (reply.op !== "conversation.switch") return;
      setThread(reply.thread);
      setAgent(true);
      setNotices(reply.notices);
      await load([], reply.thread.profile?.id, true);
    } catch (reason) {
      const error = toCoreError(reason);
      if (!handleError(error)) setSwitchError(error);
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
  const selectorsDisabled = busy || switching || loadingChoices || attaching || creating;
  const revealSelectorFocus = (event: FocusEvent<HTMLDivElement>) => {
    const toolbar = event.currentTarget;
    const bounds = toolbar.getBoundingClientRect();
    const focused = event.target.getBoundingClientRect();
    const style = getComputedStyle(toolbar);
    const left = bounds.left + parseFloat(style.scrollPaddingInlineStart);
    const right = bounds.right - parseFloat(style.scrollPaddingInlineEnd);
    if (focused.left < left) toolbar.scrollLeft += focused.left - left;
    else if (focused.right > right) toolbar.scrollLeft += focused.right - right;
  };
  const profileSelect = (
      <Select
        groups={profileGroups}
        value={agent ? thread?.profile?.id : selectedProfile}
        label="프로필"
        placeholder={agent && !thread?.profile ? "" : "프로필 선택"}
        disabled={selectorsDisabled || (agent ? !thread?.profile : visibleProfiles.length === 0)}
        onChange={selectProfile}
      />
  );
  const placeSelect = places.length >= 2 ? (
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
  ) : null;
  const modelSelect = (
      <Select
        groups={[{ options: modelOptions }]}
        value={agent ? thread?.model.id : selectedPreset}
        label="모델"
        placeholder="모델 선택"
        disabled={selectorsDisabled || modelOptions.length === 0}
        onChange={selectModel}
      />
  );
  const selectorRow = () => (
    <div className="ks-file-tree-header ks-web-toolbar ks-agent-chat-toolbar" onFocus={revealSelectorFocus}>
      <div className="ks-agent-chat-settings-content">
        <div className="ks-data-toolbar-group">{profileSelect}{placeSelect}{modelSelect}</div>
        {switching
          ? <span className="ks-agent-chat-change-hint">바꾸는 중</span>
          : busy ? <span className="ks-agent-chat-change-hint">답변이 끝난 뒤 바꿀 수 있습니다</span> : null}
      </div>
    </div>
  );
  // 시작 판의 고르기는 도구 막대 밖이라 늘 보이는 이름표를 위에 단다(앱 디자인 지침 3절).
  const startField = (label: string, control: ReactElement) => (
    <label className="ks-field ks-select-field is-label-top ks-agent-chat-start-field">
      <span className="ks-field-label">{label}</span>
      {control}
    </label>
  );

  const start = async () => {
    const profile = profiles.find((item) => item.id === selectedProfile);
    const model = models.find((item) => item.id === selectedPreset);
    if (!profile?.available || !model?.available || creating || attaching || loadingChoices) return;
    // 옛 알림은 누를 때 지우지 않고 결과가 오면 바꾼다. 누르는 순간 판의 높이가 바뀌면 단추가 움직인다.
    setCreating(true);
    const events: CoreEvent[] = [];
    conversationQueue.current = events; creatingConversation.current = true;
    try {
      await context.store.call({ op: "conversation.create", window_id: windowId, model: selectedPreset, profile: selectedProfile });
      setCreateError(null);
      setAttachError(null);
      await load(events);
    } catch (reason) {
      const error = toCoreError(reason);
      setCreateError(handleError(error) ? null : error);
      setAttachError(null);
      setCreating(false);
    } finally {
      creatingConversation.current = false;
      if (conversationQueue.current === events) conversationQueue.current = null;
    }
  };

  const selectAttach = (value: JsonValue) => {
    if (typeof value !== "string" || attaching || creating) return;
    setAttachId(value);
  };

  const attach = async () => {
    if (!attachId || attaching || creating) return;
    setAttaching(true);
    const events: CoreEvent[] = [];
    conversationQueue.current = events; creatingConversation.current = true;
    try {
      await context.store.call({ op: "conversation.attach", window_id: windowId, thread_id: attachId });
      setCreateError(null);
      setAttachError(null);
      await load(events);
    } catch (reason) {
      const error = toCoreError(reason);
      setAttachError(handleError(error) ? null : error);
      setCreateError(null);
      setAttaching(false);
    } finally {
      creatingConversation.current = false;
      if (conversationQueue.current === events) conversationQueue.current = null;
    }
  };

  const changeConversation = async () => {
    if (busy || switching || detaching) return;
    setDetaching(true);
    try {
      await context.store.call({ op: "conversation.detach", window_id: windowId });
      await load();
    } catch (reason) {
      const error = toCoreError(reason);
      if (!handleError(error)) setSwitchError(error);
    } finally {
      setDetaching(false);
    }
  };

  const attachChoices = [
    ...(own ? [{ value: own.id, label: `${own.title || "이름 없는 대화"} (이 작업)` }] : []),
    ...adoptable.map((candidate) => ({
      value: candidate.id,
      label: `${candidate.title || "이름 없는 대화"}${candidate.profile ? ` · ${candidate.profile.label}` : ""}`,
    })),
  ];
  const attachSection = attachChoices.length ? (
    <section className="ks-agent-chat-start-section" aria-labelledby={`${windowId}-attach-title`}>
      <div className="ks-agent-chat-start-head" ref={attachHeadRef}>
        <h2 id={`${windowId}-attach-title`} className="ks-data-section-title ks-agent-chat-start-title">기존 대화</h2>
        {attaching ? <StatusText>연결하는 중</StatusText> : null}
      </div>
      <div className="ks-agent-chat-start-row is-single">
        <Select
          groups={[{ options: attachChoices }]}
          value={attachId}
          label="기존 대화"
          placeholder="선택"
          disabled={attaching || creating}
          onChange={selectAttach}
        />
        <Button className="ks-agent-chat-start-submit" disabled={!attachId || attaching || creating} onClick={() => void attach()}>연결</Button>
      </div>
      {attachError ? <div ref={attachNoticeRef}><Notice role="alert" errorId={attachError.id}>{attachError.message}</Notice></div> : null}
    </section>
  ) : null;

  const send = async (returnFocus = false) => {
    const submittedDraft = draft;
    const text = submittedDraft.trim();
    const submittedAttachments = attachments;
    if (inputDisabled || (!text && submittedAttachments.length === 0) || sending) return;
    const retry = getComposer().retry;
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
      await prepareShareForSend(context.store);
      await context.store.call({ op: "conversation.send", window_id: windowId, request_id: requestId, text, attachments: uploads });
      updateComposer((current) => ({ ...current, retry: null }));
    } catch (reason) {
      setPending(null);
      const error = toCoreError(reason);
      if (!handleError(error)) setSendError(error);
      updateComposer((current) => ({ ...current, retry: { id: requestId, text, attachments: submittedAttachments, failed: false } }));
      setDraft((current) => current ? `${submittedDraft}\n${current}` : submittedDraft);
      setAttachments((current) => [...submittedAttachments, ...current]);
      if (error.code !== "login_required" && error.code !== "binding_conflict") void load();
    } finally {
      setSending(false);
    }
  };

  if (!provider) return <div {...blockRoot} className="ks-agent-chat-state"><EmptyState icon={<MessageSquare size="empty" />} text="이 앱 판에는 대화 제공자가 없습니다" /></div>;
  if (!connected) {
    return <div {...blockRoot} className="ks-agent-chat-state"><EmptyState icon={<MessageSquare size="empty" />} text="서버에 연결하면 대화할 수 있습니다" /></div>;
  }
  if (!workspaceId) return null;
  if (loading && !agent) return <div {...blockRoot} className="ks-agent-chat-state"><StatusText>불러오는 중</StatusText></div>;
  if (loginRequired && provider) return <DataState rootProps={blockRoot} value={{ status: "login_required", permission: provider.permission }} onLogin={() => { restoreFocus.current = true; void load(); }} />;
  if (bindingConflict) return <div {...blockRoot} className="ks-agent-chat-state"><Notice role="alert" errorId={bindingConflict.id}>{bindingConflict.message}</Notice></div>;
  if (loadError) {
    return (
      <div {...blockRoot} className="ks-agent-chat-state">
        <Notice role="alert" errorId={loadError.id} actions={[<Button key="retry" onClick={() => void load()}>다시 시도</Button>]}>{loadError.message}</Notice>
      </div>
    );
  }
  if (!agent) {
    return (
      <div {...blockRoot} className="ks-agent-chat-start" ref={startRef}>
        {own ? null : (
          <section className="ks-agent-chat-start-section" aria-labelledby={`${windowId}-new-title`}>
            <div className="ks-agent-chat-start-head" ref={createHeadRef}>
              <h2 id={`${windowId}-new-title`} className="ks-data-section-title ks-agent-chat-start-title">새 대화</h2>
              {creating ? <StatusText>시작하는 중</StatusText> : null}
            </div>
            <div className="ks-agent-chat-start-row">
              {startField("프로필", profileSelect)}
              {placeSelect ? startField("실행 위치", placeSelect) : null}
              {startField("모델", modelSelect)}
              <Button className="ks-agent-chat-start-submit" disabled={!selectedStartProfile?.available || !selectedStartModel?.available || creating || attaching || switching || loadingChoices} variant="emphasis" onClick={() => void start()}>시작</Button>
            </div>
            {createError ? <div ref={createNoticeRef}><Notice role="alert" errorId={createError.id}>{createError.message}</Notice></div> : null}
          </section>
        )}
        {attachSection}
      </div>
    );
  }

  const title = thread?.title || "이름 없는 대화";
  const conversationTitle = attached ? `${title} · ${thread?.model.label ?? ""}` : title;
  const conversationToolbar = () => (
    <div className="ks-file-tree-header ks-web-toolbar ks-agent-chat-toolbar">
      <div className="ks-data-toolbar-group ks-agent-chat-conversation-content">
        <Tooltip content={conversationTitle}>
          <span tabIndex={0} className="ks-agent-chat-change-hint">{conversationTitle}</span>
        </Tooltip>
        <IconButton className="ks-agent-chat-change" aria-label="대화 바꾸기" tooltip="대화 바꾸기" disabled={busy || switching || detaching} onClick={() => void changeConversation()}><DataIcon name="arrow-right-left" /></IconButton>
      </div>
    </div>
  );

  return (
    <section {...blockRoot} className="ks-agent-chat" ref={shareRef}>
      {conversationToolbar()}
      {attached ? null : selectorRow()}
      {notices.length ? <Notice>{notices.join("\n")}</Notice> : null}
      {switchError ? <Notice role="alert" errorId={switchError.id}>{switchError.message}</Notice> : null}
      <ChatHistory
        items={items}
        pending={pending}
        delta={delta}
        busy={busy}
        tool={tool}
        historyRef={historyRef}
        followTail={followTail}
        onReachTop={() => { if (hasProvider && nextBefore) loadOlder(); }}
        renderAttachment={renderAttachment}
        renderPendingAttachment={(attachment, index) => <PendingAttachment key={index} attachment={attachment} onPreview={setPreview} />}
        state={historyState}
      />
      <ChatComposer
        draft={draft}
        onDraft={setDraft}
        inputRef={inputRef}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        onSend={(returnFocus) => { void send(returnFocus); }}
        disabled={inputDisabled}
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
          onConfirm={() => { setPendingSwitch(null); void switchConversation({ ...(pendingSwitch.profile ? { profile: pendingSwitch.profile } : {}), ...(pendingSwitch.model ? { model: pendingSwitch.model } : {}) }); }}
        /> : null;
      })() : null}
    </section>
  );
}

function selectSharedWindows(snapshot: ShellSnapshot | null, workspaceId: string): Array<{ id: string; name: string }> {
  if (!snapshot) return [];
  return snapshot.sharing.flatMap((id) => {
    const shared = snapshot.shared.windows.find((item) => item.id === id);
    if (!shared || !snapshot.shared.desktops.some((item) => item.id === shared.desktop_id && item.workspace_id === workspaceId)) return [];
    const name = snapshot.shared.app_versions.find((item) => item.app_id === shared.app_id && item.version === shared.app_version)?.definition.name ?? shared.app_id;
    return [{ id, name }];
  });
}

function sameSharedWindows(left: Array<{ id: string; name: string }>, right: Array<{ id: string; name: string }>): boolean {
  return left.length === right.length && left.every((item, index) => item.id === right[index].id && item.name === right[index].name);
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
