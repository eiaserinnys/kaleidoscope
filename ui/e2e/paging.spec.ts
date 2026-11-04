import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { selectTab } from "./tab-helper";

const captures = process.env.KS_PAGING_CAPTURE_DIR;
async function capture(page: import("@playwright/test").Page, name: string) {
  if (!captures) return;
  mkdirSync(captures, { recursive: true });
  await page.getByTestId("app-window-paging-test").screenshot({ path: join(captures, `${name}.png`) });
}

for (const [tab, source] of [["격자 목록", "grid_items"], ["아이콘 목록", "icon_items"]] as const) {
  test(`${tab}은 다음 쪽이 마지막 줄만 채워도 자동으로 이어 받는다`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto("/?preview=paging-test");
    const app = page.getByTestId("app-window-paging-test");
    await app.getByRole("tab", { name: tab, exact: true }).click();
    if (tab === "아이콘 목록") {
      await expect(app.locator(".ks-list.is-icons > .ks-icon-skeleton-grid")).toBeVisible();
      await capture(page, "icons-initial-loading");
    }
    const list = app.getByRole("listbox");
    await expect(list.getByRole("option", { name: "첫 칸" })).toBeVisible();
    if (tab === "아이콘 목록") {
      await expect(list.locator(".ks-icon-skeleton-grid")).toBeVisible();
      await capture(page, "icons-next-loading");
    }
    await expect(list.getByRole("option", { name: "셋째 칸" })).toBeVisible();
    const calls = await page.evaluate((name) => (window as any).conversationHarness.calls().filter((call: { op: string; source?: string }) => call.op === "data.more" && call.source === name).length, source);
    expect(calls).toBe(2);
    await expect(list.getByRole("button", { name: "더 보기" })).toHaveCount(0);
  });
}

test("목록은 다음 쪽을 기다리고 실패 뒤 다시 받아 이어 붙인다", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/?preview=paging-test");
  const app = page.getByTestId("app-window-paging-test");
  const list = app.getByRole("listbox");
  await expect(list.getByRole("option", { name: "항목 1", exact: true })).toBeVisible();
  await capture(page, "list-wide-before");
  await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(list.getByRole("status", { name: "불러오는 중" })).toBeVisible();
  await capture(page, "list-wide-loading");
  await expect(list.getByText("다음 쪽을 받지 못했습니다")).toBeVisible();
  await expect(list.getByText("DATA_TEST_PAGE_FAILED")).toBeVisible();
  await list.getByRole("button", { name: "다시 받기" }).click();
  await expect(list.getByRole("option", { name: "항목 31", exact: true })).toBeVisible();
  await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(list.getByRole("option", { name: "항목 60", exact: true })).toBeVisible();
  await capture(page, "list-wide-after");
});

test("좁은 표에서 다음 쪽을 이어 붙인다", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto("/?preview=paging-test");
  const app = page.getByTestId("app-window-paging-test");
  await app.getByRole("tab", { name: "표" }).click();
  const table = app.getByRole("table");
  await expect(table.getByText("행 1", { exact: true })).toBeVisible();
  await capture(page, "table-narrow-before");
  await table.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(table.getByRole("status", { name: "불러오는 중" })).toBeVisible();
  await capture(page, "table-narrow-loading");
  await expect(table.getByText("행 31", { exact: true })).toBeVisible();
  await table.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(table.getByText("행 60", { exact: true })).toBeVisible();
  await capture(page, "table-narrow-after");
});

test("가로 가상 반복은 끝까지 가도 다음 쪽을 호출하지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto("/?preview=paging-test");
  const app = page.getByTestId("app-window-paging-test");
  await app.getByRole("tab", { name: "가로 반복" }).click();
  const repeat = app.locator(".ks-repeat.is-row");
  await expect(repeat.getByText("항목 1", { exact: true })).toBeVisible();
  await repeat.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => repeat.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect(repeat.getByText("항목 30", { exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).conversationHarness.calls().filter((call: { op: string; source?: string }) => call.op === "data.more" && call.source === "horizontal_rows").length);
  expect(calls).toBe(0);
});

