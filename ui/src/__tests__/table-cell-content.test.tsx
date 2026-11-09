import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { Column } from "../contract/contract";
import { ContentCell } from "../blocks/data-table-cell";

afterEach(cleanup);

const column = { field: "info", label: "설명", format: "content", max_lines: 2 } as Column;

it("muted가 참인 칸은 제목을 덜 띄게 하는 클래스를 붙인다", () => {
  const { container } = render(<ContentCell value={{ title: "자료 없음", muted: true }} column={column} />);
  expect(container.querySelector(".ks-table-content.is-muted")).toBeTruthy();
});

it("muted가 없거나 거짓이면 클래스를 붙이지 않는다", () => {
  const { container } = render(<>
    <ContentCell value={{ title: "한 줄" }} column={column} />
    <ContentCell value={{ title: "두 줄", muted: false }} column={column} />
  </>);
  expect(container.querySelector(".is-muted")).toBeNull();
});

it("muted가 참/거짓이 아니면 칸 내용 오류로 그린다", () => {
  const { container } = render(<ContentCell value={{ title: "자료 없음", muted: "yes" }} column={column} />);
  expect(container.querySelector(".ks-table-content.is-error")).toBeTruthy();
  expect(screen.getByText("SHELL_TABLE_CELL_CONTENT_INVALID")).toBeTruthy();
});
