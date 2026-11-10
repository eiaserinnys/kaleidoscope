import { Fragment, useCallback, useLayoutEffect, useSyncExternalStore, type MouseEvent } from "react";
import { Dialog, isWindowTop, toCoreError, TriangleAlert, useShellSelector, type CoreError, type InstallConsent, type ShellInstallConsent, type ShellStore } from "@kaleidoscope/ui";
import { describeInstallScope } from "./install-scope";
import { useHoldWhileWriting } from "./use-hold-while-writing";

function useWorkerLocation(store: ShellStore, request: InstallConsent | undefined) {
  return useShellSelector(store, (snapshot) => {
    if (request?.event !== "app.install_permission" || !request.definition.worker) return "";
    const link = snapshot?.link;
    if (link?.state !== "connected" && link?.state !== "offline") return "";
    return link.mode === "embedded" ? "embedded" : link.server_url;
  });
}

/** 창 동의와 쉘 전체 동의가 같은 내용을 보여 준다. 제목과 단추 글자만 각 화면이 정한다. */
function InstallConsentBody({ request, workerLocation }: { request: ShellInstallConsent; workerLocation: string }) {
  const place = workerLocation === "embedded" ? "embedded" : workerLocation ? "remote" : "unknown";
  const groups = describeInstallScope(request.definition, place, place === "remote" ? new URL(workerLocation).host : undefined);
  const installed = request.installed_release;
  const replacing = request.replacing === true;
  // 출발 출처와 대상이 같은 스토어면 같은 주소를 두 번 쓰지 않고 출발점을 「고친 판」과 호스트로 보인다.
  const sameStore = request.from_origin !== undefined && request.from_origin.store_url === request.store_url;
  return <>
    {replacing
      ? <div>
        <strong className="ks-consent-value">{request.app_name}</strong><br />
        <span className="ks-install-meta">{request.from_origin === undefined ? "커스텀 앱" : sameStore ? "고친 판" : <span className="ks-consent-value">{request.from_origin.store_url}</span>}에서 <span className="ks-consent-value">{sameStore ? new URL(request.store_url).host : request.store_url}</span> {request.release}판으로</span>
      </div>
      : <div><strong className="ks-consent-value">{request.app_name}</strong> · {installed === undefined ? `${request.release}판` : `${installed}판에서 ${request.release}판으로`}<br /><span className="ks-install-meta">{new URL(request.store_url).host}</span></div>}
    {replacing && request.modified === true ? <strong className="ks-install-sentence is-warning"><TriangleAlert size="inline" /><span>고친 내용을 스토어 판으로 대체합니다.</span></strong> : null}
    {replacing ? <span>창과 저장한 값은 유지됩니다.</span> : null}
    {groups.length === 0 ? <span>이 앱은 창 안에서만 동작합니다</span> : groups.map((group) => {
      const details = group.details;
      const hostPaths = details?.label === "자세히" ? details.hosts.map(({ host, paths }) => {
        const list = <ul className="ks-install-paths">{paths.map((path) => <li className="ks-consent-value ks-install-path" key={path}>{path.split("/").map((part, index) => index === 0 ? part : <Fragment key={index}>/<wbr />{part}</Fragment>)}</li>)}</ul>;
        return details.hosts.length > 1
          ? <div className="ks-install-host" key={host}><div className="ks-consent-value">{host}</div>{list}</div>
          : <Fragment key={host}>{list}</Fragment>;
      }) : null;
      return <section className="ks-install-group" key={group.sentence}>
      <strong className={`ks-install-sentence${group.tone === "warning" ? " is-warning" : ""}`}>{group.tone === "warning" ? <TriangleAlert size="inline" /> : null}<span>{group.sentence}</span></strong>
      {group.rows.length || group.notes.length || group.details ? <div className="ks-install-content">
        {group.rows.length ? <ul className="ks-install-rows">{group.rows.map((row, index) => <li key={index}>
          {row.target ? <span className="ks-consent-value">{row.target}</span> : null}{row.reason ? <span className="ks-install-meta">{row.reason}</span> : null}
        </li>)}</ul> : null}
        {group.notes.map((note) => <div className="ks-install-meta" key={note}>{note}</div>)}
        {details ? <details className="ks-install-details"><summary className="ks-install-meta">{details.label}</summary>
          {details.label === "코드 보기" ? <pre className="ks-process-command">{details.code}</pre>
            : details.hosts.length > 1 ? <div className="ks-install-hosts">{hostPaths}</div> : hostPaths}
        </details> : null}
      </div> : null}
      </section>;
    })}
  </>;
}

