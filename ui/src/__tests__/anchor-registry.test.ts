import { describe, expect, it } from "vitest";
import { getAnchorElement, removeAnchorElement, setAnchorElement } from "../blocks/anchor-registry";

describe("anchor registry", () => {
  it("새 분기 표적이 등록된 뒤 옛 분기 정리가 와도 새 표적을 유지한다", () => {
    const windowId = "anchor-branch-switch";
    const id = "responsive-stage";
    const oldElement = document.createElement("div");
    const currentElement = document.createElement("div");

    setAnchorElement(windowId, id, oldElement);
    setAnchorElement(windowId, id, currentElement);
    removeAnchorElement(windowId, id, oldElement);

    expect(getAnchorElement(windowId, id)).toBe(currentElement);

    removeAnchorElement(windowId, id, currentElement);
    expect(getAnchorElement(windowId, id)).toBeNull();
  });
});
