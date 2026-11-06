import type { Item } from "./reducer.ts";

export const GUIDE_TAG = "kaleidoscope-app-guide";
export const GUIDE_OPEN = `<${GUIDE_TAG}>`;
const GUIDE_CLOSE = `</${GUIDE_TAG}>`;
const SHARE_OPEN = "<kaleidoscope-share>";
const SHARE_CLOSE = "</kaleidoscope-share>";
const LEGACY_GUIDE_HEAD = "kaleidoscope 앱 제작 지침";
const LEGACY_TOOL_LINES = ["MCP 도구가 연결되어 있습니다.", "현재 MCP 도구를 사용할 수 없습니다."];

export function hadGuide(items: Item[]): boolean {
  return items.some((item) => item.kind === "user" &&
    (item.text.includes(GUIDE_OPEN) || item.text.trimStart().startsWith(LEGACY_GUIDE_HEAD)));
}

export function cleanReplay(items: Item[]): Item[] {
  return items.flatMap((item) => {
    if (item.kind !== "user") return [item];
    let text = item.text;
    for (const [open, close] of [[GUIDE_OPEN, GUIDE_CLOSE], [SHARE_OPEN, SHARE_CLOSE]]) {
      let start = text.indexOf(open);
      while (start >= 0) {
        const end = text.indexOf(close, start + open.length);
        text = text.slice(0, start) + (end < 0 ? "" : text.slice(end + close.length));
        start = text.indexOf(open);
      }
    }
    text = text.replace(/!\[[^\]]*\]\(data:[^)]*\)/g, "");
    if (text.trimStart().startsWith(LEGACY_GUIDE_HEAD)) {
      const lines = LEGACY_TOOL_LINES.map((line) => ({ line, index: text.indexOf(line) }))
        .filter(({ index }) => index >= 0).sort((a, b) => a.index - b.index);
      if (!lines.length) return [{ ...item, text }];
      text = text.slice(lines[0].index + lines[0].line.length);
    }
    text = text.trim();
    return text ? [{ ...item, text }] : [];
  });
}

export function cleanTitle(title: string): string {
  const starts = [title.indexOf(GUIDE_OPEN), title.indexOf(SHARE_OPEN)].filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  return (start < 0 ? title : title.slice(0, start)).trim();
}
