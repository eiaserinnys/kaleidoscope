import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test("해커뉴스 이야기 목록 끝에서 다음 쪽을 이어 받는다", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/?preview=reader");
  const app = page.getByTestId("app-window-reader");
  const table = app.getByRole("table");
  await expect(table.getByText("시험 이야기 1", { exact: true })).toBeVisible();
  await table.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(table.getByText("시험 이야기 31", { exact: true })).toBeVisible();
  await table.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(table.getByText("시험 이야기 60", { exact: true })).toBeVisible();
  const output = process.env.KS_PAGING_CAPTURE_DIR;
  if (output) {
    mkdirSync(output, { recursive: true });
    await app.screenshot({ path: join(output, "reader-wide-after.png") });
  }
});
