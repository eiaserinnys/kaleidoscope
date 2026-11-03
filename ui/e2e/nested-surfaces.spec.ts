import { expect, test } from "@playwright/test";

test("중첩 격자는 실제 스크롤 창에 보이는 표면만 붙이고 다시 보여 준다", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await app.getByRole("tab", { name: "중첩 표면 시험" }).click();
  await app.getByRole("button", { name: "견본 열기" }).click();
  const grid = app.locator(".ks-repeat.is-grid");
  await expect(grid.locator(".ks-canvas").first()).toBeVisible();
  await expect.poll(() => grid.locator(".ks-canvas").count()).toBeLessThan(60);
  const first = grid.locator('[data-repeat-key="0"] .ks-canvas');
  const rect = await first.boundingBox();
  expect(rect).not.toBeNull();
  expect(Math.abs(rect!.width / rect!.height - 9 / 16)).toBeLessThan(0.03);
  const second = await grid.locator('[data-repeat-key="1"] .ks-canvas').boundingBox();
  expect(second).not.toBeNull();
  expect(Math.abs(second!.width / second!.height - 1.6)).toBeLessThan(0.03);

  const outer = app.locator(".ks-repeat.is-column");
  await outer.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(grid.locator('[data-repeat-key="239"] .ks-canvas')).toBeVisible();
  await expect(first).toHaveCount(0);
  await expect.poll(() => grid.locator(".ks-canvas").count()).toBeLessThan(60);
  await outer.evaluate((element) => { element.scrollTop = 0; });
  await expect(first).toBeVisible();
  await app.getByRole("button", { name: "견본 열기" }).click();
  await expect(grid).toHaveCount(0);
});

test("채움 칸의 표면은 창에 남은 높이를 계속 차지한다", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await app.getByRole("tab", { name: "채움 표면 시험" }).click();
  const canvas = app.locator(".ks-data-stack-item.is-fill > .ks-anchor > .ks-canvas");
  await expect(canvas).toBeVisible();
  const boxes = await canvas.evaluate((element) => ({ canvas: element.getBoundingClientRect().height, parent: element.parentElement!.parentElement!.getBoundingClientRect().height }));
  expect(Math.abs(boxes.canvas - boxes.parent)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 400, height: 700 });
  const narrow = await canvas.boundingBox();
  expect(narrow).not.toBeNull();
  expect(Math.abs(narrow!.width / narrow!.height - 1)).toBeLessThan(0.03);
});
