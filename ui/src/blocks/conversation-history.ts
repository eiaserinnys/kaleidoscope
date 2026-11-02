import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import type { ConversationItem } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";

type HistoryOptions = {
  historyRef: RefObject<HTMLDivElement | null>;
  nextBefore: string | undefined;
  enabled: boolean;
  store: ShellStore;
  windowId: string;
  onItems: (items: ConversationItem[], before: string | undefined) => void;
  onError: (reason: unknown) => void;
  items: ConversationItem[];
};

export function useConversationHistory({ historyRef, nextBefore, enabled, store, windowId, onItems, onError, items }: HistoryOptions) {
  const loading = useRef(false);
  const restore = useRef<{ height: number; top: number } | null>(null);
  const callbacks = useRef({ onItems, onError });
  callbacks.current = { onItems, onError };
  const loadOlder = useCallback(() => {
    const history = historyRef.current;
    if (!enabled || !history || !nextBefore || loading.current) return;
    loading.current = true;
    void store.call({ op: "conversation.history", window_id: windowId, before: nextBefore }).then((reply) => {
      restore.current = { height: history.scrollHeight, top: history.scrollTop };
      callbacks.current.onItems(reply.items, reply.next_before);
    }).catch((reason: unknown) => callbacks.current.onError(reason)).finally(() => { loading.current = false; });
  }, [enabled, historyRef, nextBefore, store, windowId]);

  useLayoutEffect(() => {
    const history = historyRef.current;
    if (!history) return;
    const position = restore.current;
    if (position) {
      restore.current = null;
      history.scrollTop = position.top + history.scrollHeight - position.height;
    }
    const fill = () => {
      if (history.clientHeight > 0 && history.scrollHeight <= history.clientHeight) loadOlder();
    };
    fill();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fill);
    observer.observe(history);
    return () => observer.disconnect();
  }, [historyRef, items, loadOlder]);

  return loadOlder;
}
