export function htmlText(html: string): string {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  body.querySelectorAll("script, style, template, [hidden]").forEach((element) => element.remove());
  return body.textContent || "";
}
