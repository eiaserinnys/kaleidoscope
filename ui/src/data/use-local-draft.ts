import { useEffect, useMemo, useRef, useState } from "react";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { useWindowData } from "./window-data";
import { createSerialSend, createThrottledSend } from "./throttled-send";
const identityJson = <T extends JsonValue>(value: T): JsonValue => value;

export function useLocalDraft<T extends JsonValue>(
  current: T,
  pointer: string,
  options: { sendOnChange?: boolean; toJson?: (value: T) => JsonValue; dispatch?: (value: T) => Promise<boolean>; intervalMs?: number; resetOnFailure?: boolean; syncOnSuccess?: boolean; prepare?: { current: () => void } } = {},
) {
  const data = useWindowData();
  const [draft, setDraft] = useState(current);
  const holding = useRef(false);
  const inFlight = useRef(0);
  const revision = useRef(0);
  const externalChanges = useRef(0);
  const adoptRevision = useRef<number | null>(null);
  const latest = useRef(current);
  latest.current = current;
  const sendOnChange = options.sendOnChange ?? true;
  const toJson = options.toJson ?? identityJson;
  const resetOnFailure = options.resetOnFailure ?? true;
  const syncOnSuccess = options.syncOnSuccess ?? false;
  const dispatch = options.dispatch;
  const serialSend = useMemo(() => createSerialSend(async ({ value, revision: sentRevision }: { value: T; revision: number }) => {
    inFlight.current += 1;
    let success = false;
    try {
      success = dispatch ? await dispatch(value) : await data.act(`${pointer}/on_change`, toJson(value), undefined, undefined, undefined, { input: true });
      if (!success && resetOnFailure && !holding.current && revision.current === sentRevision) setDraft(latest.current);
    } finally {
      inFlight.current -= 1;
      if (success && syncOnSuccess && inFlight.current === 0 && !holding.current && revision.current === sentRevision) setDraft(latest.current);
    }
  }), [data, pointer, resetOnFailure, syncOnSuccess, toJson, dispatch]);
  const enqueue = (value: T, coalesce: boolean) => serialSend({ value, revision: revision.current }, { coalesce });
  const throttled = useMemo(() => createThrottledSend((next: T) => enqueue(next, true), options.intervalMs ?? 100), [options.intervalMs, serialSend]);
  useEffect(() => () => throttled.flush(), [throttled]);
  useEffect(() => data.holdInput(() => {
    options.prepare?.current();
    if (sendOnChange) throttled.flush();
    return serialSend.idle();
  }), [data, options.prepare, sendOnChange, serialSend, throttled]);
  useEffect(() => {
    externalChanges.current += 1;
    if ((!holding.current || adoptRevision.current === revision.current) && inFlight.current === 0) setDraft(current);
  }, [current]);
  const change = (next: T) => { revision.current += 1; setDraft(next); if (sendOnChange) throttled.send(next); };
  const finish = (sync = true) => { if (sendOnChange) throttled.flush(); holding.current = false; if (sync && inFlight.current === 0) setDraft(latest.current); };
  const send = (next: T, coalesce = false) => enqueue(next, coalesce);
  const mark = () => ({ revision: revision.current, externalChanges: externalChanges.current });
  const adopt = (submitted: ReturnType<typeof mark>) => {
    if (revision.current !== submitted.revision) return;
    adoptRevision.current = submitted.revision;
    if (externalChanges.current !== submitted.externalChanges && inFlight.current === 0) setDraft(latest.current);
  };
  const isSending = () => inFlight.current > 0;
  return { draft, change, finish, holding, send, mark, adopt, isSending };
}
