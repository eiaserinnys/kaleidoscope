import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LinkedText } from "../components/external-link";

const runtime = vi.hoisted(() => ({ store: { call: vi.fn().mockResolvedValue({}) }, windowId: "w", setNotice: vi.fn() }));
vi.mock("../data/window-data", () => ({ useOptionalWindowData: () => runtime }));
afterEach(() => { cleanup(); runtime.store.call.mockClear(); runtime.setNotice.mockClear(); });

it("주소를 링크로 그리고 뒤따르는 문장부호와 한글은 링크 밖에 둔다", () => {
  const { container } = render(<LinkedText text="받지 못했습니다. https://example.com/app, 다시 받으세요." />);
  const link = screen.getByRole("link", { name: "https://example.com/app" });
  expect(link.getAttribute("href")).toBe("https://example.com/app");
  expect(container.textContent).toBe("받지 못했습니다. https://example.com/app, 다시 받으세요.");
});

it("주소를 누르면 external.open을 부른다", () => {
  render(<LinkedText text="https://example.com/app 에서 받으세요." />);
  const link = screen.getByRole("link", { name: "https://example.com/app" });
  fireEvent.click(link);
  expect(runtime.store.call).toHaveBeenCalledWith({ op: "external.open", window_id: "w", url: "https://example.com/app" });
});

it("결과를 루트 요소 하나로 감싸 글 조각이 flex 항목으로 갈라지지 않는다", () => {
  const text = "받지 못했습니다. https://example.com/app. 다시 받으세요.";
  const { container } = render(<LinkedText text={text} />);
  expect(container.children).toHaveLength(1);
  expect(container.firstElementChild?.tagName).toBe("SPAN");
  expect(container.textContent).toBe(text);
});

it("주소가 없는 글은 그대로 그린다", () => {
  const { container } = render(<LinkedText text="주소가 없는 알림입니다." />);
  expect(container.querySelector("a")).toBeNull();
  expect(container.textContent).toBe("주소가 없는 알림입니다.");
});
