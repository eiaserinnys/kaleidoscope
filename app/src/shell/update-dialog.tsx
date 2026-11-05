import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, ErrorNotice, SHELL_UPDATE_RESTART_UNSAVED, flushEditors, flushSandboxes, toCoreError, useShellSelector, type CoreError, type ShellStore, type UpdateStatus } from "@kaleidoscope/ui";

type Ready = Extract<UpdateStatus, { state: "ready" }>;

export function UpdateDialog({ store, host, openRequest, seen }: { store: ShellStore; host: HTMLElement; openRequest: number; seen: Set<string> }) {
  const update = useShellSelector(store, (snapshot) => snapshot?.update);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CoreError | null>(null);
  const pending = useRef(false);
  const ready = useRef<Ready | null>(null);
  const previousRequest = useRef(openRequest);
  if (update?.state === "ready") ready.current = update;
  const version = update?.state === "ready" ? update.version : null;

  useEffect(() => {
    if (version && !seen.has(version)) {
      seen.add(version);
      setError(null);
      setOpen(true);
    }
  }, [version, seen]);
  useEffect(() => {
    if (previousRequest.current !== openRequest) {
      previousRequest.current = openRequest;
      if (version) { setError(null); setOpen(true); }
    }
  }, [openRequest, version]);
  const cancel = useCallback(() => { setOpen(false); setError(null); }, []);
  const confirm = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      if (!await flushEditors() || !await flushSandboxes()) {
        setError(SHELL_UPDATE_RESTART_UNSAVED());
        return;
      }
      await store.call({ op: "update.restart" });
    } catch (cause) { setError(toCoreError(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  const current = ready.current;
  if (!open || !current) return null;
  return <Dialog host={host} title={`${current.version}판으로 업데이트할까요?`} ok="다시 시작해서 업데이트"
    cancelLabel="나중에" userConsent busy={busy} onCancel={cancel} onConfirm={() => void confirm()}
    overlayClassName="ks-shell-dialog-layer" inertSelector=":scope > .ks-shell-bar, :scope > .ks-desktop-area"
    body={<div className="ks-update-content">
      <div className="ks-install-meta">{current.current_version} → {current.version}</div>
      {current.changes.length ? current.changes.map((change) => <section className="ks-install-group" key={change.version}>
        {current.changes.length > 1 ? <div className="ks-install-meta">{change.version}판</div> : null}
        <ul className="ks-install-rows">{change.items.map((item, index) => <li className="ks-update-item" key={index}>{item}</li>)}</ul>
      </section>) : <div className="ks-install-meta">업데이트 정보에 바뀐 것 목록이 없습니다</div>}
      {error ? <ErrorNotice error={error} /> : null}
    </div>} />;
}
