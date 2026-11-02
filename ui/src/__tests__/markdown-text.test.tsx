import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { MarkdownText } from "../blocks/markdown-text";

it("코드 펜스의 들여쓰기 줄을 보존하고 줄마다 들여쓰기 폭을 지정한다", () => {
  const source = "```text\n    first line long enough to wrap\n        second line\n\t\tthird line\n```";
  const { container } = render(<MarkdownText>{source}</MarkdownText>);
  const pre = container.querySelector("pre")!;
  const lines = [...pre.querySelectorAll(".ks-code-line")];

  expect(lines).toHaveLength(3);
  expect(pre.textContent).toBe("    first line long enough to wrap\n        second line\n\t\tthird line");
  expect(lines.map((line) => (line as HTMLElement).style.getPropertyValue("--ks-code-indent"))).toEqual(["4ch", "8ch", "8ch"]);
});

it("인라인 코드는 줄 span을 만들지 않는다", () => {
  const { container } = render(<MarkdownText>{"inline `code`"}</MarkdownText>);
  expect(container.querySelector(".ks-code-line")).toBeNull();
});
