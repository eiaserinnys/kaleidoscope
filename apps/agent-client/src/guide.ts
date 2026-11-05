import type { Item } from "./reducer.ts";

export const GUIDE_TAG = "kaleidoscope-app-guide";
export const GUIDE_OPEN = `<${GUIDE_TAG}>`;
const GUIDE_CLOSE = `</${GUIDE_TAG}>`;
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
    let start = text.indexOf(GUIDE_OPEN);
    while (start >= 0) {
      const end = text.indexOf(GUIDE_CLOSE, start + GUIDE_OPEN.length);
      text = text.slice(0, start) + (end < 0 ? "" : text.slice(end + GUIDE_CLOSE.length));
      start = text.indexOf(GUIDE_OPEN);
    }
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
  const start = title.indexOf(GUIDE_OPEN);
  return (start < 0 ? title : title.slice(0, start)).trim();
}
