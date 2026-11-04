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

test("고정 내용이 창보다 커도 명시 fill의 최소 높이를 남기고 바깥 fill이 스크롤된다", async ({ page }) => {
  const { app, inner } = await open(page, "nested-fill");
  await app.locator(".ks-data-window").evaluate((el) => { (el as HTMLElement).style.height = "200px"; });
  await inner.locator(":scope > .ks-data-stack-item").first().evaluate((el) => {
    Object.assign((el as HTMLElement).style, { height: "350px", flex: "0 0 350px" });
  });
  const fill = inner.locator(":scope > .ks-data-stack-item.is-fill");
  const body = inner.locator("..");
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

for (const [width, height] of [[1000, 700], [360, 480], [360, 240]]) test(`${width}×${height} 폭의 기본 표가 최소 높이를 갖고 fill 휠로 보이고 도구 막대는 고정된다`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await page.goto("/?preview=market");
  // 검수 창 머리와 여백을 빼고 앱 창 자체를 요청한 크기로 맞춘다.
  await page.addStyleTag({ content: "body { padding: 0; } .ks-harness { display: block; } .ks-harness-header { display: none; } .ks-harness-apps.is-preview { height: 100%; }" });
  const app = page.getByTestId("app-window-market");
  expect((await app.boundingBox())!.height).toBe(height);
  expect((await app.boundingBox())!.width).toBe(width);
  const tabs = app.locator(".ks-data-stack-item.is-fill > .ks-data-tabs").first();
  await expect(tabs).toBeAttached();
  const fill = tabs.locator("..");
  const body = app.locator(".ks-data-window-body > .ks-data-stack > .ks-data-stack-item.is-fill");
  const toolbar = app.locator(".ks-data-toolbar").first();
  const y = (await toolbar.boundingBox())!.y;
  const sizes = await fill.evaluate((el) => ({
    fill: el.getBoundingClientRect().height,
    minimum: 2 * parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ks-pane-min-size")),
  }));
  expect(sizes.fill).toBeGreaterThanOrEqual(sizes.minimum);
  const overflow = await body.evaluate((el) => el.scrollHeight > el.clientHeight);
  if (overflow) {
    await body.hover();
    await page.mouse.wheel(0, 4000);
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  } else {
    // 가짜 코어는 차트 대신 짧은 값을 주므로 넓은 창에서는 내용이 들어맞는다.
    expect(await body.evaluate((el) => el.scrollTop)).toBe(0);
  }
  const visibility = await tabs.evaluate((el) => {
    const target = el.getBoundingClientRect();
    const body = el.closest(".ks-data-window-body")!.getBoundingClientRect();
    return target.top < body.bottom && target.bottom > body.top;
  });
  expect(visibility).toBe(true);
  expect((await toolbar.boundingBox())!.y).toBe(y);
  await capture(page, `table-scroll-${width}-${height}`);
});

for (const width of [360, 390]) test(`${width} 가로 fill 슬라이더는 최소 길이를 지킨다`, async ({ page }) => {
  await page.setViewportSize({ width, height: 600 });
  await page.goto('/?preview=slider-fill');
  const slider = page.getByRole('slider');
  await expect(slider).toBeVisible();
  const size = await slider.evaluate(el => ({ width: el.getBoundingClientRect().width, minimum: 3 * parseFloat(getComputedStyle(el).getPropertyValue('--ks-space-6')) }));
  expect(size.width).toBeGreaterThanOrEqual(size.minimum);
});


test("마지막이 조작인 중첩 stack은 fill 없이 자연 높이로 스크롤된다", async ({ page }) => {
  const { app, inner } = await open(page, "nested-controls");
  await expect(inner.locator(':scope > .is-fill')).toHaveCount(0);
  const outer = inner.locator('..');
  const head = app.getByText('고정 머리', { exact: true });
  const y = (await head.boundingBox())!.y;
  await outer.hover({ position: { x: 30, y: 50 } });
  await page.mouse.wheel(0, 5000);
  await expect.poll(() => outer.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect((await head.boundingBox())!.y).toBe(y);
  await expect(app.getByRole('button', { name: '끝 조작' })).toBeInViewport();
});