for (const view of [
  { tab: "목록", role: "listbox" as const, rowRole: "option" as const, prefix: "항목", pointer: "/ui/tabs/0/child/children/1/items", failsOnce: true },
  { tab: "표", role: "table" as const, rowRole: "row" as const, prefix: "행", pointer: "/ui/tabs/1/child/children/1/rows", failsOnce: false },
]) {
  test(`${view.tab}의 쪽 추가와 다시 받기는 초점 행과 스크롤을 유지한다`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await page.goto("/?preview=paging-test");
    const app = page.getByTestId("app-window-paging-test");
    if (view.tab === "표") await app.getByRole("tab", { name: view.tab }).click();
    const scroll = app.getByRole(view.role);
    const row = (number: number) => scroll.getByRole(view.rowRole, { name: `${view.prefix} ${number}`, exact: true });
    await expect(row(1)).toBeVisible();
    await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    if (view.failsOnce) {
      await expect(scroll.getByText("다음 쪽을 받지 못했습니다")).toBeVisible();
      await scroll.getByRole("button", { name: "다시 받기" }).click();
    }
    await row(25).focus();
    if (view.role === "listbox") await expect(row(25)).toHaveAttribute("aria-setsize", "30");
    else await expect(scroll).toHaveAttribute("aria-rowcount", "30");
    const beforeAppend = await scroll.evaluate((element) => element.scrollTop);
    expect(beforeAppend).toBeGreaterThan(0);
    await expect(row(31)).toBeVisible();
    await expect(row(25)).toBeFocused();
    const afterAppend = await scroll.evaluate((element) => element.scrollTop);
    console.log(`${view.tab} 쪽 추가 스크롤: ${beforeAppend} → ${afterAppend}`);
    expect(Math.abs(afterAppend - beforeAppend)).toBeLessThanOrEqual(1);

    const calls = await page.evaluate(() => (window as any).conversationHarness.calls().filter((call: { op: string }) => call.op === "data.act").length);
    await app.getByRole("button", { name: "새로 받기" }).evaluate((button: HTMLButtonElement) => button.click());
    await expect.poll(() => page.evaluate(() => (window as any).conversationHarness.calls().filter((call: { op: string }) => call.op === "data.act").length)).toBeGreaterThan(calls);
    await expect(row(25)).toBeFocused();
    expect(Math.abs(await scroll.evaluate((element) => element.scrollTop) - beforeAppend)).toBeLessThanOrEqual(1);

    await page.evaluate(({ pointer }) => {
      const value = Array.from({ length: 40 }, (_, index) => ({ key: String(index + 1), title: `항목 ${index + 1}`, name: `행 ${index + 1}` }));
      (window as any).conversationHarness.emit({ event: "data.update", window_id: "paging-test-window", view: { sources: {}, values: { [pointer]: { status: "ready", value } } } });
    }, view);
    if (view.role === "listbox") await expect(row(25)).toHaveAttribute("aria-setsize", "40");
    else await expect(scroll).toHaveAttribute("aria-rowcount", "40");
    await expect(row(25)).toBeFocused();
    expect(Math.abs(await scroll.evaluate((element) => element.scrollTop) - beforeAppend)).toBeLessThanOrEqual(1);
  });
}

test("기존 속성·단추·가운데 오류 화면을 유지한다", async ({ page }) => {
  for (const width of [1200, 360]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/?preview=paging-comparison");
    const app = page.getByTestId("app-window-paging-comparison");
    await expect(app.locator(".ks-properties .ks-data-state-compact")).toBeVisible();
    await expect(app.locator(".ks-data-button-failure-item")).toBeVisible();
    await expect(app.locator(".ks-data-state:not(.ks-data-state-compact)")).toBeVisible();
    if (captures) {
      mkdirSync(captures, { recursive: true });
      await app.screenshot({ path: join(captures, `comparison-${width}.png`) });
    }
  }
});

const footerViews = [
  { name: "list", tab: "목록", role: "listbox" as const, rowRole: "option" as const, prefix: "항목", source: "list_items", permission: "api", pointer: "/ui/tabs/0/child/children/1/items" },
  { name: "table", tab: "표", role: "table" as const, rowRole: "row" as const, prefix: "행", source: "table_rows", permission: "alternate", pointer: "/ui/tabs/1/child/children/1/rows" },
];
type FooterView = typeof footerViews[number];
type FooterMore = { source: string; state: "ready" | "loading" | "failed"; retry: boolean; message?: string; id?: string };

