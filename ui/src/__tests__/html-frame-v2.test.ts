import { expect, it } from "vitest";
import { htmlViewSource } from "../blocks/html-view-frame";

it("문서를 정화하고 nonce가 붙은 브리지만 실행하도록 만든다", () => {
  const source = htmlViewSource('<script>window.bad = 1</script><img src="https://example.com/x" onerror="window.bad=2"><a href="https://example.com">열기</a>');
  const doc = new DOMParser().parseFromString(source, "text/html");
  expect(doc.querySelector("img")?.hasAttribute("onerror")).toBe(false);
  expect(doc.querySelector("a")?.hasAttribute("href")).toBe(false);
  const scripts = doc.querySelectorAll("script");
  expect(scripts).toHaveLength(1);
  const nonce = scripts[0].getAttribute("nonce");
  expect(nonce).toBeTruthy();
  expect(scripts[0].getAttribute("src")).toMatch(/^data:text\/javascript;base64,/);
  expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain(`script-src 'nonce-${nonce}'`);
});
