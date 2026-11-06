import { expect, test } from "@playwright/test";
import { selectTab } from "./tab-helper";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

for (const count of [3, 30]) test(`격자 로딩 칸과 실제 칸이 같은 자리를 쓴다: ${count}개`, async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/?preview=paging-test");
  const app = page.getByTestId("app-window-paging-test");
  await selectTab(app, "격자 목록");
  const item = app.getByRole("option", { name: "첫 칸" });
  await expect(item).toBeVisible();
  await expect(app.getByRole("option", { name: "셋째 칸" })).toBeVisible();
  await page.evaluate((count) => (window as any).conversationHarness.emit({ event: "data.update", window_id: "paging-test-window", view: {
    sources: {}, values: { "/ui/tabs/6/child/items": { status: "ready", value: Array.from({ length: count }, (_, index) => ({ key: String(index), title: index === 0 ? "첫 칸" : `항목 ${index}` })) } },
  } }), count);
  await expect(item).toHaveAttribute("aria-setsize", String(count));
  const before = (await item.boundingBox())!;
  const geometry = await app.locator(".ks-list.is-grid").evaluate(el => ({
    scrollbar: el.offsetWidth - el.clientWidth,
    columns: getComputedStyle(el.querySelector(".ks-list-grid-row")!).gridTemplateColumns.trim().split(/\s+/).length,
  }));
  await page.evaluate(() => (window as any).conversationHarness.emit({ event: "data.update", window_id: "paging-test-window", view: {
    sources: {}, values: { "/ui/tabs/6/child/items": { status: "loading" } },
  } }));
  const loading = app.getByRole("status", { name: "불러오는 중" });
  await expect(loading).toHaveCSS("pointer-events", "none");
  await expect(loading.locator(".ks-list-card")).toHaveCount(12);
  const after = (await loading.locator(".ks-list-card").first().boundingBox())!;
  expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(geometry.scrollbar / geometry.columns + 1);
  if (count === 3) expect(geometry.scrollbar).toBe(0);
});

for (const kind of ["tree", "table"] as const) for (const context of ["window", "pane", "toolbar", "section", "tab"] as const) {
  test(`${kind} 첫 행은 ${context} 로딩 전후 같은 위치다`, async ({ page }) => {
    const id = `loading-position-1057-${kind}-${context}`;
    const pointer = context === "pane" ? "/ui/children/0" : context === "toolbar" ? "/ui/children/1"
      : context === "section" ? "/ui/child" : context === "tab" ? "/ui/tabs/0/child" : "/ui";
    await page.goto(`/?preview=${id}`);
    const app = page.getByTestId(`app-window-${id}`);
    // 뼈대 행이 아니라 자료가 든 행을 기준으로 잡는다. 자료가 오기 전에 로딩을 흉내 내면 늦게 온 자료가 그것을 덮는다.
    const row = app.getByRole(kind === "tree" ? "treeitem" : "row", { name: "데이터를 불러왔습니다" });
    await expect(row).toBeVisible();
    const before = (await row.boundingBox())!;
    await page.evaluate(({ id, pointer, kind }) => (window as any).conversationHarness.emit({ event: "data.update", window_id: `${id}-window`, view: {
      sources: {}, values: { [`${pointer}/${kind === "tree" ? "items" : "rows"}`]: { status: "loading" } },
    } }), { id, pointer, kind });
    const loading = app.locator(".ks-data-loading-rows");
    await expect(loading).toHaveCSS("pointer-events", "none");
    await expect(loading.locator(".ks-row")).toHaveCount(8);
    const after = (await loading.locator(kind === "tree" ? ".ks-file-tree-row" : ".ks-table-row").first().boundingBox())!;
    expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(before.height - after.height)).toBeLessThanOrEqual(1);
  });
}

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
  const treeRow = app.getByRole("treeitem", { name: "데이터를 불러왔습니다" });
  const tableRow = app.getByRole("row", { name: "데이터를 불러왔습니다" });
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

for (const context of ["direct", "section"] as const) test(`쌓인 분할 칸의 빈 목록도 칸을 채운다: ${context}`, async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(`/?preview=empty-stacked-1057-${context}`);
  const app = page.getByTestId(`app-window-empty-stacked-1057-${context}`);
  const empty = app.locator(".ks-split.is-stacked .ks-no-items");
  await expect(empty).toBeVisible();
  const geometry = await empty.evaluate(el => {
    const item = el.getBoundingClientRect();
    const parent = (el.closest(".ks-data-section-child") ?? el.closest(".ks-split-pane"))!;
    const bounds = parent.getBoundingClientRect(), style = getComputedStyle(parent);
    const top = bounds.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
    const bottom = bounds.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom);
    return { height: item.height, delta: Math.abs((item.top + item.bottom) / 2 - (top + bottom) / 2) };
  });
  expect(geometry.height).toBeGreaterThan(200);
  expect(geometry.delta).toBeLessThanOrEqual(1);
});

test("쌓인 분할 칸 안의 내용 높이 목록은 늘리지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto("/?preview=empty-stacked-1057-natural");
  const app = page.getByTestId("app-window-empty-stacked-1057-natural");
  const empty = app.locator(".ks-split.is-stacked .ks-data-stack-item:not(.is-fill) > .ks-no-items");
  await expect(empty).toBeVisible();
  expect((await empty.boundingBox())!.height).toBeLessThan(100);
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
