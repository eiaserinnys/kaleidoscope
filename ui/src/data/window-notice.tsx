import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
  if (!message && (!failed.length || dismissed)) return null;
  const close = () => { if (message) data.setNotice(null); else setDismissed(true); };
  const closeButton = <IconButton key="close" aria-label="닫기" onClick={close}><X size="inline" /></IconButton>;
  const actions: [ReactNode] | [ReactNode, ReactNode] = message
    ? clientFailed ? [<Button key="restart" onClick={() => { void data.restartClient(); }}>다시 시작</Button>, closeButton] : [closeButton]
    : [<Button key="retry" onClick={() => { void data.refresh(failed); }}>다시 받기</Button>, closeButton];
  if (message && role === "status") return <TransientStatus data={data} message={message} sequence={statusSequence} closeButton={closeButton} />;
  return <Notice role="alert" errorId={message ? noticeId : sourceErrorId} actions={actions}>{message ?? `다시 받지 못했습니다: ${failed.join(", ")}`}</Notice>;
}

const STATUS_NOTICE_DURATION_MS = 5000;

function TransientStatus({ data, message, sequence, closeButton }: {
  data: ReturnType<typeof useWindowData>; message: string; sequence: number; closeButton: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(STATUS_NOTICE_DURATION_MS);
  useEffect(() => { remaining.current = STATUS_NOTICE_DURATION_MS; }, [sequence]);
  useEffect(() => {
    if (hovered || focused) return;
    const started = Date.now();
    const timer = setTimeout(() => {
      if (data.getNoticeRole() === "status" && data.getStatusSequence() === sequence) data.setNotice(null);
    }, remaining.current);
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - started)); };
  }, [data, sequence, hovered, focused]);
  return <div className="ks-window-status" data-ks-overlay onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <Notice role="status" actions={[closeButton]}>{message}</Notice>
  </div>;
}
