import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test("우클릭과 키보드 메뉴가 해당 행의 주소와 제목을 복사한다", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  const first = app.getByRole("option", { name: "항목 1", exact: true });
  const second = app.getByRole("option", { name: "항목 2", exact: true });
  await expect(second).toBeVisible();
  await second.click({ button: "right" });
  await expect(second).toHaveAttribute("aria-selected", "false");
  await page.getByRole("menuitem", { name: "주소 복사" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("https://example.com/2");
  await first.focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "제목 복사" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("항목 1");
});

for (const [name, width, height] of [["wide", 1440, 900], ["narrow", 520, 720]] as const) {
  test(`${name} 목록, 표, 피드 메뉴 캡처`, async ({ page }) => {
    const output = process.env.KS_ITEM_MENU_CAPTURE_DIR;
    await page.setViewportSize({ width, height });
    await page.goto("/?preview=data-views-test");
    const app = page.getByTestId("app-window-data-views-test");
    const capture = async (surface: string) => {
      await expect(page.getByRole("menu")).toBeVisible();
      if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, `${name}-${surface}.png`) }); }
      await page.keyboard.press("Escape");
    };
    await app.getByRole("option", { name: "항목 1", exact: true }).click({ button: "right" });
    await capture("list");
    await app.getByRole("tab", { name: "표 시험" }).click();
    await app.locator(".ks-table-row").first().click({ button: "right" });
    await capture("table");
    await app.getByRole("tab", { name: "선택 흐름 시험" }).click();
    await app.getByRole("article").first().click({ button: "right" });
    await capture("feed");
  });
}
