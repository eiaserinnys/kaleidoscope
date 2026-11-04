import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ErrorNotice, StatusText, defaultMessageApp, messageApps, toCoreError, type CoreError, type ShellStore } from "@kaleidoscope/ui";
import { LoaderCircle } from "../../../ui/src/components/icons";
import { Select } from "../../../ui/src/components/select-toggle";
import { useMessageSnapshot } from "./use-message-snapshot";

export function AccountSettings({ store }: { store: ShellStore }) {
  const snapshot = useMessageSnapshot(store);
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<CoreError | null>(null);
  const control = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const apps = useMemo(() => snapshot ? messageApps(snapshot.shared) : [], [snapshot]);
  const current = useMemo(() => snapshot ? defaultMessageApp(snapshot.shared) : null, [snapshot]);
  useEffect(() => {
    if (saving || !restoreFocus.current) return;
    restoreFocus.current = false;
    if (!document.activeElement || document.activeElement === document.body) control.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [saving]);
  if (!snapshot) return null;
  const { link, shared } = snapshot;
  const waiting = link.state === "connected" && !shared.preferences;
  const reason = link.state === "unlinked" ? "서버에 연결하면 기본 에이전트를 고를 수 있습니다"
    : link.state === "pairing" ? "서버 연결 승인을 기다리는 중입니다"
    : link.state === "revoked" ? "서버 연결을 다시 설정하면 바꿀 수 있습니다"
    : link.state === "offline" ? "서버에 다시 연결하면 바꿀 수 있습니다"
    : !waiting && apps.length === 0 ? "메시지를 받을 수 있는 앱이 없습니다" : null;
  const choose = async (value: unknown) => {
    if (typeof value !== "string") return;
    restoreFocus.current = true; setSaving(true); setError(null);
    try { await store.call({ op: "shell.preferences.set_default", app_id: value }); }
    catch (cause) { setError(toCoreError(cause)); }
    finally { setSaving(false); }
  };
  return <section className="ks-settings-group" aria-labelledby={`${id}-account`}>
    <h3 className="ks-data-section-title" id={`${id}-account`}>계정</h3>
    <div className="ks-settings-entry">
      <div className="ks-settings-label-row"><label>기본 에이전트</label>{saving ? <StatusText>저장 중</StatusText> : null}</div>
      {reason ? <div className="ks-settings-description" id={`${id}-reason`}>{reason}</div> : null}
      <div ref={control} className="ks-settings-control" aria-busy={waiting || undefined}>
        <Select label="기본 에이전트" items={apps.map((app) => ({ value: app.id, label: app.name }))} value={waiting ? null : current?.id ?? null}
          disabled={Boolean(reason) || waiting || saving} describedBy={reason ? `${id}-reason` : undefined}
          prefix={waiting ? <LoaderCircle size="inline" className="ks-settings-apply-spinner" /> : undefined} onChange={(value) => void choose(value)} />
      </div>
      {error ? <ErrorNotice error={error} /> : null}
    </div>
  </section>;
}
