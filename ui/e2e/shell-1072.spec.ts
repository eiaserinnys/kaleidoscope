import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

async function capture(app: import("@playwright/test").Locator, name: string) {
  const directory = process.env.KS_1072_CAPTURE_DIR;
  if (directory) { mkdirSync(directory, { recursive: true }); await app.screenshot({ path: join(directory, `${name}.png`) }); }
}

for (const width of [360, 1200]) test(`${width} 폭의 시간축 조작 행과 이름 열은 서로의 폭을 차지하지 않는다`, async ({ page }) => {
  await page.setViewportSize({ width, height: 600 });
  await page.goto("/?preview=shell-1072");
  const timeline = page.getByTestId("app-window-shell-1072").locator(".ks-timeline");
  await expect(timeline.locator(".ks-timeline-item")).toBeVisible();
  await expect(timeline.locator(":scope > .ks-timeline-controls")).toBeVisible();
  await expect(timeline.locator(".ks-timeline-label")).toHaveCSS("text-overflow", "ellipsis");
  const widths = await timeline.evaluate(el => ({ labels: el.querySelector(".ks-timeline-labels")!.getBoundingClientRect().width, root: el.getBoundingClientRect().width }));
  expect(widths.labels).toBeLessThan(widths.root * 0.4);
  await capture(page.getByTestId("app-window-shell-1072"), `item2-timeline-${width}`);
});

test("쌓인 채움 칸은 지정한 비율을 보존한다", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.goto("/?preview=shell-1072");
  const split = page.getByTestId("app-window-shell-1072").locator(".ks-split.is-stacked");
  await expect(split).toBeVisible();
  const sizes = await split.locator(":scope > .ks-split-pane").evaluateAll(panes => panes.map(pane => pane.getBoundingClientRect().height));
  expect(sizes[1] / sizes[0]).toBeGreaterThan(1.8);
  expect(sizes[1] / sizes[0]).toBeLessThan(2.4);
  console.log(`쌓인 칸 높이: ${JSON.stringify(sizes)}`);
});

for (const placement of ["direct", "section"]) test(`쌓인 지도는 내용 높이를 따른다: ${placement}`, async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(`/?preview=shell-map-1072-${placement}`);
  const app = page.getByTestId(`app-window-shell-map-1072-${placement}`);
  const frame = app.locator(".ks-map-frame");
  await expect(frame).toBeVisible();
  const metrics = await frame.evaluate(el => {
    const canvas = el.querySelector(".ks-map-canvas")!.getBoundingClientRect();
    const style = getComputedStyle(el);
    const pane = el.closest<HTMLElement>(".ks-split-pane")!;
    const paneStyle = getComputedStyle(pane);
    const mapStyle = getComputedStyle(el.parentElement!);
    return { inside: el.getBoundingClientRect().bottom - canvas.bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth),
      minHeight: parseFloat(style.minHeight), height: el.getBoundingClientRect().height,
      outside: pane.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom - parseFloat(paneStyle.paddingBottom) - parseFloat(mapStyle.paddingBottom), grow: paneStyle.flexGrow };
  });
  console.log(`지도 아래 빈칸 ${placement}: ${JSON.stringify(metrics)}`);
  expect(metrics.inside).toBeLessThanOrEqual(Math.max(1, metrics.minHeight - (metrics.height - metrics.inside) + 1));
  expect(Math.abs(metrics.outside)).toBeLessThanOrEqual(1);
  expect(metrics.grow).toBe("0");
});

for (const kind of ["list", "table"]) test(`보이던 선택 행은 ${kind} 높이가 작아져도 보인다`, async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  const id = kind === "list" ? "shell-1072" : "shell-table-1072";
  await page.goto(`/?preview=${id}`);
  const app = page.getByTestId(`app-window-${id}`);
  const list = app.locator(kind === "list" ? ".ks-list" : ".ks-table-scroll").first();
  await expect(list).toBeVisible();
  await list.evaluate(el => { el.scrollTop = 250; });
  const row = kind === "list" ? list.getByRole("option", { name: "자료 16", exact: true }) : list.getByRole("row").filter({ hasText: "자료 16" });
  await expect(row).toBeVisible();
  await row.click();
  await expect(row).toHaveClass(/is-selected/);
  const before = await row.evaluate(el => ({ bottom: el.getBoundingClientRect().bottom - el.closest(".ks-list, .ks-table-scroll")!.getBoundingClientRect().top }));
  expect(before.bottom).toBeGreaterThan(180);
  await list.locator("..").evaluate(el => { (el as HTMLElement).style.flex = "0 0 180px"; });
  await expect.poll(() => row.evaluate(el => {
    const r = el.getBoundingClientRect(), viewport = el.closest(".ks-list, .ks-table-scroll")!.getBoundingClientRect();
    return r.top >= viewport.top && r.bottom <= viewport.bottom;
  })).toBe(true);
  if (kind === "list") await capture(app, "item3-selected-row-360");
});
