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

it("들여쓰기와 첫 글자를 묶고 원문의 공백과 유니코드 글자를 보존한다", () => {
  const code = "  first\n\t😀tail\n   \nplain";
  const { container } = render(<MarkdownText>{`\`\`\`text\n${code}\n\`\`\``}</MarkdownText>);
  const pre = container.querySelector("pre")!;
  const lines = [...pre.querySelectorAll(".ks-code-line")];
  expect([...pre.querySelectorAll(".ks-code-indent")].map((span) => span.textContent)).toEqual(["  f", "\t😀"]);
  expect(lines[2].querySelector(".ks-code-indent")).toBeNull();
  expect(lines[3].querySelector(".ks-code-indent")).toBeNull();
  expect(pre.textContent).toBe(code);
});

it("24칸까지 첫 글자를 묶고 25칸부터는 원문 그대로 줄바꿈한다", () => {
  const code = `${" ".repeat(24)}first\n${" ".repeat(25)}second`;
  const { container } = render(<MarkdownText>{`\`\`\`text\n${code}\n\`\`\``}</MarkdownText>);
  const pre = container.querySelector("pre")!;
  const lines = [...pre.querySelectorAll(".ks-code-line")];
  expect(lines[0].querySelector(".ks-code-indent")?.textContent).toBe(`${" ".repeat(24)}f`);
  expect(lines[1].querySelector(".ks-code-indent")).toBeNull();
  expect(pre.textContent).toBe(code);
});

it("표는 맞춤 관찰용 감싼 div와 크기 probe를 두고, probe는 보조기기에서 숨긴다", () => {
  const { container } = render(<MarkdownText>{"| 항목 | 상태 |\n| --- | --- |\n| 공지 | 열림 |"}</MarkdownText>);
  const wrap = container.querySelector(".ks-markdown-text > .ks-table-fit");
  expect(wrap).toBeTruthy();
  expect(wrap!.querySelector(":scope > table")).toBeTruthy();
  const probe = wrap!.querySelector(".ks-table-fit-probe");
  expect(probe).toBeTruthy();
  expect(probe!.getAttribute("aria-hidden")).toBe("true");
});
