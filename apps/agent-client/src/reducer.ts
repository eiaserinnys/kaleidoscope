import type { InitializeResponse, NewSessionResponse, RequestPermissionRequest } from "@agentclientprotocol/sdk";

export type Attachment = { id: string; name: string; mime: string; key: string; size: number };
export type Queued = { id: string; text: string; attachments: Attachment[] };
export type Control = { id: string; label: string; category: string | null; value: string | boolean; kind: "select" | "boolean"; options: { value: string; label: string; group?: string }[] };
export type Pending = { kind: string; params: unknown };
export type Permission = { id: string; rpcId: number | string; title: string; options: { id: string; label: string; kind: string }[] };
export type Item = { id: string; kind: "assistant" | "user" | "notice" | "error"; text: string; at: string; attachments: { id: string; name: string; mime: string }[] };
export type RpcReply = { jsonrpc: "2.0"; id: string | number; result?: unknown; error?: { code: number; message: string } };
export type State = {
  schema: 1;
  nextId: number;
  pending: Record<string, Pending>;
  sessionId: string | null;
  capabilities: { loadSession: boolean; image: boolean; http: boolean };
  authMethods: { id: string; name: string; description: string }[];
  controls: Control[];
  permissions: Permission[];
  queue: Queued[];
  stream: { id: string | null; text: string };
  tools: { id: string; title: string }[];
  partial: number[];
  partialKey: string | null;
  streamKey: string | null;
  guideSent: boolean;
  phase: "starting" | "login" | "ready" | "responding" | "failed";
  replay: boolean;
  needsNew: boolean;
  initialized: boolean;
  failure: { id: string; reason: string } | null;
  completed: Item[];
  outbox: RpcReply[];
  servicesUsed: string | null;
  restartPending: boolean;
  contextTicket: string | null;
  restoreControls: { id: string; value: string | boolean }[];
};

export function initialState(): State {
  return { schema: 1, nextId: 1, pending: {}, sessionId: null,
    capabilities: { loadSession: false, image: false, http: false }, authMethods: [], controls: [], permissions: [], queue: [],
    stream: { id: null, text: "" }, tools: [], partial: [], partialKey: null, streamKey: null, guideSent: false,
    phase: "starting", replay: false, needsNew: false, initialized: false, failure: null,
    completed: [], outbox: [], servicesUsed: null, restartPending: false, contextTicket: null, restoreControls: [] };
}

export function reserveRequest(state: State, kind: string, params: unknown): [State, number] {
  const id = state.nextId;
  return [{ ...state, nextId: id + 1, phase: kind === "prompt" ? "responding" : state.phase,
    replay: kind === "load" ? true : state.replay, pending: { ...state.pending, [id]: { kind, params } } }, id];
}

export function enqueue(state: State, message: Queued): State {
  return state.queue.some((item) => item.id === message.id) ? state : { ...state, queue: [...state.queue, message] };
}

export function answerPermission(state: State, rpcId: string | number, option: string | null): State {
  const permission = state.permissions.find((p) => p.rpcId === rpcId);
  if (!permission || (option !== null && !permission.options.some((o) => o.id === option))) throw new Error("승인 선택을 찾지 못했습니다");
  const outcome = option === null ? { outcome: "cancelled" } : { outcome: "selected", optionId: option };
  return { ...state, permissions: state.permissions.filter((p) => p.rpcId !== rpcId),
    outbox: [...state.outbox, { jsonrpc: "2.0", id: rpcId, result: { outcome } }] };
}

