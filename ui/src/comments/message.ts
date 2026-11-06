import type { AppCommentSummary, AppCommentThread } from "../contract/contract";
import { CONVERSATION_MESSAGE_MAX_CHARS } from "../contract/limits";
import { SHELL_COMMENT_SEND_TEXT_TOO_LONG } from "../contract/shell-errors";

export function pendingComments<T extends AppCommentSummary>(items: T[]): T[] {
  return items.filter((item) => !item.resolved && !item.sent_at);
}

function source(item: AppCommentSummary): string {
  switch (item.origin.kind) {
    case "builtin": return "기본 앱: 리포의 apps 정의 또는 공용 블록과 쉘을 고치고 쉘을 릴리스합니다.";
    case "personal": return "개인 앱: get_app으로 정의를 확인하고 upload_app으로 새 판을 올립니다.";
    case "store": {
      const origin = item.origin.origin;
      return `스토어 앱: ${origin.store_url} / ${origin.store_app_id} / 릴리스 ${origin.release} / ${origin.digest}. 스토어 원본을 고치고 새 판을 설치합니다.`;
    }
  }
}

export function commentMessage(appName: string, items: AppCommentThread[]): string {
  const parts = items.map((item) => {
    const anchor = item.anchor;
    const excerpt = Array.from(item.text);
    const request = excerpt.length > 500 ? `${excerpt.slice(0, 500).join("")}… (잘림. 원문은 get_app_comment로 읽으세요)` : item.text;
    const replies = item.replies.map((reply) => `${reply.author === "agent" ? "에이전트" : "나"}: ${reply.text}`).join("\n");
    return [`커멘트 ${item.number}: ${item.id}`, `앱: ${item.app_id} / ${appName}`, `출처와 수정 위치: ${source(item)}`,
      `만든 판: ${item.created_app_version} / ${item.created_definition_digest} / 쉘 ${item.created_shell_version}`,
      `자리: ${[anchor.pointer, anchor.normalized_type, anchor.repeat_chain?.length ? `반복 ${JSON.stringify(anchor.repeat_chain)}` : "", anchor.row_identity != null && anchor.row_identity !== "" ? `행 ${JSON.stringify(anchor.row_identity)}` : "", anchor.quote?.exact ? `고른 글 ${anchor.quote.exact}` : "", anchor.frame_rel ? `프레임 좌표 ${JSON.stringify(anchor.frame_rel)} · 크기 ${anchor.frame_css_width}×${anchor.frame_css_height}` : ""].filter(Boolean).join(" · ")}`,
      `요청: ${request}`, replies && `답글:\n${replies}`,
      item.image && `그림: get_app_comment(comment_id=${item.id}, image=true)로 읽으세요`,
    ].filter(Boolean).join("\n");
  });
  const text = `[앱 화면 커멘트]\n\n${parts.join("\n\n")}`;
  if (Array.from(text).length > CONVERSATION_MESSAGE_MAX_CHARS) throw SHELL_COMMENT_SEND_TEXT_TOO_LONG({ limit: `${CONVERSATION_MESSAGE_MAX_CHARS.toLocaleString()}자` });
  return text;
}

export function replyMessage(item: AppCommentSummary, text: string): string {
  const result = `[앱 화면 커멘트 답글]\n커멘트 ${item.number}: ${item.id}\n답글: ${text}`;
  if (Array.from(result).length > CONVERSATION_MESSAGE_MAX_CHARS) throw SHELL_COMMENT_SEND_TEXT_TOO_LONG({ limit: `${CONVERSATION_MESSAGE_MAX_CHARS.toLocaleString()}자` });
  return result;
}
