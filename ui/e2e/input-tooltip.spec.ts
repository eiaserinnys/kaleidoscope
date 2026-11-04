import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test("단추 설명은 올림과 키보드에서 열리고 같은 이동 동안 유지된다", async ({ page }) => {
  const output = process.env.KS_TOOLTIP_CAPTURE_DIR;
  for (const [width, theme] of [[1200, "light"], [360, "dark"]] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/?preview=block-gallery");
    const app = page.getByTestId("app-window-block-gallery");
    await app.getByRole("tab", { name: "입력" }).click();
    const first = app.getByRole("button", { name: "하나 더" });
    const icon = app.getByRole("button", { name: "되돌리기" });
    const preview = app.getByRole("button", { name: "그림 고르기" });
    await first.hover();
    await expect(page.getByRole("tooltip")).not.toBeVisible({ timeout: 200 });
    await expect(page.getByRole("tooltip")).toHaveText("횟수를 하나 늘립니다.");
    if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, `text-${width}-${theme}.png`) }); }
    await page.getByRole("tooltip").hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await icon.hover();
    await expect(page.getByRole("tooltip")).toContainText("되돌리기", { timeout: 250 });
    await expect(icon).not.toHaveAttribute("title");
    if (output) await page.screenshot({ path: join(output, `icon-${width}-${theme}.png`) });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.waitForTimeout(600);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await preview.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("tooltip")).toHaveText("현재 그림을 확인합니다.");
    if (output) await page.screenshot({ path: join(output, `preview-${width}-${theme}.png`) });
    const box = await page.getByRole("tooltip").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }
});
