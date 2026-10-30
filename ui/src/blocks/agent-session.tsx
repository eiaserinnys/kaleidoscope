import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Block, ConversationAttachment, ConversationEvent, ConversationItem, CoreEvent, CoreRequest, LocalAgentSnapshot } from "../contract/contract";
import { Button, EmptyState, IconButton, Notice, StatusText } from "../components/primitives";
import { Folder, FolderOpen, MessageSquare } from "../components/icons";
import { Select, Toggle } from "../components/select-toggle";
import { toCoreError } from "../core/core-transport";
import { useWindowData } from "../data/window-data";
import type { BlockContext } from "./block-context";
import { useShareDescriber } from "../share/visible";
import { flushShareViews } from "../share/share-view";
import { HistoryAttachmentView, ImagePreview, readUpload, type DraftAttachment, type Preview } from "./agent-attachments";
import { ChatComposer } from "./chat-composer";
import { ChatHistory } from "./chat-history";

type AgentSessionBlockData = Extract<Block, { type: "agent_session" }>;

export function AgentSessionBlock({ block, context, pointer = "/ui" }: { block: AgentSessionBlockData; context: BlockContext; pointer?: string }) {
  const windowId = context.window.id;
  const data = useWindowData();
  const [snapshot, setSnapshot] = useState<LocalAgentSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const shareRef = useRef<HTMLElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const generationRef = useRef<string | null>(null);
  const followTail = useRef(true);
  useShareDescriber(shareRef, () => ({ text: "[에이전트 대화]", visual: false }));

  const applyUpdate = useCallback((event: Extract<CoreEvent, { event: "local_agent.update" }>) => {
    const update = event.update;
    if (update.type === "snapshot") {
      generationRef.current = update.snapshot.generation;
      setSnapshot(update.snapshot);
      return;
    }
    if (generationRef.current !== event.generation) return;
    setSnapshot((current) => {
      if (!current || current.generation !== event.generation) return current;
      if (update.type === "state") return {
        ...current,
        phase: update.phase,
        controls: update.controls,
        auth_methods: update.auth_methods,
        execution: update.execution,
        failure: update.failure,
      };
      if (update.type === "permissions") return { ...current, permissions: update.permissions };
      if (update.type === "queue") return { ...current, queued: update.queued };
      return applyConversation(current, update.update);
    });
  }, []);

  useEffect(() => {
    let active = true;
    const buffered: Extract<CoreEvent, { event: "local_agent.update" }>[] = [];
    generationRef.current = null;
    const unsubscribe = context.store.subscribeEvents((event) => {
      if (event.event !== "local_agent.update" || event.window_id !== windowId) return;
      if (generationRef.current === null) buffered.push(event);
      else applyUpdate(event);
    });
    setSnapshot(null);
    setLoadError(null);
    void context.store.call({ op: "local_agent.attach", window_id: windowId }).then((reply) => {
      if (!active) return;
      if (reply.op !== "local_agent.attach") throw new Error("에이전트 상태를 불러오지 못했습니다");
      generationRef.current = reply.snapshot.generation;
      setSnapshot(reply.snapshot);
      buffered.forEach(applyUpdate);
      buffered.length = 0;
    }).catch((reason: unknown) => {
      if (active) setLoadError(toCoreError(reason).message);
    });
    return () => {
      active = false;
      unsubscribe();
      generationRef.current = null;
      void context.store.call({ op: "local_agent.detach", window_id: windowId }).catch(() => undefined);
    };
  }, [applyUpdate, context.store, windowId]);

  const withLatestGeneration = useCallback((request: CoreRequest): CoreRequest => {
    if (generationRef.current && "generation" in request) return { ...request, generation: generationRef.current };
    return request;
  }, []);

  const call = useCallback(async <K extends CoreRequest["op"],>(request: Extract<CoreRequest, { op: K }>) => {
    setActionError(null);
    try { await context.store.call(withLatestGeneration(request)); }
    catch (reason) { setActionError(toCoreError(reason).message); }
  }, [context.store, withLatestGeneration]);

  const chooseAgent = useCallback((value: unknown) => {
    if (typeof value === "string") void data.act(`${pointer}/on_select`, value);
  }, [data, pointer]);

  const chooseFolder = useCallback(async () => {
    await call({ op: "files.pick_folder", window_id: windowId, permission: block.root.permission });
  }, [block.root.permission, call, windowId]);

  const send = useCallback(async (returnFocus = false) => {
    if (!snapshot || (snapshot.phase !== "ready" && snapshot.phase !== "responding")) return;
    const text = draft.trim();
    const submittedAttachments = attachments;
    if ((!text && !submittedAttachments.length) || !inputRef.current) return;
    const requestId = crypto.randomUUID();
    const submittedDraft = draft;
    setDraft("");
    setAttachments([]);
    setActionError(null);
    if (returnFocus) inputRef.current.focus();
    try {
      const uploads = await Promise.all(submittedAttachments.map(readUpload));
      await flushShareViews();
      const reply = await context.store.call(withLatestGeneration({
        op: "local_agent.send", window_id: windowId, generation: snapshot.generation,
        request_id: requestId, text, attachments: uploads,
      }));
      if (reply.op === "local_agent.send" && reply.queued) {
        const queued = { id: requestId, text, attachments: uploads.map((item, index) => ({ id: String(index), name: item.name, mime: item.mime })) };
        setSnapshot((current) => current && current.generation === snapshot.generation && !current.queued.some((item) => item.id === requestId)
          ? { ...current, queued: [...current.queued, queued] }
          : current);
      }
    } catch (reason) {
      setActionError(toCoreError(reason).message);
      setDraft((current) => current ? `${submittedDraft}\n${current}` : submittedDraft);
      setAttachments((current) => [...submittedAttachments, ...current]);
    }
  }, [attachments, context.store, draft, snapshot, windowId, withLatestGeneration]);

  const renderAttachment = useCallback((attachment: ConversationAttachment, item: ConversationItem, index: number) => <HistoryAttachmentView
    key={`${item.id}:${attachment.id}:${index}`}
    attachment={attachment}
    cacheKey={["local_agent", windowId, item.id, attachment.id]}
    load={async () => {
      const reply = await context.store.call({ op: "local_agent.attachment", window_id: windowId, item_id: item.id, attachment_id: attachment.id });
      if (reply.op !== "local_agent.attachment") throw new Error("첨부를 불러오지 못했습니다");
      return { mime: reply.mime, data_base64: reply.data_base64 };
    }}
    open={async () => { await context.store.call({ op: "local_agent.attachment_open", window_id: windowId, item_id: item.id, attachment_id: attachment.id }); }}
    onPreview={setPreview}
    onError={(reason) => setActionError(toCoreError(reason).message)}
  />, [context.store, windowId]);

  const closePreview = useCallback(() => setPreview(null), []);
  useLayoutEffect(() => {
    const history = historyRef.current;
    if (history && followTail.current) history.scrollTop = history.scrollHeight;
  }, [snapshot?.history, snapshot?.queued, snapshot?.text, snapshot?.activity]);
  const folderName = snapshot?.folder_name
    ?? context.snapshot.device.grants.find((grant) => grant.window_id === windowId && grant.permission === block.root.permission)?.root_name
    ?? null;
  const readyToChat = snapshot?.phase === "ready" || snapshot?.phase === "responding";
  const responding = snapshot?.phase === "responding";
  const runControl = (controlId: string, value: string | boolean) => {
    if (!snapshot) return;
    void call({ op: "local_agent.configure", window_id: windowId, generation: snapshot.generation, control_id: controlId, value });
  };
  const cancel = () => {
    if (!snapshot) return;
    void call({ op: "local_agent.cancel", window_id: windowId, generation: snapshot.generation });
  };
  const selectOptions = (snapshot?.agents ?? []).map((agent) => ({ value: agent.id, label: agent.name }));

  let main: ReactNode;
  if (loadError) main = <div className="ks-agent-session-state"><Notice role="alert">{loadError}</Notice></div>;
  else if (!snapshot) main = <div className="ks-agent-session-state"><StatusText>불러오는 중</StatusText></div>;
  else if (snapshot.phase === "choosing_agent") main = <div className="ks-agent-session-state"><EmptyState icon={<MessageSquare size="empty" />} text="에이전트를 골라 주세요" /></div>;
  else if (snapshot.phase === "choosing_folder") main = <div className="ks-agent-session-state"><EmptyState icon={<FolderOpen size="empty" />} text="작업 폴더를 골라 주세요" action={<Button onClick={() => void chooseFolder()}>폴더 선택</Button>} /></div>;
  else if (snapshot.phase === "awaiting_permission") {
    const execution = snapshot.execution;
    main = <div className="ks-agent-session-state"><div className="ks-agent-session-consent">
      {execution ? <>
        <strong>{execution.name}</strong>
        <code className="ks-agent-session-command">{[execution.command, ...execution.args].join(" ")}</code>
        {Object.entries(execution.env).map(([name, value]) => <span className="ks-agent-session-env" key={name} title={`${name}=${value}`}>{name}={value}</span>)}
        <StatusText>이 PC에서 프로그램을 실행합니다</StatusText>
        <Button variant="emphasis" onClick={() => void call({ op: "local_agent.allow", window_id: windowId, spec_hash: execution.spec_hash })}>허용</Button>
      </> : <StatusText>실행 정보를 불러오는 중</StatusText>}
    </div></div>;
  } else if (snapshot.phase === "starting") main = <div className="ks-agent-session-state"><StatusText>에이전트를 시작하는 중</StatusText></div>;
  else if (snapshot.phase === "login_required") main = <div className="ks-agent-session-state"><div className="ks-agent-session-login">
    {snapshot.failure ? <Notice role="alert">{snapshot.failure.message}</Notice> : <StatusText>로그인이 필요합니다</StatusText>}
    {snapshot.auth_methods.map((method) => <Button key={method.id} onClick={() => void call({ op: "local_agent.authenticate", window_id: windowId, generation: snapshot.generation, method_id: method.id })}>{method.name}</Button>)}
    {!snapshot.auth_methods.length ? <Button onClick={() => void call({ op: "local_agent.retry", window_id: windowId, generation: snapshot.generation })}>다시 시도</Button> : null}
  </div></div>;
  else if (snapshot.phase === "failed") main = <div className="ks-agent-session-state"><Notice role="alert" actions={[<Button key="retry" onClick={() => void call({ op: "local_agent.retry", window_id: windowId, generation: snapshot.generation })}>다시 시도</Button>]}>
    {snapshot.failure?.message ?? "에이전트를 시작하지 못했습니다"}{snapshot.failure?.command ? <> <code className="ks-agent-session-command">{snapshot.failure.command}</code></> : null}
  </Notice></div>;
  else {
    const permissions = snapshot.permissions.length ? <div className="ks-agent-session-permissions">
      {snapshot.permissions.map((permission) => <div className="ks-agent-session-permission" key={permission.id}>
        <span>{permission.title}</span>
        <div className="ks-agent-session-permission-actions">{permission.options.map((option) => <Button key={option.id} onClick={() => void call({
          op: "local_agent.permission", window_id: windowId, generation: snapshot.generation, request_id: permission.id, option_id: option.id,
        })}>{option.label}</Button>)}</div>
      </div>)}
    </div> : null;
    const queued = snapshot.queued.map((message) => <QueuedPendingMessage key={message.id} message={message} context={context} windowId={windowId} onPreview={setPreview} onError={(reason) => setActionError(toCoreError(reason).message)} />);
    main = <>
      <ChatHistory
        items={snapshot.history}
        pending={null}
        delta={snapshot.text}
        busy={snapshot.activity.busy}
        tool={snapshot.activity.tool}
        historyRef={historyRef}
        onScroll={(event) => {
          const history = event.currentTarget;
          const threshold = Number.parseFloat(getComputedStyle(history).getPropertyValue("--ks-space-6")) || 0;
          followTail.current = history.scrollHeight - history.clientHeight - history.scrollTop <= threshold;
        }}
        renderAttachment={renderAttachment}
        renderPendingAttachment={(_attachment, _index) => null}
        footer={<>{queued}{permissions}{actionError ? <Notice role="alert">{actionError}</Notice> : null}{snapshot.phase === "ended" ? <StatusText>대화가 끝났습니다</StatusText> : null}</>}
      />
      {readyToChat ? <ChatComposer
        draft={draft}
        onDraft={setDraft}
        inputRef={inputRef}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        onSend={(returnFocus) => { void send(returnFocus); }}
        disabled={false}
        busy={responding}
        onCancel={responding ? cancel : undefined}
        sharedWindows={[]}
        onRemoveShared={() => undefined}
        onPreview={setPreview}
        error={null}
        onError={setActionError}
      /> : null}
      {preview ? <ImagePreview preview={preview} onClose={closePreview} /> : null}
    </>;
  }

  return <section className="ks-agent-session ks-agent-chat" ref={shareRef}>
    <div className="ks-agent-session-toolbar">
      <div className="ks-agent-session-agent"><Select
        items={selectOptions}
        value={snapshot?.selected ?? undefined}
        placeholder="에이전트 선택"
        label="에이전트"
        onChange={chooseAgent}
      /></div>
      {snapshot && snapshot.phase !== "choosing_agent" ? <>
        <div className="ks-agent-session-folder">
          <IconButton aria-label="작업 폴더 선택" onClick={() => void chooseFolder()}><Folder /></IconButton>
          {folderName ? <span className="ks-agent-session-folder-name" title={folderName}>{folderName}</span> : null}
        </div>
        {snapshot?.controls.length ? <fieldset className="ks-agent-session-controls" disabled={responding}>{snapshot.controls.map((control) => {
          let content: ReactNode;
          if (control.kind.kind === "boolean") {
            content = <Toggle checked={control.value === true} label={control.label} onChange={(value) => runControl(control.id, value)} />;
          } else {
            const groups = control.kind.options.map((group) => ({
              ...(group.name ? { name: group.name } : {}),
              options: group.options.map((option) => ({ value: option.id, label: option.name })),
            }));
            const selectedGroup = groups.find((group) => group.options.some((option) => option.value === control.value));
            const showLabel = !selectedGroup?.name || selectedGroup.name !== control.label;
            const selectProps = groups.length === 1 && !groups[0].name
              ? { items: groups[0].options }
              : { groups };
            content = <>{showLabel ? <span className="ks-agent-session-control-label">{control.label}</span> : null}<Select
              {...selectProps}
              value={typeof control.value === "string" ? control.value : undefined}
              label={control.label}
              disabled={responding}
              onChange={(value) => { if (typeof value === "string") runControl(control.id, value); }}
            /></>;
          }
          return <div className="ks-agent-session-control" key={control.id}>{content}</div>;
        })}</fieldset> : null}
      </> : null}
    </div>
    {main}
    {!readyToChat && actionError ? <Notice role="alert">{actionError}</Notice> : null}
  </section>;
}

