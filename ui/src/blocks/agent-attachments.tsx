import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ownerOf, registerOverlay } from "../share/overlay-owner";
import type { ConversationUpload, ConversationAttachment } from "../contract/contract";
import { attachmentKind, baseMime, fileAttachmentSource, type AttachmentPreviewRequest, type AttachmentSource } from "../data/attachments";
import { Badge } from "../components/badge";
import { File as FileIcon, X } from "../components/icons";
import { IconButton } from "../components/primitives";
import { openContextMenu, writeMenuImage } from "../components/context-menu";

export type DraftAttachment = { id: number; file: File; name: string };

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

type OpenPreview = (request: AttachmentPreviewRequest) => void;

function ImageButton({ src, name, className, onOpen }: { src: string; name: string; className: string; onOpen: (trigger: HTMLElement) => void }) {
  return <button type="button" className={className} aria-label={name} onClick={(event) => onOpen(event.currentTarget)} onContextMenu={(event) => {
    const trigger = event.currentTarget;
    const image = trigger.querySelector("img")!;
    openContextMenu(event, [
      { id: "image-open", label: "크게 보기", onSelect: () => onOpen(trigger) },
      { id: "image-copy", label: "이미지 복사", onSelect: () => { void writeMenuImage(image, "이미지 복사"); } },
    ], { anchor: trigger });
  }}><img src={src} alt="" /></button>;
}

function AttachmentImage({ src, name, className, source, onPreview }: { src: string; name: string; className: string; source: AttachmentSource; onPreview: OpenPreview }) {
  return <ImageButton src={src} name={name} className={className} onOpen={(trigger) => onPreview({ source, name, trigger })} />;
}

export function DraftChip({ attachment, onRemove, onPreview, disabled = false }: { attachment: DraftAttachment; onRemove: () => void; onPreview: OpenPreview; disabled?: boolean }) {
  const url = useFileUrl(attachment.file);
  return <AttachmentChip name={attachment.name} removeLabel={`${attachment.name} 빼기`} onRemove={onRemove} disabled={disabled} preview={url ? <AttachmentImage src={url} name={attachment.name} className="ks-agent-attachment-chip-preview" source={fileAttachmentSource(attachment.file)} onPreview={onPreview} /> : <span className="ks-agent-attachment-chip-preview"><FileIcon /></span>} />;
}

export function AttachmentChip({ name, preview, removeLabel, onRemove, disabled = false }: { name: string; preview: ReactNode; removeLabel: string; onRemove: () => void; disabled?: boolean }) {
  return <div className="ks-agent-attachment-chip" role="listitem">{preview}<span className="ks-agent-attachment-name" title={name}>{name}</span><IconButton aria-label={removeLabel} disabled={disabled} onClick={onRemove}><X /></IconButton></div>;
}

export function PendingAttachment({ attachment, onPreview }: { attachment: DraftAttachment; onPreview: OpenPreview }) {
  const url = useFileUrl(attachment.file);
  if (url) return <AttachmentImage src={url} name={attachment.name} className="ks-agent-attachment-image" source={fileAttachmentSource(attachment.file)} onPreview={onPreview} />;
  return <div className="ks-agent-attachment-chip"><span className="ks-agent-attachment-chip-preview"><FileIcon /></span><span className="ks-agent-attachment-name">{attachment.name}</span></div>;
}

const attachmentCache = new Map<string, Promise<string>>();

export function HistoryAttachmentView({ attachment, cacheKey, load, onPreview }: {
  attachment: ConversationAttachment; cacheKey: readonly unknown[];
  load: () => Promise<{ mime: string; data_base64: string }>;
  onPreview: (request: AttachmentPreviewRequest) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const key = JSON.stringify(cacheKey);
  useEffect(() => {
    if (!attachment.mime.startsWith("image/")) return;
    let promise = attachmentCache.get(key);
    if (!promise) {
      promise = loadRef.current()
        .then((reply) => `data:${baseMime(reply.mime)};base64,${reply.data_base64}`);
      attachmentCache.set(key, promise);
    }
    let active = true;
    promise.then((value) => { if (active) setSrc(value); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attachment.mime, key]);

  const open = (trigger: HTMLElement) => onPreview({
    source: { kind: "later", load: async () => {
      const reply = await loadRef.current();
      return { kind: "bytes", mime: reply.mime, data_base64: reply.data_base64 };
    } },
    name: attachment.name,
    trigger,
  });
  const kind = attachmentKind(attachment.mime, attachment.name);
  if (kind === "image" && !failed) {
    return src
      ? <ImageButton src={src} name={attachment.name} className="ks-agent-attachment-image" onOpen={open} />
      : <div className="ks-agent-attachment-image ks-agent-attachment-placeholder" aria-label={attachment.name} />;
  }
  return <button type="button" className="ks-agent-attachment-chip ks-agent-attachment-file" onClick={(event) => open(event.currentTarget)} aria-label={attachment.name}>
    <span className="ks-agent-attachment-chip-preview"><FileIcon /></span>
    {kind === "video" ? <Badge value="영상" /> : kind === "audio" ? <Badge value="소리" /> : null}
    <span className="ks-agent-attachment-name" title={attachment.name}>{attachment.name}</span>
  </button>;
}

/** 대화상자의 공통 동작: 바깥을 inert로 막고, 닫기 단추에 먼저 초점을 두고, Esc와 Tab을 가둔다. */
export function useOverlayDialog({ trigger, onClose, dialog }: { trigger: HTMLElement; onClose: () => void; dialog: RefObject<HTMLDivElement | null> }) {
  const closeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const owner = ownerOf(trigger);
    const unregister = owner ? registerOverlay(element, owner, trigger) : undefined;
    const changed = Array.from(document.body.children).filter((child) => child !== element && !child.hasAttribute("inert"));
    changed.forEach((child) => child.setAttribute("inert", ""));
    closeRef.current?.querySelector("button")?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const controls = Array.from(element.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
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
      trigger.focus();
    };
  }, [dialog, onClose, trigger]);
  return closeRef;
}
