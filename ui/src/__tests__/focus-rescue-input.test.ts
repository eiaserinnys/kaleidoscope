import { afterEach, describe, expect, it, vi } from "vitest";
import { focusRescued } from "../components/focus-rescue";

// 쉘이 대신 옮기는 초점은 마지막 입력 방식을 따른다. 키보드를 쓰지 않았는데 링이 보이면
// 창을 열자마자 첫 행이나 첫 단추가 골라진 것처럼 보인다.
describe("focusRescued 초점 링", () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

  it("입력이 없으면 링을 그리지 않고, 문자 키와 포인터를 따라간다", () => {
    const first = document.createElement("button");
    const second = document.createElement("input");
    document.body.append(first, second);
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    // (a) 아직 아무 입력이 없으면 링을 그리지 않는다.
    focusRescued(first, { preventScroll: true });
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true, focusVisible: false });

    // (d) 수식 키만 누른 것은 입력 방식이 아니다.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
    focusRescued(second);
    expect(focus).toHaveBeenLastCalledWith({ focusVisible: false });

    // (b) 문자 키 뒤에는 링을 그린다.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    focusRescued(second, { preventScroll: true });
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true, focusVisible: true });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
    focusRescued(first);
    expect(focus).toHaveBeenLastCalledWith({ focusVisible: true });

    // (c) 포인터를 쓰면 다시 링을 그리지 않는다.
    document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    focusRescued(first);
    expect(focus).toHaveBeenLastCalledWith({ focusVisible: false });
  });

  it("부르는 쪽이 focusVisible을 정하면 그 값을 따른다", () => {
    const element = document.createElement("button");
    document.body.append(element);
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    focusRescued(element, { focusVisible: true });
    expect(focus).toHaveBeenLastCalledWith({ focusVisible: true });
  });
});
