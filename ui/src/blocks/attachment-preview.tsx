import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CoreError } from "../contract/contract";
import * as shellErrors from "../contract/shell-errors";
import { toCoreError } from "../core/core-transport";
import type { ShellStore } from "../core/shell-store";
import { useOptionalWindowData } from "../data/window-data";
import {
  attachmentBytes, attachmentDataUrl, attachmentKind, attachmentText, baseMime, formatAttachmentSize, loadAttachment, saveAttachment,
  type AttachmentPreviewRequest,
} from "../data/attachments";
import { Button, IconButton, Notice } from "../components/primitives";
import { X } from "../components/icons";
import { MarkdownText } from "./markdown-text";
import { useOverlayDialog } from "./agent-attachments";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; mime: string; data_base64: string }
  | { status: "failed"; error: CoreError };

function BlobMedia({ mime, data_base64, kind }: { mime: string; data_base64: string; kind: "video" | "audio" }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const type = baseMime(mime) || (kind === "video" ? "video/mp4" : "audio/mpeg");
    const next = URL.createObjectURL(new Blob([attachmentBytes(data_base64)], { type }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [data_base64, kind, mime]);
  if (!url) return null;
  return kind === "video"
    ? <video className="ks-attachment-viewer-media" src={url} controls />
    : <audio className="ks-attachment-viewer-media" src={url} controls />;
}

/** 쉘의 범용 첨부 뷰어. 미디어 참조와 이미 받은 바이트를 같은 화면으로 보여 주고 저장한다. */
export function AttachmentPreview({ request, onClose, store: storeProp, windowId: windowIdProp }: {
  request: AttachmentPreviewRequest;
  onClose: () => void;
  /** 창 데이터 문맥 밖(창 바깥 오버레이)에서 그릴 때는 창의 저장소와 창 id를 직접 넘긴다. */
  store?: ShellStore;
  windowId?: string;
}) {
  const context = useOptionalWindowData();
  const store = storeProp ?? context?.store;
  const windowId = windowIdProp ?? context?.windowId;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<CoreError | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useOverlayDialog({ trigger: request.trigger, onClose, dialog: dialogRef });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    const load = store && windowId ? loadAttachment(store, windowId, request.source) : Promise.reject(shellErrors.SHELL_WINDOW_DATA_CONTEXT_MISSING());
    load.then(
      (loaded) => { if (active) setState({ status: "ready", ...loaded }); },
      (reason) => { if (active) setState({ status: "failed", error: toCoreError(reason) }); },
    );
    return () => { active = false; };
  }, [attempt, request, store, windowId]);

  const kind = state.status === "ready" ? attachmentKind(state.mime, request.name) : "other";
  const text = useMemo(() => {
    if (state.status !== "ready" || (kind !== "markdown" && kind !== "text")) return null;
    return attachmentText(state.data_base64);
  }, [kind, state]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      if (!store || !windowId) throw shellErrors.SHELL_WINDOW_DATA_CONTEXT_MISSING();
      await saveAttachment(store, windowId, request.source, request.name);
    } catch (reason) {
      setSaveError(toCoreError(reason));
    } finally {
      setSaving(false);
    }
  };

  let body;
  if (state.status === "loading") {
    body = <div className="ks-media-preview-state"><div className="ks-data-skeleton" role="status" aria-label="불러오는 중"><i /><i /><i /></div></div>;
  } else if (state.status === "failed") {
    body = <div className="ks-attachment-viewer-state"><Notice role="alert" errorId={state.error.id}>{state.error.message}</Notice><Button onClick={() => setAttempt((current) => current + 1)}>다시 받기</Button></div>;
  } else if (kind === "image") {
    body = <img className="ks-attachment-viewer-image" src={attachmentDataUrl(state)} alt={request.name} />;
  } else if (kind === "video" || kind === "audio") {
    body = <BlobMedia mime={state.mime} data_base64={state.data_base64} kind={kind} />;
  } else if (text && kind === "markdown") {
    body = <div className="ks-attachment-viewer-text">
      {text.truncated ? <Notice>앞부분만 보입니다. 전체 내용은 받기로 저장해 확인하세요.</Notice> : null}
      <MarkdownText>{text.text}</MarkdownText>
    </div>;
  } else if (text) {
    body = <div className="ks-attachment-viewer-text">
      {text.truncated ? <Notice>앞부분만 보입니다. 전체 내용은 받기로 저장해 확인하세요.</Notice> : null}
      <pre className="ks-attachment-viewer-plain" tabIndex={0}>{text.text}</pre>
    </div>;
  } else {
    body = <div className="ks-attachment-viewer-info">
      <div className="ks-attachment-viewer-info-row"><span>이름</span><strong className="ks-attachment-viewer-info-value">{request.name}</strong></div>
      <div className="ks-attachment-viewer-info-row"><span>크기</span><span className="ks-attachment-viewer-info-value">{formatAttachmentSize(attachmentBytes(state.data_base64).length)}</span></div>
      <div className="ks-attachment-viewer-info-row"><span>형식</span><span className="ks-attachment-viewer-info-value">{state.mime || "알 수 없음"}</span></div>
    </div>;
  }

  return createPortal(<div className="ks-agent-image-overlay" data-ks-overlay role="dialog" aria-modal="true" aria-label={request.name} onClick={onClose} ref={dialogRef}>
    <div className="ks-attachment-viewer" onClick={(event) => event.stopPropagation()}>
      <div className="ks-attachment-viewer-header">
        <strong className="ks-attachment-viewer-name" title={request.name}>{request.name}</strong>
        <Button onClick={() => void save()} disabled={saving}>받기</Button>
        <div className="ks-attachment-viewer-close" ref={closeRef}><IconButton aria-label="닫기" onClick={onClose}><X /></IconButton></div>
      </div>
      <div className="ks-attachment-viewer-body">{body}</div>
      {saveError ? <div className="ks-attachment-viewer-save-error"><Notice role="alert" errorId={saveError.id}>{saveError.message}</Notice></div> : null}
    </div>
  </div>, document.body);
}
