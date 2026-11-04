import { expect, test } from "@playwright/test";

test("목록과 피드의 좁은 행과 묶음 머리가 겹치지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 1049, height: 900 });
  await page.goto("/?preview=layout-940");
  const app = page.getByTestId("app-window-layout-940");
  const row = app.locator(".ks-list-row").first();
  await expect(row).toBeAttached();
  for (const width of [520, 360, 250]) {
    const sizes = await row.evaluate((element, width) => {
      element.style.width = `${width}px`;
      const title = element.querySelector<HTMLElement>(".ks-list-title")!;
      const group = element.querySelector<HTMLElement>(".ks-view-badges")!;
      const bounds = group.getBoundingClientRect();
      const badges = [...group.children].map((child) => ({ ...child.getBoundingClientRect().toJSON(), visibility: getComputedStyle(child).visibility }));
      return { title: title.getBoundingClientRect().width, bounds: bounds.toJSON(), badges };
    }, width);
    expect(sizes.title).toBeGreaterThan(0);
    for (const badge of sizes.badges) {
      const visible = Math.max(0, Math.min(badge.right, sizes.bounds.right) - Math.max(badge.left, sizes.bounds.left));
      expect(badge.visibility === "hidden" || visible < 1 || Math.abs(visible - badge.width) < 1).toBe(true);
    }
  }
  const heading = app.locator(".ks-view-group").first();
  expect(await heading.evaluate((element) => [getComputedStyle(element).paddingTop, getComputedStyle(element).paddingBottom])).toEqual(["12px", "4px"]);
  const ident = app.locator(".ks-feed-ident").first();
  await expect(ident).toBeAttached();
  for (const width of [500, 250, 180]) {
    const boxes = await ident.evaluate((element, width) => {
      element.style.width = `${width}px`; element.style.flex = "none";
      const name = element.querySelector(".ks-feed-name-line")!.getBoundingClientRect();
      const meta = element.querySelector(":scope > .ks-view-meta")!.getBoundingClientRect();
      return { name: name.toJSON(), meta: meta.toJSON() };
    }, width);
    expect(boxes.name.bottom <= boxes.meta.top + 1 || boxes.name.right <= boxes.meta.left + 1).toBe(true);
  }
});

test("격자 선택 대화상자는 결과 수와 관계없이 크기와 찾기 위치를 유지한다", async ({ page }) => {
  await page.setViewportSize({ width: 1049, height: 1092 });
  await page.goto("/?preview=layout-940");
  const app = page.getByTestId("app-window-layout-940");
  await app.getByRole("button", { name: "선택 열기" }).click();
  const dialog = app.getByRole("dialog");
  const before = await dialog.boundingBox();
  const searchBefore = await dialog.getByPlaceholder("찾기").boundingBox();
  const host = await app.locator(".ks-data-window").boundingBox();
  expect(before!.width).toBeGreaterThan(host!.width / 2);
  await dialog.getByRole("button", { name: "결과 비우기" }).click();
  await expect(dialog.getByRole("option")).toHaveCount(0);
  const after = await dialog.boundingBox();
  const searchAfter = await dialog.getByPlaceholder("찾기").boundingBox();
  expect(after!.height).toBeCloseTo(before!.height, 0);
  expect(searchAfter!.y).toBeCloseTo(searchBefore!.y, 0);
});
