import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });
const output = process.env.KS_GUTTER_CAPTURE_DIR;
async function open(page: Page, id: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(`/?preview=${id}`);
  await page.addStyleTag({ content: "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return page.getByTestId(`app-window-${id}`);
}
async function capture(app: Locator, name: string) {
  if (!output) return;
  mkdirSync(output, { recursive: true });
  await app.screenshot({ path: join(output, `${name}.png`) });
}
async function edges(app: Locator) {
  return app.locator(".ks-data-window-body").evaluate((body) => {
    const right = body.getBoundingClientRect().right;
    return {
      ends: [...body.querySelectorAll("textarea, .ks-data-button.is-row > button")].map((element) => right - element.getBoundingClientRect().right),
      overflow: body.scrollHeight > body.clientHeight,
      horizontalBar: body.offsetHeight - body.clientHeight,
      gutter: body.getBoundingClientRect().width - body.clientWidth,
    };
  });
}

for (const [width, height] of [[480, 360], [880, 600]]) {
  test(`입력 길이가 달라도 몸통 끝선 유지 ${width}x${height}`, async ({ page }) => {
    const app = await open(page, "deco-letters", width, height);
    const input = app.getByPlaceholder("영문 입력");
    await input.fill("Hello");
    await expect(app.locator(".ks-data-button.is-row")).toHaveCount(6);
    const short = await edges(app);
    await capture(app, `deco-${width}-short`);
    await input.fill(Array.from({ length: 8 }, () => "Kaleidoscope letters ".repeat(12)).join("\n"));
    await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThan(100);
    const long = await edges(app);
    await capture(app, `deco-${width}-long`);
    console.log(JSON.stringify({ width, height, short, long }));
    expect(short.overflow).toBe(false);
    if (width === 480) expect(long.overflow).toBe(true);
    expect(short.ends).toHaveLength(7);
    for (const [index, end] of short.ends.entries()) {
      expect(end).toBeCloseTo(12, 0);
      expect(Math.abs(end - long.ends[index])).toBeLessThanOrEqual(1);
    }
    expect(short.horizontalBar).toBe(0);
    expect(long.horizontalBar).toBe(0);
    await app.locator(".ks-data-button.is-row > button").last().focus();
    expect(await app.locator(".ks-data-window-body").evaluate((body) => body.scrollLeft)).toBe(0);
  });
}

for (const id of ["md-editor", "profiler"]) {
  for (const [width, height] of [[480, 360], [880, 600]]) {
    test(`자기 스크롤 화면의 폭 유지 ${id} ${width}`, async ({ page }) => {
      const app = await open(page, id, width, height);
      await expect(app.locator(".ks-data-window-body > *").first()).toBeVisible();
      const body = app.locator(".ks-data-window-body");
      const box = await body.boundingBox();
      const content = await body.locator(":scope > *").first().boundingBox();
      console.log(JSON.stringify({ id, width, body: box, content }));
      expect(content!.width).toBeCloseTo(box!.width, 0);
      await capture(app, `${id}-${width}`);
    });
  }
}

test("스크롤하는 몸통의 목록과 표 글은 스크롤바에 가려지지 않는다", async ({ page }) => {
  const app = await open(page, "gutter-lists", 480, 360);
  const body = app.locator(".ks-data-window-body");
  await expect(app.locator(".ks-row").first()).toBeVisible();
  const read = () => body.evaluate((element) => {
    const clientRight = element.getBoundingClientRect().left + element.clientLeft + element.clientWidth;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let glyphOverlap = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width && rect.right > clientRight + 0.5) glyphOverlap += 1;
    }
    return { scrolls: element.scrollHeight > element.clientHeight, glyphOverlap, horizontalBar: element.offsetHeight - element.clientHeight };
  });
  await capture(app, "lists-top");
  const state = await read();
  expect(state.scrolls).toBe(true);
  expect(state.glyphOverlap).toBe(0);
  expect(state.horizontalBar).toBe(0);
  for (let index = 0; index < 20; index += 1) await page.keyboard.press("Tab");
  expect(await body.evaluate((element) => element.scrollLeft)).toBe(0);
  await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await capture(app, "lists-end");
  expect((await read()).glyphOverlap).toBe(0);
});
