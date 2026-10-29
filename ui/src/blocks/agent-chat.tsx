import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AgentInfo, AgentItem, AgentModel, AgentUpdate, Block } from "../contract/contract";
import { Button, EmptyState, IconButton, Notice, StatusText } from "../components/primitives";
import { ArrowUp, MessageSquare } from "../components/icons";
import { toCoreError } from "../core/core-transport";
import type { BlockContext } from "./block-context";
import { MarkdownText } from "./markdown-text";
import { ThinkingOrb } from "thinking-orbs";

type AgentChatBlockData = Extract<Block, { type: "agent_chat" }>;

export function AgentChatBlock({ block: _block, context }: { block: AgentChatBlockData; context: BlockContext }) {
  const desktop = context.snapshot.shared.desktops.find((item) => item.id === context.window.desktop_id);
  const workspaceId = desktop?.workspace_id ?? "";
  const connected = context.snapshot.link.state === "connected";
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [items, setItems] = useState<AgentItem[]>([]);
  const [models, setModels] = useState<AgentModel[]>([]);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [delta, setDelta] = useState("");
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const followTail = useRef(true);
  const loadGeneration = useRef(0);
  const pendingUpdates = useRef<AgentUpdate[] | null>(null);

  const applyUpdate = useCallback((update: AgentUpdate) => {
    if (update.kind === "created") {
      setAgent(update.agent);
      setBusy(update.agent.busy);
      setTool(update.agent.tool);
      setCreateError(null);
      setCreating(false);
    } else if (update.kind === "item") {
      setItems((current) => uniqueItems([...current, update.item]));
      if (update.item.kind === "user") setPending(null);
      if (update.item.kind === "assistant") setDelta("");
    } else if (update.kind === "delta") {
      setDelta((current) => current + update.text);
    } else {
      setBusy(update.busy);
      setTool(update.tool);
      if (!update.busy) setDelta("");
    }
  }, []);

  const load = useCallback(async () => {
    if (!connected || !workspaceId) return;
    const generation = ++loadGeneration.current;
    const updates: AgentUpdate[] = [];
    pendingUpdates.current = updates;
    setCreating(false);
    setLoading(true);
    setLoadError(null);
    try {
      const reply = await context.store.call({ op: "agent.get", workspace_id: workspaceId });
      if (generation !== loadGeneration.current) return;
      if (reply.op !== "agent.get") return;
      setAgent(reply.agent);
      setItems(uniqueItems(reply.items));
      setPending(null);
      setModels(reply.models);
      setSelectedPreset(reply.models[0]?.preset ?? "");
      setBusy(reply.agent?.busy ?? false);
      setTool(reply.agent?.tool ?? null);
      setDelta("");
      pendingUpdates.current = null;
      updates.forEach(applyUpdate);
    } catch (reason) {
      if (generation === loadGeneration.current) setLoadError(toCoreError(reason).message);
    } finally {
      if (generation === loadGeneration.current) {
        pendingUpdates.current = null;
        setLoading(false);
      }
    }
  }, [applyUpdate, connected, context.store, workspaceId]);

  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
      pendingUpdates.current = null;
    };
  }, [load]);

  useEffect(() => context.store.subscribeEvents((event) => {
    if (event.event !== "agent.update" || event.workspace_id !== workspaceId) return;
    if (pendingUpdates.current) pendingUpdates.current.push(event.update);
    else applyUpdate(event.update);
  }), [applyUpdate, context.store, workspaceId]);

  useLayoutEffect(() => {
    const history = historyRef.current;
    if (history && followTail.current) history.scrollTop = history.scrollHeight;
  }, [items, delta, busy, tool]);

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
    const updates: AgentUpdate[] = [];
    pendingUpdates.current = updates;
    setCreating(true);
    setCreateError(null);
    try {
      const reply = await context.store.call({ op: "agent.create", workspace_id: workspaceId, model_preset: selectedPreset });
      if (pendingUpdates.current !== updates) return;
      if (reply.op === "agent.create") {
        setAgent(reply.agent);
        setBusy(reply.agent.busy);
        setTool(reply.agent.tool);
      }
      setCreating(false);
    } catch (reason) {
      if (pendingUpdates.current !== updates) return;
      setCreateError(toCoreError(reason).message);
      setCreating(false);
    } finally {
      if (pendingUpdates.current === updates) {
        pendingUpdates.current = null;
        updates.forEach(applyUpdate);
      }
    }
  };

  const send = async (returnFocus = false) => {
    const submittedDraft = draft;
    const text = submittedDraft.trim();
    if (!text || sending) return;
    setPending(text);
    setDraft("");
    setSending(true);
    setSendError(null);
    if (returnFocus) inputRef.current?.focus();
    try {
      await context.store.call({ op: "agent.send", workspace_id: workspaceId, text });
    } catch (reason) {
      setPending(null);
      setSendError(toCoreError(reason).message);
      setDraft((current) => current ? `${submittedDraft}\n${current}` : submittedDraft);
    } finally {
      setSending(false);
    }
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    void send();
  };

  if (!connected) {
    return <div className="ks-agent-chat-state"><EmptyState icon={<MessageSquare size="empty" />} text="서버에 연결하면 대화할 수 있습니다" /></div>;
  }
  if (!workspaceId) return null;
  if (loading) return <div className="ks-agent-chat-state"><StatusText>불러오는 중</StatusText></div>;
  if (loadError) {
    return (
      <div className="ks-agent-chat-state">
        <Notice role="alert" actions={[<Button key="retry" onClick={() => void load()}>다시 시도</Button>]}>{loadError}</Notice>
      </div>
    );
  }
  if (!agent) {
    return (
      <div className="ks-agent-chat-start">
        <div className="ks-agent-chat-models">
          {models.map((model) => (
            <Button
              key={model.preset}
              aria-pressed={selectedPreset === model.preset}
              disabled={creating}
              onClick={() => setSelectedPreset(model.preset)}
            >
              {model.label}
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
    <section className="ks-agent-chat">
      <div
        aria-label="대화 기록"
        className="ks-agent-chat-history"
        onScroll={(event) => {
          const history = event.currentTarget;
          const threshold = Number.parseFloat(getComputedStyle(history).getPropertyValue("--ks-space-6")) || 0;
          followTail.current = history.scrollHeight - history.clientHeight - history.scrollTop <= threshold;
        }}
        ref={historyRef}
        role="log"
      >
        {items.map((item) => <HistoryItem key={item.id} item={item} />)}
        {pending !== null ? <div className="ks-agent-chat-user is-pending">{pending}</div> : null}
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
        <div className="ks-agent-chat-input-row">
          <textarea
            aria-label="메시지"
            className="ks-text-input ks-agent-chat-input"
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={onInputKeyDown}
            ref={inputRef}
            rows={1}
            value={draft}
          />
          <IconButton aria-label="보내기" disabled={!draft.trim() || sending} onClick={() => void send(true)}>
            <ArrowUp />
          </IconButton>
        </div>
      </div>
    </section>
  );
}

function HistoryItem({ item }: { item: AgentItem }) {
  if (item.kind === "user") return <div className="ks-agent-chat-user">{item.text}</div>;
  if (item.kind === "assistant") {
    return <div className="ks-agent-chat-assistant"><div className="ks-agent-chat-assistant-content"><MarkdownText>{item.text}</MarkdownText></div></div>;
  }
  if (item.kind === "error") return <Notice role="alert">{item.text}</Notice>;
  return <div className="ks-agent-chat-notice">{item.text}</div>;
}

function uniqueItems(items: AgentItem[]): AgentItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