async function footerFixture(page: Page, view: FooterView, width: number) {
  await page.setViewportSize({ width: width + 32, height: 700 });
  await page.goto("/?preview=paging-test&conversation=ready");
  const app = page.getByTestId("app-window-paging-test");
  if (view.tab === "표") await app.getByRole("tab", { name: view.tab }).click();
  const scroll = app.getByRole(view.role);
  await expect(scroll.getByRole(view.rowRole, { name: `${view.prefix} 1`, exact: true })).toBeVisible();
  return { app, scroll };
}

async function emitFooter(page: Page, view: FooterView, more: FooterMore, windowId = "paging-test-window") {
  await page.evaluate(({ pointer, more, windowId }) => {
    const value = Array.from({ length: 30 }, (_, index) => ({ key: String(index + 1), title: `항목 ${index + 1}`, name: `행 ${index + 1}` }));
    (window as any).conversationHarness.emit({ event: "data.update", window_id: windowId, view: { sources: {}, values: { [pointer]: { status: "ready", value, more } } } });
  }, { pointer: view.pointer, more, windowId });
}

async function showFooter(scroll: Locator) {
  const footer = scroll.locator(":scope > .ks-load-more");
  await expect(footer).toBeAttached();
  await footer.scrollIntoViewIfNeeded();
  return footer;
}

async function checkFooterGeometry(scroll: Locator, view: FooterView, state: "loading" | "failed" | "manual") {
  const metrics = await scroll.evaluate((element, { name, state }) => {
    const footer = element.querySelector<HTMLElement>(":scope > .ks-load-more")!;
    const rowText = element.querySelector<HTMLElement>(name === "list" ? ".ks-list-content" : ".ks-table-cell")!;
    const row = rowText.getBoundingClientRect();
    const rowStyle = getComputedStyle(rowText);
    const box = footer.getBoundingClientRect();
    const style = getComputedStyle(footer);
    const content = footer.querySelector<HTMLElement>(state === "loading" ? ".ks-data-skeleton" : state === "manual" ? "button" : ".ks-empty-state-icon")!.getBoundingClientRect();
    const inner = footer.firstElementChild!.getBoundingClientRect();
    const icon = footer.querySelector<HTMLElement>(".ks-empty-state-icon")?.getBoundingClientRect();
    const textElement = footer.querySelector<HTMLElement>(".ks-empty-state-text");
    const text = textElement?.getBoundingClientRect();
    const textStyle = textElement ? getComputedStyle(textElement) : undefined;
    const action = footer.querySelector<HTMLElement>(".ks-empty-state-action")?.getBoundingClientRect();
    return {
      width: element.clientWidth, scrollWidth: element.scrollWidth,
      start: box.left + parseFloat(style.paddingLeft), end: box.right - parseFloat(style.paddingRight),
      rowStart: row.left + (name === "table" ? parseFloat(rowStyle.paddingLeft) : 0),
      rowEnd: row.right - (name === "table" ? parseFloat(rowStyle.paddingRight) : 0),
      contentStart: content.left, contentEnd: content.right, bottomSpace: box.bottom - inner.bottom,
      iconRight: icon?.right, textLeft: text?.left, actionRight: action?.right,
      actionLeft: action?.left, actionTop: action?.top, textBottom: text?.bottom,
      footerContentWidth: footer.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      iconCenter: icon && (icon.top + icon.height / 2),
      firstLineCenter: text && textStyle && (text.top + parseFloat(textStyle.paddingTop) + parseFloat(textStyle.lineHeight) / 2),
    };
  }, { name: view.name, state });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width);
  expect(Math.abs(metrics.start - metrics.rowStart)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.end - metrics.rowEnd)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.contentStart - metrics.rowStart)).toBeLessThanOrEqual(1);
  expect(metrics.bottomSpace).toBeGreaterThan(0);
  if (state === "loading") expect(Math.abs(metrics.contentEnd - metrics.rowEnd)).toBeLessThanOrEqual(1);
  if (state === "failed") {
    expect(metrics.textLeft! - metrics.iconRight!).toBeGreaterThanOrEqual(0);
    expect(metrics.textLeft! - metrics.iconRight!).toBeLessThanOrEqual(8);
    if (metrics.footerContentWidth <= 420) {
      expect(metrics.actionTop!).toBeGreaterThanOrEqual(metrics.textBottom!);
      expect(Math.abs(metrics.actionLeft! - metrics.rowStart)).toBeLessThanOrEqual(1);
    } else expect(Math.abs(metrics.actionRight! - metrics.rowEnd)).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.iconCenter! - metrics.firstLineCenter!)).toBeLessThanOrEqual(1);
  }
}

