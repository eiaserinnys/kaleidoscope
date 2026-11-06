import { afterEach, expect, it, vi } from "vitest";
import { isCommentAnchorVisible } from "../comments/positions";

const rect = new DOMRect(10, 20, 100, 40);
const clip = { left: 30, right: 90, top: 10, bottom: 80 };
const prepare = () => {
  const content = document.createElement("div");
  content.className = "ks-window-content";
  const target = document.createElement("div");
  content.append(target); document.body.append(content);
  const hit = vi.fn<(x: number, y: number) => Element[]>();
  const previous = Object.getOwnPropertyDescriptor(document, "elementsFromPoint");
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: hit });
  return { content, target, hit, restore: () => { if (previous) Object.defineProperty(document, "elementsFromPoint", previous); else delete (document as Partial<Document>).elementsFromPoint; } };
};
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it("프레임 점은 적중 판정을 건너뛴다", () => {
  const { content, target, hit, restore } = prepare();
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue(rect);
  try { expect(isCommentAnchorVisible(content, target, "point", new DOMRect(40, 30, 0, 0), clip, 40)).toBe(true); expect(hit).not.toHaveBeenCalled(); } finally { restore(); }
});
it("프레임 점은 표면과 스크롤 칸의 교집합 밖이면 숨긴다", () => {
  const { content, target, hit, restore } = prepare();
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 0, 100, 100));
  try {
    for (const [x, y, visible] of [[40, 20, true], [40, -1, false], [40, 10, false], [40, 80, false], [40, 81, false], [20, 20, false], [91, 20, false]]) {
      expect(isCommentAnchorVisible(content, target, "point", new DOMRect(x as number, y as number, 0, 0), clip, 40)).toBe(visible);
    }
    expect(hit).not.toHaveBeenCalled();
  } finally { restore(); }
});
it("숫자 입력 안의 단추 등 고정 머리가 아닌 형제 가림은 표시한다", () => {
  const { content, target, hit, restore } = prepare();
  const button = document.createElement("button"); content.append(button); hit.mockReturnValue([button]);
  try {
    expect(isCommentAnchorVisible(content, target, "control", rect, clip, 40)).toBe(true);
    expect(hit).toHaveBeenLastCalledWith(60, 40);
    isCommentAnchorVisible(content, target, "control", new DOMRect(0, 20, 500, 40), clip, 40);
    expect(hit).toHaveBeenLastCalledWith(90, 40);
  } finally { restore(); }
});
it("다른 창과 커멘트 층을 건너뛰며 맨 위가 없거나 대상의 조상이어도 표시한다", () => {
  const { content, target, hit, restore } = prepare();
  const otherWindow = document.createElement("div"); otherWindow.style.position = "sticky";
  const layer = document.createElement("div"); layer.className = "ks-comment-layer"; content.append(layer);
  try {
    for (const stack of [[otherWindow, layer, target], [otherWindow], [content]]) {
      hit.mockReturnValue(stack);
      expect(isCommentAnchorVisible(content, target, "row", rect, clip, 40)).toBe(true);
    }
  } finally { restore(); }
});
it.each(["표 머리", "묶음 머리"])("%s가 가린 경우만 숨기고 대상 자식이면 표시한다", () => {
  const { content, target, hit, restore } = prepare();
  const sticky = document.createElement("div"); sticky.style.position = "sticky";
  const label = document.createElement("span"); sticky.append(label); content.append(sticky);
  try {
    hit.mockReturnValue([label, target]);
    expect(isCommentAnchorVisible(content, target, "row", rect, clip, 40)).toBe(false);
    target.append(sticky);
    expect(isCommentAnchorVisible(content, target, "block", rect, clip, 40)).toBe(true);
  } finally { restore(); }
});
