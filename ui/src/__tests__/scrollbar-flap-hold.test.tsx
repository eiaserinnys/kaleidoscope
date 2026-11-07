import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useScrollbarFlapHold } from "../blocks/data-view-common";

type Entry = { callback: ResizeObserverCallback };
let observers: Entry[] = [];
class FakeResizeObserver {
  private readonly entry: Entry;
  constructor(callback: ResizeObserverCallback) { this.entry = { callback }; observers.push(this.entry); }
  observe() {}
  unobserve() {}
  disconnect() { observers = observers.filter((entry) => entry !== this.entry); }
}
// 실제 크기 변화 없이 콜백만 돌려 브라우저의 재관측을 흉내 낸다.
function notified() { for (const entry of [...observers]) entry.callback([], entry as unknown as ResizeObserver); }
function measured(element: HTMLElement) {
  const size = { width: 500, height: 400, client: 500 };
  Object.defineProperties(element, {
    offsetWidth: { configurable: true, get: () => size.width },
    offsetHeight: { configurable: true, get: () => size.height },
    clientWidth: { configurable: true, get: () => size.client },
  });
  return size;
}
function Harness({ marker }: { marker: number }) {
  const scroll = useRef<HTMLDivElement>(null);
  useScrollbarFlapHold(scroll, true, marker);
  return <div ref={scroll} />;
}
function mount(marker = 1) {
  const view = render(<Harness marker={marker} />);
  const element = view.container.firstElementChild as HTMLElement;
  const size = measured(element);
  act(() => notified());
  return { view, element, size };
}
function flip(size: { client: number }, element: HTMLElement, client: number) {
  size.client = client;
  act(() => notified());
  return element.style.overflowY;
}
beforeEach(() => { observers = []; vi.stubGlobal("ResizeObserver", FakeResizeObserver); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("세 번째 왕복에서 스크롤 막대를 고정한다", () => {
  const { element, size } = mount();
  expect(flip(size, element, 492)).toBe("");
  expect(flip(size, element, 500)).toBe("");
  expect(flip(size, element, 492)).toBe("scroll");
});

it("바깥 크기가 바뀌면 고정을 풀고 왕복 횟수를 다시 센다", () => {
  const { element, size } = mount();
  flip(size, element, 492);
  flip(size, element, 500);
  expect(flip(size, element, 492)).toBe("scroll");
  size.width = 520;
  size.client = 520;
  act(() => notified());
  expect(element.style.overflowY).toBe("");
  expect(flip(size, element, 512)).toBe("");
  expect(flip(size, element, 520)).toBe("");
  expect(flip(size, element, 512)).toBe("scroll");
});

it("내용 표지가 바뀌면 고정을 푼다", () => {
  const { view, element, size } = mount();
  flip(size, element, 492);
  flip(size, element, 500);
  expect(flip(size, element, 492)).toBe("scroll");
  view.rerender(<Harness marker={2} />);
  expect(element.style.overflowY).toBe("");
  expect(flip(size, element, 500)).toBe("");
  expect(flip(size, element, 492)).toBe("");
});

it("느린 간격의 왕복은 막대를 고정하지 않는다", () => {
  let now = 10_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const { element, size } = mount();
  for (let round = 0; round < 6; round += 1) {
    expect(flip(size, element, round % 2 === 0 ? 492 : 500)).toBe("");
    now += 1_000;
  }
});
