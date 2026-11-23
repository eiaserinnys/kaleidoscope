import type { MediaRef } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";

/** 뷰어가 그릴 첨부의 원천. 미디어 참조나 이미 받아 둔 바이트, 또는 누를 때 받아 올 함수다. */
export type AttachmentContent =
  | { kind: "media"; media: MediaRef }
  | { kind: "bytes"; mime: string; data_base64: string };

export type AttachmentSource = AttachmentContent | { kind: "later"; load: () => Promise<AttachmentContent> };

export type AttachmentKind = "image" | "video" | "audio" | "markdown" | "text" | "other";

/** 뷰어를 열 때 넘기는 요청. `trigger`는 닫을 때 초점을 돌려줄 단추다. */
export type AttachmentPreviewRequest = { source: AttachmentSource; name: string; trigger: HTMLElement };

/** 글은 앞 1MiB만 보여 준다. 그보다 큰 첨부는 받기로 저장해 확인한다. */
export const ATTACHMENT_TEXT_MAX_BYTES = 1024 * 1024;

const EXTENSION_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/mp4", ogv: "video/ogg",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac", aac: "audio/aac", opus: "audio/ogg",
  md: "text/markdown", markdown: "text/markdown",
  txt: "text/plain", log: "text/plain", csv: "text/csv", tsv: "text/tab-separated-values",
  html: "text/html", htm: "text/html", xml: "text/xml", yaml: "text/yaml", yml: "text/yaml",
  toml: "text/plain", ini: "text/plain", json: "application/json",
  js: "text/javascript", mjs: "text/javascript", cjs: "text/javascript", ts: "text/typescript",
  tsx: "text/typescript", jsx: "text/javascript", css: "text/css", py: "text/x-python",
  rs: "text/rust", go: "text/go", java: "text/java", c: "text/c", h: "text/c", cpp: "text/c++",
  hpp: "text/c++", sh: "text/x-sh", bat: "text/plain", ps1: "text/plain", sql: "text/plain",
};

const MIME_EXTENSION: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "image/avif": "avif", "image/svg+xml": "svg", "image/bmp": "bmp",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/ogg": "ogv",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a",
  "audio/flac": "flac", "audio/aac": "aac",
  "text/plain": "txt", "text/markdown": "md", "text/html": "html", "text/csv": "csv",
  "application/json": "json", "application/pdf": "pdf", "application/zip": "zip",
};

export function baseMime(mime: string): string {
  return mime.split(";", 1)[0].trim().toLowerCase();
}

export function mimeFromName(name: string): string {
  const extension = name.match(/\.([a-z0-9]{1,10})$/i)?.[1]?.toLowerCase();
  return extension ? EXTENSION_MIME[extension] ?? "" : "";
}

export function attachmentKind(mime: string, name: string): AttachmentKind {
  let value = baseMime(mime);
  if (!value || value === "application/octet-stream") value = mimeFromName(name);
  if (value.startsWith("image/")) return "image";
  if (value.startsWith("video/")) return "video";
  if (value.startsWith("audio/")) return "audio";
  if (value === "text/markdown" || /\.(md|markdown)$/i.test(name)) return "markdown";
  if (value.startsWith("text/") || value === "application/json" || value.endsWith("+json")) return "text";
  return "other";
}

/** 저장 대화상자에 넣을 제안 이름. 표시 이름이 비었을 때만 받은 형식의 확장자를 붙인다. */
export function suggestedAttachmentName(name: string, mime: string): string {
  const base = name.trim() || "첨부";
  if (/\.[a-z0-9]{1,10}$/i.test(base)) return base;
  const value = baseMime(mime);
  const subtype = value.split("/", 2)[1] ?? "";
  const extension = MIME_EXTENSION[value] ?? (/^[a-z0-9]{1,10}$/.test(subtype) ? subtype : "");
  return extension ? `${base}.${extension}` : base;
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function attachmentBytes(dataBase64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** 아직 보내지 않은 로컬 파일을 뷰어에 넘길 때, 누를 때 읽어 올 원천을 만든다. */
export function fileAttachmentSource(file: File): AttachmentSource {
  return { kind: "later", load: async () => ({
    kind: "bytes",
    mime: file.type || mimeFromName(file.name),
    data_base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
  }) };
}

export function attachmentDataUrl(content: { mime: string; data_base64: string }): string {
  return `data:${baseMime(content.mime) || "application/octet-stream"};base64,${content.data_base64}`;
}

/** 첨부 종류에 맞춰 보여 줄 글을 자른다. `truncated`면 1MiB 뒤가 잘렸다. */
export function attachmentText(dataBase64: string): { text: string; truncated: boolean } {
  const bytes = attachmentBytes(dataBase64);
  const truncated = bytes.length > ATTACHMENT_TEXT_MAX_BYTES;
  return {
    text: new TextDecoder().decode(truncated ? bytes.subarray(0, ATTACHMENT_TEXT_MAX_BYTES) : bytes),
    truncated,
  };
}

async function resolveSource(source: AttachmentSource): Promise<AttachmentContent> {
  return source.kind === "later" ? source.load() : source;
}

/** 원천이 미디어 참조면 `data.media`로 원본을 받고, 바이트면 그대로 돌려준다. */
export async function loadAttachment(store: ShellStore, windowId: string, source: AttachmentSource): Promise<{ mime: string; data_base64: string }> {
  const content = await resolveSource(source);
  if (content.kind === "bytes") return { mime: content.mime, data_base64: content.data_base64 };
  const reply = await store.call({ op: "data.media", window_id: windowId, media: content.media });
  return { mime: reply.media.mime, data_base64: reply.media.data_base64 };
}

function downloadBytes(dataBase64: string, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([attachmentBytes(dataBase64)], { type: baseMime(mime) || "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * 받기. 데스크톱 전송은 코어의 저장 대화상자를, 브라우저 전송은 download를 쓴다. 취소는 조용히 끝난다.
 * 호스트가 대화상자 없이 스스로 고른 위치가 있으면 그 표시 이름을 돌려주고, 없으면 null이다.
 */
export async function saveAttachment(store: ShellStore, windowId: string, source: AttachmentSource, displayName: string): Promise<string | null> {
  const content = await resolveSource(source);
  if (store.nativeFiles) {
    const mime = content.kind === "bytes" ? content.mime : (await loadAttachment(store, windowId, content)).mime;
    const reply = await store.call({
      op: "data.media.save",
      window_id: windowId,
      source: content,
      suggested_name: suggestedAttachmentName(displayName, mime),
    });
    return reply.saved_to ?? null;
  }
  const loaded = await loadAttachment(store, windowId, content);
  downloadBytes(loaded.data_base64, suggestedAttachmentName(displayName, loaded.mime), loaded.mime);
  return null;
}
