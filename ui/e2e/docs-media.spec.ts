import { expect, test, type Page } from "@playwright/test";

async function openGallery(page: Page) {
  await page.goto("/?preview=block-gallery");
  await expect(page.getByRole("tab", { name: "코드" })).toBeVisible();
}

test("코드 편집의 저장과 충돌, 큰 로그의 스크롤을 확인한다", async ({ page }, info) => {
  await openGallery(page);
  await page.getByRole("tab", { name: "코드" }).click();
  await page.getByRole("button", { name: "설정 파일 폴더 고르기" }).click();
  await page.getByRole("button", { name: "settings.json" }).click();
  const editor = page.getByRole("textbox", { name: "코드 편집기" });
  await expect(editor).toContainText('"theme"');
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("saved");
  await expect.poll(() => page.evaluate(() => (window as any).__ksHarness.getFiles()["settings.json"])).toContain("saved");
  await page.evaluate(async () => {
    const fake = (window as any).__ksHarness;
    const read = await fake.call({ op: "files.read", window_id: "gallery-window", permission: "notes", path: "settings.json" });
    await fake.call({ op: "files.write", window_id: "gallery-window", permission: "notes", path: "settings.json", text: "external", expected_revision: read.revision });
  });
  await editor.click();
  await page.keyboard.type("x");
  await expect(page.getByRole("alert").filter({ hasText: "디스크에서 바뀌었습니다" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("code-conflict.png") });
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await expect(editor).toContainText("external");

  await page.goto("/?preview=block-gallery&long-log");
  await page.getByRole("tab", { name: "코드" }).click();
  const scroll = page.locator(".ks-code-view .cm-scroller").first();
  await expect(page.getByRole("textbox", { name: "코드 보기" })).toBeVisible();
  await scroll.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await page.evaluate(() => (window as any).__ksSetLog(`${Array.from({ length: 20000 }, (_, i) => `줄 ${i}`).join("\n")}\n마지막`));
  await expect.poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(3);
  await scroll.evaluate((node) => { node.scrollTop = 100; });
  await page.evaluate(() => (window as any).__ksSetLog(`${Array.from({ length: 20000 }, (_, i) => `줄 ${i}`).join("\n")}\n마지막\n추가`));
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(100);
});

test("이미지 확대와 이동, 소리 재생과 위치 조절", async ({ page }, info) => {
  await openGallery(page);
  await page.getByRole("tab", { name: "미디어" }).click();
  await page.getByText("landscape.png").click();
  const image = page.locator(".ks-image-view");
  const frame = image.locator(".ks-image-frame");
  await expect(frame.locator("img")).toBeVisible();
  await image.hover();
  await page.mouse.wheel(0, -100);
  await expect(frame).toHaveCSS("transform", /matrix\(1\.25/);
  const bounds = await image.boundingBox();
  if (!bounds) throw new Error("이미지 크기가 없습니다");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 30, bounds.y + bounds.height / 2 + 20); await page.mouse.up();
  await expect(frame).not.toHaveCSS("transform", "matrix(1.25, 0, 0, 1.25, 0, 0)");
  await image.dblclick();
  await expect(frame).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await page.getByRole("tab", { name: "소리" }).click();
  await page.getByText("tone.wav").click();
  const audio = page.locator("audio");
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.readyState)).toBeGreaterThan(0);
  if (await audio.evaluate((el: HTMLAudioElement) => el.paused)) await page.getByRole("button", { name: "재생" }).click();
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(false);
  const seek = page.getByRole("slider", { name: "재생 위치" });
  await seek.fill("2");
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThan(1);
  await page.screenshot({ path: info.outputPath("media-wide.png") });
});

test("이미지의 자르기 비율을 표시한다", async ({ page }) => {
  await page.goto("/?preview=block-gallery&crop-image");
  await page.getByRole("tab", { name: "미디어" }).click();
  const frame = page.locator(".ks-image-frame");
  const image = frame.locator("img");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((el) => el.getBoundingClientRect().width / el.parentElement!.getBoundingClientRect().width)).toBeCloseTo(2);
});

test("코드와 미디어를 넓은 폭과 400px에서 캡처한다", async ({ browser }, info) => {
  for (const width of [1440, 400]) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await context.newPage();
    await openGallery(page);
    await page.getByRole("tab", { name: "코드" }).click();
    await page.getByRole("button", { name: "설정 파일 폴더 고르기" }).click();
    await page.getByRole("button", { name: "settings.json" }).click();
    await expect(page.getByRole("textbox", { name: "코드 편집기" })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`code-${width}.png`) });
    await page.getByRole("tab", { name: "미디어" }).click();
    await page.getByText("landscape.png").click();
    await expect(page.locator(".ks-image-frame img")).toBeVisible();
    await page.screenshot({ path: info.outputPath(`media-${width}.png`) });
    await context.close();
  }
});
