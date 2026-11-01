export interface HtmlReportReply { id: string; author?: string; role?: "user" | "agent"; body: string; created_at?: string }
export type HtmlCommentStatus = "needs_agent_review" | "needs_user_reply" | "resolved";
export interface HtmlReportComment { id: string; selected_text: string; prefix?: string; suffix?: string; selector?: string; comment: string; status: HtmlCommentStatus; created_at?: string; replies?: HtmlReportReply[] }
export interface HtmlReportRevision { rev: number; title?: string; html: string; created_at?: string; note?: string; comments?: HtmlReportComment[] }
export interface HtmlReportDocument { id: string; title: string; revisions: HtmlReportRevision[] }
export interface HtmlSelection { selector?: string; selected_text: string; prefix?: string; suffix?: string }
export interface HtmlElementSelection extends HtmlSelection { selector: string; tagName: string; text: string; styles: Record<"color" | "backgroundColor" | "margin" | "padding", string> }

export function htmlText(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").body.textContent || "";
}

export function reportDocuments(content: unknown): HtmlReportDocument[] {
  if (!content || typeof content !== "object" || !("documents" in content) || !Array.isArray(content.documents)) return [];
  return content.documents.filter((doc: unknown): doc is HtmlReportDocument => {
    if (!doc || typeof doc !== "object") return false;
    const value = doc as HtmlReportDocument;
    return typeof value.id === "string" && typeof value.title === "string" && Array.isArray(value.revisions);
  }).map((doc: HtmlReportDocument) => ({ ...doc, revisions: doc.revisions.filter((rev) => rev && typeof rev.rev === "number" && typeof rev.html === "string") }));
}

export function editedHtml(html: string, selected: HtmlElementSelection, previous: HtmlElementSelection): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let element: HTMLElement | null;
  try { element = doc.querySelector(selected.selector); } catch { return html; }
  if (!element) return html;
  if (selected.text !== previous.text) {
    const textNodes = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE);
    if (textNodes.length) { textNodes[0].textContent = selected.text; textNodes.slice(1).forEach((node) => node.remove()); }
    else element.prepend(doc.createTextNode(selected.text));
  }
  for (const key of ["color", "backgroundColor", "margin", "padding"] as const) {
    if (selected.styles[key] !== previous.styles[key]) element.style[key] = selected.styles[key];
  }
  return "<!doctype html>" + doc.documentElement.outerHTML;
}

export function shareHtmlReport(doc: HtmlReportDocument, revision: HtmlReportRevision, selected: HtmlSelection | null, text: string, appName = "시안과 리포트"): string {
  const latest = Math.max(...doc.revisions.map((item) => item.rev));
  const comments = (revision.comments ?? []).map((comment, index) => ({ comment, index })).filter(({ comment }) => comment.status !== "resolved");
  const lines = [`[${appName}: ${doc.title} (${doc.id}) - v${revision.rev}/${latest}]`];
  if (selected) lines.push(`선택됨: ${selected.selector ?? ""} "${selected.selected_text}"`);
  if (comments.length) {
    lines.push(`미해결 코멘트 (${comments.length}건):`);
    for (const { comment, index } of comments) {
      const reply = comment.replies?.at(-1);
      lines.push(`- #${index + 1} [${comment.status}] (${comment.selector ?? ""} "${comment.selected_text}"): ${comment.comment}${reply ? ` / 답글: ${reply.body}` : ""}`);
    }
  }
  if (text) lines.push(text);
  return lines.join("\n");
}
