import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const output = process.env.KS_GRID_CAPTURE_DIR;
async function capture(page: Page, name: string) {
  if (!output) return;
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
}

test("동적 일정표의 선택과 고정 행 머리", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await app.getByRole("tab", { name: "일정표", exact: true }).click();
  const grid = app.getByRole("grid");
  const first = grid.getByRole("gridcell", { name: /작업 묶음 1, 1일, 빈 칸/ });
  await expect(first).toBeVisible();
  await first.focus();
  await page.keyboard.press("ArrowRight");
  const next = grid.getByRole("gridcell", { name: /작업 묶음 1, 2일/ });
  await expect(next).toBeFocused();
  await expect(next).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Enter");
  await expect(next).toHaveAttribute("aria-selected", "true");
  await expect(app.getByText(/period_1/)).toBeVisible();
  await capture(page, "20261104-1640-table-wide");
  if (output) {
    const bounds = await grid.evaluate((element) => {
      const header = element.querySelector("[role=columnheader]")!.getBoundingClientRect();
      const row = element.querySelector("[role=rowheader]")!.getBoundingClientRect();
      const root = element.getBoundingClientRect();
      return { gridLeft: root.left, headerLeft: header.left, rowLeft: row.left, headerTop: header.top, rowTop: row.top };
    });
    writeFileSync(join(output, "20261104-1640-table-bounds.json"), JSON.stringify(bounds, null, 2));
  }
  const contrast = await grid.locator(".ks-table-content").filter({ has: page.getByText("긴 한글 제목과 검토 일정 1-3") }).locator(".ks-badge").first().evaluate((element) => {
    const rgb = (value: string) => value.match(/\d+/g)!.slice(0, 3).map(Number).map((v) => { const channel = v / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; });
    const luminance = (value: string) => { const [r, g, b] = rgb(value); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const style = getComputedStyle(element), foreground = luminance(style.color), background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await page.setViewportSize({ width: 400, height: 700 });
  await page.emulateMedia({ colorScheme: "dark" });
  await grid.evaluate((element) => { element.scrollLeft = 500; });
  const pinned = grid.getByRole("rowheader").first();
  await expect(pinned).toBeVisible();
  const alignment = await pinned.evaluate((element) => {
    const root = element.closest("[role=grid]")!.getBoundingClientRect();
    const rect = element.getBoundingClientRect(), row = element.parentElement!;
    return { left: Math.abs(rect.left - root.left), height: Math.abs(rect.height - row.clientHeight) };
  });
  expect(alignment.left).toBeLessThanOrEqual(2);
  expect(alignment.height).toBeLessThanOrEqual(1);
  await expect(pinned).toHaveText("작업 묶음 1");
  const headerIsOnTop = await pinned.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === element || element.contains(hit);
  });
  expect(headerIsOnTop).toBe(true);
  await capture(page, "20261104-1640-table-narrow");
  await page.keyboard.press("Home");
  await expect(first).toBeFocused();
  const revealed = await first.evaluate((element) => {
    const root = element.closest("[role=grid]")!;
    const header = root.querySelector("[role=rowheader]")!.getBoundingClientRect();
    return element.getBoundingClientRect().left >= header.right - 1;
  });
  expect(revealed).toBe(true);
});

test("기존 표 행 선택과 정렬을 유지한다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await app.getByRole("tab", { name: "표 시험", exact: true }).click();
  const table = app.getByRole("table");
  await expect(table.getByRole("columnheader", { name: "이름" })).toBeVisible();
  await table.getByRole("columnheader", { name: "이름" }).getByRole("button").click();
  await expect(table.getByRole("columnheader", { name: "이름" })).toHaveAttribute("aria-sort", "ascending");
  await capture(page, "20261104-1640-table-existing");
});

test("200행 200열에서 끝 칸까지 키보드로 이동한다", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 750 });
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await app.getByRole("tab", { name: "큰 일정표", exact: true }).click();
  const grid = app.getByRole("grid");
  const first = grid.getByRole("gridcell", { name: /그룹 1, 1일, 빈 칸/ });
  await first.focus();
  await page.keyboard.press("Control+End");
  const last = grid.getByRole("gridcell", { name: /그룹 200, 200일, 빈 칸/ });
  await expect(last).toBeFocused();
  await page.keyboard.press("Space");
  await expect(last).toHaveAttribute("aria-selected", "true");
  await capture(page, "20261104-1640-table-large");
});

test("탐색기 자세히 보기의 기존 표를 확인한다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await app.getByRole("tab", { name: "탐색기 확인" }).click();
  await app.getByRole("button", { name: "그림 고르기" }).click();
  await app.getByRole("button", { name: "자세히 보기" }).click();
  const table = app.getByRole("table", { name: "폴더 내용" });
  await expect(table.getByText("README.md")).toBeVisible();
  await capture(page, `20261104-1700-explorer-${process.env.KS_GRID_CAPTURE_MODE ?? "after"}`);
  await page.setViewportSize({ width: 400, height: 700 });
  await capture(page, `20261104-1700-explorer-narrow-${process.env.KS_GRID_CAPTURE_MODE ?? "after"}`);
});

test("동적 열이 도착하기 전 표 자리에 로딩을 보인다", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 750 });
  await page.goto("/?preview=data-views-test&grid-loading=1");
  const app = page.getByTestId("app-window-data-views-test");
  await expect(app.getByRole("status", { name: "불러오는 중" })).toBeVisible();
  await capture(page, "20261104-1700-table-loading");
  await expect(app.getByRole("table")).toBeVisible();
});

test("내용 글의 더블클릭과 드래그 선택을 구분한다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await app.getByRole("tab", { name: "일정표", exact: true }).click();
  const text = app.getByText("긴 한글 제목과 검토 일정 1-2", { exact: true });
  await text.dblclick();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  const cell = text.getByRole("gridcell").or(text.locator('xpath=ancestor::*[@role="gridcell"]'));
  await expect(cell).toHaveAttribute("aria-selected", "true");
  const selections = () => page.evaluate(() => (window as unknown as { conversationHarness: { calls: () => Array<{ op: string; pointer?: string }> } }).conversationHarness.calls().filter((call) => call.op === "data.act" && call.pointer?.endsWith("/on_select")).length);
  const before = await selections();
  const rect = (await text.boundingBox())!;
  await page.mouse.move(rect.x + 4, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, { steps: 8 });
  await page.mouse.up();
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  expect(selected).not.toBe("");
  await page.keyboard.press("Control+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(selected);
  expect(await selections()).toBe(before);
});

test("잘못된 내용 칸과 정상 칸을 함께 표시한다", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 750 });
  await page.goto("/?preview=data-views-test&grid-error=1");
  const app = page.getByTestId("app-window-data-views-test");
  await expect(app.getByText("SHELL_TABLE_CELL_CONTENT_INVALID")).toBeVisible();
  await expect(app.getByText("정상 일정")).toBeVisible();
  const error = app.getByRole("alert");
  const layout = await error.evaluate((element) => {
    const cell = element.closest('[role="gridcell"]')!.getBoundingClientRect();
    const code = element.querySelector(".ks-error-id")!.getBoundingClientRect();
    return { wraps: getComputedStyle(element).whiteSpace, codeInside: code.right <= cell.right && code.bottom <= cell.bottom };
  });
  expect(layout.wraps).toBe("normal");
  expect(layout.codeInside).toBe(true);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await error.evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  });
  await page.keyboard.press("Control+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("SHELL_TABLE_CELL_CONTENT_INVALID");
  await page.evaluate(() => window.getSelection()!.removeAllRanges());
  await capture(page, "20261104-1740-table-error-after");
});
