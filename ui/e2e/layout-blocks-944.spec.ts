import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const output = process.env.KS_LAYOUT_CAPTURE_DIR;
const stage = process.env.KS_LAYOUT_CAPTURE_STAGE ?? "after";
async function prepare(page: import("@playwright/test").Page, width: number, app: string) {
  await page.setViewportSize({ width: width + 2, height: 920 });
  await page.goto(`/?preview=${app}`);
  await page.addStyleTag({ content: "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return page.getByTestId(`app-window-${app}`);
}
async function capture(app: import("@playwright/test").Locator, name: string) {
  if (!output) return;
  mkdirSync(output, { recursive: true });
  await app.screenshot({ path: join(output, `${stage}-${name}.png`) });
}

test("기본 앱 탭 화면의 넓은 폭과 최소 폭", async ({ page }) => {
  for (const width of [1100, 360]) {
    const app = await prepare(page, width, "earth");
    await expect(app.getByRole("tab").first()).toBeVisible();
    await capture(app, `earth-${width}`);
  }
});

test("탭 넘침과 분할 폭, 반복 간격", async ({ page }) => {
  const app = await prepare(page, 360, "block-gallery");
  const list = app.locator(".ks-data-tab-list").first();
  const more = app.getByRole("button", { name: "탭 더 보기" }).first();
  await expect(more).toBeVisible();
  expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await capture(app, "tabs-360");
  await more.click();
  await expect(page.getByRole("menuitem", { name: "배치" })).toBeVisible();
  if (output) await page.screenshot({ path: join(output, `${stage}-tabs-menu-360.png`) });
  await page.getByRole("menuitem", { name: "배치" }).click();
  const layoutTab = app.getByRole("tab", { name: "배치" });
  await expect(layoutTab).toBeVisible();
  await expect(layoutTab).toHaveAttribute("aria-selected", "true");
  const split = app.locator(".ks-data-tab-panel:visible > .ks-split");
  await expect(split).toHaveClass(/ks-split-column/);
  const input = split.getByRole("textbox");
  await input.fill("유지할 메모");
  const repeat = split.locator(".ks-repeat.is-column");
  const rows = repeat.locator(".ks-repeat-item");
  await expect(rows).toHaveCount(3);
  const gap = await rows.evaluateAll((els) => els[1].getBoundingClientRect().top - els[0].getBoundingClientRect().bottom);
  expect(gap).toBe(24);
  await capture(app, "split-column-360");
  await page.setViewportSize({ width: 1102, height: 920 });
  await expect(split).toHaveClass(/ks-split-row/);
  await expect(input).toHaveValue("유지할 메모");
  await expect(split.locator(":scope > .ks-split-pane:first-child > .ks-split")).toHaveClass(/ks-split-column/);
  await expect(app.getByRole("button", { name: "탭 더 보기" })).toHaveCount(0);
  await capture(app, "split-row-1100");
  const panes = await split.locator(":scope > .ks-split-pane").evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, start: parseFloat(style.paddingLeft), end: parseFloat(style.paddingRight) };
  }));
  console.log(`3칸 분할 정렬: ${JSON.stringify(panes)}`);
  expect(panes[1].start).toBe(panes[0].end);
  expect(panes[1].end).toBe(panes[2].start);
  await layoutTab.focus();
  await page.keyboard.press("Home");
  await expect(app.getByRole("tab", { name: "목록" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(layoutTab).toHaveAttribute("aria-selected", "true");
});

test("repeat 기본 간격의 넓은 폭과 최소 폭", async ({ page }) => {
  for (const width of [1100, 360]) {
    const app = await prepare(page, width, "follow-fixture");
    await expect(app.locator(".ks-repeat-item").first()).toBeVisible();
    await capture(app, `repeat-default-${width}`);
  }
});

test("긴 선택 탭을 말줄여 더 보기 단추를 온전히 표시한다", async ({ page }) => {
  const app = await prepare(page, 360, "long-tabs-fixture");
  const name = "프로젝트의 아주 긴 이름과 여러 항목을 함께 살펴보는 상세 작업 화면과 변경 기록";
  const selected = app.getByRole("tab", { name, exact: true });
  const list = app.getByRole("tablist");
  const more = app.getByRole("button", { name: "탭 더 보기" });
  await expect(selected).toBeVisible();
  await expect(more).toBeVisible();
  const bounds = await list.evaluate((element) => {
    const tab = element.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!;
    const moreButton = element.querySelector<HTMLElement>('[aria-label="탭 더 보기"]')!;
    const label = tab.querySelector<HTMLElement>(".ks-truncate-label");
    const container = element.getBoundingClientRect();
    const button = moreButton.getBoundingClientRect();
    return { container: container.toJSON(), button: button.toJSON(), clipped: Boolean(label && label.scrollWidth > label.clientWidth), ellipsis: label && getComputedStyle(label).textOverflow };
  });
  expect(bounds.button.left).toBeGreaterThanOrEqual(bounds.container.left);
  expect(bounds.button.right).toBeLessThanOrEqual(bounds.container.right);
  expect(bounds.clipped).toBe(true);
  expect(bounds.ellipsis).toBe("ellipsis");
  await capture(app, "long-selected-tab-360");
  await more.click();
  await page.getByRole("menuitem", { name: "상세 보기" }).click();
  await expect(app.getByRole("tab", { name: "상세 보기" })).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 1102, height: 920 });
  await expect(app.getByRole("button", { name: "탭 더 보기" })).toHaveCount(0);
  await selected.click();
  await expect(selected).toHaveAttribute("aria-selected", "true");
});
