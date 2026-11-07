import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, X } from "../components/icons";
import { Button, IconButton, Notice } from "../components/primitives";
import { useWindowData } from "./window-data";

export function ClientShareSignal() {
  const data = useWindowData();
  const sequence = useSyncExternalStore(data.subscribeClientShare, data.getClientShareSequence, data.getClientShareSequence);
  return <span hidden data-share-seq={sequence} />;
}

export function WindowNotice() {
  const data = useWindowData();
  const sources = useSyncExternalStore(data.subscribeSources, data.getNoticeSources, data.getNoticeSources);
  const actualSources = useSyncExternalStore(data.subscribeSources, data.getSources, data.getSources);
  const message = useSyncExternalStore(data.subscribeNotice, data.getNotice, data.getNotice);
  const revision = useSyncExternalStore(data.subscribeNotice, data.getNoticeRevision, data.getNoticeRevision);
  const noticeId = useSyncExternalStore(data.subscribeNotice, data.getNoticeId, data.getNoticeId);
  const role = useSyncExternalStore(data.subscribeNotice, data.getNoticeRole, data.getNoticeRole);
  const statusSequence = useSyncExternalStore(data.subscribeNotice, data.getStatusSequence, data.getStatusSequence);
  const clientFailed = useSyncExternalStore(data.subscribeNotice, data.getClientFailed, data.getClientFailed);
  const retrySequence = useSyncExternalStore(data.subscribeSources, data.getSourceRetrySequence, data.getSourceRetrySequence);
  const slot = useSyncExternalStore(data.subscribeNoticeSlot, data.getNoticeSlot, data.getNoticeSlot);
  const [dismissed, setDismissed] = useState(false);

  const failed = Object.entries(sources).filter(([, value]) => value.state === "failed" && value.has_value).map(([name]) => name);
  const retrying = failed.some(name => actualSources[name]?.state === "loading");
  const failureKey = JSON.stringify([...failed].sort().map((name) => {
    const source = sources[name];
    return source.state === "failed" ? [name, source.id, source.message] : [];
  }));
  useEffect(() => { setDismissed(false); }, [failureKey, retrySequence]);
  const sourceErrorId = failed
    .map((name) => {
      const source = sources[name];
      return source.state === "failed" ? source.id : undefined;
    })
    .find((id) => id !== undefined);
  const firstFailed = sources[failed[0]];
  const sourceMessage = firstFailed?.state === "failed"
    ? `${failed.length > 1 ? `화면 ${failed.length}곳이 이전에 받은 내용을 보이고 있습니다.` : "이전에 받은 내용을 보이고 있습니다."} ${firstFailed.message}`
    : "";
  if (!message && (!failed.length || dismissed)) return null;
  const close = () => {
    if (message) data.setNotice(null); else setDismissed(true);
  };
  const closeButton = <IconButton key="close" aria-label="닫기" onClick={close}><X size="inline" /></IconButton>;
  const actions: [ReactNode] | [ReactNode, ReactNode] = message
    ? clientFailed ? [<Button key="restart" onClick={() => { void data.restartClient(); }}>다시 시작</Button>, closeButton] : [closeButton]
    : [<Button key="retry" aria-label="다시 받기" aria-disabled={retrying || undefined} aria-busy={retrying || undefined} className={retrying ? "is-progress" : undefined} onClick={() => { if (!retrying) void data.refresh(failed); }}><span>다시 받기</span>{retrying && <span className="ks-button-progress" aria-hidden="true"><LoaderCircle size="control" /></span>}</Button>, closeButton];
  if (message && role === "status") return <TransientStatus data={data} message={message} sequence={statusSequence} slot={slot} />;
  // 같은 문구로 다시 실패하면 실패 알림 요소를 새로 그려 화면 읽기 도구가 다시 읽게 한다.
  const notice = <Notice key={message ? revision : undefined} role="alert" data-ks-overlay errorId={message ? noticeId : sourceErrorId} actions={actions}>{message ?? sourceMessage}</Notice>;
  return slot ? createPortal(notice, slot) : notice;
}

const STATUS_NOTICE_DURATION_MS = 5000;

function TransientStatus({ data, message, sequence, slot }: {
  data: ReturnType<typeof useWindowData>; message: string; sequence: number; slot: HTMLElement | null;
}) {
  useEffect(() => {
    const timer = setTimeout(() => {
      if (data.getNoticeRole() === "status" && data.getStatusSequence() === sequence) data.clearStatus(sequence);
    }, STATUS_NOTICE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [data, sequence]);
  const status = <div className="ks-window-status" data-ks-overlay>
    <Notice role="status">{message}</Notice>
  </div>;
  return slot ? createPortal(status, slot) : status;
}
