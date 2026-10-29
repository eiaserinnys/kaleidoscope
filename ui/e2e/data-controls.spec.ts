import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const output = process.env.KS_DATA_CAPTURE_DIR;
async function capture(page: import("@playwright/test").Page, name: string) {
  if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, `${name}.png`), fullPage: true }); }
}

test("범용 블록의 탭, 입력, 확인과 상태를 조작한다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?preview=data-controls");
  const app = page.getByTestId("app-window-data-controls");
  await expect(app.getByRole("status", { name: "불러오는 중" })).toBeVisible();
  await capture(page, "wide-loading");
  await expect(app.getByText("데이터를 불러왔습니다")).toBeVisible();
  await expect(app.getByText("데이터를 받지 못했습니다")).toBeVisible();
  await capture(page, "wide-ready");

  const tab = app.getByRole("tab", { name: "기본" });
  await tab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(app.getByRole("tab", { name: "다른 탭" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(app.getByText("두 번째 탭")).toBeVisible();
  await app.getByRole("tab", { name: "기본" }).click();

  const multiline = app.getByPlaceholder("여러 줄 입력");
  const before = await multiline.boundingBox();
  await multiline.click();
  await page.keyboard.type("첫 줄");
  await page.keyboard.press("Enter");
  await page.keyboard.type("둘째 줄");
  const after = await multiline.boundingBox();
  expect(after!.height).toBeGreaterThan(before!.height);
  const toolbar = app.locator(".ks-data-toolbar");
  const boxes = await toolbar.locator("input, button").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, centerY: rect.y + rect.height / 2 };
  }));
  expect(Math.max(...boxes.map((box) => box.centerY)) - Math.min(...boxes.map((box) => box.centerY))).toBeLessThanOrEqual(1);
  const edges = await Promise.all([
    toolbar.locator("input").boundingBox(),
    app.getByRole("tab", { name: "기본" }).boundingBox(),
    app.locator(".ks-data-section-header").first().boundingBox(),
  ]);
  expect(Math.max(...edges.map((box) => box!.x)) - Math.min(...edges.map((box) => box!.x))).toBeLessThanOrEqual(1);
  if (output) writeFileSync(join(output, "toolbar-metrics.json"), JSON.stringify(boxes, null, 2));

  const remove = app.getByRole("button", { name: "삭제" });
  await remove.click();
  const dialog = app.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "삭제" })).toBeFocused();
  await capture(page, "wide-dialog");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();
  await app.getByRole("button", { name: "실행" }).click();
  await expect(app.getByRole("alert").filter({ hasText: "요청을 처리하지 못했습니다" })).toBeVisible();
  await capture(page, "wide-notice");

  await page.setViewportSize({ width: 700, height: 700 });
  await capture(page, "narrow-notice");
  await app.getByRole("button", { name: "삭제" }).click();
  await capture(page, "narrow-dialog");
});
