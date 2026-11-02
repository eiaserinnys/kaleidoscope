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
  const role = useSyncExternalStore(data.subscribeNotice, data.getNoticeRole, data.getNoticeRole);
  const clientFailed = useSyncExternalStore(data.subscribeNotice, data.getClientFailed, data.getClientFailed);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { setDismissed(false); }, [sources]);
  const failed = Object.entries(sources).filter(([, value]) => value.state === "failed" && value.has_value).map(([name]) => name);
  if (!message && (!failed.length || dismissed)) return null;
  const close = () => { if (message) data.setNotice(null); else setDismissed(true); };
  const closeButton = <IconButton key="close" aria-label="닫기" onClick={close}><X size="inline" /></IconButton>;
  const actions: [ReactNode] | [ReactNode, ReactNode] = message
    ? clientFailed ? [<Button key="restart" onClick={() => { void data.restartClient(); }}>다시 시작</Button>, closeButton] : [closeButton]
    : [<Button key="retry" onClick={() => { void data.refresh(failed); }}>다시 받기</Button>, closeButton];
  return <Notice role={message ? role : "alert"} actions={actions}>{message ?? `다시 받지 못했습니다: ${failed.join(", ")}`}</Notice>;
}
