import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentLayout } from "../blocks/html-document/layout";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("두 경계는 화살표로 이웃 칸의 크기를 바꾸고 최소 폭을 지킨다", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains("ks-html-content") ? 1000 : 256;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 500, width, height: 500, toJSON() {} };
  });
  const { container } = render(<DocumentLayout selecting compact={false} face="comments" locked={false} left="속성" document="불러오는 중" right="커멘트" />);
  const left = container.querySelector<HTMLElement>(".is-properties")!;
  const right = container.querySelector<HTMLElement>(".is-comments")!;
  fireEvent.keyDown(screen.getByRole("separator", { name: "속성과 문서 사이 크기 조절" }), { key: "ArrowRight" });
  fireEvent.keyDown(screen.getByRole("separator", { name: "문서와 커멘트 사이 크기 조절" }), { key: "ArrowLeft" });
  expect(left.style.flexBasis).toBe("264px");
  expect(right.style.flexBasis).toBe("264px");
  expect(screen.getByText("불러오는 중").className).toBe("ks-html-document");
});

it("보기, 고르기와 좁은 창 전환에서도 문서 프레임을 유지한다", () => {
  const layout = (selecting: boolean, compact: boolean) => <DocumentLayout selecting={selecting} compact={compact} face="comments" locked={false} left="속성" document={<iframe title="문서" srcDoc="<p>내용</p>" />} right="커멘트" />;
  const { rerender } = render(layout(false, false));
  const frame = screen.getByTitle("문서");
  rerender(layout(true, false));
  expect(screen.getByTitle("문서")).toBe(frame);
  expect(screen.getByText("속성")).toBeTruthy();
  expect(screen.getByText("커멘트")).toBeTruthy();
  rerender(layout(true, true));
  expect(screen.getByTitle("문서")).toBe(frame);
  rerender(layout(false, true));
  expect(screen.getByTitle("문서")).toBe(frame);
});


it("경계 조절 상한과 하한을 지키고 창 축소 뒤 문서 360을 확보한다", () => {
  let total = 1200;
  let notifyWidth = (_width: number) => {};
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { notifyWidth = (width) => this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains("ks-html-content") ? total : Number.parseFloat(this.style.flexBasis) || 256;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 500, width, height: 500, toJSON() {} };
  });
  const layout = (width: number) => <DocumentLayout selecting compact={width < 842} face="comments" locked={false} left="속성" document="문서" right="커멘트" />;
  const { container, rerender } = render(layout(total));
  act(() => notifyWidth(total));
  const left = container.querySelector<HTMLElement>(".is-properties")!;
  const right = container.querySelector<HTMLElement>(".is-comments")!;
  const leftHandle = screen.getByRole("separator", { name: "속성과 문서 사이 크기 조절" });
  for (let i = 0; i < 100; i++) fireEvent.keyDown(leftHandle, { key: "ArrowLeft" });
  expect(Number.parseFloat(left.style.flexBasis)).toBe(240);
  for (let i = 0; i < 100; i++) fireEvent.keyDown(leftHandle, { key: "ArrowRight" });
  expect(Number.parseFloat(left.style.flexBasis)).toBe(582);
  total = 880; act(() => notifyWidth(total)); rerender(layout(total));
  const l = Number.parseFloat(left.style.flexBasis), r = Number.parseFloat(right.style.flexBasis);
  expect(l).toBeGreaterThanOrEqual(240); expect(r).toBeGreaterThanOrEqual(240);
  expect(total - l - r - 2).toBeGreaterThanOrEqual(360);
  rerender(layout(842)); expect(screen.getAllByRole("separator")).toHaveLength(2);
  rerender(layout(841)); expect(screen.queryByRole("separator")).toBeNull();
});

it("끌기 중 포인터 캡처를 잃거나 손잡이가 사라지면 이후 이동을 무시한다", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 500, width: 1200, height: 500, toJSON() {} });
  const layout = (compact: boolean) => <DocumentLayout selecting compact={compact} face="comments" locked={false} left="속성" document="문서" right="커멘트" />;
  const { container, rerender } = render(layout(false));
  const left = container.querySelector<HTMLElement>(".is-properties")!;
  let handle = screen.getByRole("separator", { name: "속성과 문서 사이 크기 조절" });
  fireEvent.pointerDown(handle, { button: 0, buttons: 1, clientX: 10 });
  fireEvent.lostPointerCapture(handle);
  fireEvent.pointerMove(handle, { buttons: 1, clientX: 110 });
  expect(Number.parseFloat(left.style.flexBasis)).toBe(256);
  fireEvent.pointerDown(handle, { button: 0, buttons: 1, clientX: 10 });
  rerender(layout(true)); rerender(layout(false));
  handle = screen.getByRole("separator", { name: "속성과 문서 사이 크기 조절" });
  fireEvent.pointerMove(handle, { buttons: 1, clientX: 110 });
  expect(Number.parseFloat(left.style.flexBasis)).toBe(256);
  vi.unstubAllGlobals();
});
