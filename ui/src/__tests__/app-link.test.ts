import { expect, it } from "vitest";
import { checkAppLink } from "../data/app-link";

it.each([
  "http://example.com", "https://localhost", "https://test.localhost",
  "https://127.0.0.1", "https://10.0.0.1", "https://[::1]",
  "https://[::ffff:127.0.0.1]", "https://[::ffff:10.0.0.1]",
  "https://[::ffff:7f00:1]", "https://[::ffff:a00:1]",
  "https://localhost.", "https://foo.localhost.", "https://[::]",
  "https://2130706433", "https://0x7f.1", "https://[fc00::1]", "https://[fd00::1]", "https://[fe80::1]",
])("앱 주소 %s를 거부한다", (url) => {
  expect(() => checkAppLink(url)).toThrow();
});

it.each([
  ["https://[::ffff:127.0.0.1]", "[::ffff:7f00:1]"],
  ["https://[::ffff:10.0.0.1]", "[::ffff:a00:1]"],
  ["https://2130706433", "127.0.0.1"],
  ["https://0x7f.1", "127.0.0.1"],
])("브라우저가 %s의 호스트를 %s로 정규화한다", (url, host) => {
  expect(new URL(url).hostname).toBe(host);
});

it.each([
  "https://example.com/path", "https://8.8.8.8/path", "https://[2606:4700:4700::1111]/path",
  "https://[::ffff:8.8.8.8]/path",
])("공개 HTTPS 주소 %s를 허용한다", (url) => {
  expect(checkAppLink(url)).toBe(new URL(url).href);
});
