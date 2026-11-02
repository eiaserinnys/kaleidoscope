import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Button } from "../components/primitives";
import { Select } from "../components/select-toggle";

afterEach(cleanup);

it("공용 버튼의 제목과 선택 상자의 앞뒤 내용을 표시한다", () => {
  render(<><Button title="되돌리기 Ctrl+Z">되돌리기</Button><Select label="그림자" value="small" onChange={vi.fn()} groups={[{ options: [{ value: "small", label: "작게" }] }]} className="ks-html-prop" prefix={<span>그림자</span>} suffix="단위" /></>);
  expect(screen.getByRole("button", { name: "되돌리기" }).getAttribute("title")).toBe("되돌리기 Ctrl+Z");
  const select = screen.getByRole("button", { name: "그림자" });
  expect(select.classList.contains("ks-html-prop")).toBe(true);
  expect(select.textContent).toContain("그림자");
  expect(select.textContent).toContain("단위");
});
