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
import { Download, X } from "../components/icons";
import { MarkdownText } from "./markdown-text";
import { useOverlayDialog } from "./agent-attachments";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; mime: string; data_base64: string }
  | { status: "failed"; error: CoreError };

/** 코어의 크기 초과 오류 id. 쉘은 이 id로만 크기 초과를 가르고 앱 이름이나 경로를 쓰지 않는다. */
const MEDIA_TOO_LARGE_ID = "MEDIA_LOAD_DATA_TOO_LARGE";

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
  const [savedTo, setSavedTo] = useState<string | null>(null);
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

  // 크기 초과는 코어 오류 id로 가르고, 뷰어에서 할 수 없는 일을 시키지 않는 쉘 문구로 바꾼다.
  const tooLarge = state.status === "failed" && state.error.id === MEDIA_TOO_LARGE_ID;
  const loadError = state.status === "failed"
    ? (tooLarge ? shellErrors.SHELL_ATTACHMENT_VIEWER_TOO_LARGE({ limit: "20MB" }) : state.error)
    : null;

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSavedTo(null);
    try {
      if (!store || !windowId) throw shellErrors.SHELL_WINDOW_DATA_CONTEXT_MISSING();
      // 이미 받아 둔 원본이 있으면 다시 받지 않고 그 바이트로 저장한다.
      const source = state.status === "ready"
        ? { kind: "bytes" as const, mime: state.mime, data_base64: state.data_base64 }
        : request.source;
      setSavedTo(await saveAttachment(store, windowId, source, request.name));
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
    body = <div className="ks-attachment-viewer-state">
      <Notice role="alert" errorId={loadError!.id}>{loadError!.message}</Notice>
      {tooLarge ? null : <Button onClick={() => setAttempt((current) => current + 1)}>다시 받기</Button>}
    </div>;
  } else if (kind === "image") {
    body = <img className="ks-attachment-viewer-image" src={attachmentDataUrl(state)} alt={request.name} />;
  } else if (kind === "video" || kind === "audio") {
    body = <BlobMedia mime={state.mime} data_base64={state.data_base64} kind={kind} />;
  } else if (text && kind === "markdown") {
    body = <div className="ks-attachment-viewer-text">
      {text.truncated ? <Notice>앞부분만 보입니다. 전체 내용은 저장해서 확인하세요.</Notice> : null}
      <MarkdownText>{text.text}</MarkdownText>
    </div>;
  } else if (text) {
    body = <div className="ks-attachment-viewer-text">
      {text.truncated ? <Notice>앞부분만 보입니다. 전체 내용은 저장해서 확인하세요.</Notice> : null}
      <pre className="ks-attachment-viewer-plain" tabIndex={0}>{text.text}</pre>
    </div>;
  } else {
    body = <div className="ks-attachment-viewer-info">
      <div className="ks-attachment-viewer-info-row"><span>크기</span><span className="ks-attachment-viewer-info-value">{formatAttachmentSize(attachmentBytes(state.data_base64).length)}</span></div>
      <div className="ks-attachment-viewer-info-row"><span>형식</span><span className="ks-attachment-viewer-info-value">{state.mime || "알 수 없음"}</span></div>
    </div>;
  }

  // 그림과 영상은 본문의 빈자리를 눌러도 닫는다. 글 뷰어는 눌러도, 끌어서 골라도 닫지 않는다.
  const closesFromBody = state.status === "ready" && (kind === "image" || kind === "video");
  // 본문 실패 문구와 저장 실패 문구가 같으면 같은 오류를 한 화면에 두 번 보이지 않는다.
  const duplicateSaveError = saveError !== null && loadError !== null && saveError.message === loadError.message;

  return createPortal(<div className="ks-agent-image-overlay" data-ks-overlay role="dialog" aria-modal="true" aria-label={request.name} onClick={onClose} ref={dialogRef}>
    <div className="ks-attachment-viewer" onClick={(event) => event.stopPropagation()}>
      <div className="ks-attachment-viewer-header">
        <strong className="ks-attachment-viewer-name" title={request.name}>{request.name}</strong>
        <IconButton aria-label="저장" tooltip="저장" onClick={() => void save()} disabled={saving || tooLarge}><Download /></IconButton>
        <div className="ks-attachment-viewer-close" ref={closeRef}><IconButton aria-label="닫기" onClick={onClose}><X /></IconButton></div>
      </div>
      {savedTo ? <div className="ks-attachment-viewer-saved" role="status">{savedTo}에 저장했습니다</div> : null}
      <div className="ks-attachment-viewer-body" onClick={closesFromBody ? (event) => { if (event.target === event.currentTarget) onClose(); } : undefined}>{body}</div>
      {saveError && !duplicateSaveError ? <div className="ks-attachment-viewer-save-error"><Notice role="alert" errorId={saveError.id}>{saveError.message}</Notice></div> : null}
    </div>
  </div>, document.body);
}
