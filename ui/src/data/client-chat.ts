import type { ConversationAttachment, ConversationEvent, ConversationItem, CoreError } from "../contract/contract";

export type ClientChatQueuedMessage = {
  id: string;
  text: string;
  attachments: ConversationAttachment[];
};

export type ClientChatEnvelope =
  | {
      kind: "snapshot";
      items: ConversationItem[];
      stream_id: string | null;
      text: string;
      busy: boolean;
      tool: string | null;
      queued: ClientChatQueuedMessage[];
    }
  | { kind: "event"; event: ConversationEvent }
  | { kind: "attachment"; request_id: string; mime: string; bytes: ArrayBuffer }
  | { kind: "error"; error: CoreError };

export type ClientChatAttachment = { mime: string; bytes: ArrayBuffer };

export type ClientChatState = {
  generation: number;
  loading: boolean;
  items: ConversationItem[];
  stream_id: string | null;
  text: string;
  busy: boolean;
  tool: string | null;
  queued: ClientChatQueuedMessage[];
  error: CoreError | null;
  attachments: ReadonlyMap<string, ClientChatAttachment>;
};

export const emptyClientChatState: ClientChatState = {
  generation: 0, loading: true, items: [], stream_id: null, text: "", busy: false, tool: null, queued: [], error: null, attachments: new Map(),
};

function uniqueItems(items: ConversationItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function applyClientChatEnvelope(state: ClientChatState, envelope: ClientChatEnvelope): ClientChatState {
  if (envelope.kind === "snapshot") {
    return {
      ...state,
      loading: false,
      items: uniqueItems(envelope.items),
      stream_id: envelope.stream_id,
      text: envelope.text,
      busy: envelope.busy,
      tool: envelope.tool,
      queued: envelope.queued,
      error: null,
    };
  }
  if (envelope.kind === "attachment") {
    const attachments = new Map(state.attachments);
    attachments.set(envelope.request_id, { mime: envelope.mime, bytes: envelope.bytes });
    return { ...state, loading: false, attachments };
  }
  if (envelope.kind === "error") return { ...state, loading: false, error: envelope.error };

  const event = envelope.event;
  if (event.kind === "snapshot") {
    const snapshot = event.snapshot;
    return {
      ...state,
      loading: false,
      items: uniqueItems(snapshot.items),
      stream_id: snapshot.stream_id,
      text: snapshot.text ?? "",
      busy: snapshot.busy,
      tool: snapshot.tool,
      error: null,
    };
  }
  if (event.kind === "item") {
    const items = uniqueItems([...state.items.filter((item) => item.id !== event.item.id), event.item]);
    return event.item.kind === "assistant"
      ? { ...state, loading: false, items, stream_id: null, text: "" }
      : { ...state, loading: false, items };
  }
  if (event.kind === "text") return { ...state, loading: false, stream_id: event.stream_id, text: event.text };
  return { ...state, loading: false, busy: event.busy, tool: event.tool };
}
