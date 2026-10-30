import { useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent, type RefObject } from "react";
import { AGENT_ATTACHMENTS_MAX, AGENT_ATTACHMENT_MAX_BYTES, AGENT_ATTACHMENTS_TOTAL_MAX_BYTES } from "../contract/limits";
import { Square as SquareIcon } from "lucide-react";
import { ArrowUp, ICON_SIZE, Paperclip, ScreenShare } from "../components/icons";
import { IconButton, Notice } from "../components/primitives";
import { AttachmentChip, DraftChip, makeDraftAttachment, type DraftAttachment, type Preview } from "./agent-attachments";

export function ChatComposer({ draft, onDraft, inputRef, attachments, onAttachmentsChange, onSend, disabled, busy, onCancel, sharedWindows, onRemoveShared, onPreview, error, onError }: {
  draft: string;
  onDraft: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  attachments: DraftAttachment[];
  onAttachmentsChange: (attachments: DraftAttachment[]) => void;
  onSend: (returnFocus?: boolean) => void;
  disabled: boolean;
  busy: boolean;
  onCancel?: () => void;
  sharedWindows: Array<{ id: string; name: string }>;
  onRemoveShared: (id: string) => void;
  onPreview: (preview: Preview) => void;
  error: string | null;
  onError: (message: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const style = getComputedStyle(input);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const verticalPadding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const border = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
    if (!Number.isFinite(lineHeight) || !Number.isFinite(verticalPadding + border)) {
      input.style.height = "";
      input.style.maxHeight = "";
      input.style.overflowY = "hidden";
      return;
    }
    const maxHeight = lineHeight * 8 + verticalPadding + border;
    input.style.height = "auto";
    const contentHeight = input.scrollHeight + border;
    input.style.maxHeight = `${maxHeight}px`;
    input.style.height = `${Math.min(contentHeight, maxHeight)}px`;
    input.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  const addAttachments = (newAttachments: DraftAttachment[]) => {
    onError(null);
    const accepted = [...attachments];
    let total = accepted.reduce((sum, item) => sum + item.file.size, 0);
    for (const attachment of newAttachments) {
      if (accepted.length >= AGENT_ATTACHMENTS_MAX) { onError("첨부는 한 번에 10개까지입니다"); break; }
      if (attachment.file.size > AGENT_ATTACHMENT_MAX_BYTES) { onError(`${attachment.name}은 20MB를 넘어 첨부할 수 없습니다`); continue; }
      if (total + attachment.file.size > AGENT_ATTACHMENTS_TOTAL_MAX_BYTES) { onError("첨부의 합은 30MB까지입니다"); continue; }
      accepted.push(attachment);
      total += attachment.file.size;
    }
    onAttachmentsChange(accepted);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const data = event.clipboardData;
    const files = Array.from(data.files);
    const pasted = files.length ? files : Array.from(data.items).filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file): file is File => file !== null);
    if (!pasted.length) return;
    if (!Array.from(data.types).includes("text/plain")) event.preventDefault();
    const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
    addAttachments(pasted.map((file) => makeDraftAttachment(file, extensions[file.type] ? `붙여넣은 이미지.${extensions[file.type]}` : file.name || "붙여넣은 파일")));
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    onSend();
  };

  return <div className="ks-agent-chat-input-area">
    {error ? <Notice role="alert">{error}</Notice> : null}
    {sharedWindows.length ? <div className="ks-agent-attachment-list">{sharedWindows.map(({ id, name }) => <AttachmentChip key={id} name={name} preview={<span className="ks-agent-attachment-chip-preview ks-share-chip-icon"><ScreenShare /></span>} removeLabel={`${name} 같이 보기 끄기`} onRemove={() => onRemoveShared(id)} />)}</div> : null}
    {attachments.length ? <div className="ks-agent-attachment-list">{attachments.map((attachment) => <DraftChip key={attachment.id} attachment={attachment} onPreview={onPreview} onRemove={() => onAttachmentsChange(attachments.filter((item) => item.id !== attachment.id))} />)}</div> : null}
    <div className="ks-agent-chat-input-row">
      <input type="file" multiple hidden ref={fileRef} disabled={disabled} onChange={(event) => {
        addAttachments(Array.from(event.currentTarget.files ?? []).map((file) => makeDraftAttachment(file, file.name)));
        event.currentTarget.value = "";
      }} />
      <IconButton aria-label="파일 첨부" disabled={disabled} onClick={() => fileRef.current?.click()}><Paperclip /></IconButton>
      <textarea
        aria-label="메시지"
        className="ks-text-input ks-agent-chat-input"
        disabled={disabled}
        onChange={(event) => onDraft(event.currentTarget.value)}
        onKeyDown={onInputKeyDown}
        onPaste={onPaste}
        ref={inputRef}
        rows={1}
        value={draft}
      />
      {busy && onCancel
        ? <IconButton aria-label="멈춤" onClick={onCancel}><SquareIcon absoluteStrokeWidth aria-hidden="true" size={ICON_SIZE.control} strokeWidth={1.5} /></IconButton>
        : <IconButton aria-label="보내기" disabled={disabled || (!draft.trim() && !attachments.length) || busy} onClick={() => onSend(true)}><ArrowUp /></IconButton>}
    </div>
  </div>;
}

