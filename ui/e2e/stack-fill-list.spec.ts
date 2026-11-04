import { expect, test } from "@playwright/test";

test("쌓기의 여러 글칸이 남은 높이를 나누고 긴 글은 칸 안에서 스크롤한다", async ({ page }, info) => {
  await page.setViewportSize({ width: 1049, height: 900 });
  await page.goto("/?preview=stack-fill-list-fixture");
  const app = page.getByTestId("app-window-stack-fill-list-fixture");
  const first = app.getByRole("textbox", { name: "한국어" });
  const second = app.getByRole("textbox", { name: "영어" });
  const slots = app.locator(".ks-data-stack.has-fill-list > .ks-data-stack-item.is-fill");
  await expect(slots).toHaveCount(2);
  const before = await Promise.all([first.boundingBox(), second.boundingBox(), slots.nth(0).boundingBox(), slots.nth(1).boundingBox()]);
  expect(Math.abs(before[0]!.height - before[1]!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(before[0]!.height - before[2]!.height)).toBeLessThanOrEqual(1);
  await first.fill(Array(20).fill("긴 글").join("\n"));
  expect((await first.boundingBox())!.height).toBe(before[0]!.height);
  expect(await first.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await app.screenshot({ path: info.outputPath("fill-list.png") });
});
