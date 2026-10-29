// 이 파일은 crates/contract/src/lib.rs의 export_limits_ts 테스트가 만든다. 손으로 고치지 않는다.

/** 말 하나에 붙일 수 있는 첨부의 최대 개수. */
export const AGENT_ATTACHMENTS_MAX = 10;
/** 첨부 파일 하나의 최대 바이트 수. */
export const AGENT_ATTACHMENT_MAX_BYTES = 20971520;
/** 말 하나에 붙인 첨부의 합의 최대 바이트 수. */
export const AGENT_ATTACHMENTS_TOTAL_MAX_BYTES = 31457280;
/** 한 번에 보낼 수 있는 글의 최대 글자 수(앞뒤 공백을 뺀 뒤, 유니코드 문자 단위). */
export const AGENT_MESSAGE_MAX_CHARS = 20000;
/** 단추 아이콘으로 쓸 수 있는 Lucide 아이콘 이름(블록 세트 4판). */
export const ICON_NAMES = ["arrow-down", "arrow-left", "arrow-right", "arrow-up", "arrow-up-down", "bell", "bookmark", "calendar", "check", "chevron-down", "chevron-left", "chevron-right", "chevron-up", "circle-alert", "circle-check", "circle-x", "clipboard-copy", "clock", "copy", "download", "ellipsis", "external-link", "eye", "eye-off", "file", "file-text", "filter", "folder", "folder-open", "heart", "history", "house", "image", "info", "link", "list-filter", "lock", "lock-open", "log-in", "log-out", "maximize-2", "message-square", "minimize-2", "minus", "music", "pause", "pencil", "play", "plus", "refresh-cw", "rotate-ccw", "save", "search", "send", "settings", "share", "skip-back", "skip-forward", "square", "star", "tag", "trash-2", "triangle-alert", "upload", "user", "users", "video", "x", "zoom-in", "zoom-out"] as const;
export type IconName = (typeof ICON_NAMES)[number];
