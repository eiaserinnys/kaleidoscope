import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { selectTab } from "./tab-helper";

test("확정 삭제 뒤 다음 행에서 키보드 탐색을 이어간다", async ({ page }) => {
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await app.getByRole("tab", { name: "지우기 시험" }).click();
  const row = (name: string) => app.getByRole("option", { name, exact: true });
  for (const [target, next, keyboard] of [["항목 3", "항목 4", false], ["항목 5", "항목 6", true]] as const) {
    if (keyboard) { await row(target).focus(); await page.keyboard.press("Shift+F10"); }
    else await row(target).click({ button: "right" });
    await page.getByRole("menuitem", { name: "지우기" }).click();
    const dialog = page.getByRole("dialog");
    if (keyboard) { await page.keyboard.press("Tab"); await page.keyboard.press("Enter"); }
    else await dialog.getByRole("button", { name: "지우기" }).click();
    await expect(row(target)).toHaveCount(0);
    await expect(row(next)).toBeFocused();
  }
  await page.keyboard.press("ArrowDown");
  await expect(row("항목 7")).toBeFocused();
  const output = process.env.KS_ITEM_MENU_CAPTURE_DIR;
  if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, "delete-next-row.png") }); }
});

test("우클릭과 키보드 메뉴가 해당 행의 주소와 제목을 복사한다", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  const first = app.getByRole("option", { name: "항목 1", exact: true });
  const second = app.getByRole("option", { name: "항목 2", exact: true });
  await expect(second).toBeVisible();
  await second.click({ button: "right" });
  await expect(second).toHaveAttribute("aria-selected", "false");
  await page.getByRole("menuitem", { name: "주소 복사" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("https://example.com/2");
  await first.focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "제목 복사" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("항목 1");
});

test("위험 확인은 대상을 보이고 취소에 먼저 초점을 두며 확정 후 행으로 돌아간다", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  const row = app.getByRole("option", { name: "항목 6", exact: true });
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "지우기" }).click();
  const dialog = page.getByRole("dialog", { name: "지울까요?" });
  await expect(dialog.getByText("항목 6", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "취소" })).toBeFocused();
  const output = process.env.KS_ITEM_MENU_CAPTURE_DIR;
  if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, "confirm-target-cancel-focus.png") }); }
  await dialog.getByRole("button", { name: "지우기" }).click();
  await expect(row).toBeFocused();
  if (output) await page.screenshot({ path: join(output, "confirm-restored-focus.png") });
  await row.focus();
  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "취소" })).toBeFocused();
  if (output) await page.screenshot({ path: join(output, "confirm-keyboard-cancel-focus.png") });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(row).toBeFocused();
  if (output) await page.screenshot({ path: join(output, "confirm-keyboard-restored.png") });
});

test("고르기 없는 피드의 키보드 초점 테두리가 안쪽에 표시된다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await app.getByRole("tab", { name: "흐름 시험", exact: true }).click();
  const row = app.getByRole("article").first();
  await app.getByRole("button", { name: "추가" }).focus();
  await page.keyboard.press("Tab");
  await expect(row).toBeFocused();
  const offset = await row.evaluate((element) => getComputedStyle(element).outlineOffset);
  expect(parseFloat(offset)).toBeLessThan(0);
  const output = process.env.KS_ITEM_MENU_CAPTURE_DIR;
  if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, "feed-focus.png") }); }
});

for (const [name, width, height] of [["wide", 1440, 900], ["narrow", 520, 720]] as const) {
  test(`${name} 목록, 표, 피드 메뉴 캡처`, async ({ page }) => {
    const output = process.env.KS_ITEM_MENU_CAPTURE_DIR;
    await page.setViewportSize({ width, height });
    await page.goto("/?preview=data-views-test");
    const app = page.getByTestId("app-window-data-views-test");
    const capture = async (surface: string) => {
      await expect(page.getByRole("menu")).toBeVisible();
      if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, `${name}-${surface}.png`) }); }
      await page.keyboard.press("Escape");
    };
    await app.getByRole("option", { name: "항목 1", exact: true }).click({ button: "right" });
    await capture("list");
    await app.getByRole("tab", { name: "표 시험" }).click();
    await app.locator(".ks-table-row").first().click({ button: "right" });
    await capture("table");
    await selectTab(app, "선택 흐름 시험");
    await app.getByRole("article").first().click({ button: "right" });
    await capture("feed");
  });
}
