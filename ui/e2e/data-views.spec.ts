import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

const output = process.env.KS_DATA_CAPTURE_DIR;
async function capture(page: Page, name: string) {
  if (!output) return;
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
}

test("긴 목록과 격자에서 가상 스크롤과 키보드 선택", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  const list = app.getByRole("listbox");
  await expect(list.getByRole("option", { name: "항목 1", exact: true })).toBeVisible();
  expect(await list.getByRole("option").count()).toBeLessThan(100);
  await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const last = list.getByRole("option", { name: "항목 1000", exact: true });
  await expect(last).toBeVisible();
  await last.click();
  await expect(last).toHaveAttribute("aria-selected", "true");
  await app.getByRole("tab", { name: "격자 시험" }).click();
  const first = app.getByRole("option", { name: "그림 1", exact: true });
  await expect(first).toBeVisible();
  await expect(first.locator("img")).toBeVisible();
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(app.getByRole("option", { name: "그림 2", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(app.locator('[role="option"]:focus')).not.toHaveAttribute("aria-label", "그림 2");
  await page.keyboard.press("ArrowUp");
  await expect(app.getByRole("option", { name: "그림 2", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(first).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(app.locator('[role="option"]:focus')).toHaveAttribute("aria-selected", "true");
  await capture(page, "grid-wide");
});

test("표 머리 고정과 가로 스크롤, 흐름 따라가기", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await app.getByRole("tab", { name: "표 시험" }).click();
  const table = app.getByRole("table");
  const header = app.locator(".ks-table-header");
  await expect(header).toBeVisible();
  const top = (await header.boundingBox())!.y;
  const dims = await table.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(dims.scroll).toBeGreaterThan(dims.client);
  const badgeBounds = await app.locator(".ks-table-cell:has(.ks-badge)").first().evaluate((cell) => {
    const badge = cell.querySelector(".ks-badge")!;
    const cellRect = cell.getBoundingClientRect();
    const badgeRect = badge.getBoundingClientRect();
    return { cellWidth: cellRect.width, badgeWidth: badgeRect.width, badgeClientWidth: badge.clientWidth, badgeScrollWidth: badge.scrollWidth };
  });
  expect(badgeBounds.cellWidth).toBeGreaterThanOrEqual(badgeBounds.badgeWidth);
  expect(badgeBounds.badgeClientWidth).toBeGreaterThanOrEqual(badgeBounds.badgeScrollWidth);
  await table.evaluate((element) => { element.scrollTop = 500; element.scrollLeft = 300; });
  await expect.poll(async () => (await header.boundingBox())!.y).toBeCloseTo(top, 0);
  expect(await table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await capture(page, "table-narrow");
  await app.getByRole("tab", { name: "흐름 시험" }).click();
  const feed = app.locator(".ks-feed");
  await expect(feed.getByText("내용 35")).toBeVisible();
  await app.getByRole("button", { name: "추가" }).click();
  await expect(feed.getByText("새 내용")).toBeVisible();
  await feed.evaluate((element) => { element.scrollTop = 0; });
  await app.getByRole("button", { name: "추가" }).click();
  await expect.poll(() => feed.evaluate((element) => element.scrollTop)).toBe(0);
});

test("견본의 다섯 보기와 다크 배지 캡처", async ({ page }) => {
  const coordinates = [];
  for (const width of [1440, 400]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?preview=block-gallery");
    const app = page.getByTestId("app-window-block-gallery");
    await expect(app.getByRole("tab", { name: "목록" })).toBeVisible();
    const lineCounts = await app.getByRole("tab").evaluateAll((tabs) => tabs.map((tab) => {
      const range = document.createRange();
      range.selectNodeContents(tab);
      return range.getClientRects().length;
    }));
    expect(lineCounts.every((count) => count === 1)).toBe(true);
    await expect(app.locator(".ks-list")).toBeVisible();
    const tabBox = await app.locator(".ks-data-tab-list").boundingBox();
    const listBox = await app.locator(".ks-list").boundingBox();
    const rowBox = await app.locator(".ks-list-row").first().boundingBox();
    const propertiesBox = await app.locator(".ks-properties").boundingBox();
    const labelBox = await app.locator(".ks-properties dt").first().boundingBox();
    const valueBox = await app.locator(".ks-properties dd").first().boundingBox();
    if (width === 400) expect(valueBox!.y).toBeGreaterThan(labelBox!.y);
    else expect(valueBox!.y).toBe(labelBox!.y);
    const fits = await app.locator(".ks-list-row > .ks-view-meta, .ks-list-row .ks-badge").evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth));
    expect(fits).toBe(true);
    await capture(page, `gallery-list-${width}`);
    await app.getByRole("tab", { name: "표와 트리" }).click();
    await expect(app.getByRole("tree")).toBeVisible();
    await expect(app.getByRole("table")).toBeVisible();
    const treeBox = await app.getByRole("tree").boundingBox();
    const tableBox = await app.getByRole("table").boundingBox();
    expect(Math.abs(treeBox!.y - tableBox!.y)).toBeLessThanOrEqual(1);
    coordinates.push({ width, tabBox, listBox, rowBox, propertiesBox, treeBox, tableBox });
    await capture(page, `gallery-table-tree-${width}`);
    await app.getByRole("tab", { name: "흐름과 글" }).click();
    await expect(app.locator(".ks-feed")).toBeVisible();
    await capture(page, `gallery-feed-${width}`);
  }
  if (output) writeFileSync(join(output, "gallery-coordinates.json"), JSON.stringify(coordinates, null, 2));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?preview=block-gallery");
  await expect(page.locator(".ks-badge").first()).toBeVisible();
  await capture(page, "gallery-badges-dark");
});

test("파일 트리 행의 공통화 전후 모습을 비교한다", async ({ page }) => {
  const { execFileSync } = await import("node:child_process");
  const baselineCss = execFileSync("git", ["show", "781091b:ui/src/styles/blocks.css"], { encoding: "utf8" });
  for (const width of [1440, 400]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?preview=md-editor");
    const app = page.getByTestId("app-window-md-editor");
    await app.getByRole("button", { name: "문서 폴더 고르기" }).click();
    await app.getByRole("button", { name: "notes" }).click();
    await app.getByRole("button", { name: "README.md" }).click();
    await expect(app.getByRole("button", { name: "README.md" })).toHaveAttribute("aria-current", "page");
    await page.evaluate((css) => {
      const style = document.createElement("style");
      style.id = "old-file-tree-css";
      style.textContent = css;
      document.head.appendChild(style);
      document.querySelectorAll(".ks-file-tree-row").forEach((row) => row.classList.remove("ks-row"));
    }, baselineCss);
    await capture(page, `file-tree-before-${width}`);
    const before = await app.locator(".ks-file-tree").screenshot();
    await page.evaluate(() => {
      document.getElementById("old-file-tree-css")?.remove();
      document.querySelectorAll(".ks-file-tree-row").forEach((row) => row.classList.add("ks-row"));
    });
    await capture(page, `file-tree-after-${width}`);
    const after = await app.locator(".ks-file-tree").screenshot();
    expect(after).toEqual(before);
  }
});
