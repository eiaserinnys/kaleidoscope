import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { describeNumbered, forgetNumbered, resolveNumbered } from "../share/numbered";
import { registerOverlay } from "../share/overlay-owner";

const rect = { left: 0, top: 0, right: 100, bottom: 100, x: 0, y: 0, width: 100, height: 100, toJSON() {} };
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(document, "createRange").mockImplementation(() => ({ setStart() {}, setEnd() {}, getClientRects: () => [rect] }) as unknown as Range);
});
afterEach(() => { forgetNumbered("one"); forgetNumbered("two"); document.body.replaceChildren(); vi.restoreAllMocks(); });

it("창 내용의 조작 요소에 안정적인 번호를 주고 재사용된 행은 새 번호를 준다", () => {
  document.body.innerHTML = '<div data-window-id="one"><button id="frame">닫기</button><main id="root"><button>저장</button><input aria-label="제목"><button role="tab">탭</button><div role="row" aria-selected="false" data-row-key="a">행</div><input type="checkbox" aria-label="선택"><select aria-label="고르기"><option>하나</option></select></main></div>';
  const root = document.querySelector<HTMLElement>("#root")!;
  const first = describeNumbered("one", root);
  expect(first.text).toContain("단추 저장");
  expect(first.text).toContain("입력칸 제목");
  expect(first.text).not.toContain("닫기");
  const buttons = [...root.querySelectorAll<HTMLElement>("button, input, [role=row], select")];
  const numbers = buttons.map((element) => Number(first.text.match(new RegExp(`\\[(\\d+)\\] [^\\n]*${element.getAttribute("aria-label") || element.textContent}`))?.[1]));
  expect(numbers.every(Number.isFinite)).toBe(true);
  root.prepend(document.createElement("button"));
  buttons[3].setAttribute("aria-rowindex", "2");
  const second = describeNumbered("one", root);
  expect(resolveNumbered("one", numbers[0])).toEqual({ element: buttons[0] });
  expect(second.text).toContain(`[${numbers[0]}] 단추 저장`);
  buttons[3].setAttribute("data-row-key", "b");
  describeNumbered("one", root);
  expect(resolveNumbered("one", numbers[3])).toEqual({ reason: "stale" });
  buttons[0].remove();
  expect(resolveNumbered("one", numbers[0])).toEqual({ reason: "stale" });
});

it("같은 창의 오버레이만 읽고 허용 화면을 제외하며 이전 번호의 상태를 다시 판정한다", () => {
  document.body.innerHTML = '<main id="one"><button>안전</button><input type="password" aria-label="비밀번호" value="secret"></main><main id="two"></main><div id="menu1"><button>내 메뉴</button></div><div id="menu2"><button>다른 메뉴</button></div>';
  const root = document.querySelector<HTMLElement>("#one")!;
  const button = root.querySelector("button")!;
  registerOverlay(document.querySelector("#menu1")!, "one");
  registerOverlay(document.querySelector("#menu2")!, "two");
  const view = describeNumbered("one", root);
  expect(view.text).toContain("내 메뉴");
  expect(view.text).not.toContain("다른 메뉴");
  expect(view.text).not.toContain("secret");
  const number = Number(view.text.match(/\[(\d+)\] 단추 안전/)?.[1]);
  button.setAttribute("data-ks-user-consent", "");
  expect(resolveNumbered("one", number)).toEqual({ reason: "consent" });
  expect(describeNumbered("one", root).text).not.toContain("단추 안전");
});

it("현재 번호의 숨김, 비활성, 읽기 전용 상태를 재검사한다", () => {
  document.body.innerHTML = '<main id="root"><button disabled>닫기</button><input readonly aria-label="문서"><button>숨김</button></main>';
  const root = document.querySelector<HTMLElement>("#root")!;
  const view = describeNumbered("one", root);
  const number = (label: string) => Number(view.text.match(new RegExp(`\\[(\\d+)\\] [^\\n]*${label}`))?.[1]);
  expect(view.text).toContain("닫기 (비활성)");
  expect(resolveNumbered("one", number("닫기"))).toEqual({ reason: "disabled" });
  expect(resolveNumbered("one", number("문서"), true)).toEqual({ reason: "readonly" });
  root.lastElementChild!.setAttribute("hidden", "");
  expect(resolveNumbered("one", number("숨김"))).toEqual({ reason: "hidden" });
});

it("트리의 위치가 바뀌어도 같은 행 키의 번호는 유지한다", () => {
  document.body.innerHTML = '<main id="root"><div data-tree-row="문서"><button role="treeitem" aria-posinset="1">문서</button></div></main>';
  const root = document.querySelector<HTMLElement>("#root")!;
  const row = root.querySelector("button")!;
  const first = describeNumbered("one", root);
  const number = Number(first.text.match(/\[(\d+)\] 트리 항목 문서/)?.[1]);
  row.setAttribute("aria-posinset", "2");
  const second = describeNumbered("one", root);
  expect(second.text).toContain(`[${number}] 트리 항목 문서`);
  expect(resolveNumbered("one", number)).toEqual({ element: row });
});

it("최소화 창의 inert만 우회하고 실제 모달이 막은 내용은 숨긴다", () => {
  document.body.innerHTML = '<section data-minimized="true" inert><main id="root"><button>보이는 조작</button><div inert><button>모달 뒤</button></div></main></section>';
  const root = document.querySelector<HTMLElement>("#root")!;
  const view = describeNumbered("one", root);
  expect(view.text).toContain("보이는 조작");
  expect(view.text).not.toContain("모달 뒤");
  const number = Number(view.text.match(/\[(\d+)\] 단추 보이는 조작/)?.[1]);
  expect(resolveNumbered("one", number)).toEqual({ element: root.querySelector("button") });
});