function applyConversation(snapshot: LocalAgentSnapshot, event: ConversationEvent): LocalAgentSnapshot {
  if (event.kind === "snapshot") return {
    ...snapshot,
    history: uniqueItems([...snapshot.history, ...event.snapshot.items]),
    stream_id: event.snapshot.stream_id,
    text: event.snapshot.text ?? "",
    activity: { busy: event.snapshot.busy, tool: event.snapshot.tool },
  };
  if (event.kind === "item") return {
    ...snapshot,
    history: uniqueItems([...snapshot.history, event.item]),
    ...(event.item.kind === "assistant" ? { stream_id: null, text: "" } : {}),
  };
  if (event.kind === "text") return { ...snapshot, stream_id: event.stream_id, text: event.text };
  return { ...snapshot, activity: { busy: event.busy, tool: event.tool }, ...(event.busy ? {} : { stream_id: null, text: "" }) };
}

function uniqueItems(items: ConversationItem[]): ConversationItem[] {
  const seen = new Set<string>();
  return items.filter((item) => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
}

function QueuedPendingMessage({ message, context, windowId, onPreview, onError }: {
  message: LocalAgentSnapshot["queued"][number]; context: BlockContext; windowId: string;
  onPreview: (preview: Preview) => void; onError: (reason: unknown) => void;
}) {
  return <div className="ks-agent-chat-user is-pending">{message.text}{message.attachments.length ? <div className={`ks-agent-attachment-history${message.text ? " has-text" : ""}`}>
    {message.attachments.map((attachment, index) => <HistoryAttachmentView
      key={`${attachment.id}:${index}`}
      attachment={attachment}
      cacheKey={["local_agent", windowId, message.id, attachment.id]}
      load={async () => {
        const reply = await context.store.call({ op: "local_agent.attachment", window_id: windowId, item_id: message.id, attachment_id: attachment.id });
        if (reply.op !== "local_agent.attachment") throw new Error("첨부를 불러오지 못했습니다");
        return { mime: reply.mime, data_base64: reply.data_base64 };
      }}
      open={async () => { await context.store.call({ op: "local_agent.attachment_open", window_id: windowId, item_id: message.id, attachment_id: attachment.id }); }}
      onPreview={onPreview}
      onError={onError}
    />)}
  </div> : null}</div>;
}
