import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";

const captureDirectory = process.env.KS_PROGRESS_CAPTURE_DIR;

async function capture(page: Page, name: string) {
  if (!captureDirectory) return;
  mkdirSync(captureDirectory, { recursive: true });
  await page.screenshot({ path: join(captureDirectory, `${name}.png`), fullPage: true });
}

async function dragText(page: Page, target: Locator) {
  const range = await target.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!(node.textContent ?? "").trim()) continue;
      const text = node.textContent ?? "";
      const selection = document.createRange();
      selection.setStart(node, 0);
      selection.setEnd(node, Math.min(text.length, 8));
      const rect = selection.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    return null;
  });
  expect(range, "target contains visible text").not.toBeNull();
  await page.mouse.move(range!.x + 1, range!.y + range!.height / 2);
  await page.mouse.down();
  await page.mouse.move(range!.x + Math.max(range!.width + 8, 28), range!.y + range!.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function selectionText(page: Page) {
  return page.evaluate(() => window.getSelection()?.toString() ?? "");
}

// 선택이 없어진 상태에서 끌어야 "선택되지 않는다"를 제대로 본다. user-select: none 위에서 끌면
// 브라우저가 앞선 선택을 지우지 않는다.
async function clearSelection(page: Page) {
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
}

// 트랙이 같은 역할의 다른 직선 트랙(미디어 탐색 막대)과 같은 토큰을 쓰는지 본다.
// 토큰을 직접 푸는 대신 창 안에 탐침 요소를 두어 지금 테마의 계산값을 받는다.
async function trackTokenColor(app: Locator) {
  return app.evaluate((element) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--ks-color-border)";
    element.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  });
}

async function fillRatios(app: Locator) {
  return app.locator(".ks-data-progress-value").evaluateAll((elements) => elements.map((element) => {
    const transform = getComputedStyle(element).transform;
    if (transform === "none") return 1;
    const match = /^matrix\(([-0-9.e+]+),/.exec(transform);
    return match ? Number(match[1]) : null;
  }));
}

for (const theme of ["light", "dark"] as const) {
  test(`진행 막대 트랙이 ${theme} 테마에서 트랙 토큰과 같고 채움 비율이 값과 맞는다`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/?preview=progress-track-test");
    const app = page.getByTestId("app-window-progress-track-test");
    await expect(app.locator(".ks-data-progress")).toHaveCount(3);
    await expect(app.locator(".ks-data-progress-label")).toHaveCount(3);

    const expected = await trackTokenColor(app);
    const tracks = await app.locator(".ks-data-progress").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundColor));
    expect(tracks).toEqual([expected, expected, expected]);

    const ratios = await fillRatios(app);
    expect(ratios).toHaveLength(3);
    [0, 0.5, 1].forEach((value, index) => expect(ratios[index], `${value * 100}% 막대의 채움`).toBeCloseTo(value, 2));

    await capture(page, `progress-track-${theme}`);
  });
}

test("진행 막대 이름표와 구역 메타는 선택되고, 구역 제목과 접는 머리 메타는 선택되지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?preview=progress-track-test");
  const app = page.getByTestId("app-window-progress-track-test");
  await expect(app.locator(".ks-data-progress")).toHaveCount(3);
  const toggleMeta = app.locator(".ks-data-section-toggle .ks-data-section-meta").first();

  await clearSelection(page);
  await dragText(page, app.locator(".ks-data-section-title").first());
  expect(await selectionText(page)).toBe("");

  await clearSelection(page);
  await dragText(page, toggleMeta);
  expect(await selectionText(page)).toBe("");

  await clearSelection(page);
  await toggleMeta.dblclick();
  expect(await selectionText(page)).toBe("");

  await clearSelection(page);
  await dragText(page, app.locator(".ks-data-progress-label").first());
  expect(await selectionText(page)).toContain("7일");

  await clearSelection(page);
  await dragText(page, app.locator(".ks-data-section-meta").first());
  expect(await selectionText(page)).toContain("eias@");
});
