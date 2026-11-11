/** Existing AGENT identifiers keep their original place and cause in the client. */
const messages = {
  AGENT_SESSION_LIST_FAILED: (reason: string) => `지난 세션 목록을 받지 못했습니다. 다시 받기를 누르세요. 원인: ${reason}`,
  AGENT_SESSION_LOAD_FAILED: (reason: string) => `선택한 세션을 이어 가지 못했습니다. 다시 선택하세요. 원인: ${reason}`,
  AGENT_SESSION_LOAD_ACTIVE_WRITER: "다른 곳에서 열려 있는 세션입니다. 그쪽을 닫고 다시 고르세요.",
  AGENT_SESSION_NEW_FAILED: (reason: string) => `새 세션을 만들지 못했습니다. 다시 시도하세요. 원인: ${reason}`,
  AGENT_PROMPT_REQUEST_ID_MISSING: "메시지 ID가 비어 있습니다. 쉘을 업데이트한 뒤 다시 보내세요.",
  AGENT_PROMPT_CONTENT_EMPTY: "에이전트에 보낼 글과 첨부 파일이 없습니다. 글이나 파일을 추가해 보내세요.",
  AGENT_PROMPT_TEXT_TOO_LONG: "에이전트 메시지가 20000자를 넘었습니다. 글을 줄인 뒤 다시 보내세요.",
  AGENT_PROMPT_TOO_MANY_ATTACHMENTS: "에이전트 메시지는 첨부 파일을 10개까지만 보낼 수 있습니다. 파일 수를 줄이세요.",
  AGENT_PROMPT_ATTACHMENT_NAME_EMPTY: "첨부 파일 이름이 비어 있습니다. 파일을 다시 선택하세요.",
  AGENT_PROMPT_ATTACHMENT_TOO_LARGE: "에이전트 첨부 파일 하나가 허용 크기 20MB보다 큽니다. 파일 크기를 줄이세요.",
  AGENT_PROMPT_ATTACHMENTS_TOTAL_TOO_LARGE: "에이전트 첨부 파일 합계가 허용 크기 30MB보다 큽니다. 파일 수나 크기를 줄이세요.",
  AGENT_PROMPT_SEND_NOT_READY: "에이전트가 준비되지 않아 메시지를 보낼 수 없습니다. 준비가 끝난 뒤 다시 보내세요.",
  AGENT_PERMISSION_REPLY_REQUEST_NOT_FOUND: "이 허용 요청은 더 이상 대기 중이지 않습니다. 새 요청이 오면 다시 선택하세요.",
  AGENT_PERMISSION_REPLY_OPTION_NOT_FOUND: "이 선택지는 현재 허용 요청에 없습니다. 요청에 표시된 선택지를 누르세요.",
  AGENT_RECORD_PAGE_NOT_FOUND: (page: string) => `에이전트 대화 기록의 ${page}번 페이지를 찾지 못했습니다. 쉘 데이터 폴더의 상태를 확인하세요.`,
  AGENT_RECONNECT_STREAM_NOT_FOUND: "진행 중인 에이전트 응답을 찾지 못했습니다. 쉘 데이터 폴더의 상태를 확인하세요.",
  AGENT_RECONNECT_PARTIAL_NOT_FOUND: "에이전트 응답의 남은 데이터를 찾지 못했습니다. 쉘 데이터 폴더의 상태를 확인하세요.",
  AGENT_START_AGENT_NOT_SELECTED: "실행할 에이전트를 고르지 않았습니다. 에이전트를 선택한 뒤 다시 시도하세요.",
  AGENT_START_HANDLE_MISSING: "에이전트 실행 결과에 프로세스 식별자가 없습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
  AGENT_START_CWD_MISSING: "에이전트 실행 결과에 작업 폴더 경로가 없습니다. 쉘을 업데이트한 뒤 다시 시도하세요.",
  AGENT_PROCESS_HANDLE_MISSING: "실행 중인 에이전트 프로세스가 없습니다. 다시 시도하세요.",
  AGENT_INSTALL_UNSUPPORTED_PLATFORM: (agent: string, name: string, url: string) => `${agent} 에이전트에 필요한 ${name} 프로그램이 이 기기에 없습니다. 창에서 설치는 Windows에서만 되니 ${url}에서 받아 설치한 뒤 다시 시도하세요.`,
  AGENT_INSTALL_WINGET_NOT_FOUND: (name: string, url: string) => `Windows 패키지 관리자 winget이 없어 ${name} 프로그램을 설치하지 못했습니다. ${url}에서 받아 설치한 뒤 다시 시도하세요.`,
  AGENT_INSTALL_COMMAND_STILL_MISSING: (name: string, command: string) => `${name} 프로그램을 설치했지만 ${command} 명령을 찾지 못했습니다. 쉘을 다시 시작한 뒤 다시 시도하세요.`,
  AGENT_INSTALL_BLOCKED_BY_POLICY: (name: string, url: string) => `조직의 정책이 설치를 막아 ${name} 프로그램을 설치하지 못했습니다. 관리자에게 문의하거나 ${url}에서 설치 방법을 확인하세요.`,
  AGENT_INSTALL_CANCELLED_BY_USER: (name: string, url: string) => `설치가 취소되어 ${name} 프로그램을 설치하지 못했습니다. 다시 시도하거나 ${url}에서 받아 설치하세요.`,
  AGENT_INSTALL_FAILED: (name: string, url: string, _hex: string, output: string) => `${name} 프로그램을 설치하지 못했습니다. 다시 시도하거나 ${url}에서 받아 설치하세요. 원인: ${output}`,
  AGENT_PROCESS_EXITED: (name: string) => `에이전트 ${name} 프로그램이 종료되어 대화를 이어갈 수 없습니다. 다시 시도하세요.`,
  AGENT_ATTACHMENT_READ_NOT_FOUND: (name: string) => `에이전트 대화에 기록된 ${name} 첨부 파일을 이 기기에서 찾지 못했습니다. 필요하면 파일을 다시 첨부하세요.`,
} as const;

const notFound = new Set<keyof typeof messages>([
  "AGENT_RECORD_PAGE_NOT_FOUND", "AGENT_RECONNECT_STREAM_NOT_FOUND", "AGENT_RECONNECT_PARTIAL_NOT_FOUND", "AGENT_ATTACHMENT_READ_NOT_FOUND",
]);

export function agentError(id: keyof typeof messages, detail = "", ...details: string[]): Error & { id: string; code: string; details: string[] } {
  const value = messages[id];
  const message = typeof value === "function" ? (value as (...args: string[]) => string)(detail, ...details) : value;
  const code = notFound.has(id) ? "not_found" : id === "AGENT_PROCESS_EXITED" ? "local_agent_failed" : "invalid_request";
  return Object.assign(new Error(message), { id, code, details: id === "AGENT_INSTALL_FAILED" ? [`winget 종료 코드: ${details[1]}`] : [] });
}
