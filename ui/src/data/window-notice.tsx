import { useEffect, useState, useSyncExternalStore } from "react";
import { X } from "../components/icons";
import { Button, IconButton, Notice } from "../components/primitives";
import { useWindowData } from "./window-data";

export function WindowNotice() {
  const data = useWindowData();
  const sources = useSyncExternalStore(data.subscribeSources, data.getSources, data.getSources);
  const message = useSyncExternalStore(data.subscribeNotice, data.getNotice, data.getNotice);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { setDismissed(false); }, [sources]);
  const failed = Object.entries(sources).filter(([, value]) => value.state === "failed" && value.has_value).map(([name]) => name);
  if (!message && (!failed.length || dismissed)) return null;
  const close = () => { if (message) data.setNotice(null); else setDismissed(true); };
  return <Notice role="alert" actions={message ? [<IconButton key="close" aria-label="닫기" onClick={close}><X size="inline" /></IconButton>] : [<Button key="retry" onClick={() => { void data.refresh(failed); }}>다시 받기</Button>, <IconButton key="close" aria-label="닫기" onClick={close}><X size="inline" /></IconButton>]}>{message ?? `다시 받지 못했습니다: ${failed.join(", ")}`}</Notice>;
}
