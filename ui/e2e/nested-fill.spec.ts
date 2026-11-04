import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

async function open(page: Page, id: string) {
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(`/?preview=${id}`);
  const app = page.getByTestId(`app-window-${id}`);
  const inner = app.locator(".ks-data-window-body > .ks-data-stack > .ks-data-stack-item.is-fill > .ks-data-stack");
  await expect(inner).toBeVisible();
  return { app, inner };
}

async function capture(page: Page, name: string) {
  const directory = process.env.KS_NESTED_FILL_CAPTURE_DIR;
  if (directory) { mkdirSync(directory, { recursive: true }); await page.screenshot({ path: join(directory, `${name}.png`) }); }
}

test("명시 fill 중첩 stack은 부모 칸 높이를 받고 내용 칸이 스크롤된다", async ({ page }) => {
  const { inner } = await open(page, "nested-fill");
  const sizes = await inner.evaluate((el) => ({ inner: el.getBoundingClientRect().height, parent: el.parentElement!.getBoundingClientRect().height }));
  expect(Math.abs(sizes.inner - sizes.parent)).toBeLessThanOrEqual(1);
  const fill = inner.locator(":scope > .ks-data-stack-item.is-fill");
  const overflow = await fill.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }));
  expect(overflow.scroll).toBeGreaterThan(overflow.client);
  await fill.evaluate((el) => { el.scrollTop = 150; });
  expect(await fill.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await capture(page, "nested-fill");
});

test("명시 fill 안의 split은 각 칸이 독립적으로 스크롤된다", async ({ page }) => {
  const { inner } = await open(page, "nested-fill-split");
  const sizes = await inner.evaluate((el) => ({ inner: el.getBoundingClientRect().height, parent: el.parentElement!.getBoundingClientRect().height }));
  expect(Math.abs(sizes.inner - sizes.parent)).toBeLessThanOrEqual(1);
  const panes = inner.locator(".ks-split-pane .ks-data-section-child");
  await expect(panes).toHaveCount(2);
  for (let i = 0; i < 2; i += 1) {
    const pane = panes.nth(i);
    const sizes = await pane.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }));
    expect(sizes.scroll).toBeGreaterThan(sizes.client);
  }
  await panes.nth(0).evaluate((el) => { el.scrollTop = 150; });
  expect(await panes.nth(0).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await panes.nth(1).evaluate((el) => el.scrollTop)).toBe(0);
  await panes.nth(1).evaluate((el) => { el.scrollTop = 100; });
  expect(await panes.nth(1).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await capture(page, "nested-fill-split");
});

test("fill을 생략한 중첩 stack은 자연 높이를 유지한다", async ({ page }) => {
  const { inner } = await open(page, "nested-natural");
  const sizes = await inner.evaluate((el) => ({ inner: el.getBoundingClientRect().height, parent: el.parentElement!.getBoundingClientRect().height, overflow: getComputedStyle(el.querySelector(".ks-data-stack-item.is-fill")!).overflowY }));
  expect(sizes.inner).toBeGreaterThan(sizes.parent);
  expect(sizes.overflow).toBe("visible");
});

test("고정 내용이 창보다 커도 명시 fill의 최소 높이를 남기고 몸통이 스크롤된다", async ({ page }) => {
  const { app, inner } = await open(page, "nested-fill");
  await app.locator(".ks-data-window").evaluate((el) => { (el as HTMLElement).style.height = "200px"; });
  await inner.locator(":scope > .ks-data-stack-item").first().evaluate((el) => {
    Object.assign((el as HTMLElement).style, { height: "350px", flex: "0 0 350px" });
  });
  const fill = inner.locator(":scope > .ks-data-stack-item.is-fill");
  const body = app.locator(".ks-data-window-body");
  const sizes = await fill.evaluate((el) => ({
    fill: el.getBoundingClientRect().height,
    minimum: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ks-pane-min-size")),
  }));
  expect(sizes.fill).toBeGreaterThanOrEqual(sizes.minimum);
  const bodySizes = await body.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }));
  expect(bodySizes.scroll).toBeGreaterThan(bodySizes.client);
  await body.hover({ position: { x: 20, y: 40 } });
  await page.mouse.wheel(0, 500);
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await capture(page, "nested-overflow");
});

for (const [width, height] of [[1000, 700], [360, 480]]) test(`${width} 폭의 기본 표가 최소 높이를 갖고 몸통 휠로 보인다`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await page.goto("/?preview=market");
  const app = page.getByTestId("app-window-market");
  const tabs = app.locator(".ks-data-stack-item.is-fill > .ks-data-tabs").first();
  await expect(tabs).toBeAttached();
  const fill = tabs.locator("..");
  const body = app.locator(".ks-data-window-body");
  const sizes = await fill.evaluate((el) => ({
    fill: el.getBoundingClientRect().height,
    minimum: 2 * parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ks-pane-min-size")),
  }));
  expect(sizes.fill).toBeGreaterThanOrEqual(sizes.minimum);
  await body.hover({ position: { x: 20, y: 100 } });
  await page.mouse.wheel(0, 4000);
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const visibility = await tabs.evaluate((el) => {
    const target = el.getBoundingClientRect();
    const body = el.closest(".ks-data-window-body")!.getBoundingClientRect();
    return target.top < body.bottom && target.bottom > body.top;
  });
  expect(visibility).toBe(true);
  await capture(page, `table-scroll-${width}`);
});
