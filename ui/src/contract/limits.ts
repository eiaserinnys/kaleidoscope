// 이 파일은 crates/contract/src/lib.rs의 export_limits_ts 테스트가 만든다. 손으로 고치지 않는다.

/** 말 하나에 붙일 수 있는 첨부의 최대 개수. */
export const AGENT_ATTACHMENTS_MAX = 10;
/** 첨부 파일 하나의 최대 바이트 수. */
export const AGENT_ATTACHMENT_MAX_BYTES = 20971520;
/** 말 하나에 붙인 첨부의 합의 최대 바이트 수. */
export const AGENT_ATTACHMENTS_TOTAL_MAX_BYTES = 31457280;
/** 한 번에 보낼 수 있는 글의 최대 글자 수(앞뒤 공백을 뺀 뒤, 유니코드 문자 단위). */
export const CONVERSATION_MESSAGE_MAX_CHARS = 20000;
/** JSON 저장 항목 하나의 최대 바이트 수. */
export const STORAGE_JSON_MAX_BYTES = 65536;
/** Markdown 저장 항목 하나의 최대 UTF-8 바이트 수. */
export const STORAGE_MD_MAX_BYTES = 1048576;
/** 저장소 명령 HTTP 본문의 최대 바이트 수. */
export const STORAGE_COMMAND_BODY_MAX_BYTES = 8388608;
/** (9판) 같이 보기 글 하나의 최대 바이트 수(UTF-8). */
export const SHARE_TEXT_MAX_BYTES = 16384;
/** (9판) 잘린 같이 보기 글의 마지막 줄. */
export const SHARE_TEXT_CUT_MARK = "…(아래는 길어서 뺐습니다)";
/** (9판) 같이 보기 창이 바뀐 뒤 글을 다시 옮기기까지 기다리는 시간(ms). */
export const SHARE_DEBOUNCE_MS = 800;
/** 쉘에 기본 탑재되는 앱 ID 목록. */
export const BUILTIN_APP_IDS = ["agent", "explorer", "md-editor", "md-viewer", "web-browser", "calculator", "weather", "market"] as const;
/** 단추 아이콘으로 쓸 수 있는 Lucide 아이콘 이름(블록 세트 4판). */
export const ICON_NAMES = ["arrow-down", "arrow-left", "arrow-right", "arrow-up", "arrow-up-down", "bell", "bookmark", "calendar", "check", "chevron-down", "chevron-left", "chevron-right", "chevron-up", "circle-alert", "circle-check", "circle-x", "clipboard-copy", "clock", "copy", "download", "ellipsis", "external-link", "eye", "eye-off", "file", "file-text", "filter", "folder", "folder-open", "heart", "history", "house", "image", "info", "link", "list-filter", "lock", "lock-open", "log-in", "log-out", "maximize-2", "message-square", "minimize-2", "minus", "music", "pause", "pencil", "play", "plus", "refresh-cw", "rotate-ccw", "save", "search", "send", "settings", "share", "skip-back", "skip-forward", "square", "star", "tag", "trash-2", "triangle-alert", "upload", "user", "users", "video", "x", "zoom-in", "zoom-out"] as const;
export type IconName = (typeof ICON_NAMES)[number];
