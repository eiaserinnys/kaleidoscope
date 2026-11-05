import type { Item } from "./reducer.ts";

export const GUIDE_TAG = "kaleidoscope-app-guide";
export const GUIDE_OPEN = `<${GUIDE_TAG}>`;
const GUIDE_CLOSE = `</${GUIDE_TAG}>`;

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
    text = text.trim();
    return text ? [{ ...item, text }] : [];
  });
}

export function cleanTitle(title: string): string {
  const start = title.indexOf(GUIDE_OPEN);
  return (start < 0 ? title : title.slice(0, start)).trim();
}
