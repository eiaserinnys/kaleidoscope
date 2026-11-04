import { expect, test } from "@playwright/test";

for (const [width, direction] of [[1400, "row"], [880, "column"]] as const) {
  test(`${width} 폭에서 보이는 조건 분할이 남은 높이를 채운다`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: width + 2, height: 732 });
    await page.goto("/?preview=stack-when-fill");
    await page.addStyleTag({ content: "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }" });
    const app = page.getByTestId("app-window-stack-when-fill");
    const inner = app.locator(".ks-data-window-body > .ks-data-stack > .ks-data-stack-item.is-fill > .ks-data-stack");
    const split = inner.locator(`:scope > .ks-data-stack-item > .ks-split-${direction}`);
    const table = split.locator(".ks-table-scroll");
    await expect(table.getByText("검토 1", { exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await app.screenshot({ path: testInfo.outputPath(`stack-when-fill-${width}.png`) });
    const dimensions = await split.evaluate((element) => {
      const inner = element.parentElement!.parentElement!;
      const table = element.querySelector<HTMLElement>(".ks-table-scroll")!;
      return { split: element.getBoundingClientRect().height, slot: inner.parentElement!.getBoundingClientRect().height, table: table.clientHeight, tableScroll: table.scrollHeight, width: element.closest(".ks-data-window")!.getBoundingClientRect().width };
    });
    console.log(`${width}: ${JSON.stringify(dimensions)}`);
    expect(dimensions.width).toBe(width);
    expect(Math.abs(dimensions.split - dimensions.slot)).toBeLessThanOrEqual(1);
    expect(dimensions.table).toBeLessThanOrEqual(dimensions.split);
    expect(dimensions.tableScroll).toBeGreaterThan(dimensions.table);
    if (direction === "column") expect(Math.abs(dimensions.table / dimensions.split - 0.5)).toBeLessThan(0.05);
  });
}
