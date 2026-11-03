import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ButtonBlock } from "../blocks/data-input";

const runtime = vi.hoisted(() => ({ act: vi.fn().mockResolvedValue(true) }));
vi.mock("../data/window-data", () => ({
  useWindowData: () => runtime,
  useBinding: (_pointer: string, binding: unknown) => ({ status: "ready", value: binding }),
}));
vi.mock("../components/data-icons", () => ({
  DataIcon: ({ name }: { name: string }) => <svg data-icon-name={name} />,
}));

afterEach(() => { cleanup(); runtime.act.mockReset().mockResolvedValue(true); vi.useRealTimers(); });

it("성공한 아이콘 복사 단추는 1.5초 동안 확인 아이콘과 읽기 알림을 보인다", async () => {
  vi.useFakeTimers();
  const button = {
    type: "button", label: "링크 복사", icon: "copy",
    on_click: { copy_text: { expr: "$state.target" } },
  };
  render(<ButtonBlock block={button as never} context={{} as never} pointer="/button" />);

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "링크 복사" })); });
  expect(runtime.act).toHaveBeenCalledWith("/button/on_click", null, undefined, { shift: false, alt: false, ctrl: false, meta: false });
  expect(screen.getByRole("button", { name: "링크 복사" }).textContent).toBe("링크 복사");
  expect(screen.getByRole("button", { name: "링크 복사" }).querySelector("[data-icon-name]")?.getAttribute("data-icon-name")).toBe("check");
  expect(screen.getByRole("status").textContent).toBe("복사했습니다");

  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(screen.getByRole("button", { name: "링크 복사" }).querySelector("[data-icon-name]")?.getAttribute("data-icon-name")).toBe("copy");
});

it("아이콘이 없는 글 단추와 실패한 동작에는 복사 피드백을 보이지 않는다", async () => {
  runtime.act.mockResolvedValue(false);
  const button = { type: "button", label: "복사", on_click: { copy_text: "텍스트" } };
  render(<ButtonBlock block={button as never} context={{} as never} pointer="/button" />);

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "복사" })); });
  expect(screen.getByRole("button", { name: "복사" }).querySelector("svg")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});
