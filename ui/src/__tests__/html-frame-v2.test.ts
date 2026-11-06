import { expect, it } from "vitest";
import { htmlViewSource } from "../blocks/html-view-frame";

it("문서를 정화하고 nonce가 붙은 브리지만 실행하도록 만든다", () => {
  const source = htmlViewSource('<script>window.bad = 1</script><iframe src="https://example.com"></iframe><meta http-equiv="refresh" content="0;url=https://example.com"><img src="https://example.com/x" onerror="window.bad=2"><a href="https://example.com">열기</a><template><script>window.bad = 3</script><img onerror="window.bad = 4"></template>');
  const doc = new DOMParser().parseFromString(source, "text/html");
  expect(doc.querySelector("img")?.hasAttribute("onerror")).toBe(false);
  expect(doc.querySelector("a")?.hasAttribute("href")).toBe(false);
  expect(doc.querySelector("iframe, meta[http-equiv='refresh']")).toBeNull();
  expect(doc.querySelector("template")?.content.querySelector("script, [onerror]")).toBeNull();
  const scripts = doc.querySelectorAll("script");
  expect(scripts).toHaveLength(1);
  const nonce = scripts[0].getAttribute("nonce");
  expect(nonce).toBeTruthy();
  expect(scripts[0].getAttribute("src")).toMatch(/^data:text\/javascript;base64,/);
  expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain(`script-src 'nonce-${nonce}'`);
});


it("토큰 문서만 낮은 우선순위의 기본 색상 체계를 받고 작성자 선언은 보존한다", () => {
  const token = htmlViewSource('<p style="color:var(--ks-color-text)">본문</p>');
  expect(token).toContain(":where(:root){color-scheme:light dark}");
  expect(htmlViewSource('<p style="color:black;background:white">본문</p>')).not.toContain(":where(:root){color-scheme:light dark}");
  const own = htmlViewSource('<style>:root{color-scheme:only light}</style><p style="color:var(--ks-color-text)">본문</p>');
  expect(own).toContain(":root{color-scheme:only light}");
});


it("meta로 직접 정한 색상 체계도 기본 주입보다 우선한다", () => {
  const source = htmlViewSource('<meta name="color-scheme" content="only light"><p style="color:var(--ks-color-text)">본문</p>');
  expect(source).not.toContain(":where(:root){color-scheme:light dark}");
  expect(source).toContain('content="only light"');
});


it.each([
  '<body style="background:white;font-size:var(--ks-type-body)">본문</body>',
  '<p style="color:#222;font-size:var(--ks-type-body)">본문</p>',
  '<p style="color:#333;font-family:var(--ks-font-family)">본문</p>',
])("색이 고정된 글꼴 토큰 문서에는 색상 체계를 주입하지 않는다: %s", (html) => {
  expect(htmlViewSource(html)).not.toContain(":where(:root){color-scheme:light dark}");
});
