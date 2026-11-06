import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ButtonBlock } from "../blocks/data-input";

const runtime = vi.hoisted(() => ({ act: vi.fn().mockResolvedValue(true) }));
vi.mock("../data/window-data", () => ({
  useWindowData: () => runtime,
  useBinding: (_pointer: string, binding: unknown) => ({ status: "ready", value: binding }),
}));
vi.mock("../data/window-state", async (importOriginal) => ({ ...(await importOriginal<typeof import("../data/window-state")>()), useWindowVisible: () => true }));
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

  expect(screen.getByRole("status").textContent).toBe("");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "링크 복사" })); });
  expect(runtime.act).toHaveBeenCalledWith("/button/on_click", null, undefined, { shift: false, alt: false, ctrl: false, meta: false });
  expect(screen.getByRole("button", { name: "링크 복사" }).textContent).toBe("링크 복사");
  expect(screen.getByRole("button", { name: "링크 복사" }).querySelector("[data-icon-name]")?.getAttribute("data-icon-name")).toBe("check");
  expect(screen.getByRole("status").textContent).toBe("복사했습니다");

  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(screen.getByRole("button", { name: "링크 복사" }).querySelector("[data-icon-name]")?.getAttribute("data-icon-name")).toBe("copy");
  expect(screen.getByRole("status").textContent).toBe("");
});

it("줄 단추는 복사 성공 동안 줄에 표시를 붙인다", async () => {
  vi.useFakeTimers();
  render(<ButtonBlock block={{ type: "button", label: "결과", icon: "copy", variant: "row", on_click: { copy_text: "값" } } as never} context={{} as never} pointer="/button" />);
  const button = screen.getByRole("button", { name: "결과" });
  expect(button.closest(".ks-data-button")?.classList.contains("is-row")).toBe(true);
  await act(async () => { fireEvent.click(button); });
  expect(button.closest(".ks-data-button")?.classList.contains("is-copied")).toBe(true);
  expect(button.querySelector("[data-icon-name]")?.getAttribute("data-icon-name")).toBe("check");
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(button.closest(".ks-data-button")?.classList.contains("is-copied")).toBe(false);
});
