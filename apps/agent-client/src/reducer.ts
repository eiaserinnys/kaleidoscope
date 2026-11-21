import type { InitializeResponse, NewSessionResponse, RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { agentError } from "./errors.ts";
import { hadGuide } from "./guide.ts";

export type Attachment = { id: string; name: string; mime: string; key: string; size: number };
export type Queued = { id: string; text: string; attachments: Attachment[] };
export type Control = { id: string; label: string; category: string | null; value: string | boolean; kind: "select" | "boolean"; options: { value: string; label: string; group?: string }[] };
/** 보낸 요청. sessionId는 응답을 돌려줄 세션이고 연결 전체의 요청(initialize, authenticate, list)은 null이다. */
export type Pending = { kind: string; params: unknown; sessionId?: string | null };
export type Permission = { id: string; rpcId: number | string; title: string; options: { id: string; label: string; kind: string }[]; sessionId?: string };
export type Item = { id: string; kind: "assistant" | "user" | "notice" | "error"; text: string; at: string; attachments: { id: string; name: string; mime: string }[] };
export type RpcReply = { jsonrpc: "2.0"; id: string | number; result?: unknown; error?: { code: number; message: string } };
export type Failure = { id: string; reason: string; code?: string; message?: string };

/** 세션 하나의 상태. 한 프로세스가 세션 여러 개를 들고 sessionId로 나눈다. */
export type SessionState = {
  /** loading은 session/load를 보내고 응답을 기다리는 중이다. */
  phase: "loading" | "ready" | "responding";
  /** load 중 재생되는 기록을 버릴지(drop, 이미 기록이 있음) 모을지(collect, 다른 세션으로 바꿈). */
  replay: "drop" | "collect" | null;
  replayItems: Item[];
  queue: Queued[];
  stream: { id: string | null; text: string };
  streamKey: string | null;
  tools: { id: string; title: string }[];
  permissions: Permission[];
  controls: Control[];
  guideSent: boolean;
  refreshAfterFirstPrompt: boolean;
  restoreControls: { id: string; value: string | boolean }[];
  contextTicket: string | null;
  completed: Item[];
  /** 이 세션의 마지막 턴이 실패한 까닭. 다음 말을 보내면 지운다. */
  failure: Failure | null;
};

/** 프로세스(연결) 하나의 상태. 세션별 상태는 sessions에, 화면에 보이는 세션은 foreground에 둔다. */
export type State = {
  schema: 2;
  generation: string;
  nextId: number;
  pending: Record<string, Pending>;
  capabilities: { loadSession: boolean; image: boolean; http: boolean; list: boolean };
  authMethods: { id: string; name: string; description: string }[];
  phase: "starting" | "login" | "ready" | "failed";
  foreground: string | null;
  sessions: Record<string, SessionState>;
  /** 세션이 정해지기 전(프로세스 교체 등)에 넘겨받은 말. 전경 세션이 준비되면 그 큐 앞에 붙인다. */
  carry: Queued[];
  partial: number[];
  partialKey: string | null;
  sessionError: { id: string; message: string } | null;
  needsNew: boolean;
  initialized: boolean;
  failure: Failure | null;
  outbox: RpcReply[];
  servicesUsed: string | null;
  restartPending: boolean;
};

export function sessionState(): SessionState {
  return { phase: "ready", replay: null, replayItems: [], queue: [], stream: { id: null, text: "" }, streamKey: null, tools: [], permissions: [], controls: [],
    guideSent: false, refreshAfterFirstPrompt: false, restoreControls: [], contextTicket: null, completed: [], failure: null };
}

export function initialState(): State {
  return { schema: 2, generation: "", nextId: 1, pending: {},
    capabilities: { loadSession: false, image: false, http: false, list: false }, authMethods: [],
    phase: "starting", foreground: null, sessions: {}, carry: [], partial: [], partialKey: null, sessionError: null, needsNew: false, initialized: false, failure: null,
    outbox: [], servicesUsed: null, restartPending: false };
}

/** 응답 중이거나 보낼 말이 남은 세션. */
export function sessionBusy(session: SessionState | undefined): boolean {
  return !!session && (session.phase === "responding" || (session.phase === "ready" && session.queue.length > 0));
}

function patch(state: State, id: string | null | undefined, change: (session: SessionState) => SessionState): State {
  if (!id || !state.sessions[id]) return state;
  return { ...state, sessions: { ...state.sessions, [id]: change(state.sessions[id]) } };
}

function without(sessions: Record<string, SessionState>, id: string | null | undefined): Record<string, SessionState> {
  if (!id || !(id in sessions)) return sessions;
  const next = { ...sessions };
  delete next[id];
  return next;
}

export function reserveRequest(state: State, kind: string, params: unknown, sessionId: string | null = null): [State, number] {
  const id = state.nextId;
  let next: State = { ...state, nextId: id + 1, phase: kind === "authenticate" ? "starting" : state.phase,
    failure: kind === "prompt" ? null : state.failure, sessionError: kind === "switch" || kind === "new_user" ? null : state.sessionError,
    pending: { ...state.pending, [id]: { kind, params, sessionId } } };
  if (kind === "prompt") next = patch(next, sessionId, (session) => ({ ...session, phase: "responding", failure: null }));
  if (kind === "load" && sessionId) next = { ...next, sessions: { ...next.sessions, [sessionId]: { ...(next.sessions[sessionId] ?? sessionState()), phase: "loading", replay: "drop" } } };
  if (kind === "switch" && sessionId) next = { ...next, sessions: { ...next.sessions, [sessionId]: { ...sessionState(), phase: "loading", replay: "collect" } } };
  return [next, id];
}

export function enqueue(state: State, sessionId: string, message: Queued): State {
  return patch(state, sessionId, (session) => session.queue.some((item) => item.id === message.id) ? session : { ...session, queue: [...session.queue, message] });
}

export function findPermission(state: State, rpcId: string | number): Permission | undefined {
  for (const session of Object.values(state.sessions)) {
    const permission = session.permissions.find((p) => p.rpcId === rpcId);
    if (permission) return permission;
  }
  return undefined;
}

export function answerPermission(state: State, rpcId: string | number, option: string | null): State {
  const permission = findPermission(state, rpcId);
  if (!permission) throw agentError("AGENT_PERMISSION_REPLY_REQUEST_NOT_FOUND");
  if (option !== null && !permission.options.some((o) => o.id === option)) throw agentError("AGENT_PERMISSION_REPLY_OPTION_NOT_FOUND");
  const outcome = option === null ? { outcome: "cancelled" } : { outcome: "selected", optionId: option };
  const sessions = Object.fromEntries(Object.entries(state.sessions).map(([id, session]) => [id,
    session.permissions.some((p) => p.rpcId === rpcId) ? { ...session, permissions: session.permissions.filter((p) => p.rpcId !== rpcId) } : session]));
  return { ...state, sessions, outbox: [...state.outbox, { jsonrpc: "2.0", id: rpcId, result: { outcome } }] };
}

function finishText(session: SessionState): SessionState {
  if (!session.stream.id || !session.stream.text) return { ...session, stream: { id: null, text: "" } };
  const item: Item = { id: session.stream.id, kind: "assistant", text: session.stream.text, at: new Date().toISOString(), attachments: [] };
  return { ...session, stream: { id: null, text: "" }, completed: [...session.completed, item] };
}

function controlsFrom(result: Record<string, any>): Control[] {
  const controls: Control[] = [];
  for (const option of result.configOptions ?? []) {
    if (option.type !== "select" && option.type !== "boolean") continue;
    const options: Control["options"] = [];
    for (const entry of option.options ?? []) {
      if (Array.isArray(entry.options)) {
        for (const child of entry.options) options.push({ value: child.value, label: child.name, group: entry.name });
      } else options.push({ value: entry.value, label: entry.name });
    }
    controls.push({ id: option.id, label: option.name, category: option.category ?? null, value: option.currentValue, kind: option.type, options });
  }
  if (!controls.some((c) => c.category === "model") && result.models) {
    controls.push({ id: "__legacy_model", label: "모델", category: "model", value: result.models.currentModelId, kind: "select", options: result.models.availableModels.map((m: any) => ({ value: m.modelId, label: m.name })) });
  }
  if (!controls.some((c) => c.category === "mode") && result.modes) {
    controls.push({ id: "__legacy_mode", label: "모드", category: "mode", value: result.modes.currentModeId, kind: "select", options: result.modes.availableModes.map((m: any) => ({ value: m.id, label: m.name })) });
  }
  return controls;
}

/**
 * 알림의 sessionId가 가리키는 세션. sessionId가 없는 옛 에이전트의 알림은
 * 기록을 모으는 중인 세션이 있으면 그쪽으로, 아니면 전경 세션으로 보낸다.
 */
function target(state: State, sessionId: unknown): string | null {
  if (typeof sessionId === "string" && sessionId) return sessionId;
  return Object.entries(state.sessions).find(([, session]) => session.replay === "collect")?.[0] ?? state.foreground;
}

/** Applies one ACP message without side effects; the result can be stored as JSON. */
export function reduceMessage(state: State, raw: unknown, streamId: string): State {
  const message = raw as Record<string, any>;
  if (message.method === "session/request_permission" && message.id !== undefined) {
    const request = message.params as RequestPermissionRequest;
    const sessionId = target(state, request?.sessionId);
    // 들고 있지 않은 세션의 허용 요청은 물어볼 곳이 없으니 취소로 답한다.
    if (!sessionId || !state.sessions[sessionId]) return { ...state, outbox: [...state.outbox, { jsonrpc: "2.0", id: message.id, result: { outcome: { outcome: "cancelled" } } }] };
    return patch(state, sessionId, (session) => ({ ...session, permissions: [...session.permissions, {
      id: streamId, rpcId: message.id, title: request.toolCall.title ?? "도구", sessionId,
      options: request.options.map((o) => ({ id: o.optionId, label: o.name, kind: o.kind })),
    }] }));
  }
  if (message.method === "session/update") {
    const update = message.params?.update;
    const sessionId = target(state, message.params?.sessionId);
    const session = sessionId ? state.sessions[sessionId] : undefined;
    if (!session) return state;
    if (session.replay === "collect") {
      if ((update?.sessionUpdate !== "user_message_chunk" && update?.sessionUpdate !== "agent_message_chunk") || update.content?.type !== "text") return state;
      const id = String(update.messageId ?? streamId);
      const items = [...session.replayItems];
      const index = items.findIndex((item) => item.id === id);
      if (index >= 0) items[index] = { ...items[index], text: items[index].text + update.content.text };
      else items.push({ id, kind: update.sessionUpdate === "user_message_chunk" ? "user" : "assistant", text: update.content.text, at: new Date().toISOString(), attachments: [] });
      return patch(state, sessionId, (current) => ({ ...current, replayItems: items }));
    }
    if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
      if (session.replay) return state;
      return patch(state, sessionId, (current) => ({ ...current, stream: { id: current.stream.id ?? streamId, text: current.stream.text + update.content.text } }));
    }
    if (update?.sessionUpdate === "current_mode_update") {
      return patch(state, sessionId, (current) => ({ ...current, controls: current.controls.map((c) => c.id === "__legacy_mode" ? { ...c, value: update.currentModeId } : c) }));
    }
    if (update?.sessionUpdate === "config_option_update") {
      const controls = controlsFrom({ configOptions: update.configOptions });
      return patch(state, sessionId, (current) => ({ ...current, controls: [...controls, ...current.controls.filter((c) => c.id.startsWith("__legacy_") && !controls.some((o) => o.category === c.category))] }));
    }
    if (update?.sessionUpdate === "tool_call") {
      if (session.replay) return state;
      const terminal = update.status === "completed" || update.status === "failed";
      return patch(state, sessionId, (current) => {
        const finished = finishText(current);
        return { ...finished, tools: terminal ? finished.tools : [...finished.tools, { id: update.toolCallId, title: update.title }] };
      });
    }
    if (update?.sessionUpdate === "tool_call_update") {
      const terminal = update.status === "completed" || update.status === "failed";
      return patch(state, sessionId, (current) => ({ ...current, tools: terminal ? current.tools.filter((t) => t.id !== update.toolCallId) : current.tools.map((t) => t.id === update.toolCallId && update.title ? { ...t, title: update.title } : t) }));
    }
    return state;
  }
  if (typeof message.method === "string") {
    return message.id === undefined ? state : { ...state, outbox: [...state.outbox, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } }] };
  }
  if (message.id === undefined || !(String(message.id) in state.pending)) return state;
  const pending = { ...state.pending };
  const request = pending[String(message.id)];
  delete pending[String(message.id)];
  const next: State = { ...state, pending };
  const sessionId = request.sessionId ?? (request.kind === "switch" ? String(request.params) : request.kind === "new" ? null : state.foreground);
  if (message.error) {
    const reason = String(message.error.message ?? "ACP 오류");
    if (request.kind === "switch" || request.kind === "new_user") {
      const active = request.kind === "switch" && message.error.data?.reason === "thread_active_writer";
      const error = agentError(active ? "AGENT_SESSION_LOAD_ACTIVE_WRITER" : request.kind === "switch" ? "AGENT_SESSION_LOAD_FAILED" : "AGENT_SESSION_NEW_FAILED", reason);
      return { ...next, sessions: request.kind === "switch" && sessionId !== state.foreground ? without(next.sessions, sessionId) : next.sessions, sessionError: { id: error.id, message: error.message } };
    }
    if ((request.kind === "new" || request.kind === "load") && message.error.code === -32000) return patch({ ...next, phase: "login" }, sessionId, (session) => ({ ...session, replay: null }));
    if (request.kind === "load") return patch({ ...next, phase: "starting", needsNew: true }, sessionId, (session) => ({ ...session, replay: null }));
    if (request.kind === "authenticate") return { ...next, phase: "login", failure: { id: "AGENT_LOGIN_AUTHENTICATE_FAILED", reason } };
    if (request.kind === "prompt") {
      return patch(next, sessionId, (session) => ({ ...finishText(session), phase: "ready", replay: null, failure: { id: "AGENT_ACP_PROTOCOL_FAILED", reason }, permissions: [], tools: [] }));
    }
    const sessions = Object.fromEntries(Object.entries(next.sessions).map(([id, session]) => [id, { ...session, replay: null, permissions: [], tools: [] }]));
    return { ...next, sessions, phase: "failed", failure: { id: "AGENT_ACP_PROTOCOL_FAILED", reason } };
  }
  if (!message.result) return next;
  if (request.kind === "initialize") {
    const result = message.result as InitializeResponse;
    return { ...next, initialized: true, capabilities: { loadSession: result.agentCapabilities?.loadSession === true,
      image: result.agentCapabilities?.promptCapabilities?.image === true, http: result.agentCapabilities?.mcpCapabilities?.http === true,
      list: result.agentCapabilities?.sessionCapabilities?.list != null },
      authMethods: (result.authMethods ?? []).filter((method) => "id" in method && "name" in method && (method as { type?: string }).type !== "terminal").map((method) => ({ id: method.id, name: method.name, description: method.description ?? "" })) };
  }
  if (request.kind === "switch" && sessionId) {
    const loaded = next.sessions[sessionId] ?? sessionState();
    return { ...next, foreground: sessionId, sessionError: null, sessions: { ...next.sessions, [sessionId]: { ...loaded, phase: "ready", replay: null, replayItems: [],
      guideSent: hadGuide(loaded.replayItems), refreshAfterFirstPrompt: false, controls: controlsFrom(message.result), restoreControls: [] } } };
  }
  if (request.kind === "new_user") {
    const result = message.result as NewSessionResponse;
    return { ...next, foreground: result.sessionId, sessionError: null, sessions: { ...next.sessions,
      [result.sessionId]: { ...sessionState(), refreshAfterFirstPrompt: true, controls: controlsFrom(result as Record<string, any>) } } };
  }
  if (request.kind === "new") {
    // 앞 세션을 이어받지 못해 새로 연 세션은 앞 세션의 큐와 기록을 그대로 넘겨받는다.
    const result = message.result as NewSessionResponse;
    const previous = state.foreground ? next.sessions[state.foreground] : undefined;
    const base = previous ?? sessionState();
    const sessions = without(next.sessions, state.foreground);
    sessions[result.sessionId] = { ...base, phase: "ready", replay: null, queue: [...next.carry, ...base.queue], refreshAfterFirstPrompt: true, controls: controlsFrom(result as Record<string, any>) };
    return { ...next, phase: "ready", needsNew: false, failure: null, foreground: result.sessionId, carry: [], sessions };
  }
  if (request.kind === "load" && sessionId) {
    const loaded = next.sessions[sessionId] ?? sessionState();
    const carry = sessionId === state.foreground ? next.carry : [];
    return { ...next, phase: "ready", needsNew: false, failure: null, carry: sessionId === state.foreground ? [] : next.carry, sessions: { ...next.sessions,
      [sessionId]: { ...loaded, phase: "ready", replay: null, queue: [...carry, ...loaded.queue], refreshAfterFirstPrompt: false, controls: controlsFrom(message.result) } } };
  }
  if (request.kind === "authenticate") return { ...next, phase: "starting", failure: null };
  if (request.kind === "prompt") return patch(next, sessionId, (session) => ({ ...finishText(session), phase: "ready", permissions: [], tools: [] }));
  if (request.kind === "configure") {
    const control = request.params as { id: string; value: string | boolean };
    if (message.result.configOptions) {
      const controls = controlsFrom(message.result);
      return patch(next, sessionId, (session) => ({ ...session, controls: [...controls, ...session.controls.filter((c) => c.id.startsWith("__legacy_") && !controls.some((o) => o.category === c.category))] }));
    }
    return patch(next, sessionId, (session) => ({ ...session, controls: session.controls.map((c) => c.id === control.id ? { ...c, value: control.value } : c) }));
  }
  return next;
}

