import { expect, test, type Page } from "@playwright/test";
import { coreUrl } from "./runtime.ts";

// 테마는 호스트(Tauri)가 네이티브 창에 적용하고 웹 내용은 prefers-color-scheme로 따른다.
// 브라우저 하네스에는 창이 없으므로 여기서는 고른 값이 코어에 저장되고 다시 열어도 남는지를 본다.
async function themeGroup(page: Page) {
  const settings = page.getByTestId("system-window-settings");
  if (!(await settings.isVisible())) await page.locator(".ks-shell-bar").getByRole("button", { name: "설정", exact: true }).click();
  await expect(settings).toBeVisible();
  return settings.getByRole("group", { name: "테마" });
}

test("고른 테마를 기기에 저장하고 다시 열어도 유지한다", async ({ page }, testInfo) => {
  await page.goto(`/?core=${coreUrl}`);
  const group = await themeGroup(page);
  await expect(group.getByRole("button", { name: "시스템", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(group).toHaveAccessibleDescription("운영체제 설정을 따릅니다");

  await group.getByRole("button", { name: "다크", exact: true }).click();
  await expect(group.getByRole("button", { name: "다크", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(group).toHaveAccessibleDescription("");
  await page.screenshot({ path: testInfo.outputPath("settings.png") });

  await page.reload();
  const reopened = await themeGroup(page);
  await expect(reopened.getByRole("button", { name: "다크", exact: true })).toHaveAttribute("aria-pressed", "true");

  await reopened.getByRole("button", { name: "시스템", exact: true }).click();
  await expect(reopened.getByRole("button", { name: "시스템", exact: true })).toHaveAttribute("aria-pressed", "true");
});
