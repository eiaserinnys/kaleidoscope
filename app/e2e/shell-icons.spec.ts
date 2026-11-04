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
      await page.screenshot({ path: path.join(output, `shell-icons-closed-${width}-${theme}.png`) });
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

test("목록 아이콘의 단색 SVG도 테마색을 따른다", async ({ page }) => {
  const output = process.env.KS_ICON_CAPTURE_DIR ?? "/tmp/ks-icon-979/captures";
  mkdirSync(output, { recursive: true });
  const metrics: unknown[] = [];
  for (const width of [1000, 360]) {
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 720 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/harness.html?app-icons&window=explorer");
      const row = page.getByRole("option", { name: "긴 제목을 가진 웹 브라우저와 자료 탐색 작업" });
      const icon = row.locator("span.ks-app-icon");
      await expect(icon).toHaveCSS("mask-image", /data:image\/svg/);
      const color = await row.evaluate((element) => getComputedStyle(element).color);
      await expect(icon).toHaveCSS("background-color", color);
      await expect(page.getByRole("option", { name: "탐색기", exact: true }).locator("img.ks-app-icon")).toBeVisible();
      const coords = await row.evaluate((element) => {
        const icon = element.querySelector(".ks-app-icon")!.getBoundingClientRect();
        const name = element.querySelector(".ks-icon-tile-name")!.getBoundingClientRect();
        return { icon: icon.toJSON(), name: name.toJSON(), centerDifference: Math.abs(icon.x + icon.width / 2 - name.x - name.width / 2) };
      });
      expect(coords.centerDifference).toBeLessThanOrEqual(1);
      metrics.push({ width, theme, ...coords });
      await page.screenshot({ path: path.join(output, `list-icons-${width}-${theme}.png`) });
    }
  }
  writeFileSync(path.join(output, "list-metrics.json"), JSON.stringify(metrics, null, 2));
});

test("아이콘을 기다리는 동안에도 창 머리와 메뉴의 자리를 유지한다", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    (window as unknown as { releaseIcons: () => void }).releaseIcons = release;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      if (typeof args[0] === "string" && args[0].startsWith("data:image/")) await pending;
      return original(...args);
    };
  });
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/harness.html?app-icons");
  const bar = page.getByTestId("app-window-web-browser").locator(".ks-window-titlebar");
  await expect(bar.locator("svg.ks-app-icon")).toBeVisible();
  const before = await bar.locator(".ks-window-title").boundingBox();
  await page.locator(".ks-shell-actions").getByRole("button", { name: "앱 열기" }).click();
  const output = process.env.KS_ICON_CAPTURE_DIR ?? "/tmp/ks-icon-979/captures";
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: path.join(output, "shell-icons-loading.png") });
  await page.evaluate(() => (window as unknown as { releaseIcons: () => void }).releaseIcons());
  await expect(bar.locator("span.ks-app-icon")).toHaveCSS("mask-image", /data:image\/svg/);
  expect(await bar.locator(".ks-window-title").boundingBox()).toEqual(before);
});
