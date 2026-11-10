import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent, type RefObject } from "react";
import { AGENT_ATTACHMENTS_MAX, AGENT_ATTACHMENT_MAX_BYTES, AGENT_ATTACHMENTS_TOTAL_MAX_BYTES } from "../contract/limits";
import type { CoreError } from "../contract/contract";
import { Square as SquareIcon } from "lucide-react";
import { ArrowUp, ICON_SIZE, Paperclip, ScreenShare } from "../components/icons";
import { IconButton, Notice } from "../components/primitives";
import { AttachmentChip, DraftChip, makeDraftAttachment, type DraftAttachment, type Preview } from "./agent-attachments";
import { CHAT_PASTE_FILES_EVENT, requestChatAttachment } from "./chat-paste";
import * as shellErrors from "../contract/shell-errors";

const CLIPBOARD_IMAGE_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** 붙여넣기 데이터에서 파일을 모은다. 이름 없는 클립보드 그림도 파일 그대로 남기고, 같은 파일은 한 번만 넣는다. */
export function extractClipboardFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  const seen = new Set<string>();
  const push = (file: File | null) => {
    if (!file) return;
    const key = `${file.type}|${file.size}|${file.name === "image.png" ? "" : file.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };
  Array.from(data.items ?? []).forEach((item) => { if (item.kind === "file") push(item.getAsFile()); });
  Array.from(data.files ?? []).forEach(push);
  return files;
}

/** 첨부로 받을 파일만 고른다. 그림이 하나라도 있으면 글과 함께 와도 첨부이고, 다른 파일은 글 없이 왔을 때만 첨부다. */
export function clipboardAttachmentFiles(data: DataTransfer | null): File[] {
  const files = extractClipboardFiles(data);
  if (!files.length) return [];
  if (files.some((file) => file.type.startsWith("image/"))) return files;
  return data && data.getData("text/plain").trim() === "" ? files : [];
}

/** 입력칸 밖에서 붙여넣어도 채팅 영역이 그림을 첨부로 받는다. 입력칸 자신은 ChatComposer가 처리한다. */
export function chatAreaPaste(event: ClipboardEvent<HTMLElement>, input: HTMLTextAreaElement | null, disabled: boolean): void {
  if (disabled || event.defaultPrevented) return;
  const target = event.target;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;
  const files = clipboardAttachmentFiles(event.clipboardData);
  if (!files.length) return;
  event.preventDefault();
  requestChatAttachment(input, files);
  input?.focus();
}

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
  error: CoreError | null;
  onError: (error: CoreError | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const addAttachments = (newAttachments: DraftAttachment[]) => {
    if (disabled) return;
    onError(null);
    const accepted = [...attachments];
    let total = accepted.reduce((sum, item) => sum + item.file.size, 0);
    for (const attachment of newAttachments) {
      if (accepted.length >= AGENT_ATTACHMENTS_MAX) { onError(shellErrors.SHELL_CHAT_ATTACHMENT_COUNT_EXCEEDED({ limit: String(AGENT_ATTACHMENTS_MAX) })); break; }
      if (attachment.file.size > AGENT_ATTACHMENT_MAX_BYTES) { onError(shellErrors.SHELL_CHAT_ATTACHMENT_TOO_LARGE({ name: attachment.name, limit: "20MB" })); continue; }
      if (total + attachment.file.size > AGENT_ATTACHMENTS_TOTAL_MAX_BYTES) { onError(shellErrors.SHELL_CHAT_ATTACHMENT_TOTAL_TOO_LARGE({ limit: "30MB" })); continue; }
      accepted.push(attachment);
      total += attachment.file.size;
    }
    onAttachmentsChange(accepted);
  };

  const addFiles = (files: File[]) => {
    addAttachments(files.map((file) => makeDraftAttachment(file, CLIPBOARD_IMAGE_EXTENSIONS[file.type] ? `붙여넣은 이미지.${CLIPBOARD_IMAGE_EXTENSIONS[file.type]}` : file.name || "붙여넣은 파일")));
  };
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;
  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    const listener = (event: Event) => {
      const files = (event as CustomEvent<{ files?: File[] }>).detail?.files;
      if (files?.length) addFilesRef.current(files);
    };
    element.addEventListener(CHAT_PASTE_FILES_EVENT, listener);
    return () => element.removeEventListener(CHAT_PASTE_FILES_EVENT, listener);
  }, [inputRef]);

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    const files = clipboardAttachmentFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    onSend();
  };

  return <div className="ks-agent-chat-input-area">
    {error ? <Notice role="alert" errorId={error.id}>{error.message}</Notice> : null}
    {sharedWindows.length ? <div className="ks-agent-attachment-list" role="list">{sharedWindows.map(({ id, name }) => <AttachmentChip key={id} name={name} preview={<span className="ks-agent-attachment-chip-preview ks-share-chip-icon"><ScreenShare /></span>} removeLabel={`${name} 같이 보기 끄기`} disabled={disabled} onRemove={() => { if (!disabled) onRemoveShared(id); }} />)}</div> : null}
    {attachments.length ? <div className="ks-agent-attachment-list" role="list">{attachments.map((attachment) => <DraftChip key={attachment.id} attachment={attachment} onPreview={onPreview} disabled={disabled} onRemove={() => { if (!disabled) onAttachmentsChange(attachments.filter((item) => item.id !== attachment.id)); }} />)}</div> : null}
    <div className="ks-agent-chat-input-row">
      <input type="file" multiple hidden ref={fileRef} disabled={disabled} onChange={(event) => {
        addAttachments(Array.from(event.currentTarget.files ?? []).map((file) => makeDraftAttachment(file, file.name)));
        event.currentTarget.value = "";
      }} />
      <IconButton aria-label="파일 첨부" disabled={disabled} onClick={() => { if (!disabled) fileRef.current?.click(); }}><Paperclip /></IconButton>
      <textarea
        aria-label="메시지"
        className="ks-text-input ks-agent-chat-input"
        disabled={disabled}
        onChange={(event) => { if (!disabled) onDraft(event.currentTarget.value); }}
        onKeyDown={onInputKeyDown}
        onPaste={onPaste}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        ref={inputRef}
        rows={1}
        value={draft}
      />
      {busy && onCancel
        ? <IconButton aria-label="멈춤" disabled={disabled} onClick={(event) => { if (disabled) return; onCancel(); if (event.detail === 0) inputRef.current?.focus(); }}><SquareIcon aria-hidden="true" size={ICON_SIZE.control} strokeWidth={1.5} /></IconButton>
        : <IconButton aria-label="보내기" disabled={disabled || (!draft.trim() && !attachments.length) || busy} onClick={() => onSend(true)}><ArrowUp /></IconButton>}
    </div>
  </div>;
}

