import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NoticeBlock } from "../blocks/data-notice";
import { Notice } from "../components/primitives";

const runtime = vi.hoisted(() => ({ act: vi.fn().mockResolvedValue(true), values: {} as Record<string, unknown>, windowId: "w", setNotice: vi.fn(), store: { call: vi.fn().mockResolvedValue({}) } }));
vi.mock("../data/window-data", () => ({
  useWindowData: () => runtime,
  useOptionalWindowData: () => runtime,
  useBinding: (_pointer: string, binding: unknown) => ({ status: "ready", value: binding && typeof binding === "object" && "client" in binding ? runtime.values[(binding as { client: string }).client] : binding }),
}));
afterEach(() => { cleanup(); runtime.act.mockClear(); runtime.values = {}; runtime.store.call.mockClear(); runtime.setNotice.mockClear(); });

it("notice 오류는 공용 코드 표시와 선택 동작을 제공한다", () => {
  const block = { type: "notice", kind: "error", message: "폴더를 고르지 않았습니다.", error_id: "FILE_ACCESS_FOLDER_NOT_CHOSEN", actions: [{ label: "다시 시도", on_click: { set_state: "retry" } }] };
  render(<NoticeBlock block={block as never} pointer="/notice" />);
  expect(screen.getByRole("alert").textContent).toContain("폴더를 고르지 않았습니다.");
  expect(screen.getByText("FILE_ACCESS_FOLDER_NOT_CHOSEN").tagName).toBe("CODE");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(runtime.act).toHaveBeenCalledWith("/notice/actions/0/on_click", null);
});

it("loading notice는 글 없이 공용 스켈레톤을 표시한다", () => {
  const block = { type: "notice", kind: "loading", message: "", actions: [] };
  const { container } = render(<NoticeBlock block={block as never} pointer="/notice" />);
  expect(screen.getByRole("status", { name: "불러오는 중" })).toBeTruthy();
  expect(container.querySelectorAll(".ks-data-skeleton > i")).toHaveLength(3);
  expect(container.querySelector(".ks-notice")).toBeNull();
});

it("알림 글 속 주소를 링크로 그린다", () => {
  const block = { type: "notice", kind: "error", message: "받지 못했습니다. https://example.com/app 에서 다시 받으세요.", actions: [] };
  render(<NoticeBlock block={block as never} pointer="/notice" />);
  const link = screen.getByRole("link", { name: "https://example.com/app" });
  expect(link.getAttribute("href")).toBe("https://example.com/app");
});

it("공용 알림은 글자 메시지 속 주소를 링크로 그린다", () => {
  render(<Notice>받지 못했습니다. https://example.com/app</Notice>);
  expect(screen.getByRole("link", { name: "https://example.com/app" })).toBeTruthy();
});
