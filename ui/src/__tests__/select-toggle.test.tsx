import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Select, type SelectGroup } from "../components/select-toggle";

afterEach(cleanup);

const placeGroups = (): SelectGroup[] => [
  { name: "가까운 곳", options: [{ value: "seoul", label: "서울" }, { value: "busan", label: "부산" }] },
  { name: "먼 곳", options: [{ value: "tokyo", label: "도쿄" }, { value: "seoul-far", label: "서울" }] },
];

it("고른 값의 이름이 다른 묶음에도 있으면 값 옆에 묶음 이름을 보인다", () => {
  render(<Select label="장소" value="seoul-far" onChange={vi.fn()} groups={placeGroups()} />);
  const button = screen.getByRole("button", { name: "장소" });
  expect(button.textContent).toContain("서울");
  expect(button.textContent).toContain("먼 곳");
});

it("고른 값의 이름이 다른 묶음에 없으면 묶음 이름을 보이지 않는다", () => {
  render(<Select label="장소" value="busan" onChange={vi.fn()} groups={placeGroups()} />);
  const button = screen.getByRole("button", { name: "장소" });
  expect(button.textContent).toContain("부산");
  expect(button.textContent).not.toContain("가까운 곳");
});

it("같은 묶음 안에서만 이름이 겹치면 묶음 이름을 보이지 않는다", () => {
  render(<Select label="장소" value="a" onChange={vi.fn()} groups={[{ name: "가까운 곳", options: [{ value: "a", label: "서울" }, { value: "b", label: "서울" }] }]} />);
  const button = screen.getByRole("button", { name: "장소" });
  expect(button.textContent).toContain("서울");
  expect(button.textContent).not.toContain("가까운 곳");
});
