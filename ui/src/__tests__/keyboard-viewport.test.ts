import { describe, expect, it, vi } from "vitest";
import { installKeyboardScrollRestore, restoreDocumentScroll } from "../../../app/src/shell/keyboard-viewport";

function fakeWindow(options: { scrollTop?: number; scrollY?: number; viewportHeight?: number } = {}) {
  const listeners = new Map<string, () => void>();
  const root = { scrollTop: options.scrollTop ?? 0, scrollLeft: 0 };
  const body = { scrollTop: 0, scrollLeft: 0 };
  let active: unknown = null;
  const viewport = {
    height: options.viewportHeight ?? 768,
    addEventListener: (type: string, listener: () => void) => { listeners.set(`viewport:${type}`, listener); },
    removeEventListener: (type: string) => { listeners.delete(`viewport:${type}`); },
  };
  const scrollTo = vi.fn();
  const view = {
    document: {
      scrollingElement: root,
      documentElement: root,
      body,
      get activeElement() { return active; },
      addEventListener: (type: string, listener: () => void) => { listeners.set(type, listener); },
      removeEventListener: (type: string) => { listeners.delete(type); },
    },
    innerHeight: 768,
    scrollX: 0,
    scrollY: options.scrollY ?? 0,
    scrollTo,
    visualViewport: viewport,
    requestAnimationFrame: (callback: () => void) => { callback(); return 0; },
    cancelAnimationFrame: vi.fn(),
  };
  return {
    view: view as unknown as Window,
    listeners,
    root,
    body,
    scrollTo,
    setActive: (value: unknown) => { active = value; },
  };
}

describe("가상 키보드가 닫힌 뒤", () => {
  it("초점이 남은 곳이 없으면 문서 스크롤을 0으로 되돌린다", () => {
    const { view, listeners, root, scrollTo } = fakeWindow({ scrollTop: 84, scrollY: 84 });
    const dispose = installKeyboardScrollRestore(view);
    listeners.get("focusout")?.();
    expect(root.scrollTop).toBe(0);
    expect(root.scrollLeft).toBe(0);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    dispose();
  });

  it("입력칸 사이를 옮겨 간 것이면 스크롤을 건드리지 않는다", () => {
    const { view, listeners, root, setActive } = fakeWindow({ scrollTop: 84 });
    const dispose = installKeyboardScrollRestore(view);
    setActive({ tagName: "INPUT" });
    listeners.get("focusout")?.();
    expect(root.scrollTop).toBe(84);
    dispose();
  });

  it("보이는 높이가 레이아웃 높이로 돌아오면 되돌린다", () => {
    const { view, listeners, root, scrollTo } = fakeWindow({ scrollTop: 84, scrollY: 84 });
    const dispose = installKeyboardScrollRestore(view);
    listeners.get("viewport:resize")?.();
    expect(root.scrollTop).toBe(0);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    dispose();
  });

  it("키보드가 올라와 보이는 높이가 줄어 있으면 그대로 둔다", () => {
    const { view, listeners, root } = fakeWindow({ scrollTop: 84, viewportHeight: 420 });
    const dispose = installKeyboardScrollRestore(view);
    listeners.get("viewport:resize")?.();
    expect(root.scrollTop).toBe(84);
    dispose();
  });

  it("감시를 풀면 focusout에 더 반응하지 않는다", () => {
    const { view, listeners, root } = fakeWindow({ scrollTop: 84 });
    const dispose = installKeyboardScrollRestore(view);
    dispose();
    expect(listeners.has("focusout")).toBe(false);
    expect(root.scrollTop).toBe(84);
  });
});

describe("restoreDocumentScroll", () => {
  it("이미 0이면 scrollTo를 부르지 않는다", () => {
    const { view, scrollTo } = fakeWindow();
    restoreDocumentScroll(view);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
