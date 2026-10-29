import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentAttachment, AgentUpload } from "../contract/contract";
import { File as FileIcon, X } from "../components/icons";
import { IconButton } from "../components/primitives";
import type { ShellStore } from "../core/shell-store";
import { toCoreError } from "../core/core-transport";

export type DraftAttachment = { file: File; name: string };
export type Preview = { src: string; name: string; trigger: HTMLElement };

export function readUpload({ file, name }: DraftAttachment): Promise<AgentUpload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name, mime: file.type, data_base64: String(reader.result).split(",", 2)[1] });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function useFileUrl(file: File): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

type OpenPreview = (preview: Preview) => void;

export function DraftChip({ attachment, onRemove, onPreview }: { attachment: DraftAttachment; onRemove: () => void; onPreview: OpenPreview }) {
  const url = useFileUrl(attachment.file);
  return <div className="ks-agent-attachment-chip">
    {url ? <button type="button" className="ks-agent-attachment-chip-preview" aria-label={attachment.name} onClick={(event) => onPreview({ src: url, name: attachment.name, trigger: event.currentTarget })}><img src={url} alt="" /></button> : <span className="ks-agent-attachment-chip-preview"><FileIcon /></span>}
    <span className="ks-agent-attachment-name" title={attachment.name}>{attachment.name}</span>
    <IconButton aria-label={`${attachment.name} 빼기`} onClick={onRemove}><X /></IconButton>
  </div>;
}

export function PendingAttachment({ attachment, onPreview }: { attachment: DraftAttachment; onPreview: OpenPreview }) {
  const url = useFileUrl(attachment.file);
  if (url) return <button type="button" className="ks-agent-attachment-image" aria-label={attachment.name} onClick={(event) => onPreview({ src: url, name: attachment.name, trigger: event.currentTarget })}><img src={url} alt="" /></button>;
  return <div className="ks-agent-attachment-chip"><span className="ks-agent-attachment-chip-preview"><FileIcon /></span><span className="ks-agent-attachment-name">{attachment.name}</span></div>;
}

const attachmentCache = new Map<string, Promise<string>>();

export function HistoryAttachment({ attachment, workspaceId, itemId, index, store, onPreview, onError }: {
  attachment: AgentAttachment; workspaceId: string; itemId: string; index: number; store: ShellStore;
  onPreview: OpenPreview; onError: (message: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    if (!attachment.mime.startsWith("image/")) return;
    const key = JSON.stringify([workspaceId, itemId, index]);
    let promise = attachmentCache.get(key);
    if (!promise) {
      promise = store.call({ op: "agent.attachment", workspace_id: workspaceId, item_id: itemId, index })
        .then((reply) => `data:${reply.mime};base64,${reply.data_base64}`);
      attachmentCache.set(key, promise);
    }
    let active = true;
    promise.then((value) => { if (active) setSrc(value); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attachment.mime, workspaceId, itemId, index, store]);

  const open = async () => {
    setOpening(true);
    try { await store.call({ op: "agent.attachment_open", workspace_id: workspaceId, item_id: itemId, index }); }
    catch (reason) { onError(toCoreError(reason).message); }
    finally { setOpening(false); }
  };
  if (attachment.mime.startsWith("image/") && !failed) {
    return src
      ? <button type="button" className="ks-agent-attachment-image" aria-label={attachment.name} onClick={(event) => onPreview({ src, name: attachment.name, trigger: event.currentTarget })}><img src={src} alt="" /></button>
      : <div className="ks-agent-attachment-placeholder" aria-label={attachment.name} />;
  }
  return <button type="button" className="ks-agent-attachment-chip ks-agent-attachment-file" disabled={opening} onClick={() => void open()} aria-label={attachment.name}>
    <span className="ks-agent-attachment-chip-preview"><FileIcon /></span><span className="ks-agent-attachment-name" title={attachment.name}>{attachment.name}</span>
  </button>;
}

export function ImagePreview({ preview, onClose }: { preview: Preview; onClose: () => void }) {
  const closeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    closeRef.current?.querySelector("button")?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); preview.trigger.focus(); };
  }, [onClose, preview.trigger]);
  return createPortal(<div className="ks-agent-image-overlay" role="dialog" aria-modal="true" aria-label={preview.name} onClick={onClose}>
    <img src={preview.src} alt={preview.name} onClick={(event) => event.stopPropagation()} />
    <div className="ks-agent-image-close" ref={closeRef}><IconButton aria-label="닫기" onClick={onClose}><X /></IconButton></div>
  </div>, document.body);
}
