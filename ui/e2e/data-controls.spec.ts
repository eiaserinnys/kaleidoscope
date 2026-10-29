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
  await expect(app.getByText("데이터를 받지 못했습니다").first()).toBeVisible();
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

test("확인 대화상자와 실패한 구역 머리의 조작을 격리한다", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 700 });
  await page.goto("/?preview=data-controls");
  const app = page.getByTestId("app-window-data-controls");
  const header = app.locator(".ks-data-section-header").filter({ has: page.getByRole("button", { name: "다시 받기" }) });
  const sectionToggle = header.getByRole("button", { name: "접기" });
  await expect(sectionToggle).toHaveAttribute("aria-expanded", "true");
  await header.getByRole("button", { name: "다시 받기" }).click();
  await expect(sectionToggle).toHaveAttribute("aria-expanded", "true");
  await expect(app.getByText("구역 내용")).toBeVisible();
  await capture(page, "section-retry");

  await app.getByRole("button", { name: "실행" }).click();
  await expect(app.getByRole("alert").filter({ hasText: "요청을 처리하지 못했습니다" })).toBeVisible();
  const opener = app.getByRole("button", { name: "삭제" });
  await opener.click();
  const dialog = app.getByRole("dialog");
  const cancel = dialog.getByRole("button", { name: "취소" });
  const confirm = dialog.getByRole("button", { name: "삭제" });
  await expect(app.locator(".ks-data-window-body")).toHaveAttribute("inert", "");
  await expect(app.locator(".ks-data-window-notice")).toHaveAttribute("inert", "");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(confirm).toBeFocused();
  await capture(page, "dialog-trapped");
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await opener.click();
  await dialog.getByRole("button", { name: "삭제" }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeEnabled();
  await expect(opener).toBeFocused();
  await expect(app.locator(".ks-data-window-body")).not.toHaveAttribute("inert", "");
});

test("도구막대는 세 폭에서 겹치거나 글자를 줄바꿈하지 않는다", async ({ page }) => {
  const metrics = [];
  for (const width of [400, 700, 1440]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/?preview=data-controls");
    const app = page.getByTestId("app-window-data-controls");
    const toolbar = app.locator(".ks-data-toolbar");
    await expect(toolbar.getByRole("button", { name: "실행" })).toBeVisible();
    const boxes = await toolbar.locator("input, button").evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const text = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      const range = document.createRange();
      if (text) range.selectNodeContents(text);
      return { text: element.textContent?.trim(), x: rect.x, y: rect.y, width: rect.width, height: rect.height, lines: text ? range.getClientRects().length : 0 };
    }));
    for (const [index, box] of boxes.entries()) {
      expect(box.lines).toBeLessThanOrEqual(1);
      for (const other of boxes.slice(index + 1)) {
        const overlapX = Math.min(box.x + box.width, other.x + other.width) - Math.max(box.x, other.x);
        const overlapY = Math.min(box.y + box.height, other.y + other.height) - Math.max(box.y, other.y);
        expect(overlapX <= 0 || overlapY <= 0).toBe(true);
      }
    }
    expect(new Set(boxes.map((box) => box.y)).size).toBe(1);
    metrics.push({ width, boxes });
    await capture(page, `toolbar-${width}`);
  }
  if (output) writeFileSync(join(output, "toolbar-widths.json"), JSON.stringify(metrics, null, 2));
});
