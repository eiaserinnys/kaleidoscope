import { afterEach, describe, expect, it } from "vitest";
import { describeTarget } from "../comments/target";
import { resolveScreen } from "../comments/screen";
import { registerOverlay } from "../share/overlay-owner";

const rect = { x: 10, y: 10, left: 10, top: 10, right: 210, bottom: 110, width: 200, height: 100, toJSON: () => ({}) } as DOMRect;
const geometry = (root: HTMLElement) => {
  for (const el of [document.documentElement, document.body, root, ...root.querySelectorAll<HTMLElement>("*")]) Object.defineProperty(el, "getBoundingClientRect", { configurable: true, value: () => rect });
};
afterEach(() => { document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });

describe("화면에서 커멘트 자리 고르기", () => {
  it("표의 행 키와 순번을 구별해 저장하고 같은 행을 찾는다", () => {
    const root = document.createElement("div"); root.dataset.windowId = "w";
    root.innerHTML = '<div data-ks-block="/ui" data-ks-block-type="table"><div role="row" aria-rowindex="4" data-ks-comment-key="&quot;id-17&quot;"><span>행 내용</span></div></div>';
    document.body.append(root); geometry(root);
    const picked = describeTarget(root.querySelector("span")!, root)!;
    expect(picked.anchor).toMatchObject({ kind: "row", pointer: "/ui", row_identity: "id-17" });
    expect(picked.path).toBe("표 › 4행");
    expect(resolveScreen(picked.anchor, { kind: "exact", pointer: "/ui" }, root, { windowId: "w", sourceWindowId: "w" }).kind).toBe("exact");
  });
  it("선택한 글과 양쪽 문맥이 같은 블록 안에서 유일할 때 다시 찾는다", () => {
    const root = document.createElement("div"); root.innerHTML = '<div data-ks-block="/ui" data-ks-block-type="text">앞 문맥 <b>고른 글</b> 뒤 문맥</div>';
    document.body.append(root); geometry(root);
    const node = root.querySelector("b")!.firstChild!, range = document.createRange(); range.selectNodeContents(node);
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    const picked = describeTarget(root.querySelector("b")!, root)!;
    expect(picked.anchor).toMatchObject({ kind: "text", quote: { exact: "고른 글", prefix: "앞 문맥 ", suffix: " 뒤 문맥" } });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => rect });
    expect(resolveScreen(picked.anchor, { kind: "exact", pointer: "/ui" }, root, { windowId: "w", sourceWindowId: "w" }).kind).toBe("exact");
  });
  it("다른 위치에 열린 소유 겹침도 반복 키의 조상을 따라간다", () => {
    const root = document.createElement("div"); root.dataset.windowId = "w";
    root.innerHTML = '<div data-repeat-key="1" data-ks-comment-key="1"><div class="anchor"></div></div>';
    const overlay = document.createElement("div"); overlay.innerHTML = '<div data-ks-block="/ui/template" data-ks-block-type="dialog">대화상자</div>';
    document.body.append(root, overlay); geometry(root); geometry(overlay);
    const unregister = registerOverlay(overlay, "w", root.querySelector(".anchor")!);
    const picked = describeTarget(overlay.firstElementChild as HTMLElement, root)!;
    expect(picked.anchor.repeat_chain).toEqual([1]);
    expect(resolveScreen(picked.anchor, { kind: "exact", pointer: "/ui/template" }, root, { windowId: "w", sourceWindowId: "w" }).kind).toBe("exact");
    unregister();
  });
});