for (const view of footerViews) for (const width of [1200, 360]) {
  test(`${view.name} ${width} 바닥 줄 로딩·실패·선언 오류와 다시 받기 초점`, async ({ page }) => {
    const { scroll } = await footerFixture(page, view, width);
    const more = { source: view.source, retry: false };
    await emitFooter(page, view, { ...more, state: "loading" });
    await expect(scroll.getByRole("status", { name: "불러오는 중" })).toBeVisible();
    let footer = await showFooter(scroll);
    await checkFooterGeometry(scroll, view, "loading");
    await capture(page, `${view.name}-${width}-loading`);

    await emitFooter(page, view, { ...more, state: "failed", retry: true, id: "DATA_TEST_PAGE_FAILED", message: "다음 쪽을 받지 못했습니다. 연결을 확인한 뒤 다시 받으세요." });
    const retry = scroll.getByRole("button", { name: "다시 받기" });
    await expect(retry).toBeVisible();
    footer = await showFooter(scroll);
    await checkFooterGeometry(scroll, view, "failed");
    await capture(page, `${view.name}-${width}-failed`);
    const row = scroll.getByRole(view.rowRole, { name: `${view.prefix} 25`, exact: true });
    await row.focus();
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(row).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(scroll.getByRole(view.rowRole, { name: `${view.prefix} 26`, exact: true })).toBeFocused();
    await expect(scroll.getByRole("status", { name: "불러오는 중" })).toBeVisible();
    await expect(scroll.getByRole("status", { name: "불러오는 중" })).toBeHidden();

    await emitFooter(page, view, { ...more, state: "failed", id: "DATA_SOURCE_PAGE_NEXT_INVALID", message: "다음 쪽 식을 고치세요." });
    await expect(scroll.getByText("DATA_SOURCE_PAGE_NEXT_INVALID")).toBeVisible();
    await expect(scroll.getByRole("button", { name: "다시 받기" })).toHaveCount(0);
    footer = await showFooter(scroll);
    await capture(page, `${view.name}-${width}-declaration`);
  });

  test(`${view.name} ${width} 바닥 줄 더 보기 초점`, async ({ page }) => {
    const { scroll } = await footerFixture(page, view, width);
    const more = { source: view.source, retry: false };
    await emitFooter(page, view, { ...more, state: "loading" });
    await expect(scroll.getByRole("status", { name: "불러오는 중" })).toBeVisible();
    await emitFooter(page, view, { ...more, state: "ready" });
    const button = scroll.getByRole("button", { name: "더 보기" });
    await expect(button).toBeVisible();
    await showFooter(scroll);
    await checkFooterGeometry(scroll, view, "manual");
    await capture(page, `${view.name}-${width}-more`);
    const row = scroll.getByRole(view.rowRole, { name: `${view.prefix} 25`, exact: true });
    await row.focus();
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(row).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(scroll.getByRole(view.rowRole, { name: `${view.prefix} 26`, exact: true })).toBeFocused();
    await expect(scroll.getByRole("status", { name: "불러오는 중" })).toBeVisible();
  });

  test(`${view.name} ${width} 바닥 줄 로그인 뒤 같은 원천의 다음 쪽을 받는다`, async ({ page }) => {
    const { scroll } = await footerFixture(page, view, width);
    await emitFooter(page, view, { source: view.source, state: "failed", retry: true, id: "DATA_SOURCE_MORE_LOGIN_REQUIRED", message: "다음 쪽을 받으려면 다시 로그인하세요." });
    const login = scroll.getByRole("button", { name: "로그인" });
    await expect(login).toBeVisible();
    await expect(scroll.getByText("DATA_SOURCE_MORE_LOGIN_REQUIRED")).toBeVisible();
    await expect(scroll.getByRole("button", { name: "다시 받기" })).toHaveCount(0);
    await showFooter(scroll);
    await capture(page, `${view.name}-${width}-login`);
    await login.click();
    await expect.poll(() => page.evaluate(() => (window as any).conversationHarness.calls().filter((call: { op: string }) => call.op === "data.more").length)).toBeGreaterThan(0);
    const calls = await page.evaluate(() => (window as any).conversationHarness.calls());
    expect(calls.find((call: { op: string }) => call.op === "connection.login")).toMatchObject({ permission: view.permission });
    expect(calls.find((call: { op: string }) => call.op === "data.more")).toMatchObject({ source: view.source });
  });
}

