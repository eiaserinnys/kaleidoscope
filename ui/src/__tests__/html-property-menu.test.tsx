import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { PropertyFace } from "../blocks/html-document/properties";

afterEach(cleanup);

it("색 견본을 연 다음 그림자 메뉴를 고를 수 있다", async () => {
  const model = {
    selection: {
      n: 1, name: "button", ancestors: [], hasChildren: false, text: "시작", first: true, last: true,
      anchor: { kind: "element", tag: "button", label: "button" }, colors: ["rgb(51, 68, 85)"],
      styles: { display: "block", "border-style": "none", "border-width": "0px", "box-shadow": "none", opacity: "1" },
    },
    propertyGroups: {}, setPropertyGroups: vi.fn(), send: vi.fn(), keyAction: vi.fn(),
    editStyle: vi.fn(), previewStyle: vi.fn(), editText: vi.fn(),
  } as unknown as ComponentProps<typeof PropertyFace>["model"];
  const user = userEvent.setup();
  render(<PropertyFace model={model} />);
  await user.click(screen.getByRole("textbox", { name: "테두리" }));
  expect(screen.getByRole("button", { name: "#334455" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "그림자" }));
  await user.click(await screen.findByRole("menuitem", { name: "보통" }));
  expect(model.editStyle).toHaveBeenCalledWith("box-shadow", "0 4px 12px rgb(0 0 0 / 16%)");
});

it("방향별로 다른 두께와 모서리는 혼합으로 표시하고 입력한 값을 전체에 적용한다", async () => {
  const model = {
    selection: {
      n: 1, name: "header", ancestors: [], hasChildren: true, text: "", first: true, last: true,
      anchor: { kind: "element", tag: "header", label: "header" }, colors: [],
      styles: { display: "block", "border-style": "none none solid", "border-width": "0px 0px 1px", "border-radius": "4px 8px", "box-shadow": "none", opacity: "1" },
    },
    propertyGroups: {}, setPropertyGroups: vi.fn(), send: vi.fn(), keyAction: vi.fn(),
    editStyle: vi.fn(), previewStyle: vi.fn(), editText: vi.fn(),
  } as unknown as ComponentProps<typeof PropertyFace>["model"];
  const user = userEvent.setup();
  render(<PropertyFace model={model} />);
  const width = screen.getByRole("textbox", { name: "두께" }) as HTMLInputElement;
  const radius = screen.getByRole("textbox", { name: "모서리" }) as HTMLInputElement;
  expect(width.value).toBe("혼합");
  expect(radius.value).toBe("혼합");
  await user.clear(width); await user.type(width, "2{Enter}");
  expect(model.editStyle).toHaveBeenCalledWith("border-width", "2px");
  await user.clear(radius); await user.type(radius, "6{Enter}");
  expect(model.editStyle).toHaveBeenCalledWith("border-radius", "6px");
});
