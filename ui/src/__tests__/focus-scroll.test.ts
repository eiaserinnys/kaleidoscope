import { describe, expect, it } from "vitest";
import { revealStackControl } from "../render/focus-scroll";

describe("결정 줄 위 본문의 초점 스크롤", () => {
  for (const [top, bottom, expected] of [[457.5,489.5,80], [610,642,91], [490,522,87]]) {
    it(`${top}..${bottom} 입력의 테두리를 본문 안에 보인다`, () => {
      const scroller = document.createElement("div"); scroller.className = "ks-stack-scroll";
      const target = document.createElement("textarea"); scroller.append(target);
      scroller.scrollTop = 87;
      Object.defineProperty(scroller, "getBoundingClientRect", { value: () => ({ top:464.5 } as DOMRect) });
      Object.defineProperty(scroller, "clientHeight", { value:173.5 });
      Object.defineProperty(target, "getBoundingClientRect", { value: () => ({ top, bottom } as DOMRect) });
      revealStackControl(target);
      expect(scroller.scrollTop).toBe(expected);
    });
  }
});
