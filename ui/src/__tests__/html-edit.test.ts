import { describe, expect, it } from "vitest";
import { applyEdit, invertEdit, numberElements, serializeOriginal, type HtmlEdit } from "../blocks/html-bridge/edit";

describe("HTML 편집", () => {
  it("삭제와 삽입을 원래 위치에 되돌리고 스크립트와 링크를 보존한다", () => {
    const doc = new DOMParser().parseFromString('<!doctype html><html><head><script>original()</script></head><body><a href="https://example.com">앞</a><p>대상</p><p>뒤</p></body></html>', "text/html");
    numberElements(doc);
    const target = doc.querySelector("p")!;
    const n = Number(target.getAttribute("data-ks-n"));
    const edit: HtmlEdit = { kind: "remove", n, parent: Number(doc.body.getAttribute("data-ks-n")), next: Number(target.nextElementSibling!.getAttribute("data-ks-n")), html: target.outerHTML };
    applyEdit(doc, edit);
    expect(doc.body.textContent).toBe("앞뒤");
    applyEdit(doc, invertEdit(edit));
    expect(doc.body.textContent).toBe("앞대상뒤");
    const saved = serializeOriginal(doc);
    expect(saved).toContain("<script>original()</script>");
    expect(saved).toContain('href="https://example.com"');
    expect(saved).not.toContain("data-ks-n");
  });

  it("이동의 역연산은 이전 형제 위치로 되돌린다", () => {
    const doc = new DOMParser().parseFromString("<div><i>1</i><i>2</i><i>3</i></div>", "text/html");
    numberElements(doc);
    const parent = doc.querySelector("div")!;
    const [first, second] = parent.children;
    const edit: HtmlEdit = { kind: "move", n: Number(first.getAttribute("data-ks-n")), parent: Number(parent.getAttribute("data-ks-n")), next_before: Number(second.getAttribute("data-ks-n")), next_after: null };
    applyEdit(doc, edit);
    expect(parent.textContent).toBe("231");
    applyEdit(doc, invertEdit(edit));
    expect(parent.textContent).toBe("123");
  });
});
