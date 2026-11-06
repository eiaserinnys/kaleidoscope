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
      scrollWidth: body.scrollWidth,
      clientWidth: body.clientWidth,
      gutter: body.getBoundingClientRect().width - body.clientWidth,
    };
  });
}

for (const [width, height] of [[480, 360], [880, 360]]) {
  test(`키 입력으로 줄을 늘려 스크롤바가 생겨도 몸통 끝선 유지 ${width}x${height}`, async ({ page }) => {
    const app = await open(page, "deco-letters", width, height);
    const input = app.getByPlaceholder("영문 입력");
    await input.click();
    await page.keyboard.type("Hello");
    await expect(app.locator(".ks-data-button.is-row")).toHaveCount(6);
    const short = await edges(app);
    await capture(app, `deco-${width}-short`);
    expect(short.overflow).toBe(false);
    expect(short.ends).toHaveLength(7);
    for (const end of short.ends) expect(end).toBeCloseTo(12, 0);
    let crossed = false;
    for (let line = 0; line < 24 && !(crossed && line > 0); line += 1) {
      await page.keyboard.type(`${"Kaleidoscope letters ".repeat(3)}`);
      await page.keyboard.press("Shift+Enter");
      const now = await edges(app);
      expect(now.ends).toHaveLength(7);
      for (const [index, end] of now.ends.entries()) expect(Math.abs(end - short.ends[index]), `줄 ${line} 단추 ${index}`).toBeLessThanOrEqual(1);
      expect(now.scrollWidth).toBe(now.clientWidth);
      expect(now.horizontalBar).toBe(0);
      if (now.overflow && !crossed) { crossed = true; await capture(app, `deco-${width}-crossed`); }
    }
    expect(crossed, "스크롤바가 생기는 경계를 지나야 한다").toBe(true);
    const long = await edges(app);
    expect(long.gutter).toBe(8);
    await capture(app, `deco-${width}-long`);
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

for (const width of [480, 880]) {
test(`몸통 바로 아래 목록과 표의 선택 행과 초점 행이 몸통 보이는 영역 안에 있다 ${width}`, async ({ page }) => {
  const app = await open(page, "gutter-lists", width, 360);
  const body = app.locator(".ks-data-window-body");
  await expect(app.locator(".ks-row").first()).toBeVisible();
  const read = () => body.evaluate((element) => {
    const clientRight = element.getBoundingClientRect().left + element.clientLeft + element.clientWidth;
    const over = [...element.querySelectorAll(".ks-row, .ks-table-row, .ks-notice")].map((row) => row.getBoundingClientRect()).filter((rect) => rect.width && rect.right > clientRight + 0.5).length;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let glyphOverlap = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width && rect.right > clientRight + 0.5) glyphOverlap += 1;
    }
    return { scrolls: element.scrollHeight > element.clientHeight, over, glyphOverlap, scrollWidth: element.scrollWidth - element.clientWidth, horizontalBar: element.offsetHeight - element.clientHeight };
  });
  expect((await read()).scrolls).toBe(true);
  await app.locator(".ks-row").nth(1).click();
  await page.keyboard.press("ArrowDown");
  await capture(app, `lists-row-focus-${width}`);
  expect(await read()).toMatchObject({ over: 0, glyphOverlap: 0, scrollWidth: 0, horizontalBar: 0 });
  await app.locator(".ks-table-row").nth(1).scrollIntoViewIfNeeded();
  await app.locator(".ks-table-row").nth(1).click();
  await page.keyboard.press("ArrowDown");
  await capture(app, `lists-table-focus-${width}`);
  expect(await read()).toMatchObject({ over: 0, glyphOverlap: 0, scrollWidth: 0, horizontalBar: 0 });
  for (let index = 0; index < 20; index += 1) await page.keyboard.press("Tab");
  expect(await body.evaluate((element) => element.scrollLeft)).toBe(0);
  await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await capture(app, `lists-end-${width}`);
  expect(await read()).toMatchObject({ over: 0, glyphOverlap: 0, scrollWidth: 0 });
});

test(`몸통이 스크롤하는 알림 상자가 몸통 보이는 영역 안에 있다 ${width}`, async ({ page }) => {
  const app = await open(page, "input-options-fixture", width, 360);
  const notice = app.locator(".ks-notice").first();
  await expect(notice).toBeVisible();
  const state = await app.locator(".ks-data-window-body").evaluate((body) => {
    const clientRight = body.getBoundingClientRect().left + body.clientLeft + body.clientWidth;
    const rect = body.querySelector(".ks-notice")!.getBoundingClientRect();
    return { scrolls: body.scrollHeight > body.clientHeight, overflow: rect.right - clientRight, scrollWidth: body.scrollWidth - body.clientWidth };
  });
  await capture(app, `notice-${width}`);
  expect(state.scrolls).toBe(true);
  expect(state.overflow).toBeLessThanOrEqual(0.5);
  expect(state.scrollWidth).toBe(0);
});
}

test("최상위 가로 쌓기의 왼쪽 구역 오른쪽 패딩은 몸통이 스크롤해도 같다", async ({ page }) => {
  const read = async (height: number) => {
    const app = await open(page, "gutter-row", 880, height);
    await expect(app.locator(".ks-data-window-body .ks-data-section").first()).toBeVisible();
    return app.locator(".ks-data-window-body").evaluate((body) => ({
      scrolls: body.scrollHeight > body.clientHeight,
      sectionEnd: getComputedStyle(body.querySelector(".ks-data-section")!).paddingRight,
    }));
  };
  const tall = await read(900);
  const short = await read(360);
  expect(tall.scrolls).toBe(false);
  expect(short.scrolls).toBe(true);
  expect(short.sectionEnd).toBe(tall.sectionEnd);
});
