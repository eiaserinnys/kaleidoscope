import { expect, test, type Page } from "@playwright/test";

async function conflict(page: Page, kind: "code" | "markdown") {
  if (kind === "code") {
    await page.goto("/?preview=block-gallery");
    await page.getByRole("tab", { name: "코드", exact: true }).click();
    await page.getByRole("button", { name: "설정 파일 폴더 고르기" }).click();
    await page.getByRole("button", { name: "settings.json", exact: true }).click();
  } else {
    await page.goto("/?preview=md-editor");
    await page.getByRole("button", { name: "문서 폴더 고르기" }).click();
    await page.getByRole("button", { name: "README.md", exact: true }).click();
  }
  const editor = page.getByRole("textbox", { name: kind === "code" ? "코드 편집기" : "마크다운 편집기" });
  await expect(editor).toBeVisible();
  await page.evaluate(async ({ kind }) => {
    const fake = (window as any).__ksHarness;
    const window_id = kind === "code" ? "gallery-window" : "editor-window";
    const permission = kind === "code" ? "notes" : "docs";
    const path = kind === "code" ? "settings.json" : "README.md";
    const read = await fake.call({ op: "files.read", window_id, permission, path });
    await fake.call({ op: "files.write", window_id, permission, path, text: "external", expected_revision: read.revision });
  }, { kind });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("changed");
  await expect(page.getByRole("alert").filter({ hasText: "디스크에서 바뀌었습니다" })).toBeVisible();
}

for (const kind of ["code", "markdown"] as const) {
  test(`${kind} 충돌 안내의 두 복구 단추가 넓고 좁은 화면에서 보이고 눌린다`, async ({ browser }, info) => {
    for (const width of [1440, 400]) {
      for (const action of ["다시 불러오기", "덮어쓰기"]) {
        const context = await browser.newContext({ viewport: { width, height: 800 } });
        const page = await context.newPage();
        await conflict(page, kind);
        const notice = page.getByRole("alert").filter({ hasText: "디스크에서 바뀌었습니다" });
        const bounds = await notice.evaluate((el) => ({ notice: el.getBoundingClientRect().toJSON(), message: el.querySelector('.ks-notice-message')!.getBoundingClientRect().toJSON(), buttons: [...el.querySelectorAll('button')].map((button) => ({ ...button.getBoundingClientRect().toJSON(), textFits: button.scrollWidth <= button.clientWidth })) }));
        console.log(`conflict-${kind}-${width}-${action}: ${JSON.stringify(bounds)}`);
        await page.screenshot({ path: info.outputPath(`${kind}-conflict-${width}-${action}.png`) });
        for (const button of bounds.buttons) {
          expect(button.left).toBeGreaterThanOrEqual(bounds.notice.left);
          expect(button.right).toBeLessThanOrEqual(bounds.notice.right);
          expect(button.textFits).toBe(true);
        }
        if (width === 1440) expect(bounds.buttons[0].top).toBe(bounds.buttons[1].top);
        if (kind === "code" && width === 400) expect(bounds.buttons[1].top).toBeGreaterThan(bounds.buttons[0].top);
        await notice.getByRole("button", { name: action }).click();
        await expect(notice).toHaveCount(0);
        await context.close();
      }
    }
  });
}

test("이미지 수신 실패를 알리고 다시 받기로 복구한다", async ({ browser }, info) => {
  for (const width of [400, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await context.newPage();
    await page.goto("/?preview=block-gallery");
    await expect(page.getByRole("tab", { name: "미디어", exact: true })).toBeVisible();
    await page.route("**/assets/landscape.png**", (route) => route.abort());
    await page.getByRole("tab", { name: "미디어", exact: true }).click();
    await page.getByText("landscape.png", { exact: true }).click();
    const image = page.locator(".ks-image-view");
    await expect(image.getByRole("button", { name: "다시 받기" })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`image-failed-${width}.png`) });
    await page.unroute("**/assets/landscape.png**");
    await image.getByRole("button", { name: "다시 받기" }).click();
    await expect(image.locator("img")).toBeVisible();
    await context.close();
  }
});

test("손상된 소리를 알리고 다른 파일 선택으로 복구한다", async ({ browser }, info) => {
  for (const width of [400, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await context.newPage();
    await page.goto("/?preview=block-gallery");
    await expect(page.getByRole("tab", { name: "미디어", exact: true })).toBeVisible();
    await page.route("**/assets/tone.wav**", (route) => route.fulfill({ contentType: "audio/wav", body: "broken wav" }));
    await page.getByRole("tab", { name: "미디어", exact: true }).click();
    await page.getByRole("tab", { name: "소리", exact: true }).click();
    await page.getByText("tone.wav", { exact: true }).click();
    const player = page.locator(".ks-media-player");
    await expect(player.getByRole("alert")).toHaveText("재생할 수 없는 파일입니다");
    await expect(player.getByRole("button", { name: "재생" })).toBeDisabled();
    await expect(player.getByRole("slider", { name: "소리 크기" })).toBeDisabled();
    await page.screenshot({ path: info.outputPath(`media-failed-${width}.png`) });
    await page.unroute("**/assets/tone.wav**");
    await page.getByText("tone-second.wav", { exact: true }).click();
    await expect(player.getByRole("alert")).toHaveCount(0);
    await expect(player.getByRole("button", { name: /재생|일시 정지/ })).toBeEnabled();
    await expect.poll(() => player.locator("audio").evaluate((el: HTMLAudioElement) => el.readyState)).toBeGreaterThan(0);
    await context.close();
  }
});
