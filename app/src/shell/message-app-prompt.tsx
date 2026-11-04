import { useCallback, useMemo, useRef, useState } from "react";
import { BUILTIN_APP_IDS, Dialog, ErrorNotice, defaultMessageApp, messageApps, toCoreError, type CoreError, type ShellStore } from "@kaleidoscope/ui";
import { LoaderCircle } from "../../../ui/src/components/icons";
import { useMessageSnapshot } from "./use-message-snapshot";

export function directionParticle(name: string): string {
  const last = name.codePointAt(name.length - 1);
  if (last === undefined || last < 0xac00 || last > 0xd7a3) return "로";
  const final = (last - 0xac00) % 28;
  return final !== 0 && final !== 8 ? "으로" : "로";
}

export function MessageAppPrompt({ store, host }: { store: ShellStore; host: HTMLElement }) {
  const snapshot = useMessageSnapshot(store);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [problem, setProblem] = useState<{ key: string; error: CoreError } | null>(null);
  const shared = snapshot?.shared;
  const link = snapshot?.link;
  const apps = useMemo(() => shared ? messageApps(shared) : [], [snapshot]);
  const current = useMemo(() => shared ? defaultMessageApp(shared) : null, [snapshot]);
  const candidate = shared?.preferences && link?.state === "connected"
    ? apps.find((app) => !(BUILTIN_APP_IDS as readonly string[]).includes(app.id)
      && app.id !== current?.id && !shared.preferences!.asked_message_app_ids.includes(app.id))
    : undefined;
  const appId = candidate?.id;
  const key = link?.state === "connected" && appId ? `${link.server_url}:${appId}` : "";
  const answer = useCallback(async (useAsDefault: boolean) => {
    if (!appId || pending.current) return;
    pending.current = true; setBusy(true); setProblem(null);
    try { await store.call({ op: "shell.preferences.answer", app_id: appId, use_as_default: useAsDefault }); }
    catch (cause) { setProblem({ key, error: toCoreError(cause) }); }
    finally { pending.current = false; setBusy(false); }
  }, [store, appId, key]);
  const cancel = useCallback(() => { void answer(false); }, [answer]);
  if (!candidate) return null;
  const error = problem?.key === key ? problem.error : null;
  const body = busy || error ? <>{error ? <ErrorNotice error={error} /> : null}{busy ? <span className="ks-settings-apply-progress" role="status" aria-label="저장 중"><LoaderCircle size="inline" className="ks-settings-apply-spinner" /></span> : null}</> : undefined;
  return <Dialog key={key} host={host} title={`기본 에이전트를 ${candidate.name}${directionParticle(candidate.name)} 바꿀까요?`}
    body={body} ok="바꾸기" cancelLabel="그대로 두기" userConsent busy={busy}
    overlayClassName="ks-shell-dialog-layer" inertSelector=":scope > .ks-shell-bar, :scope > .ks-desktop-area, :scope > .ks-shell-settings, :scope > .ks-empty-state"
    onCancel={cancel} onConfirm={() => void answer(true)} />;
}
