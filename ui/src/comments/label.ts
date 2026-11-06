import type { AppCommentAnchor } from "../contract/contract";

const names: Record<string, string> = { repeat: "반복", progress: "진행", dialog: "대화상자", anchor: "구역", tour: "안내", canvas: "캔버스", timeline: "시간축", split: "분할", tree: "트리", folder: "폴더", markdown: "문서", html_view: "HTML", sandbox: "프레임", chat: "대화", stack: "구역", tabs: "탭", toolbar: "도구 막대", section: "구역", list: "목록", table: "표", properties: "속성", notice: "안내", feed: "흐름", text: "글", input: "입력", slider: "슬라이더", color: "색", select: "선택", toggle: "스위치", button: "단추", code: "코드", image: "이미지", media: "미디어", metrics: "수치", button_grid: "단추 모음", chart: "차트", map: "지도", web_view: "웹", explorer: "탐색기" };

export function blockName(type?: string): string { return type ? names[type] ?? "블록" : "블록"; }
export function commentLabel(anchor: AppCommentAnchor, detailOnly = false): string {
  if (anchor.kind === "text" && anchor.row_identity == null && anchor.quote?.exact) return `${blockName(anchor.normalized_type)} “${anchor.quote.exact}”`;
  if (anchor.row_identity != null || anchor.kind === "text") return anchor.element?.description || (anchor.quote?.exact ? `“${anchor.quote.exact}”` : blockName(anchor.normalized_type));
  const description = anchor.element?.description?.replace(/\s+/g, " ").trim();
  const text = description && description !== blockName(anchor.normalized_type) ? `“${description.length > 48 ? `${description.slice(0, 48)}…` : description}”` : "";
  return [detailOnly ? "" : blockName(anchor.normalized_type), text].filter(Boolean).join(" ");
}
