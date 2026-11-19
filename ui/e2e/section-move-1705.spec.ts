import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const app = "section-move-1705";
const section = (key: string) => `[data-repeat-key="${key}"] .ks-data-section-header`;
const sectionRoot = (key: string) => `[data-repeat-key="${key}"] > .ks-data-section`;
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

async function mouseDragOver(page: Page, from: string, to: string, ratio: number) {
  const source = (await page.locator(from).boundingBox())!;
  const target = (await page.locator(to).boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height * ratio, { steps: 12 });
  await page.mouse.move(target.x + target.width / 2 + 2, target.y + target.height * ratio);
}

for (const width of [1280, 360]) test(`실제 마우스: 구역 경계의 자리 표시 ${width}`, async ({ page }) => {
  await open(page, width);
  const capture = async (name: string) => {
    if (process.env.KS_1705_VISUAL_OUTPUT) await page.screenshot({ path: path.join(process.env.KS_1705_VISUAL_OUTPUT, `${width}-${name}.png`) });
  };
  await mouseDragOver(page, section("c"), section("a"), .8);
  const a = page.locator(sectionRoot("a"));
  await expect(a).toHaveAttribute("data-drop-position", "after");
  const lineY = (key: string) => page.locator(sectionRoot(key)).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const pseudo = getComputedStyle(element, "::after");
    return rect.top + parseFloat(pseudo.top);
  });
  const after = await lineY("a");
  const lastRowBottom = await page.locator('[data-tree-id="item:a2"]').evaluate((element) => element.getBoundingClientRect().bottom);
  expect(after).toBeGreaterThanOrEqual(lastRowBottom);
  await capture("expanded-after");
  await page.mouse.up();
  await expect(page.locator(".ks-repeat-item").nth(1)).toHaveAttribute("data-repeat-key", "c");
  await capture("expanded-dropped");
  await page.reload(); await page.addStyleTag({ content: hideChrome });
  await expect(page.locator(section("a"))).toBeVisible();
  await mouseDragOver(page, section("c"), section("b"), .2);
  await expect(page.locator(sectionRoot("b"))).toHaveAttribute("data-drop-position", "before");
  const before = await lineY("b");
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  await capture("next-before");
  await page.mouse.up();
  await page.reload(); await page.addStyleTag({ content: hideChrome });
  await expect(page.locator(section("a"))).toBeVisible();
  await mouseDragOver(page, section("c"), section("a"), .2);
  await expect(a).toHaveAttribute("data-drop-position", "before");
  const first = await lineY("a");
  const windowHeaderBottom = await page.locator(`[data-testid="app-window-${app}"] .ks-harness-window-header`).evaluate((element) => element.getBoundingClientRect().bottom);
  expect(first).toBeGreaterThan(windowHeaderBottom);
  console.log(`구역 자리 좌표 ${width}:`, { after, before, lastRowBottom, first, windowHeaderBottom });
  await capture("first-before");
  await page.mouse.up();
});

test("실제 마우스: 더하기 단추에서 끌어도 구역이 이동하지 않는다", async ({ page }) => {
  await open(page, 1280);
  const capture = async (name: string) => {
    if (process.env.KS_1705_VISUAL_OUTPUT) await page.screenshot({ path: path.join(process.env.KS_1705_VISUAL_OUTPUT, `1280-${name}.png`) });
  };
  await capture("plus-before");
  await mouseDragOver(page, `${section("b")} .ks-data-section-actions button`, section("c"), .8);
  await expect(page.locator(sectionRoot("c"))).not.toHaveAttribute("data-drop-position", /.+/);
  await page.mouse.up();
  await expect(page.locator(".ks-repeat-item").first()).toHaveAttribute("data-repeat-key", "a");
  await expect(page.locator(".ks-repeat-item").nth(1)).toHaveAttribute("data-repeat-key", "b");
  await capture("plus-after");
});

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
  await expect(page.locator(sectionRoot("b"))).not.toHaveAttribute("data-drop-position", /.+/);
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
  if (width === 360) {
    const header = page.locator(section("b"));
    const title = header.locator(".ks-data-section-title");
    const action = header.locator(".ks-data-section-actions");
    const sizes = await title.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth, ellipsis: getComputedStyle(element).textOverflow }));
    const titleBox = (await title.boundingBox())!;
    const actionBox = (await action.boundingBox())!;
    expect(sizes.scroll).toBeGreaterThan(sizes.client);
    expect(sizes.ellipsis).toBe("ellipsis");
    expect(Math.abs((titleBox.y + titleBox.height / 2) - (actionBox.y + actionBox.height / 2))).toBeLessThanOrEqual(2);
    await capture("long-header");
  }
  await dragStart(page, section("c"));
  await dragEvent(page, section("a"), "dragover", .2);
  await expect(page.locator(sectionRoot("a"))).toHaveAttribute("data-drop-position", "before");
  await capture("before");
  await dragEvent(page, section("a"), "dragover", .8);
  await expect(page.locator(sectionRoot("a"))).toHaveAttribute("data-drop-position", "after");
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
  await expect(page.locator(section("a")).getByRole("button", { name: "추가" })).toBeFocused();
  const metrics = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    focusVisible: !!document.activeElement && document.activeElement !== document.body,
    overlap: Array.from(document.querySelectorAll(".ks-data-section-header")).some((header) => {
      const heading = header.querySelector(".ks-data-section-toggle")?.getBoundingClientRect();
      const actions = header.querySelector(".ks-data-section-actions")?.getBoundingClientRect();
      return !!heading && !!actions && heading.right > actions.left + 1 && heading.left < actions.right - 1
        && heading.bottom > actions.top + 1 && heading.top < actions.bottom - 1;
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
