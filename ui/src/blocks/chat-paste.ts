export const CHAT_PASTE_FILES_EVENT = "ks-chat-paste-files";

/** 채팅 입력칸에 파일을 첨부로 넘긴다. 입력칸이 붙여넣기 신호를 받아 기존 한도 검사를 그대로 거친다. */
export function requestChatAttachment(input: HTMLTextAreaElement | null, files: File[]): boolean {
  if (!input || !files.length) return false;
  input.dispatchEvent(new CustomEvent(CHAT_PASTE_FILES_EVENT, { detail: { files } }));
  return true;
}