function finishText(state: State): State {
  if (!state.stream.id || !state.stream.text) return { ...state, stream: { id: null, text: "" } };
  const item: Item = { id: state.stream.id, kind: "assistant", text: state.stream.text, at: new Date().toISOString(), attachments: [] };
  return { ...state, stream: { id: null, text: "" }, completed: [...state.completed, item] };
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

/** Applies one ACP message without side effects; the result can be stored as JSON. */
export function reduceMessage(state: State, raw: unknown, streamId: string): State {
  const message = raw as Record<string, any>;
  if (message.method === "session/request_permission" && message.id !== undefined) {
    const request = message.params as RequestPermissionRequest;
    return { ...state, permissions: [...state.permissions, {
      id: streamId, rpcId: message.id, title: request.toolCall.title ?? "도구",
      options: request.options.map((o) => ({ id: o.optionId, label: o.name, kind: o.kind })),
    }] };
  }
  if (message.method === "session/update") {
    const update = message.params?.update;
    if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
      if (state.replay) return state;
      return { ...state, stream: { id: state.stream.id ?? streamId, text: state.stream.text + update.content.text } };
    }
    if (update?.sessionUpdate === "current_mode_update") {
      return { ...state, controls: state.controls.map((c) => c.id === "__legacy_mode" ? { ...c, value: update.currentModeId } : c) };
    }
    if (update?.sessionUpdate === "config_option_update") {
      const controls = controlsFrom({ configOptions: update.configOptions });
      return { ...state, controls: [...controls, ...state.controls.filter((c) => c.id.startsWith("__legacy_") && !controls.some((o) => o.category === c.category))] };
    }
    if (update?.sessionUpdate === "tool_call") {
      if (state.replay) return state;
      const terminal = update.status === "completed" || update.status === "failed";
      const finished = finishText(state);
      return { ...finished, tools: terminal ? finished.tools : [...finished.tools, { id: update.toolCallId, title: update.title }] };
    }
    if (update?.sessionUpdate === "tool_call_update") {
      const terminal = update.status === "completed" || update.status === "failed";
      return { ...state, tools: terminal ? state.tools.filter((t) => t.id !== update.toolCallId) : state.tools.map((t) => t.id === update.toolCallId && update.title ? { ...t, title: update.title } : t) };
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
  const next = { ...state, pending };
  if (message.error) {
    const reason = String(message.error.message ?? "ACP 오류");
    if ((request.kind === "new" || request.kind === "load") && message.error.code === -32000) return { ...next, phase: "login", replay: false };
    if (request.kind === "load") return { ...next, phase: "starting", replay: false, needsNew: true };
    if (request.kind === "authenticate") return { ...next, phase: "login", failure: { id: "AGENT_LOGIN_AUTHENTICATE_FAILED", reason } };
    const finished = request.kind === "prompt" ? finishText(next) : next;
    return { ...finished, phase: "failed", replay: false, failure: { id: "AGENT_ACP_PROTOCOL_FAILED", reason }, tools: [] };
  }
  if (!message.result) return next;
  if (request.kind === "initialize") {
    const result = message.result as InitializeResponse;
    return { ...next, initialized: true, capabilities: { loadSession: result.agentCapabilities?.loadSession === true,
      image: result.agentCapabilities?.promptCapabilities?.image === true, http: result.agentCapabilities?.mcpCapabilities?.http === true },
      authMethods: (result.authMethods ?? []).filter((method) => "id" in method && "name" in method && (method as { type?: string }).type !== "terminal").map((method) => ({ id: method.id, name: method.name, description: method.description ?? "" })) };
  }
  if (request.kind === "new" || request.kind === "load") {
    const result = message.result as NewSessionResponse;
    return { ...next, phase: "ready", replay: false, needsNew: false, failure: null, sessionId: request.kind === "new" ? result.sessionId : state.sessionId, controls: controlsFrom(result as Record<string, any>) };
  }
  if (request.kind === "authenticate") return { ...next, phase: "starting", failure: null };
  if (request.kind === "prompt") return { ...finishText(next), phase: "ready", permissions: [], tools: [] };
  if (request.kind === "configure") {
    const control = request.params as { id: string; value: string | boolean };
    if (message.result.configOptions) {
      const controls = controlsFrom(message.result);
      return { ...next, controls: [...controls, ...state.controls.filter((c) => c.id.startsWith("__legacy_") && !controls.some((o) => o.category === c.category))] };
    }
    return { ...next, controls: state.controls.map((c) => c.id === control.id ? { ...c, value: control.value } : c) };
  }
  return next;
}
