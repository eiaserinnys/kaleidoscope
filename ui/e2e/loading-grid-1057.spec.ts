import { expect, test } from "@playwright/test";
import { selectTab } from "./tab-helper";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("격자 로딩 칸과 실제 칸이 같은 자리를 쓴다", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/?preview=paging-test");
  const app = page.getByTestId("app-window-paging-test");
  await selectTab(app, "격자 목록");
  const item = app.getByRole("option", { name: "첫 칸" });
  await expect(item).toBeVisible();
  await expect(app.getByRole("option", { name: "셋째 칸" })).toBeVisible();
  await page.evaluate(() => (window as any).conversationHarness.emit({ event: "data.update", window_id: "paging-test-window", view: {
    sources: {}, values: { "/ui/tabs/6/child/items": { status: "ready", value: Array.from({ length: 30 }, (_, index) => ({ key: String(index), title: index === 0 ? "첫 칸" : `항목 ${index}` })) } },
  } }));
  await expect(item).toHaveAttribute("aria-setsize", "30");
  const before = (await item.boundingBox())!;
  await page.evaluate(() => (window as any).conversationHarness.emit({ event: "data.update", window_id: "paging-test-window", view: {
    sources: {}, values: { "/ui/tabs/6/child/items": { status: "loading" } },
  } }));
  const loading = app.getByRole("status", { name: "불러오는 중" });
  await expect(loading.locator(".ks-list-card")).toHaveCount(12);
  const after = (await loading.locator(".ks-list-card").first().boundingBox())!;
  expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.height - after.height)).toBeLessThanOrEqual(1);
});

test("행 로딩의 높이는 실제 행과 같다", async ({ page }) => {
  await page.goto("/?preview=paging-test");
  const app = page.getByTestId("app-window-paging-test");
  const row = app.getByRole("option", { name: "항목 1", exact: true });
  await expect(row).toBeVisible();
  const height = (await row.boundingBox())!.height;
  await page.evaluate(() => (window as any).conversationHarness.emit({ event: "data.update", window_id: "paging-test-window", view: {
    sources: {}, values: { "/ui/tabs/0/child/children/1/items": { status: "loading" } },
  } }));
  const loading = app.getByRole("status", { name: "불러오는 중" });
  await expect(loading.locator(".ks-list-row")).toHaveCount(8);
  expect(Math.abs(height - (await loading.locator(".ks-list-row").first().boundingBox())!.height)).toBeLessThanOrEqual(1);
});

test("트리와 표도 로딩 행 높이를 실제 행과 맞춘다", async ({ page }) => {
  await page.goto("/?preview=loading-rows-1057");
  const app = page.getByTestId("app-window-loading-rows-1057");
  const treeRow = app.getByRole("treeitem").first();
  const tableRow = app.getByRole("table").locator(".ks-table-row").first();
  await expect(treeRow).toBeVisible();
  await expect(tableRow).toBeVisible();
  const heights = [(await treeRow.boundingBox())!.height, (await tableRow.boundingBox())!.height];
  await page.evaluate(() => (window as any).conversationHarness.emit({ event: "data.update", window_id: "loading-rows-1057-window", view: {
    sources: {}, values: { "/ui/children/0/items": { status: "loading" }, "/ui/children/1/rows": { status: "loading" } },
  } }));
  const loading = app.locator(".ks-data-loading-rows");
  await expect(loading).toHaveCount(2);
  for (let index = 0; index < 2; index++) {
    await expect(loading.nth(index).locator(".ks-row")).toHaveCount(8);
    const height = (await loading.nth(index).locator(".ks-row").first().boundingBox())!.height;
    expect(Math.abs(height - heights[index])).toBeLessThanOrEqual(1);
  }
});

test("빈 목록은 채움 칸 가운데에 놓인다", async ({ page }) => {
  await page.goto("/?preview=paging-test");
  const app = page.getByTestId("app-window-paging-test");
  await selectTab(app, "구역 상태");
  await expect(app.getByRole("option", { name: "항목 1", exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).conversationHarness.emit({ event: "data.update", window_id: "paging-test-window", view: {
    sources: {}, values: { "/ui/tabs/9/child/child/children/1/items": { status: "ready", value: [] } },
  } }));
  const empty = app.locator(".ks-no-items");
  await expect(empty).toBeVisible();
  const geometry = await empty.evaluate(el => {
    const item = el.getBoundingClientRect(), parent = el.parentElement!.getBoundingClientRect();
    return { height: item.height, parentHeight: parent.height, delta: Math.abs((item.top + item.bottom) / 2 - (parent.top + parent.bottom) / 2) };
  });
  expect(geometry.height).toBeGreaterThan(100);
  expect(geometry.delta).toBeLessThanOrEqual(1);
});

test("내용 높이 쌓기의 빈 목록은 남은 칸을 차지하지 않는다", async ({ page }) => {
  await page.goto("/?preview=empty-natural-1057");
  const app = page.getByTestId("app-window-empty-natural-1057");
  const empty = app.locator(".ks-no-items");
  await expect(empty).toBeVisible();
  const heights = await empty.evaluate(el => ({ empty: el.getBoundingClientRect().height,
    stack: el.closest(".ks-data-stack")!.getBoundingClientRect().height,
    panel: el.closest(".ks-data-tab-panel")!.getBoundingClientRect().height }));
  expect(heights.empty).toBeLessThan(heights.panel / 2);
  expect(heights.stack).toBeLessThan(heights.panel / 2);
});

test("선택된 아이콘 타일은 누르는 동안 호버와 다르게 표시된다", async ({ page }) => {
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await selectTab(app, "아이콘 시험");
  const tile = app.getByRole("option", { name: "계산기 플러스" });
  await tile.click();
  await expect(tile).toHaveAttribute("aria-selected", "true");
  await tile.hover();
  const hovered = await tile.evaluate(el => getComputedStyle(el).backgroundImage);
  if (process.env.KS_1057_CAPTURE_DIR) {
    await app.screenshot({ path: `${process.env.KS_1057_CAPTURE_DIR}/icon-hover.png` });
  }
  await page.mouse.down();
  const pressed = await tile.evaluate(el => getComputedStyle(el).backgroundImage);
  expect(pressed).not.toBe(hovered);
  expect(pressed).toContain("linear-gradient");
  if (process.env.KS_1057_CAPTURE_DIR) {
    await app.screenshot({ path: `${process.env.KS_1057_CAPTURE_DIR}/icon-pressed.png` });
  }
  await page.mouse.up();
});
