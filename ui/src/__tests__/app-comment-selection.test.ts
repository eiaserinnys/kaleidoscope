import { afterEach, describe, expect, it } from "vitest";
import { describeTarget } from "../comments/target";
import { resolveScreen } from "../comments/screen";
import { registerOverlay } from "../share/overlay-owner";

const rect = { x: 10, y: 10, left: 10, top: 10, right: 210, bottom: 110, width: 200, height: 100, toJSON: () => ({}) } as DOMRect;
const geometry = (root: HTMLElement) => {
  for (const el of [document.documentElement, document.body, root, ...root.querySelectorAll<HTMLElement>("*")]) { Object.defineProperty(el, "getBoundingClientRect", { configurable: true, value: () => rect }); Object.defineProperty(el, "getClientRects", { configurable: true, value: () => [rect] }); }
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
  it("목록 행의 이름도 표와 흐름처럼 인용한다", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div data-ks-block="/ui" data-ks-block-type="list"><button role="option" aria-label="목록 1 행의 제목" aria-posinset="1" data-ks-comment-key="&quot;first&quot;"><span>목록 1 행의 제목</span></button></div>';
    document.body.append(root); geometry(root);
    const picked = describeTarget(root.querySelector("span")!, root)!;
    expect(picked.anchor.element?.description).toBe('목록 1행 “목록 1 행의 제목”');
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
  it("상자 없는 anchor는 자식 상자를 합쳐 고르고 화면에 찾는다", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div data-ks-block="/ui" data-ks-block-type="anchor" style="display: contents"><span>첫째</span><span>둘째</span></div>';
    document.body.append(root); geometry(root);
    const anchor = root.firstElementChild as HTMLElement;
    const children = [...anchor.children] as HTMLElement[];
    Object.defineProperty(anchor, "getClientRects", { configurable: true, value: () => [] });
    Object.defineProperty(anchor, "getBoundingClientRect", { configurable: true, value: () => new DOMRect(0, 0, 0, 0) });
    Object.defineProperty(children[0], "getBoundingClientRect", { configurable: true, value: () => new DOMRect(20, 30, 40, 20) });
    Object.defineProperty(children[1], "getBoundingClientRect", { configurable: true, value: () => new DOMRect(80, 50, 30, 20) });
    for (const child of children) Object.defineProperty(child, "getClientRects", { configurable: true, value: () => [child.getBoundingClientRect()] });
    const picked = describeTarget(anchor, root)!;
    expect(picked.rect).toMatchObject({ left: 20, top: 30, right: 110, bottom: 70 });
    const result = resolveScreen(picked.anchor, { kind: "exact", pointer: "/ui" }, root, { windowId: "w", sourceWindowId: "w" });
    expect(result.kind).toBe("exact");
    if (result.kind === "exact") expect(result.rect).toMatchObject({ left: 20, top: 30, right: 110, bottom: 70 });
    anchor.replaceChildren();
    expect(resolveScreen(picked.anchor, { kind: "exact", pointer: "/ui" }, root, { windowId: "w", sourceWindowId: "w" }).kind).toBe("not_visible");
  });
  it.each([["toggle", "switch"], ["select", null]])("%s의 표식 단추 자체를 컨트롤로 찾아낸다", (type, role) => {
    const root = document.createElement("div");
    const button = document.createElement("button"); button.dataset.ksBlock = "/ui"; button.dataset.ksBlockType = type;
    if (role) button.setAttribute("role", role);
    button.setAttribute("aria-label", "선택"); root.append(button); document.body.append(root); geometry(root);
    const picked = describeTarget(button, root)!;
    expect(picked.anchor.kind).toBe("control");
    const result = resolveScreen(picked.anchor, { kind: "exact", pointer: "/ui" }, root, { windowId: "w", sourceWindowId: "w" });
    expect(result.kind).toBe("exact");
    if (result.kind === "exact") expect(result.element).toBe(button);
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
