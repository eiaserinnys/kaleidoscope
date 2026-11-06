import { expect, test } from "@playwright/test";

test("긴 주소 메타가 있어도 묶음 제목은 한 줄로 남는다", async ({ page }) => {
  await page.goto("/?preview=list-row-fit-940");
  const heading = page.getByTestId("app-window-list-row-fit-940").locator(".ks-view-group").first();
  await expect(heading).toBeVisible();
  await heading.evaluate(el => {
    el.style.width = "160px";
    el.querySelector("strong")!.textContent = "사설 3";
    const meta = document.createElement("span");
    meta.textContent = "http://10.20.30.40:8443/kaleidoscope/appstore/team-platform/production/internal-tools-and-utilities";
    el.append(meta);
  });
  const result = await heading.evaluate(el => {
    const title = el.querySelector("strong")!;
    const meta = el.querySelector("span")!;
    return { titleHeight: title.getBoundingClientRect().height, line: parseFloat(getComputedStyle(title).lineHeight),
      metaWidth: meta.clientWidth, metaContent: meta.scrollWidth, overflow: el.scrollWidth > el.clientWidth };
  });
  expect(result.titleHeight).toBeLessThanOrEqual(result.line + 1);
  expect(result.metaWidth).toBeGreaterThan(0);
  expect(result.metaContent).toBeGreaterThan(result.metaWidth);
  expect(result.overflow).toBe(false);
});

test("목록은 넓을 때 정보를 보존하고 좁을 때 배지와 시각 자리를 회수한다", async ({ page }) => {
  await page.goto("/?preview=list-row-fit-940");
  const app = page.getByTestId("app-window-list-row-fit-940");
  const row = app.locator(".ks-list-row").first();
  await expect(row).toBeVisible();
  for (const width of [400, 320, 220, 160, 120, 90, 400]) {
    await row.evaluate((e, width) => { e.style.width = `${width}px`; }, width);
    await row.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect.poll(() => row.evaluate((e) => {
      const group = e.querySelector<HTMLElement>(".ks-view-badges")!;
      const meta = e.querySelector<HTMLElement>(":scope > .ks-view-meta")!;
      const title = e.querySelector<HTMLElement>(".ks-list-title")!;
      const badges = [...group.children].filter(b => b.getBoundingClientRect().width > 0 && getComputedStyle(b).visibility !== "hidden");
      const mr = meta.getBoundingClientRect();
      return { title: title.clientWidth > 0, badges: badges.length, meta: mr.width > 0, emptyGroup: !badges.length && group.getBoundingClientRect().width > 0,
        partialMeta: mr.width > 0 && meta.scrollWidth > meta.clientWidth, overflow: e.scrollWidth > e.clientWidth + 1 };
    })).toMatchObject({ title: true, emptyGroup: false, partialMeta: false, overflow: false, ...(width >= 320 ? { badges: 1, meta: true } : {}) });
  }
});

test("고정 묶음 머리만 위아래 같은 여백을 쓴다", async ({ page }) => {
  await page.goto("/?preview=list-row-fit-940");
  const app = page.getByTestId("app-window-list-row-fit-940");
  await expect(app.locator(".ks-list-row").first()).toBeVisible();
  expect(await app.locator(".ks-view-group").evaluateAll(es => es.filter(e => !e.closest(".ks-view-sticky")).map(e => [getComputedStyle(e).paddingTop, getComputedStyle(e).paddingBottom]))).toContainEqual(["12px", "4px"]);
  await app.locator(".ks-list").evaluate(e => { e.scrollTop = 100; });
  const sticky = app.locator(".ks-view-sticky .ks-view-group");
  await expect(sticky).toBeAttached();
  expect(await sticky.evaluate(e => [getComputedStyle(e).paddingTop, getComputedStyle(e).paddingBottom, e.getBoundingClientRect().height])).toEqual(["8px", "8px", 34]);
});
