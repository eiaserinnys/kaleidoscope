import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test.use({ locale: "ko-KR", timezoneId: "Asia/Seoul" });

for (const width of [360, 1200]) {
  test(`날짜 일정표 행 머리의 이름과 보조 글 ${width} 폭`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/?preview=block-gallery");
    const app = page.getByTestId("app-window-block-gallery");
    const tab = app.getByRole("tab", { name: "일정", exact: true });
    if (await tab.isVisible()) await tab.click();
    else {
      await app.getByRole("button", { name: "탭 더 보기" }).click();
      await page.getByRole("menuitem", { name: "일정", exact: true }).click();
    }
    await expect(app.locator(".ks-timeline-dates")).toBeVisible();
    await page.evaluate(async () => {
      const harness = (window as any).__ksHarness;
      const { snapshot } = await harness.call({ op: "state.get" });
      const version = snapshot.shared.app_versions.find((item: any) => item.app_id === "block-gallery");
      const index = version.definition.ui.tabs.findIndex((item: any) => item.label === "일정");
      version.definition.ui.tabs[index].child.tracks[0].meta = "21건 · 미지정 13";
      version.version += 1;
      const appWindow = snapshot.shared.windows.find((item: any) => item.app_id === "block-gallery");
      appWindow.app_version = version.version;
      appWindow.state.tab = index;
      harness.emit({ event: "state.changed", snapshot });
    });
    const header = app.locator(".ks-dates-track-name").first();
    const label = header.locator(".ks-list-title");
    const meta = header.locator(".ks-view-meta");
    await expect(meta).toHaveText("21건 · 미지정 13");
    await page.evaluate(() => document.fonts.ready);
    const directory = process.env.KS_DATA_CAPTURE_DIR;
    if (directory) {
      mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: join(directory, `${width}.png`) });
    }
    const metrics = await header.evaluate((element) => {
      const label = element.querySelector<HTMLElement>(".ks-list-title")!;
      const meta = element.querySelector<HTMLElement>(".ks-view-meta")!;
      return { labelWidth: label.getBoundingClientRect().width, labelClientWidth: label.clientWidth,
        labelScrollWidth: label.scrollWidth, metaWidth: meta.clientWidth,
        metaScrollWidth: meta.scrollWidth, overflow: getComputedStyle(meta).textOverflow };
    });
    console.log(`${width} 행 머리: ${JSON.stringify(metrics)}`);
    expect(metrics.labelWidth).toBeGreaterThan(0);
    if (width === 360) {
      expect(metrics.labelClientWidth).toBe(metrics.labelScrollWidth);
      expect(metrics.metaWidth).toBeLessThan(metrics.metaScrollWidth);
      expect(metrics.overflow).toBe("ellipsis");
    } else {
      expect(metrics.metaWidth).toBe(metrics.metaScrollWidth);
    }
  });
}
