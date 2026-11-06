import { commentLabel } from "./label";
import type { AppCommentSummary, AppCommentThread } from "../contract/contract";
import { CONVERSATION_MESSAGE_MAX_CHARS } from "../contract/limits";
import { SHELL_COMMENT_SEND_TEXT_TOO_LONG } from "../contract/shell-errors";

export function pendingComments<T extends AppCommentSummary>(items: T[]): T[] {
  return items.filter((item) => !item.resolved && !item.sent_at);
}

export function commentMessage(appName: string, items: AppCommentThread[]): string {
  const first = items[0];
  const origin = first?.origin.kind === "builtin" ? "기본" : first?.origin.kind === "store" ? "스토어" : "개인";
  const parts = items.map((item) => {
    const excerpt = Array.from(item.text);
    const request = excerpt.length > 500 ? `${excerpt.slice(0, 500).join("")}… (잘림)` : item.text;
    const replies = item.replies.map((reply) => `${reply.author === "agent" ? "에이전트" : "나"}: ${reply.text}`);
    return [`${item.number}번 · ${commentLabel(item.anchor)} : ${request}`, ...replies].join("\n");
  });
  const text = `[앱 화면 커멘트] ${appName}(${origin} 앱) ${first?.created_app_version}판\n\n${parts.join("\n\n")}\n\n${readHint(first.app_id)}`;
  if (Array.from(text).length > CONVERSATION_MESSAGE_MAX_CHARS) throw SHELL_COMMENT_SEND_TEXT_TOO_LONG({ limit: `${CONVERSATION_MESSAGE_MAX_CHARS.toLocaleString()}자` });
  return text;
}

export function replyMessage(appName: string, item: AppCommentSummary, text: string): string {
  const result = `[앱 화면 커멘트 답글] ${appName} ${item.number}번 : ${text}\n\n${readHint(item.app_id)}`;
  if (Array.from(result).length > CONVERSATION_MESSAGE_MAX_CHARS) throw SHELL_COMMENT_SEND_TEXT_TOO_LONG({ limit: `${CONVERSATION_MESSAGE_MAX_CHARS.toLocaleString()}자` });
  return result;
}

function readHint(appId: string): string { return `자리와 그림은 list_app_comments(app_id="${appId}")로 읽습니다.`; }