for (const view of footerViews) test(`${view.name} 바닥 줄 단추를 마우스로 눌러도 행에 초점을 둔다`, async ({ page }) => {
  let { scroll } = await footerFixture(page, view, 360);
  await emitFooter(page, view, { source: view.source, state: "failed", retry: true, id: "DATA_TEST_PAGE_FAILED", message: "다음 쪽을 받지 못했습니다." });
  await showFooter(scroll);
  let row = scroll.getByRole(view.rowRole, { name: `${view.prefix} 25`, exact: true });
  await row.focus();
  await scroll.getByRole("button", { name: "다시 받기" }).click();
  await expect(row).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(scroll.getByRole(view.rowRole, { name: `${view.prefix} 26`, exact: true })).toBeFocused();
  await expect(scroll.getByRole("status", { name: "불러오는 중" })).toBeVisible();

  ({ scroll } = await footerFixture(page, view, 360));
  await emitFooter(page, view, { source: view.source, state: "loading", retry: false });
  await expect(scroll.getByRole("status", { name: "불러오는 중" })).toBeVisible();
  await emitFooter(page, view, { source: view.source, state: "ready", retry: false });
  await showFooter(scroll);
  row = scroll.getByRole(view.rowRole, { name: `${view.prefix} 25`, exact: true });
  await row.focus();
  await scroll.getByRole("button", { name: "더 보기" }).click();
  await expect(row).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(scroll.getByRole(view.rowRole, { name: `${view.prefix} 26`, exact: true })).toBeFocused();
  await expect(scroll.getByRole("status", { name: "불러오는 중" })).toBeVisible();
});

test("가로로 넓은 표의 바닥 줄은 스크롤 칸 왼쪽에 붙는다", async ({ page }) => {
  await page.setViewportSize({ width: 392, height: 700 });
  await page.goto("/?preview=paging-test");
  const app = page.getByTestId("app-window-paging-test");
  await app.getByRole("tab", { name: "가로 폭 시험" }).click();
  const table = app.getByRole("table");
  await expect(table.getByText("행 1", { exact: true })).toBeVisible();
  await emitFooter(page, { ...footerViews[1], pointer: "/ui/tabs/3/child/rows" }, { source: "table_rows", state: "failed", retry: true, id: "DATA_TEST_PAGE_FAILED", message: "다음 쪽을 받지 못했습니다." });
  const footer = await showFooter(table);
  await table.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  const geometry = await table.evaluate((element) => {
    const frame = element.getBoundingClientRect();
    const footer = element.querySelector<HTMLElement>(":scope > .ks-load-more")!.getBoundingClientRect();
    return { scrollWidth: element.scrollWidth, width: element.clientWidth, left: frame.left, footerLeft: footer.left, footerWidth: footer.width };
  });
  expect(geometry.scrollWidth).toBeGreaterThan(geometry.width);
  expect(Math.abs(geometry.left - geometry.footerLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.width - geometry.footerWidth)).toBeLessThanOrEqual(1);
  await expect(footer.getByRole("button", { name: "다시 받기" })).toBeVisible();
  await capture(page, "table-360-horizontal-failure");
});

