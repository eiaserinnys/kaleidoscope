import { afterEach, expect, it } from "vitest";
import { topPainted } from "../share/paint-order";
afterEach(() => document.body.replaceChildren());
it("z-index auto 부모는 자식의 쌓임 맥락을 가두지 않는다", () => {
  document.body.innerHTML = '<div style="position:relative"><canvas style="position:absolute;z-index:3"></canvas></div><div id="cover" style="position:absolute;z-index:2"></div>';
  const canvas = document.querySelector("canvas")!, cover = document.querySelector<HTMLElement>("#cover")!;
  expect(topPainted([canvas, cover])).toBe(canvas);
});
it("소유 포털과 내용은 실제 조상 쌓임 맥락과 DOM 순서로 비교한다", () => {
  document.body.innerHTML = '<div style="position:relative;z-index:1"><canvas style="position:absolute;z-index:9"></canvas></div><div id="portal" style="position:fixed;z-index:2"><button>포털</button></div>';
  expect(topPainted([...document.querySelectorAll<HTMLElement>("canvas, #portal, button")])).toBe(document.querySelector("button"));
});
