import { expect, it } from "vitest";
import { checkAppLink } from "../data/app-link";

it.each(["http://example.com", "https://localhost", "https://test.localhost", "https://127.0.0.1", "https://10.0.0.1", "https://[::1]"])("앱 주소 %s를 거부한다", (url) => {
  expect(() => checkAppLink(url)).toThrow();
});

it("공개 HTTPS 주소를 허용한다", () => {
  expect(checkAppLink("https://example.com/path")).toBe("https://example.com/path");
});
