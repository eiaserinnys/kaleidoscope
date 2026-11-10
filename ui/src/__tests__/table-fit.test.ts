import { expect, it, vi } from "vitest";
import { fitTable, watchTableFit } from "../blocks/table-fit";

function size(element: HTMLElement, values: { offsetWidth?: number; clientWidth?: number }) {
  if (values.offsetWidth !== undefined) Object.defineProperty(element, "offsetWidth", { configurable: true, value: values.offsetWidth });
  if (values.clientWidth !== undefined) Object.defineProperty(element, "clientWidth", { configurable: true, value: values.clientWidth });
}

it("표가 감싼 폭보다 넓을 때만 is-tight를 붙이고, probe 폭이 바뀔 때만 다시 맞추며, 멈추면 관찰을 끊는다", () => {
  const wrap = document.createElement("div");
  const table = document.createElement("table");
  const probe = document.createElement("div");
  size(wrap, { clientWidth: 400 });
  size(table, { offsetWidth: 400 });

  // jsdom에는 ResizeObserver가 없다. 관찰 없이 끝난다.
  const noop = watchTableFit(wrap, probe, table);
  noop();
  expect(wrap.classList.contains("is-tight")).toBe(false);

  fitTable(wrap, table);
  expect(wrap.classList.contains("is-tight")).toBe(false);
  size(table, { offsetWidth: 520 });
  fitTable(wrap, table);
  expect(wrap.classList.contains("is-tight")).toBe(true);
  size(table, { offsetWidth: 400 });
  fitTable(wrap, table);
  expect(wrap.classList.contains("is-tight")).toBe(false);

  // is-tight가 붙은 채로 재면 좁아진 최소 폭이 재져 넓힌 뒤에도 맞는 것으로 잘못 판정한다. 먼저 떼고 잰다.
  Object.defineProperty(table, "offsetWidth", { configurable: true, get: () => (wrap.classList.contains("is-tight") ? 390 : 520) });
  fitTable(wrap, table);
  expect(wrap.classList.contains("is-tight")).toBe(true);
  fitTable(wrap, table);
  expect(wrap.classList.contains("is-tight")).toBe(true);

  const observed: Element[] = [];
  let disconnected = 0;
  let callback: ResizeObserverCallback | undefined;
  class FakeResizeObserver {
    constructor(handler: ResizeObserverCallback) { callback = handler; }
    observe(element: Element) { observed.push(element); }
    disconnect() { disconnected += 1; }
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const stop = watchTableFit(wrap, probe, table);
  expect(observed).toEqual([probe]);
  const notify = (width: number) => callback?.([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);

  size(table, { offsetWidth: 520 });
  notify(400);
  expect(wrap.classList.contains("is-tight")).toBe(true);
  size(table, { offsetWidth: 300 });
  notify(400);
  expect(wrap.classList.contains("is-tight")).toBe(true);
  notify(380);
  expect(wrap.classList.contains("is-tight")).toBe(false);

  stop();
  expect(disconnected).toBe(1);
  vi.unstubAllGlobals();
});
