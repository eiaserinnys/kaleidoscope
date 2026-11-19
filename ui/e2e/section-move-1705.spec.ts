import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const app = "section-move-1705";
const section = (key: string) => `[data-repeat-key="${key}"] .ks-data-section-header`;
const hideChrome = `body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }`;

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`/?preview=${app}`);
  await page.addStyleTag({ content: hideChrome });
  await expect(page.locator(section("a"))).toBeVisible();
}

async function dragStart(page: Page, source: string) {
  await page.evaluate((selector) => {
    const transfer = new DataTransfer();
    (window as unknown as { transfer: DataTransfer }).transfer = transfer;
    document.querySelector(selector)!.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, source);
}
async function dragEvent(page: Page, selector: string, type: string, ratio: number) {
  await page.evaluate(({ selector, type, ratio }) => {
    const element = document.querySelector(selector)!;
    const rect = element.getBoundingClientRect();
    const transfer = (window as unknown as { transfer: DataTransfer }).transfer;
    element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: rect.top + rect.height * ratio }));
  }, { selector, type, ratio });
}

test("섹션을 끌어 실제 순서를 바꾸고 트리 끌기는 섞이지 않는다", async ({ page }) => {
  await open(page, 1000);
  const source = page.locator(section("c"));
  const target = page.locator(section("a"));
  await source.dragTo(target, { targetPosition: { x: 40, y: 3 } });
  await expect(page.locator(".ks-repeat-item").first()).toHaveAttribute("data-repeat-key", "c");
  await dragStart(page, section("c"));
  await dragEvent(page, '[data-tree-id="item:a1"]', "dragover", .2);
  await expect(page.locator('[data-tree-id="item:a1"]')).not.toHaveAttribute("data-drop-state", /.+/);
  await page.keyboard.press("Escape");
  await dragStart(page, '[data-tree-id="item:a1"]');
  await dragEvent(page, section("b"), "dragover", .2);
  await expect(page.locator(section("b"))).not.toHaveAttribute("data-drop-position", /.+/);
  await dragEvent(page, '[data-tree-id="item:a2"]', "dragover", .1);
  await expect(page.locator('[data-tree-id="item:a2"]')).toHaveAttribute("data-drop-position", "before");
  await dragEvent(page, '[data-tree-id="item:a2"]', "drop", .1);
});

for (const width of [1280, 360]) test(`시각 검수 ${width}`, async ({ page }) => {
  test.skip(!process.env.KS_1705_VISUAL_OUTPUT, "시각 검수 스크립트에서 실행");
  await open(page, width);
  const output = process.env.KS_1705_VISUAL_OUTPUT!;
  const capture = (state: string) => page.screenshot({ path: path.join(output, `${width}-${state}.png`) });
  await capture("normal");
  await dragStart(page, section("c"));
  await dragEvent(page, section("a"), "dragover", .2);
  await expect(page.locator(section("a"))).toHaveAttribute("data-drop-position", "before");
  await capture("before");
  await dragEvent(page, section("a"), "dragover", .8);
  await expect(page.locator(section("a"))).toHaveAttribute("data-drop-position", "after");
  await capture("after");
  await dragEvent(page, section("a"), "drop", .8);
  await expect(page.locator(".ks-repeat-item").nth(1)).toHaveAttribute("data-repeat-key", "c");
  await capture("dropped");
  await page.locator(section("a")).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "이름 바꾸기" })).toBeVisible();
  await capture("menu");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.locator(section("a")).locator(".ks-data-section-toggle")).toBeFocused();
  await page.keyboard.press("Tab");
  const metrics = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    focusVisible: !!document.activeElement && document.activeElement !== document.body,
    overlap: Array.from(document.querySelectorAll(".ks-data-section-header")).some((header) => {
      const heading = header.querySelector(".ks-data-section-toggle")?.getBoundingClientRect();
      const actions = header.querySelector(".ks-data-section-actions")?.getBoundingClientRect();
      return !!heading && !!actions && heading.right > actions.left + 1;
    }),
  }));
  expect(metrics.overflow).toBe(false);
  expect(metrics.focusVisible).toBe(true);
  expect(metrics.overlap).toBe(false);
  await page.locator(section("a")).click({ button: "right" });
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();
  const input = page.getByRole("textbox", { name: "구역 이름" });
  await input.fill("수정 중인 이름");
  await page.setViewportSize({ width: width === 360 ? 1280 : 360, height: 800 });
  await expect(input).toHaveValue("수정 중인 이름");
  await expect(page.getByRole("menu")).toHaveCount(0);
});
