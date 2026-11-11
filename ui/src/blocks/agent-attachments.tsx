import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ownerOf, registerOverlay } from "../share/overlay-owner";
import type { ConversationUpload, ConversationAttachment } from "../contract/contract";
import { File as FileIcon, X } from "../components/icons";
import { IconButton } from "../components/primitives";
import { openContextMenu, writeMenuImage } from "../components/context-menu";

export type DraftAttachment = { id: number; file: File; name: string };
export type Preview = { src: string; name: string; trigger: HTMLElement };

let nextDraftId = 0;
export function makeDraftAttachment(file: File, name: string): DraftAttachment {
  return { id: nextDraftId++, file, name };
}

export function readUpload({ file, name }: DraftAttachment): Promise<ConversationUpload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name, mime: file.type, data_base64: String(reader.result).split(",", 2)[1] });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function fromBase64(dataBase64: string): ArrayBuffer {
  return Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0)).buffer;
}

export function openPayload(payload: { mime: string; bytes: ArrayBuffer }, name: string) {
  const url = URL.createObjectURL(new Blob([payload.bytes], { type: payload.mime }));
  const tab = window.open("about:blank", "_blank");
  if (tab) {
    tab.opener = null;
    tab.location.href = url;
  } else {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    link.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* 미디어 응답은 `data:<mime>;base64,<본문>` 꼴이다. 이미지가 아닌 첨부는 칩에서 눌러 새 탭으로 연다. */
export function openDataUrl(dataUrl: string, name: string) {
  const comma = dataUrl.indexOf(",");
  const header = comma >= 0 ? dataUrl.slice(0, comma) : "";
  const mime = header.startsWith("data:") ? header.slice("data:".length).split(";", 1)[0] || "application/octet-stream" : "application/octet-stream";
  try {
    if (comma < 0) throw new Error("data URL이 아닙니다");
    openPayload({ mime, bytes: fromBase64(dataUrl.slice(comma + 1)) }, name);
  } catch {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = name;
    link.rel = "noopener";
    link.click();
  }
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

function AttachmentImage({ src, name, className, onPreview }: { src: string; name: string; className: string; onPreview: OpenPreview }) {
  const open = (trigger: HTMLElement) => onPreview({ src, name, trigger });
  return <button type="button" className={className} aria-label={name} onClick={(event) => open(event.currentTarget)} onContextMenu={(event) => {
    const trigger = event.currentTarget;
    const image = trigger.querySelector("img")!;
    openContextMenu(event, [
      { id: "image-open", label: "크게 보기", onSelect: () => open(trigger) },
      { id: "image-copy", label: "이미지 복사", onSelect: () => { void writeMenuImage(image, "이미지 복사"); } },
    ], { anchor: trigger });
  }}><img src={src} alt="" /></button>;
}

export function DraftChip({ attachment, onRemove, onPreview, disabled = false }: { attachment: DraftAttachment; onRemove: () => void; onPreview: OpenPreview; disabled?: boolean }) {
  const url = useFileUrl(attachment.file);
  return <AttachmentChip name={attachment.name} removeLabel={`${attachment.name} 빼기`} onRemove={onRemove} disabled={disabled} preview={url ? <AttachmentImage src={url} name={attachment.name} className="ks-agent-attachment-chip-preview" onPreview={onPreview} /> : <span className="ks-agent-attachment-chip-preview"><FileIcon /></span>} />;
}

export function AttachmentChip({ name, preview, removeLabel, onRemove, disabled = false }: { name: string; preview: ReactNode; removeLabel: string; onRemove: () => void; disabled?: boolean }) {
  return <div className="ks-agent-attachment-chip" role="listitem">{preview}<span className="ks-agent-attachment-name" title={name}>{name}</span><IconButton aria-label={removeLabel} disabled={disabled} onClick={onRemove}><X /></IconButton></div>;
}

export function PendingAttachment({ attachment, onPreview }: { attachment: DraftAttachment; onPreview: OpenPreview }) {
  const url = useFileUrl(attachment.file);
  if (url) return <AttachmentImage src={url} name={attachment.name} className="ks-agent-attachment-image" onPreview={onPreview} />;
  return <div className="ks-agent-attachment-chip"><span className="ks-agent-attachment-chip-preview"><FileIcon /></span><span className="ks-agent-attachment-name">{attachment.name}</span></div>;
}

const attachmentCache = new Map<string, Promise<string>>();

export function HistoryAttachmentView({ attachment, cacheKey, load, open, onPreview, onError }: {
  attachment: ConversationAttachment; cacheKey: readonly unknown[];
  load: () => Promise<{ mime: string; data_base64: string }>;
  open: () => Promise<void>;
  onPreview: OpenPreview; onError: (reason: unknown) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const key = JSON.stringify(cacheKey);
  useEffect(() => {
    if (!attachment.mime.startsWith("image/")) return;
    let promise = attachmentCache.get(key);
    if (!promise) {
      promise = loadRef.current()
        .then((reply) => `data:${reply.mime};base64,${reply.data_base64}`);
      attachmentCache.set(key, promise);
    }
    let active = true;
    promise.then((value) => { if (active) setSrc(value); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attachment.mime, key]);

  const handleOpen = async () => {
    setOpening(true);
    try {
      await open();
    }
    catch (reason) { onError(reason); }
    finally { setOpening(false); }
  };
  if (attachment.mime.startsWith("image/") && !failed) {
    return src
      ? <AttachmentImage src={src} name={attachment.name} className="ks-agent-attachment-image" onPreview={onPreview} />
      : <div className="ks-agent-attachment-image ks-agent-attachment-placeholder" aria-label={attachment.name} />;
  }
  return <button type="button" className="ks-agent-attachment-chip ks-agent-attachment-file" disabled={opening} onClick={() => void handleOpen()} aria-label={attachment.name}>
    <span className="ks-agent-attachment-chip-preview"><FileIcon /></span><span className="ks-agent-attachment-name" title={attachment.name}>{attachment.name}</span>
  </button>;
}

export function ImagePreview({ preview, onClose, children }: { preview: Preview; onClose: () => void; children?: ReactNode }) {
  const closeRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current!;
    const owner = ownerOf(preview.trigger);
    const unregister = owner ? registerOverlay(dialog, owner, preview.trigger) : undefined;
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
      unregister?.();
      document.removeEventListener("keydown", onKey);
      changed.forEach((child) => child.removeAttribute("inert"));
      preview.trigger.focus();
    };
  }, [onClose, preview.trigger]);
  return createPortal(<div className="ks-agent-image-overlay" data-ks-overlay role="dialog" aria-modal="true" aria-label={preview.name} onClick={onClose} ref={dialogRef}>
    {children ?? <img src={preview.src} alt={preview.name} onClick={(event) => event.stopPropagation()} />}
    <div className="ks-agent-image-close" ref={closeRef}><IconButton aria-label="닫기" onClick={onClose}><X /></IconButton></div>
  </div>, document.body);
}