export function InstallationConsent({ store, windowId, host }: { store: ShellStore; windowId: string; host: HTMLElement | null }) {
  const subscribe = useCallback((listener: () => void) => store.subscribeInstallConsent(windowId, listener), [store, windowId]);
  const getRequest = useCallback(() => store.getInstallConsent(windowId), [store, windowId]);
  const request = useSyncExternalStore(subscribe, getRequest, getRequest);
  const active = useShellSelector(store, (snapshot) => isWindowTop(snapshot, windowId));
  const workerLocation = useWorkerLocation(store, request);
  const answer = useCallback((allow: boolean) => {
    if (!request) return;
    if (request.event === "app.install_permission") {
      void store.call({ op: "app.respond_install_permission", owner: request.owner, request_id: request.request_id, digest: request.digest, allow });
    } else {
      void store.call({ op: "store.respond_server_permission", window_id: windowId, request_id: request.request_id, server: request.server, allow });
    }
  }, [request, store, windowId]);
  const cancel = useCallback(() => answer(false), [answer]);
  const confirm = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (event.nativeEvent.isTrusted) answer(true);
  }, [answer]);
  useLayoutEffect(() => {
    if (request && active) host?.querySelector<HTMLButtonElement>(".ks-install-consent .ks-dialog-actions > button")?.focus({ preventScroll: true });
  }, [request, active, host]);
  if (!request || !host) return null;
  if (request.event === "store.server_permission") {
    return <Dialog key={request.request_id} host={host} windowId={windowId} userConsent windowModal active={active}
      overlayClassName="ks-window-consent-overlay ks-install-consent" inertSelector=":scope > .ks-window-content"
      title="이 스토어에 연결할까요?" ok="연결 허용" onCancel={cancel} onConfirm={confirm}
      body={<>
        <strong className="ks-consent-value">{request.server}</strong>
        {request.server.startsWith("http:") ? <strong className="ks-install-sentence is-warning"><TriangleAlert size="inline" /><span>이 연결은 암호화되지 않습니다.</span></strong> : null}
        <span>이 PC에서 앱 목록과 설치 파일을 받도록 허용합니다.</span>
      </>} />;
  }
  const installed = request.installed_release;
  const replacing = request.replacing === true;
  return <Dialog key={request.request_id} host={host} windowId={windowId} userConsent windowModal active={active}
    overlayClassName="ks-window-consent-overlay ks-install-consent" inertSelector=":scope > .ks-window-content"
    title={replacing ? "스토어 판으로 바꿀까요?" : installed === undefined ? "이 앱을 설치할까요?" : "이 앱을 업데이트할까요?"}
    ok={replacing ? "허용하고 바꾸기" : installed === undefined ? "허용하고 설치" : "허용하고 업데이트"} onCancel={cancel} onConfirm={confirm}
    body={<InstallConsentBody request={request} workerLocation={workerLocation} />} />;
}

/** 창 없이 쉘 전체에 뜨는 설치 동의. MCP가 시작한 요청이라 앱스토어 창이 없어도 된다. */
export function ShellInstallationConsent({ store, host, onError }: { store: ShellStore; host: HTMLElement | null; onError?: (error: CoreError) => void }) {
  const subscribe = useCallback((listener: () => void) => store.subscribeShellInstallConsent(listener), [store]);
  const getRequest = useCallback(() => store.getShellInstallConsent(), [store]);
  const request = useSyncExternalStore(subscribe, getRequest, getRequest);
  const workerLocation = useWorkerLocation(store, request);
  const hold = useHoldWhileWriting(request !== undefined);
  const answer = useCallback((allow: boolean) => {
    if (!request) return;
    // 승인 호출은 설치가 끝난 뒤 결과를 돌려준다. 실패는 이미 닫힌 MCP 요청이 아니라 쉘 알림으로 보인다.
    store.call({ op: "app.respond_install_permission", owner: request.owner, request_id: request.request_id, digest: request.digest, allow })
      .catch((reason: unknown) => { if (allow) onError?.(toCoreError(reason)); });
  }, [request, store, onError]);
  const cancel = useCallback(() => answer(false), [answer]);
  const confirm = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (event.nativeEvent.isTrusted) answer(true);
  }, [answer]);
  if (!request || !host || hold) return null;
  const installed = request.installed_release;
  const replacing = request.replacing === true;
  return <Dialog key={request.request_id} host={host} userConsent
    overlayClassName="ks-shell-dialog-layer ks-install-consent" inertSelector=":scope > .ks-shell-bar, :scope > .ks-desktop-area"
    title={replacing ? "스토어 판으로 바꿀까요?" : installed === undefined ? "이 앱을 설치할까요?" : "이 앱을 업데이트할까요?"}
    ok={replacing ? "허용하고 바꾸기" : installed === undefined ? "허용하고 설치" : "허용하고 업데이트"} onCancel={cancel} onConfirm={confirm}
    body={<div className="ks-update-content"><InstallConsentBody request={request} workerLocation={workerLocation} /></div>} />;
}