for (const width of [1200, 360]) test(`분할 칸 ${width} 바닥 줄이 칸 너비와 행 안쪽 선을 지킨다`, async ({ page }) => {
  await page.setViewportSize({ width: width + 32, height: 700 });
  await page.goto("/?preview=paging-split-test");
  const app = page.getByTestId("app-window-paging-split-test");
  const table = app.getByRole("table");
  const list = app.getByRole("listbox");
  await expect(table.getByText("행 1", { exact: true })).toBeVisible();
  await expect(list.getByRole("option", { name: "항목 1", exact: true })).toBeVisible();
  const tableView = { ...footerViews[1], pointer: "/ui/children/0/rows" };
  const listView = { ...footerViews[0], pointer: "/ui/children/1/items" };
  await emitFooter(page, tableView, { source: tableView.source, state: "loading", retry: false }, "paging-split-test-window");
  await emitFooter(page, listView, { source: listView.source, state: "loading", retry: false }, "paging-split-test-window");
  await showFooter(table); await showFooter(list);
  await checkFooterGeometry(table, tableView, "loading");
  await checkFooterGeometry(list, listView, "loading");
  if (captures) { mkdirSync(captures, { recursive: true }); await app.screenshot({ path: join(captures, `split-${width}-loading.png`) }); }
  await emitFooter(page, tableView, { source: tableView.source, state: "failed", retry: true, id: "DATA_TEST_PAGE_FAILED", message: "다음 쪽을 받지 못했습니다. 연결을 확인한 뒤 다시 받으세요." }, "paging-split-test-window");
  await emitFooter(page, listView, { source: listView.source, state: "ready", retry: false }, "paging-split-test-window");
  await expect(table.getByRole("button", { name: "다시 받기" })).toBeVisible();
  await expect(list.getByRole("button", { name: "더 보기" })).toBeVisible();
  await showFooter(table); await showFooter(list);
  await checkFooterGeometry(table, tableView, "failed");
  if (width === 360) {
    const heights = await table.evaluate(element => ({ pane: element.clientHeight, footer: element.querySelector(".ks-load-more")!.getBoundingClientRect().height }));
    expect(heights.footer).toBeLessThan(heights.pane / 2);
  }
  await checkFooterGeometry(list, listView, "manual");
  if (captures) await app.screenshot({ path: join(captures, `split-${width}-failed-more.png`) });
});

for (const view of [
  { name: "feed", tab: "피드 시험", selector: ".ks-feed", pointer: "/ui/tabs/4/child/entries", row: ".ks-feed-entry[tabindex='0']" },
  { name: "repeat", tab: "격자 반복", selector: ".ks-repeat.is-grid", pointer: "/ui/tabs/5/child/items", row: ".ks-repeat-item" },
]) test(`${view.name} 바닥 줄이 폭을 늘리지 않고 행에 초점을 둔다`, async ({ page }) => {
  await page.setViewportSize({ width: 392, height: 700 });
  await page.goto("/?preview=paging-test");
  const app = page.getByTestId("app-window-paging-test");
  await selectTab(app, view.tab);
  const scroll = app.locator(view.selector);
  await expect(scroll.locator(view.row).first()).toBeAttached();
  const rowStart = await scroll.locator(view.row).first().evaluate(element => element.getBoundingClientRect().left);
  if (view.name === "repeat") {
    await emitFooter(page, { ...footerViews[0], pointer: view.pointer }, { source: "list_items", state: "loading", retry: false });
    const footer = await showFooter(scroll);
    const start = await footer.locator(".ks-data-skeleton").evaluate(element => element.getBoundingClientRect().left);
    expect(Math.abs(start - rowStart)).toBeLessThanOrEqual(1);
    await capture(page, "repeat-360-loading");
  }
  await page.evaluate(({ pointer }) => {
    const value = Array.from({ length: 30 }, (_, index) => ({ key: String(index + 1), title: `항목 ${index + 1}`, body: `내용 ${index + 1}` }));
    const more = { source: "list_items", state: "failed", retry: true, id: "DATA_TEST_PAGE_FAILED", message: "다음 쪽을 받지 못했습니다. 연결을 확인한 뒤 다시 받으세요." };
    (window as any).conversationHarness.emit({ event: "data.update", window_id: "paging-test-window", view: { sources: {}, values: { [pointer]: { status: "ready", value, more } } } });
  }, view);
  await showFooter(scroll);
  if (view.name === "repeat") {
    const start = await scroll.locator(".ks-load-more .ks-empty-state-icon").evaluate(element => element.getBoundingClientRect().left);
    expect(Math.abs(start - rowStart)).toBeLessThanOrEqual(1);
  }
  const widths = await scroll.evaluate((element) => ({ content: element.scrollWidth, view: element.clientWidth }));
  expect(widths.content).toBeLessThanOrEqual(widths.view);
  await capture(page, `${view.name}-360-failed`);
  const row = view.name === "feed" ? scroll.locator(view.row).first() : scroll.locator(view.row).last();
  await scroll.getByRole("button", { name: "다시 받기" }).click();
  await expect(row).toBeFocused();
});
