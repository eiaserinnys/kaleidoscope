import { beforeAll, describe, expect, it, vi } from "vitest";
import sample from "./fixtures/html-report-sample.html?raw";
import { createAnchor, resolveAnchor } from "../blocks/html-bridge/anchor";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
beforeAll(() => { if (!globalThis.CSS) vi.stubGlobal("CSS", { escape: (value: string) => value.replace(/([^a-zA-Z0-9_-])/g, "\\$1") }); });
const textAnchor = (element: Element) => {
  const node = element.firstChild!;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(node);
  return createAnchor(element, range);
};

describe("리비전에서 커멘트 다시 찾기", () => {
  it("작업본에서 순서를 바꿔 B에 단 앵커는 원래 문서의 A에 붙지 않는다", () => {
    const original = parse("<main><p>첫 번째 문단 A입니다</p><p>두 번째 문단 B입니다</p></main>");
    const draft = parse("<main><p>첫 번째 문단 A입니다</p><p>두 번째 문단 B입니다</p></main>");
    const main = draft.querySelector("main")!;
    main.prepend(main.lastElementChild!);
    const anchor = createAnchor(main.firstElementChild!);
    const result = resolveAnchor(original, anchor, false);
    expect(result.element).toBe(original.querySelectorAll("p")[1]);
    expect(result.element).not.toBe(original.querySelectorAll("p")[0]);
  });
  it("앞 섹션이 생겨도 글과 요소를 같은 대상에 붙인다", () => {
    const old = parse(sample); const next = parse(sample);
    const element = old.querySelector(".cta")!; const paragraph = old.querySelector(".hero p")!;
    const button = createAnchor(element); const text = textAnchor(paragraph);
    expect(button.label).toBe("button.cta");
    next.body.prepend(next.createElement("section"));
    expect(resolveAnchor(next, button).element).toBe(next.querySelector(".cta"));
    expect(resolveAnchor(next, text).element).toBe(next.querySelector(".hero p"));
  });
  it("긴 문장의 한 단어가 바뀌면 옮겨 찾고 짧은 인용이 바뀌면 고아로 둔다", () => {
    const old = parse(sample); const next = parse(sample);
    const long = textAnchor(old.querySelector(".hero p")!); const short = textAnchor(old.querySelector(".plan h2")!);
    next.querySelector(".hero p")!.textContent = next.querySelector(".hero p")!.textContent!.replace("녹음을", "음성을");
    next.querySelector(".plan h2")!.textContent = "개별";
    expect(resolveAnchor(next, long).status).toBe("moved");
    expect(resolveAnchor(next, short).status).toBe("orphan");
  });
  it("문구나 클래스 하나가 바뀐 버튼과 순서가 바뀐 카드를 찾는다", () => {
    const old = parse(sample); const next = parse(sample);
    const button = createAnchor(old.querySelector(".cta")!); const card = createAnchor(old.querySelector(".plan.best")!);
    next.querySelector(".cta")!.textContent = "지금 시작";
    const plans = next.querySelector(".plans")!; plans.prepend(next.querySelector(".plan.best")!);
    expect(resolveAnchor(next, button).element).toBe(next.querySelector(".cta"));
    const movedCard = resolveAnchor(next, card);
    expect(movedCard.element).toBe(next.querySelector(".plan.best"));
    expect(movedCard.status).toBe("moved");
    const renamed = parse(sample); renamed.querySelector(".cta")!.className = "action";
    expect(resolveAnchor(renamed, button).element).toBe(renamed.querySelector(".action"));
  });
  it("삭제된 글과 요소 및 완전히 새로 쓴 내용은 잘못 붙이지 않는다", () => {
    const old = parse(sample); const element = createAnchor(old.querySelector(".cta")!); const text = textAnchor(old.querySelector(".hero p")!);
    const next = parse(sample); next.querySelector(".cta")!.remove(); next.querySelector(".hero p")!.remove();
    expect(resolveAnchor(next, element).status).toBe("orphan");
    expect(resolveAnchor(next, text).status).toBe("orphan");
    const rewritten = parse("<main><h1>새 내용</h1><button>새 버튼</button></main>");
    expect(resolveAnchor(rewritten, element).status).toBe("orphan");
    expect(resolveAnchor(rewritten, text).status).toBe("orphan");
  });
  it("같은 글이 둘이면 문맥으로 가르거나 고아로 둔다", () => {
    const old = parse("<p>앞 문맥 선택한 글 뒤 문맥</p>"); const p = old.querySelector("p")!;
    const range = old.createRange(); range.setStart(p.firstChild!, 5); range.setEnd(p.firstChild!, 10);
    const anchor = createAnchor(p, range);
    const next = parse("<p>다른 곳 선택한 글 끝</p><p>앞 문맥 선택한 글 뒤 문맥</p>");
    const result = resolveAnchor(next, anchor);
    expect(result.status).toBe("exact");
    expect(result.element).toBe(next.querySelectorAll("p")[1]);
  });
  it("글 없는 이미지는 src를 비교하고 식별자가 없는 빈 div는 고아로 둔다", () => {
    const old = parse('<main><img src="data:image/png;base64,YQ=="><div></div></main>');
    const image = createAnchor(old.querySelector("img")!); const blank = createAnchor(old.querySelector("div")!);
    const next = parse('<main><section><img src="data:image/png;base64,YQ=="></section><section><div></div></section></main>');
    expect(resolveAnchor(next, image).element).toBe(next.querySelector("img"));
    expect(resolveAnchor(next, blank).status).toBe("orphan");
    expect(resolveAnchor(old, blank, true).element).toBe(old.querySelector("div"));
  });
});