/** schema 1(세션 하나) 체크포인트를 schema 2로 옮긴다. 같은 프로세스에 다시 붙을 때 진행 중인 턴을 잃지 않는다. */
export function migrateState(raw: unknown): State {
  const old = raw as Record<string, any>;
  if (old?.schema === 2) return old as State;
  const foreground: string | null = old.sessionId ?? null;
  const pendingOld = (old.pending ?? {}) as Record<string, Pending>;
  const pending: Record<string, Pending> = {};
  let switchTarget: string | null = null;
  for (const [id, request] of Object.entries(pendingOld)) {
    if (request.kind === "switch") switchTarget = String(request.params);
    const sessionId = request.kind === "switch" ? String(request.params)
      : request.kind === "prompt" || request.kind === "configure" || request.kind === "load" ? foreground : null;
    pending[id] = { ...request, sessionId };
  }
  const loading = Object.values(pendingOld).some((request) => request.kind === "load");
  const turnFailure = old.phase === "ready" || old.phase === "responding";
  const current: SessionState = {
    ...sessionState(),
    phase: old.phase === "responding" ? "responding" : loading ? "loading" : "ready",
    replay: old.replay && loading ? "drop" : null,
    queue: old.queue ?? [], stream: old.stream ?? { id: null, text: "" }, streamKey: old.streamKey ?? null, tools: old.tools ?? [],
    permissions: (old.permissions ?? []).map((permission: Permission) => ({ ...permission, ...(foreground ? { sessionId: foreground } : {}) })),
    controls: old.controls ?? [], guideSent: old.guideSent === true, refreshAfterFirstPrompt: old.refreshAfterFirstPrompt === true,
    restoreControls: old.restoreControls ?? [], contextTicket: old.contextTicket ?? null, completed: old.completed ?? [],
    failure: turnFailure ? old.failure ?? null : null,
  };
  const sessions: Record<string, SessionState> = {};
  if (foreground) sessions[foreground] = current;
  if (switchTarget && switchTarget !== foreground) sessions[switchTarget] = { ...sessionState(), phase: "loading", replay: "collect", replayItems: old.replayItems ?? [] };
  return {
    schema: 2, generation: old.generation ?? "", nextId: old.nextId ?? 1, pending,
    capabilities: { loadSession: false, image: false, http: false, list: false, ...(old.capabilities ?? {}) }, authMethods: old.authMethods ?? [],
    phase: old.phase === "responding" ? "ready" : old.phase ?? "starting", foreground, sessions,
    carry: foreground ? [] : old.queue ?? [], partial: old.partial ?? [], partialKey: old.partialKey ?? null,
    sessionError: old.sessionError ?? null, needsNew: old.needsNew === true, initialized: old.initialized === true,
    failure: turnFailure ? null : old.failure ?? null, outbox: old.outbox ?? [], servicesUsed: old.servicesUsed ?? null, restartPending: old.restartPending === true,
  };
}
