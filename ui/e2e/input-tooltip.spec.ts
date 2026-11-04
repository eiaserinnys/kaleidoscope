import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

async function crossGap(page: Page, trigger: Locator, side: "above" | "below") {
  const tip = page.getByRole("tooltip");
  const button = (await trigger.boundingBox())!;
  const popup = (await tip.boundingBox())!;
  const gap = side === "above" ? button.y - (popup.y + popup.height) : popup.y - (button.y + button.height);
  expect(gap).toBeCloseTo(8, 1);
  const x = (Math.max(button.x, popup.x) + Math.min(button.x + button.width, popup.x + popup.width)) / 2;
  const start = side === "above" ? button.y + 2 : button.y + button.height - 2;
  const middle = side === "above" ? button.y - 4 : button.y + button.height + 4;
  const end = side === "above" ? popup.y + popup.height - 2 : popup.y + 2;
  await page.mouse.move(x, start);
  await page.mouse.move(x, middle, { steps: 4 });
  expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[role="tooltip"]')), { x, y: middle })).toBe(true);
  await expect(tip).toBeVisible();
  await page.mouse.move(x, end, { steps: 4 });
  await expect(tip).toBeVisible();
  return { gap, button, popup };
}

test("단추 설명은 간격을 두고 올림과 키보드에서 열리며 틈을 지나도 유지된다", async ({ page }) => {
  const output = process.env.KS_TOOLTIP_CAPTURE_DIR;
  const measurements: Record<string, unknown> = {};
  if (output) mkdirSync(output, { recursive: true });
  for (const [width, theme] of [[1200, "light"], [360, "dark"]] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/?preview=block-gallery");
    const app = page.getByTestId("app-window-block-gallery");
    await app.getByRole("tab", { name: "입력" }).click();
    const first = app.getByRole("button", { name: "하나 더" });
    const icon = app.getByRole("button", { name: "되돌리기" });
    const preview = app.getByRole("button", { name: "그림 고르기" });
    const danger = app.getByRole("button", { name: "모두 지우기" });
    await first.hover();
    await expect(page.getByRole("tooltip")).not.toBeVisible({ timeout: 200 });
    await expect(page.getByRole("tooltip")).toHaveText("횟수를 하나 늘립니다.");
    if (output) await page.screenshot({ path: join(output, `text-${width}-${theme}.png`) });
    const above = await crossGap(page, first, "above");
    await icon.hover();
    await expect(page.getByRole("tooltip")).toContainText("되돌리기", { timeout: 250 });
    await expect(icon).not.toHaveAttribute("title");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.waitForTimeout(600);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await first.click();
    await expect(icon).toBeEnabled();
    await page.keyboard.press("Tab");
    await expect(icon).toBeFocused();
    await expect(page.getByRole("tooltip")).toContainText("되돌리기");
    const colors = await page.getByRole("tooltip").locator(".ks-tooltip-line").evaluateAll((lines) => lines.map((line) => getComputedStyle(line).color));
    expect(colors).toHaveLength(2);
    expect(colors[0]).not.toBe(colors[1]);
    if (output) await page.screenshot({ path: join(output, `icon-keyboard-${width}-${theme}.png`) });
    await page.keyboard.press("Escape");
    await preview.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("tooltip")).toHaveText("현재 그림을 확인합니다.");
    if (output) await page.screenshot({ path: join(output, `preview-${width}-${theme}.png`) });
    await page.keyboard.press("Escape");
    await danger.hover();
    await expect(page.getByRole("tooltip")).toHaveText("현재 입력과 횟수를 모두 지우고 처음 상태로 되돌립니다.");
    const dangerBox = (await danger.boundingBox())!;
    const dangerTip = (await page.getByRole("tooltip").boundingBox())!;
    expect(Math.abs(dangerTip.x + dangerTip.width - (dangerBox.x + dangerBox.width))).toBeLessThanOrEqual(1);
    if (output) await page.screenshot({ path: join(output, `danger-${width}-${theme}.png`) });
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('button[aria-label="하나 더"]')!;
      button.style.position = "fixed";
      button.style.top = "14px";
      button.style.left = "40px";
      button.style.zIndex = "20";
    });
    await page.mouse.move(width - 1, 799);
    await first.hover();
    await expect(page.getByRole("tooltip")).toHaveText("횟수를 하나 늘립니다.");
    const below = await crossGap(page, first, "below");
    if (output) await page.screenshot({ path: join(output, `below-${width}-${theme}.png`) });
    measurements[`${width}-${theme}`] = { above, below, dangerBox, dangerTip, colors };
  }
  if (output) writeFileSync(join(output, "metrics.json"), JSON.stringify(measurements, null, 2));
});
