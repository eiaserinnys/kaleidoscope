import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const output = process.env.KS_LAYOUT_CAPTURE_DIR;
async function open(page: Page, appId: string, width: number, height: number) {
  await page.setViewportSize({ width: width + 2, height });
  await page.goto(`/?preview=${appId}`);
  await page.addStyleTag({ content: "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return page.getByTestId(`app-window-${appId}`);
}
async function capture(target: Locator, name: string) {
  if (!output) return;
  mkdirSync(output, { recursive: true });
  await target.screenshot({ path: join(output, `${name}.png`) });
}
async function chooseLayout(page: Page, app: Locator) {
  const layout = app.getByRole("tab", { name: "배치" });
  if (!await layout.isVisible()) {
    await app.getByRole("button", { name: "탭 더 보기" }).first().click();
    await page.getByRole("menuitem", { name: "배치" }).click();
  } else await layout.click();
  return layout;
}

test("쌓인 분할의 가상 목록은 높이와 가상화를 유지한다", async ({ page }) => {
  const app = await open(page, "stacked-list-fixture", 360, 640);
  const split = app.locator(".ks-split").first();
  await expect(split).toHaveClass(/is-stacked/);
  const lists = split.locator(".ks-list");
  await expect(lists).toHaveCount(2);
  await expect(lists.first().locator('[role="option"]').first()).toBeAttached();
  await capture(app, "stacked-lists-360x640-top");
  const metrics = await lists.evaluateAll((elements) => elements.map((element) => ({ height: element.clientHeight, scrollHeight: element.scrollHeight, rows: element.querySelectorAll('[role="option"]').length, outerHeight: element.closest('.ks-split')!.clientHeight, outerScroll: element.closest('.ks-split')!.scrollHeight })));
  console.log(`쌓인 가상 목록: ${JSON.stringify(metrics)}`);
  for (const list of metrics) {
    expect(list.height, "목록 높이가 0이면 중단").toBeGreaterThan(0);
    expect(list.rows, "목록 행이 없으면 중단").toBeGreaterThan(0);
    expect(list.rows, "100행을 모두 그리면 중단").toBeLessThan(100);
  }
  await split.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await capture(app, "stacked-lists-360x640-bottom");
  await expect(split.getByPlaceholder("첫 입력")).toBeInViewport();
  await expect(split.locator(".ks-code-view")).toBeInViewport();
  for (const height of [480, 640]) {
    const gallery = await open(page, "block-gallery", 360, height);
    await chooseLayout(page, gallery);
    const outer = gallery.locator(".ks-data-tab-panel:visible > .ks-split");
    const nested = outer.locator(":scope > .ks-split-pane:first-child > .ks-split");
    await capture(gallery, `stacked-gallery-360x${height}-top`);
    await expect(outer).toHaveClass(/is-stacked/);
    await expect(nested).toBeVisible();
    await expect(nested.getByText("분할 안의 분할")).toBeVisible();
    const inputPane = nested.locator(":scope > .ks-split-pane:first-child");
    const blank = await inputPane.evaluate((element) => {
      const input = element.querySelector("input")!.getBoundingClientRect();
      return element.getBoundingClientRect().bottom - input.bottom;
    });
    console.log(`360x${height} 입력 칸 아래 여백: ${blank}`);
    expect(blank).toBeLessThanOrEqual(8);
    await outer.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await capture(gallery, `stacked-gallery-360x${height}-bottom`);
    await expect(outer.getByText("격자 간격")).toBeInViewport();
  }
});

test("360x480 쌓인 분할은 스크롤로 마지막 칸에 닿는다", async ({ page }) => {
  const app = await open(page, "stacked-list-fixture", 360, 480);
  const split = app.locator(".ks-split").first();
  await expect(split).toHaveClass(/is-stacked/);
  await split.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await capture(app, "stacked-lists-360x480-bottom");
  expect(await split.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(split.getByPlaceholder("첫 입력")).toBeInViewport();
  await expect(split.locator(".ks-code-view")).toBeInViewport();
});

test("탭 정렬과 첫 제목, 쌓인 분할 스크롤과 독립 메모", async ({ page }) => {
  for (const height of [480, 640]) {
    const app = await open(page, "block-gallery", 360, height);
    const more = app.getByRole("button", { name: "탭 더 보기" }).first();
    const firstTab = app.getByRole("tab").first();
    const tabBox = await firstTab.boundingBox();
    const moreBox = await more.boundingBox();
    expect(Math.abs((tabBox!.y + tabBox!.height / 2) - (moreBox!.y + moreBox!.height / 2))).toBeLessThanOrEqual(0.5);
    if (output) await app.locator(".ks-data-tab-header").first().screenshot({ path: join(output, `tabs-360x${height}.png`) });
    const layout = await chooseLayout(page, app);
    const split = app.locator(".ks-data-tab-panel:visible > .ks-split");
    await expect(split).toHaveClass(/is-stacked/);
    const nested = split.locator(":scope > .ks-split-pane:first-child > .ks-split");
    await expect(nested).toBeVisible();
    await expect(nested.getByText("분할 안의 분할")).toBeVisible();
    const title = nested.getByText("메모", { exact: true });
    const titleBox = await title.boundingBox();
    const layoutBox = await layout.boundingBox();
    expect(titleBox!.y - (layoutBox!.y + layoutBox!.height)).toBeCloseTo(8, 0);
    const input = nested.getByRole("textbox");
    await input.fill("독립 메모");
    await capture(app, `layout-360x${height}-top`);
    await split.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(split.getByText("격자 간격")).toBeInViewport();
    const scroll = await split.evaluate((element) => ({ top: element.scrollTop, end: element.scrollHeight - element.clientHeight }));
    expect(Math.abs(scroll.end - scroll.top)).toBeLessThanOrEqual(1);
    await capture(app, `layout-360x${height}-bottom`);
    await app.getByRole("tab", { name: "목록" }).click();
    await expect(app.getByPlaceholder("거르기")).toHaveValue("");
    await chooseLayout(page, app);
    await expect(app.getByPlaceholder("내용")).toHaveValue("독립 메모");
  }
  const gallery = await open(page, "block-gallery", 1100, 920);
  const layout = await chooseLayout(page, gallery);
  const split = gallery.locator(".ks-data-tab-panel:visible > .ks-split");
  const heads = await split.locator(".ks-data-section-title").evaluateAll((items) => items.map((item) => ({ text: item.textContent, top: item.getBoundingClientRect().top })));
  const top = (await layout.boundingBox())!.y + (await layout.boundingBox())!.height + 8;
  console.log(`넓은 분할 제목: ${JSON.stringify(heads)}, 기준 ${top}`);
  expect(heads.map((item) => Math.abs(item.top - top))).toEqual([0, 0, 0]);
  await capture(gallery, "layout-1100");
  const selection = await open(page, "shell-selection-test", 1100, 920);
  const summary = selection.getByRole("tab", { name: "요약" });
  await expect(summary.locator(".ks-truncate-label")).toHaveCount(0);
  await capture(selection, "shell-selection-1100");
});
