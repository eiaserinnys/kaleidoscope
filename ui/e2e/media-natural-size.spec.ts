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
      <div class="ks-data-stack-item" style="width:320px"><div class="ks-media-player"><audio></audio><div class="ks-media-controls-container"><div class="ks-media-controls"></div></div></div></div>
      <div class="ks-data-stack-item is-fill" style="width:320px;height:220px"><div class="ks-image-view" style="--ks-image-natural-height:90px"></div></div>
      <div class="ks-data-stack-item is-fill" style="width:320px;height:220px"><div class="ks-media-player is-video"><video></video><div class="ks-media-controls-container"><div class="ks-media-controls"></div></div></div></div>
      <div class="ks-data-button-card-preview" style="width:320px"><div class="ks-image-view" style="--ks-image-natural-height:90px"></div></div>`;
    document.body.append(fixture);
  });
  const metrics = await page.locator("#media-size-fixture").evaluate((fixture) => {
    const height = (element: Element) => element.getBoundingClientRect().height;
    const images = [...fixture.querySelectorAll(".ks-image-view")].map(height);
    const players = [...fixture.querySelectorAll(".ks-media-player")].map((player) => ({
      height: height(player), video: player.querySelector("video") ? height(player.querySelector("video")!) : 0,
      controls: height(player.querySelector(".ks-media-controls-container")!),
    }));
    return { images, players };
  });
  for (const [actual, expected] of metrics.images.map((height, index) => [height, [240, 320 * 4 / 3, 90, 180, 220, 180][index]])) {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
  }
  expect(Math.abs(metrics.players[0].video - 480)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.players[0].height - metrics.players[0].video - metrics.players[0].controls)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.players[1].height - metrics.players[1].controls)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.players[2].height - 220)).toBeLessThanOrEqual(1);
});
