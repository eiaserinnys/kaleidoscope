import { useCallback, useLayoutEffect, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { Dialog, isWindowTop, TriangleAlert, useShellSelector, type ShellStore } from "@kaleidoscope/ui";
import { describeInstallScope } from "./install-scope";

export function InstallationConsent({ store, windowId, host }: { store: ShellStore; windowId: string; host: HTMLElement | null }) {
  const subscribe = useCallback((listener: () => void) => store.subscribeInstallConsent(windowId, listener), [store, windowId]);
  const getRequest = useCallback(() => store.getInstallConsent(windowId), [store, windowId]);
  const request = useSyncExternalStore(subscribe, getRequest, getRequest);
  const active = useShellSelector(store, (snapshot) => isWindowTop(snapshot, windowId));
  const workerLocation = useShellSelector(store, (snapshot) => {
    if (!request?.definition.worker) return "";
    const link = snapshot?.link;
    if (link?.state !== "connected" && link?.state !== "offline") return "";
    return link.mode === "embedded" ? "embedded" : link.server_url;
  });
  const answer = useCallback((allow: boolean) => {
    if (!request) return;
    void store.call({ op: "app.respond_install_permission", window_id: windowId, request_id: request.request_id, digest: request.digest, allow });
  }, [request, store, windowId]);
  const cancel = useCallback(() => answer(false), [answer]);
  const confirm = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (event.nativeEvent.isTrusted) answer(true);
  }, [answer]);
  useLayoutEffect(() => {
    if (request && active) host?.querySelector<HTMLButtonElement>(".ks-install-consent .ks-dialog-actions > button")?.focus({ preventScroll: true });
  }, [request, active, host]);
  if (!request || !host) return null;
  const place = workerLocation === "embedded" ? "embedded" : workerLocation ? "remote" : "unknown";
  const groups = describeInstallScope(request.definition, place, place === "remote" ? new URL(workerLocation).host : undefined);
  return <Dialog key={request.request_id} host={host} windowId={windowId} userConsent windowModal active={active}
    overlayClassName="ks-window-consent-overlay ks-install-consent" inertSelector=":scope > .ks-window-content"
    title="이 앱을 설치할까요?" ok="허용하고 설치" onCancel={cancel} onConfirm={confirm}
    body={<>
      <div><strong className="ks-consent-value">{request.app_name}</strong> · {request.release}판<br /><span className="ks-install-meta">{new URL(request.store_url).host}</span></div>
      {groups.length === 0 ? <span>이 앱은 창 안에서만 동작합니다</span> : groups.map((group) => <section className="ks-install-group" key={group.sentence}>
        <strong className={group.tone === "warning" ? "ks-install-warning" : undefined}>{group.tone === "warning" ? <TriangleAlert size="inline" /> : null}<span>{group.sentence}</span></strong>
        {group.rows.length ? <ul className="ks-install-rows">{group.rows.map((row, index) => <li key={index}>
          {row.target ? <span className="ks-consent-value">{row.target}</span> : null}{row.reason ? <span className="ks-install-meta">{row.reason}</span> : null}
        </li>)}</ul> : null}
        {group.notes.map((note) => <div className="ks-install-meta" key={note}>{note}</div>)}
        {group.details ? <Details label={group.details.label}>{group.details.text}</Details> : null}
      </section>)}
    </>} />;
}

function Details({ label, children }: { label: string; children: ReactNode }) {
  return <details className="ks-install-details"><summary className="ks-install-meta">{label}</summary><pre className="ks-process-command">{children}</pre></details>;
}
