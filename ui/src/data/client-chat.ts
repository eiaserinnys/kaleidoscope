import type { ConversationAttachment, ConversationEvent, ConversationItem, CoreError, MediaRef } from "../contract/contract";

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
  | { kind: "attachment"; request_id: string; media: MediaRef }
  | { kind: "error"; error: CoreError };

export type ClientChatAttachment = { mime: string; bytes: ArrayBuffer } | { media: MediaRef };

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
    /* 기록을 그리지 않고 컴포저만 쓰는 채널은 보낸 메시지를 큐나 기록으로 돌려주지 않는다.
       비어 있고 쉬는 스냅샷이 오면 세대를 올려 화면이 기다리는 보낸 메시지 표시를 지운다. */
    const empty = envelope.items.length === 0 && !envelope.busy && envelope.queued.length === 0;
    return {
      ...state,
      generation: empty ? state.generation + 1 : state.generation,
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
    attachments.set(envelope.request_id, "media" in envelope ? { media: envelope.media } : { mime: envelope.mime, bytes: envelope.bytes });
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
