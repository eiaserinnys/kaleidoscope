import { expect, test, type Page } from "@playwright/test";
import { coreUrl } from "./runtime.ts";

const background = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ks-color-background").trim());

async function chooseTheme(page: Page, label: "시스템" | "라이트" | "다크") {
  const settings = page.getByTestId("system-window-settings");
  if (!(await settings.isVisible())) await page.locator(".ks-shell-bar").getByRole("button", { name: "설정", exact: true }).click();
  await expect(settings).toBeVisible();
  const option = settings.getByRole("group", { name: "테마" }).getByRole("button", { name: label, exact: true });
  await option.click();
  await expect(option).toHaveAttribute("aria-pressed", "true");
}

test.describe("화면 테마", () => {
  test.use({ colorScheme: "light" });

  test("고른 테마를 운영체제 설정보다 먼저 쓰고 다시 열어도 유지한다", async ({ page }, testInfo) => {
    await page.goto(`/?core=${coreUrl}`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const light = await background(page);

    await chooseTheme(page, "다크");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await background(page)).not.toBe(light);
    await page.screenshot({ path: testInfo.outputPath("dark.png") });

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await chooseTheme(page, "시스템");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await chooseTheme(page, "라이트");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.screenshot({ path: testInfo.outputPath("light.png") });
  });
});
