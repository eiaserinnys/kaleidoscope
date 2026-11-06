import type { Item } from "./reducer.ts";

export const GUIDE_TAG = "kaleidoscope-app-guide";
export const GUIDE_OPEN = `<${GUIDE_TAG}>`;
const GUIDE_CLOSE = `</${GUIDE_TAG}>`;
const SHARE_OPEN = "<kaleidoscope-share>";
const SHARE_CLOSE = "</kaleidoscope-share>";
const SHARE_INTRO = "디렉터가 kaleidoscope 쉘에서 「같이 보기」로 켠 창에 지금 보이는 내용입니다. 쉘이 디렉터의 말 뒤에 붙였고 디렉터가 쓴 글이 아닙니다. 지난번 말 뒤로 달라진 것만 담았습니다. 지금 모습 전체는 MCP get_shared_view로 읽을 수 있습니다. 이미지나 웹 화면이 보이는 창은 모습이 바뀌었을 때 「같이 보기 - 앱 이름.png」 첨부로 함께 옵니다.";
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
    const shareStart = `${SHARE_OPEN}\n${SHARE_INTRO}`;
    start = text.indexOf(shareStart);
    while (start >= 0) {
      const end = text.indexOf(SHARE_CLOSE, start + shareStart.length);
      if (end < 0) break;
      text = text.slice(0, start) + text.slice(end + SHARE_CLOSE.length);
      start = text.indexOf(shareStart);
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
  const starts = [title.indexOf(GUIDE_OPEN), title.indexOf(SHARE_OPEN), title.search(/!\[[^\]]*\]\(data:/)].filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  return (start < 0 ? title : title.slice(0, start)).trim();
}
