import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";

test("아이콘 목록의 칸과 간격을 기록한다", async ({ page }) => {
  await page.setViewportSize({ width: 1049, height: 900 });
  await page.goto("/?preview=layout-940-icons");
  const app = page.getByTestId("app-window-layout-940-icons");
  const icons = app.locator(".ks-icon-tile");
  await expect(icons.first()).toBeVisible();
  const boxes = await icons.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()));
  expect(boxes.length).toBeGreaterThan(2);
  if (process.env.KS_ICON_EVIDENCE) {
    await app.screenshot({ path: `${process.env.KS_ICON_EVIDENCE}.png` });
    writeFileSync(`${process.env.KS_ICON_EVIDENCE}.json`, JSON.stringify(boxes));
  }
});

test("격자 목록은 같은 칸의 입력과 끝선을 맞추고 폭에 맞춰 칸 수를 계산한다", async ({ page }) => {
  await page.setViewportSize({ width: 1049, height: 900 });
  await page.goto("/?preview=layout-940-grid");
  const app = page.getByTestId("app-window-layout-940-grid");
  const list = app.locator(".ks-list.is-grid");
  await expect(list.locator(".ks-list-card").first()).toBeVisible();
  await list.evaluate((element) => { element.style.width = "344px"; });
  await expect.poll(() => list.locator(".ks-list-grid-row").first().locator(".ks-list-card").count()).toBe(2);
  const inset = await list.locator(".ks-list-grid-row").first().evaluate((element) => {
    const row = element.getBoundingClientRect();
    const cards = [...element.children].map((child) => child.getBoundingClientRect());
    return { left: cards[0].left - row.left, right: row.right - cards.at(-1)!.right };
  });
  expect(Math.abs(inset.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(inset.right)).toBeLessThanOrEqual(1);
});
