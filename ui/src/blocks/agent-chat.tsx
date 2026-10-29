import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AgentInfo, AgentItem, AgentModel, Block } from "../contract/contract";
import { Button, EmptyState, IconButton, Notice, StatusText } from "../components/primitives";
import { toCoreError } from "../core/core-transport";
import type { BlockContext } from "./block-context";
import { MarkdownText } from "./markdown-text";

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
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [delta, setDelta] = useState("");
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const followTail = useRef(true);

  const load = useCallback(async () => {
    if (!connected || !workspaceId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const reply = await context.store.call({ op: "agent.get", workspace_id: workspaceId });
      if (reply.op !== "agent.get") return;
      setAgent(reply.agent);
      setItems(uniqueItems(reply.items));
      setModels(reply.models);
      setSelectedPreset(reply.models[0]?.preset ?? "");
      setBusy(reply.agent?.busy ?? false);
      setTool(reply.agent?.tool ?? null);
      setDelta("");
    } catch (reason) {
      setLoadError(toCoreError(reason).message);
    } finally {
      setLoading(false);
    }
  }, [connected, context.store, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => context.store.subscribeEvents((event) => {
    if (event.event !== "agent.update" || event.workspace_id !== workspaceId) return;
    const update = event.update;
    if (update.kind === "created") {
      setAgent(update.agent);
      setBusy(update.agent.busy);
      setTool(update.agent.tool);
      setCreateError(null);
      setCreating(false);
    } else if (update.kind === "item") {
      setItems((current) => uniqueItems([...current, update.item]));
      if (update.item.kind === "assistant") setDelta("");
    } else if (update.kind === "delta") {
      setDelta((current) => current + update.text);
    } else {
      setBusy(update.busy);
      setTool(update.tool);
      if (!update.busy) setDelta("");
    }
  }), [context.store, workspaceId]);

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
    input.style.maxHeight = `${maxHeight}px`;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft, agent]);

  const start = async () => {
    if (!selectedPreset || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      await context.store.call({ op: "agent.create", workspace_id: workspaceId, model_preset: selectedPreset });
    } catch (reason) {
      setCreateError(toCoreError(reason).message);
      setCreating(false);
    }
  };

  const send = async () => {
    const submittedDraft = draft;
    const text = submittedDraft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await context.store.call({ op: "agent.send", workspace_id: workspaceId, text });
      setDraft((current) => current === submittedDraft ? "" : current);
    } catch (reason) {
      setSendError(toCoreError(reason).message);
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
    return <div className="ks-agent-chat-state"><EmptyState icon={<ChatIcon />} text="서버에 연결하면 대화할 수 있습니다" /></div>;
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
              variant={selectedPreset === model.preset ? "emphasis" : "default"}
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
        {delta ? <div className="ks-agent-chat-assistant"><div className="ks-agent-chat-assistant-content"><MarkdownText>{delta}</MarkdownText></div></div> : null}
        {busy ? <div className="ks-agent-chat-working">작업 중{tool ? ` · ${tool}` : ""}</div> : null}
      </div>
      {sendError ? <Notice role="alert">{sendError}</Notice> : null}
      <div className="ks-agent-chat-input-row">
        <textarea
          aria-label="메시지"
          className="ks-agent-chat-input"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={onInputKeyDown}
          ref={inputRef}
          rows={1}
          value={draft}
        />
        <IconButton aria-label="보내기" disabled={!draft.trim() || sending} onClick={() => void send()}>
          <SendIcon />
        </IconButton>
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

function ChatIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M5 5.75h14v10.5H10l-5 3v-13.5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M8 9.5h8M8 12.5h5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M12 19V5m0 0L6.5 10.5M12 5l5.5 5.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}
