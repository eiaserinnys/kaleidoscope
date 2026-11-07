import { expect, test } from "@playwright/test";

test("채움 밖 미디어는 원본 비율을 쓰고 채움과 카드 미리보기는 자리를 유지한다", async ({ page }) => {
  await page.goto("/?preview=block-gallery");
  await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.id = "media-size-fixture";
    fixture.innerHTML = `
      <div class="ks-data-stack-item" style="width:320px"><div class="ks-image-view" style="--ks-image-ratio:4/3;--ks-image-natural-height:600px"></div></div>
      <div class="ks-data-stack-item" style="width:320px"><div class="ks-image-view" style="--ks-image-ratio:3/4;--ks-image-natural-height:600px"></div></div>
      <div class="ks-data-stack-item" style="width:320px"><div class="ks-image-view" style="--ks-image-ratio:16/9;--ks-image-natural-height:90px"></div></div>
      <div class="ks-data-stack-item" style="width:320px"><div class="ks-image-view"></div></div>
      <div class="ks-data-stack-item" style="width:320px"><div class="ks-media-player is-video" style="--ks-media-ratio:9/16"><video></video><div class="ks-media-controls-container"><div class="ks-media-controls"></div></div></div></div>
      <div class="ks-data-stack-item" style="width:320px"><div class="ks-media-player is-audio"><audio></audio><div class="ks-media-controls-container"><div class="ks-media-controls"></div></div></div></div>
      <div class="ks-data-stack-item is-fill" style="width:320px;height:220px;--ks-fill-textarea-height:100%;--ks-fill-media-max:none"><div class="ks-image-view" style="--ks-image-natural-height:90px"></div></div>
      <div class="ks-data-stack-item is-fill" style="width:320px;height:220px;--ks-fill-textarea-height:100%;--ks-fill-media-max:none"><div class="ks-media-player is-video"><video></video><div class="ks-media-controls-container"><div class="ks-media-controls"></div></div></div></div>
      <div class="ks-data-stack-item is-fill" style="width:320px;height:220px;--ks-fill-textarea-height:100%;--ks-fill-media-max:none"><div class="ks-media-player is-audio"><audio></audio><div class="ks-media-controls-container"><div class="ks-media-controls"></div></div></div></div>
      <div class="ks-data-button-card-preview" style="width:320px"><div class="ks-image-view" style="--ks-image-natural-height:90px"></div></div>`;
    document.body.append(fixture);
  });
  const metrics = await page.locator("#media-size-fixture").evaluate((fixture) => {
    const height = (element: Element) => element.getBoundingClientRect().height;
    const images = [...fixture.querySelectorAll(".ks-image-view")].map(height);
    const players = [...fixture.querySelectorAll(".ks-media-player")].map((player) => {
      const glyph = getComputedStyle(player, "::before");
      return {
        height: height(player), video: player.querySelector("video") ? height(player.querySelector("video")!) : 0,
        controls: height(player.querySelector(".ks-media-controls-container")!),
        glyphHeight: Number.parseFloat(glyph.height),
        glyphMask: glyph.maskImage || glyph.webkitMaskImage,
      };
    });
    return { images, players };
  });
  for (const [actual, expected] of metrics.images.map((height, index) => [height, [240, 320 * 4 / 3, 90, 180, 220, 180][index]])) {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
  }
  expect(Math.abs(metrics.players[0].video - 480)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.players[0].height - metrics.players[0].video - metrics.players[0].controls)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.players[1].height - metrics.players[1].controls)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.players[2].height - 220)).toBeLessThanOrEqual(1);
  expect(metrics.players[0].glyphMask).toBe("none");
  expect(metrics.players[1].glyphMask).not.toBe("none");
  expect(metrics.players[2].glyphMask).toBe("none");
  expect(metrics.players[3].glyphMask).not.toBe("none");
  expect(metrics.players[1].glyphHeight).toBe(0);
  expect(Math.abs(metrics.players[3].glyphHeight - (220 - metrics.players[3].controls))).toBeLessThanOrEqual(1);
});

test("kind 없는 동영상은 원본을 받는 동안 소리 글리프 없이 잠긴 재생 줄을 둔다", async ({ page }) => {
  await page.goto("/?preview=block-gallery");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await page.route("**/assets/tone.wav**", async (route) => {
    requested = true;
    await gate;
    await route.fulfill({ status: 200, contentType: "video/mp4", body: Buffer.from([0, 0, 0, 0]) });
  });
  await page.getByRole("tab", { name: "미디어" }).click();
  await page.getByRole("tab", { name: "소리", exact: true }).click();
  await page.getByText("tone.wav", { exact: true }).click();
  const player = page.locator(".ks-media-player");
  await expect(player).toHaveCount(1);
  await expect.poll(() => requested).toBe(true);
  const loading = await player.evaluate((element) => {
    const glyph = getComputedStyle(element, "::before");
    return {
      mask: glyph.maskImage || glyph.webkitMaskImage,
      audio: element.classList.contains("is-audio"),
      video: element.classList.contains("is-video"),
    };
  });
  expect(loading).toEqual({ mask: "none", audio: false, video: false });
  await expect(player.getByRole("button", { name: "재생" })).toBeDisabled();
  release();
  await expect(player).toHaveClass(/is-video/);
  const loaded = await player.evaluate((element) => {
    const glyph = getComputedStyle(element, "::before");
    return glyph.maskImage || glyph.webkitMaskImage;
  });
  expect(loaded).toBe("none");
});

test("내용 높이 쌓기의 마지막 미디어와 좁은 오류는 접히지 않는다", async ({ page }) => {
  await page.goto("/?preview=block-gallery");
  await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.id = "media-content-size-fixture";
    fixture.style.width = "320px";
    fixture.innerHTML = `
      <div class="ks-data-tab-panel"><div class="ks-data-stack is-column"><div class="ks-data-stack-item is-fill"><div class="ks-image-view" style="--ks-image-ratio:4/3;--ks-image-natural-height:600px"></div></div></div></div>
      <div class="ks-data-section-child"><div class="ks-data-stack is-column"><div class="ks-data-stack-item is-fill"><div class="ks-image-view" style="--ks-image-ratio:16/9;--ks-image-natural-height:90px"></div></div></div></div>
      <div class="ks-data-section-child"><div class="ks-data-stack is-column"><div class="ks-data-stack-item is-fill"><div class="ks-media-player is-video" style="--ks-media-ratio:9/16"><video></video><div class="ks-media-controls-container"><div class="ks-media-controls"></div></div></div></div></div></div>
      <div class="ks-data-stack-item" style="width:153px"><div class="ks-image-view is-failed"><div style="height:140px">오류와 다시 받기</div></div></div>
      <div class="ks-data-button-card-preview" style="width:153px"><div class="ks-image-view is-failed"><div style="height:140px">오류</div></div></div>`;
    document.body.append(fixture);
  });
  const heights = await page.locator("#media-content-size-fixture").evaluate((fixture) => {
    const size = (selector: string) => [...fixture.querySelectorAll(selector)].map((element) => { const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height }; });
    return { images: size(".ks-image-view"), video: size("video") };
  });
  for (const [actual, expected] of heights.images.map((size, index) => [size.height, [size.width * 3 / 4, 90, 140, size.width * 9 / 16][index]])) {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
  }
  expect(Math.abs(heights.video[0].height - 480)).toBeLessThanOrEqual(1);
});
