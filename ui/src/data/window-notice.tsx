import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { X } from "../components/icons";
import { Button, IconButton, Notice } from "../components/primitives";
import { useWindowData } from "./window-data";

export function ClientShareSignal() {
  const data = useWindowData();
  const sequence = useSyncExternalStore(data.subscribeClientShare, data.getClientShareSequence, data.getClientShareSequence);
  return <span hidden data-share-seq={sequence} />;
}

export function WindowNotice() {
  const data = useWindowData();
  const sources = useSyncExternalStore(data.subscribeSources, data.getSources, data.getSources);
  const message = useSyncExternalStore(data.subscribeNotice, data.getNotice, data.getNotice);
  const noticeId = useSyncExternalStore(data.subscribeNotice, data.getNoticeId, data.getNoticeId);
  const role = useSyncExternalStore(data.subscribeNotice, data.getNoticeRole, data.getNoticeRole);
  const statusSequence = useSyncExternalStore(data.subscribeNotice, data.getStatusSequence, data.getStatusSequence);
  const clientFailed = useSyncExternalStore(data.subscribeNotice, data.getClientFailed, data.getClientFailed);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { setDismissed(false); }, [sources]);
  const failed = Object.entries(sources).filter(([, value]) => value.state === "failed" && value.has_value).map(([name]) => name);
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
  const close = () => { if (message) data.setNotice(null); else setDismissed(true); };
  const closeButton = <IconButton key="close" aria-label="닫기" onClick={close}><X size="inline" /></IconButton>;
  const actions: [ReactNode] | [ReactNode, ReactNode] = message
    ? clientFailed ? [<Button key="restart" onClick={() => { void data.restartClient(); }}>다시 시작</Button>, closeButton] : [closeButton]
    : [<Button key="retry" onClick={() => { void data.refresh(failed); }}>다시 받기</Button>, closeButton];
  if (message && role === "status") return <TransientStatus data={data} message={message} sequence={statusSequence} />;
  return <Notice role="alert" data-ks-overlay errorId={message ? noticeId : sourceErrorId} actions={actions}>{message ?? sourceMessage}</Notice>;
}

const STATUS_NOTICE_DURATION_MS = 5000;

function TransientStatus({ data, message, sequence }: {
  data: ReturnType<typeof useWindowData>; message: string; sequence: number;
}) {
  useEffect(() => {
    const timer = setTimeout(() => {
      if (data.getNoticeRole() === "status" && data.getStatusSequence() === sequence) data.setNotice(null);
    }, STATUS_NOTICE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [data, sequence]);
  return <div className="ks-window-status" data-ks-overlay>
    <Notice role="status">{message}</Notice>
  </div>;
}
