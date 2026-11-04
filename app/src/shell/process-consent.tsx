import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { Dialog, isWindowTop, useShellSelector, type CoreEvent, type ShellStore } from "@kaleidoscope/ui";

type Request = Extract<CoreEvent, { event: "process.permission" }>;

export function ProcessConsent({ store, windowId, host }: { store: ShellStore; windowId: string; host: HTMLElement | null }) {
  const [requests, setRequests] = useState<Request[]>([]);
  const active = useShellSelector(store, (snapshot) => isWindowTop(snapshot, windowId));
  useEffect(() => store.subscribeEvents((event) => {
    if (event.event === "process.permission" && event.window_id === windowId) setRequests((previous) => [...previous, event]);
  }), [store, windowId]);
  const request = requests[0];
  const answer = useCallback((allow: boolean) => {
    if (!request) return;
    setRequests((previous) => previous.slice(1));
    void store.call({ op: "process.respond_permission", window_id: windowId, request_id: request.request_id, allow });
  }, [request, store, windowId]);
  const cancel = useCallback(() => answer(false), [answer]);
  const allow = useCallback((event: MouseEvent<HTMLButtonElement>) => { if (event.nativeEvent.isTrusted) answer(true); }, [answer]);
  if (!request || !host) return null;
  return <Dialog key={request.request_id} host={host} windowId={windowId} userConsent overlayClassName="ks-window-consent-overlay" inertSelector=":scope > .ks-window-content" windowModal active={active} title={`이 PC에서 ${request.spec.name}을(를) 실행할까요?`} ok="허용" onCancel={cancel} onConfirm={allow} body={<>
    <code className="ks-process-command">{[request.spec.command, ...request.spec.args].map((part) => /[\s"'\\]/.test(part) || !part ? JSON.stringify(part) : part).join(" ")}</code>
    {Object.entries(request.spec.env).map(([name, value]) => <span className="ks-process-env" key={name}>{name}={value}</span>)}
  </>} />;
}
