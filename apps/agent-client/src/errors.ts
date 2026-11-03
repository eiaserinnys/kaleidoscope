/** Existing AGENT identifiers keep their original place and cause in the client. */
const messages = {
  AGENT_PROMPT_REQUEST_ID_MISSING: "메시지 ID가 비어 있습니다. 쉘을 업데이트한 뒤 다시 보내세요.",
  AGENT_PROMPT_CONTENT_EMPTY: "에이전트에 보낼 글과 첨부 파일이 없습니다. 글이나 파일을 추가해 보내세요.",
  AGENT_PROMPT_TEXT_TOO_LONG: "에이전트 메시지가 20000자를 넘었습니다. 글을 줄인 뒤 다시 보내세요.",
  AGENT_PROMPT_TOO_MANY_ATTACHMENTS: "에이전트 메시지는 첨부 파일을 10개까지만 보낼 수 있습니다. 파일 수를 줄이세요.",
  AGENT_PROMPT_ATTACHMENT_NAME_EMPTY: "첨부 파일 이름이 비어 있습니다. 파일을 다시 선택하세요.",
  AGENT_PROMPT_ATTACHMENT_TOO_LARGE: "에이전트 첨부 파일 하나가 허용 크기 20MB보다 큽니다. 파일 크기를 줄이세요.",
  AGENT_PROMPT_ATTACHMENTS_TOTAL_TOO_LARGE: "에이전트 첨부 파일 합계가 허용 크기 30MB보다 큽니다. 파일 수나 크기를 줄이세요.",
  AGENT_PROMPT_SEND_NOT_READY: "에이전트가 준비되지 않아 메시지를 보낼 수 없습니다. 준비가 끝난 뒤 다시 보내세요.",
} as const;

export function agentError(id: keyof typeof messages): Error & { id: string; code: string; details: string[] } {
  return Object.assign(new Error(messages[id]), { id, code: "invalid_request", details: [] });
}
