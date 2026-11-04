import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

test.use({ deviceScaleFactor: 2 });

test("런처와 창의 앱 아이콘이 테마와 앱 판을 따른다", async ({ page }) => {
  const output = process.env.KS_ICON_CAPTURE_DIR ?? "/tmp/ks-icon-979/captures";
  mkdirSync(output, { recursive: true });
  const metrics: unknown[] = [];
  for (const width of [1000, 360]) {
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 720 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/harness.html?app-icons");
      const bar = page.getByTestId("app-window-web-browser").locator(".ks-window-titlebar");
      const icon = bar.locator(".ks-app-icon");
      await expect(icon).toHaveCSS("mask-image", /data:image\/svg/);
      const color = await bar.evaluate((element) => getComputedStyle(element).color);
      await expect(icon).toHaveCSS("background-color", color);
      await page.locator(".ks-shell-actions").getByRole("button", { name: "앱 열기" }).click();
      const menu = page.getByRole("menu");
      await expect(menu.getByRole("menuitem", { name: "탐색기" }).locator("img.ks-app-icon")).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "계산기" }).locator("svg.ks-app-icon")).toBeVisible();
      const coords = await bar.evaluate((element) => {
        const get = (selector: string) => {
          const r = element.querySelector(selector)!.getBoundingClientRect();
          return { left: r.left, right: r.right, centerY: r.top + r.height / 2 };
        };
        return { icon: get(".ks-app-icon"), title: get(".ks-window-title"), bar: element.getBoundingClientRect().toJSON() };
      });
      expect(Math.abs(coords.icon.centerY - coords.title.centerY)).toBeLessThanOrEqual(1);
      metrics.push({ width, theme, ...coords });
      await page.screenshot({ path: path.join(output, `shell-icons-${width}-${theme}.png`) });
    }
  }
  writeFileSync(path.join(output, "metrics.json"), JSON.stringify(metrics, null, 2));
});
