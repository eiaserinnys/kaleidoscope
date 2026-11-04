import { expect, test } from "@playwright/test";

test("표 선택은 창을 채우고 짧은 확인창은 기존 크기를 지킨다", async ({ page }) => {
  await page.setViewportSize({ width: 1049, height: 900 });
  await page.goto("/?preview=layout-940-table");
  const tableApp = page.getByTestId("app-window-layout-940-table");
  await tableApp.getByRole("button", { name: "표 열기" }).click();
  const tableDialog = tableApp.getByRole("dialog");
  const tableBox = await tableDialog.boundingBox();
  const hostBox = await tableApp.locator(".ks-data-window").boundingBox();
  const inset = await tableDialog.evaluate((element) => parseFloat(getComputedStyle(element).getPropertyValue("--ks-space-6")));
  expect(tableBox!.width).toBeCloseTo(hostBox!.width - 2 * inset, 0);
  expect(tableBox!.height).toBeCloseTo(hostBox!.height - 2 * inset, 0);
  await expect(tableDialog.getByRole("table")).toBeVisible();
  await tableDialog.getByRole("button", { name: "닫기" }).click();
  await expect(tableDialog).toHaveCount(0);

  await page.goto("/?preview=timeline-fixture");
  const app = page.getByTestId("app-window-timeline-fixture");
  await app.getByRole("button", { name: "대화상자 열기" }).click();
  const dialog = app.getByRole("dialog");
  expect((await dialog.boundingBox())!.width).toBe(360);
});
