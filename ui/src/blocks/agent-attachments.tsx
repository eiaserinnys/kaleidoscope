import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AgentAttachment, AgentUpload } from "../contract/contract";
import { File as FileIcon, X } from "../components/icons";
import { IconButton } from "../components/primitives";
import type { ShellStore } from "../core/shell-store";
import { toCoreError } from "../core/core-transport";

export type DraftAttachment = { id: number; file: File; name: string };
export type Preview = { src: string; name: string; trigger: HTMLElement };

let nextDraftId = 0;
export function makeDraftAttachment(file: File, name: string): DraftAttachment {
  return { id: nextDraftId++, file, name };
}

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
  return file.type.startsWith("image/") ? url : null;
}

type OpenPreview = (preview: Preview) => void;

export function DraftChip({ attachment, onRemove, onPreview }: { attachment: DraftAttachment; onRemove: () => void; onPreview: OpenPreview }) {
  const url = useFileUrl(attachment.file);
  return <AttachmentChip name={attachment.name} removeLabel={`${attachment.name} 빼기`} onRemove={onRemove} preview={url ? <button type="button" className="ks-agent-attachment-chip-preview" aria-label={attachment.name} onClick={(event) => onPreview({ src: url, name: attachment.name, trigger: event.currentTarget })}><img src={url} alt="" /></button> : <span className="ks-agent-attachment-chip-preview"><FileIcon /></span>} />;
}

export function AttachmentChip({ name, preview, removeLabel, onRemove }: { name: string; preview: ReactNode; removeLabel: string; onRemove: () => void }) {
  return <div className="ks-agent-attachment-chip">{preview}<span className="ks-agent-attachment-name" title={name}>{name}</span><IconButton aria-label={removeLabel} onClick={onRemove}><X /></IconButton></div>;
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
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current!;
    const changed = Array.from(document.body.children).filter((child) => child !== dialog && !child.hasAttribute("inert"));
    changed.forEach((child) => child.setAttribute("inert", ""));
    closeRef.current?.querySelector("button")?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (index === -1 || (event.shiftKey ? index === 0 : index === controls.length - 1)) {
        event.preventDefault();
        (event.shiftKey ? controls[controls.length - 1] : controls[0])?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      changed.forEach((child) => child.removeAttribute("inert"));
      preview.trigger.focus();
    };
  }, [onClose, preview.trigger]);
  return createPortal(<div className="ks-agent-image-overlay" data-ks-overlay role="dialog" aria-modal="true" aria-label={preview.name} onClick={onClose} ref={dialogRef}>
    <img src={preview.src} alt={preview.name} onClick={(event) => event.stopPropagation()} />
    <div className="ks-agent-image-close" ref={closeRef}><IconButton aria-label="닫기" onClick={onClose}><X /></IconButton></div>
  </div>, document.body);
}
