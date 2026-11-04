import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const captures = process.env.KS_PAGING_CAPTURE_DIR;
async function capture(page: import("@playwright/test").Page, name: string) {
  if (!captures) return;
  mkdirSync(captures, { recursive: true });
  await page.getByTestId("app-window-paging-test").screenshot({ path: join(captures, `${name}.png`) });
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
    const beforeAppend = await scroll.evaluate((element) => element.scrollTop);
    await expect(row(31)).toBeVisible();
    await expect(row(25)).toBeFocused();
    expect(Math.abs(await scroll.evaluate((element) => element.scrollTop) - beforeAppend)).toBeLessThanOrEqual(1);

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
