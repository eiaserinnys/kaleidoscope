import { expect, test, type Locator, type Page } from "@playwright/test";

async function open(page: Page, id: string) {
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto(`/?preview=${id}`);
  return page.getByTestId(`app-window-${id}`);
}

async function topGap(app: Locator, selector: string) {
  return app.evaluate((root, target) => {
    const tab = root.querySelector(".ks-data-tab-list button")!.getBoundingClientRect();
    const first = root.querySelector(target)!.getBoundingClientRect();
    return first.top - tab.bottom;
  }, selector);
}

async function clippedRing(card: Locator) {
  return card.evaluate((button) => {
    const style = getComputedStyle(button);
    const ring = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    const r = button.getBoundingClientRect();
    const clipped: string[] = [];
    for (let parent = button.parentElement; parent && !parent.dataset.testid?.startsWith("app-window"); parent = parent.parentElement) {
      const cs = getComputedStyle(parent);
      const p = parent.getBoundingClientRect();
      const left = p.left + parseFloat(cs.borderLeftWidth);
      const top = p.top + parseFloat(cs.borderTopWidth);
      if (cs.overflowX !== "visible" && (r.left - ring < left - 0.5 || r.right + ring > left + parent.clientWidth + 0.5)) clipped.push("가로");
      if (cs.overflowY !== "visible" && (r.top - ring < top - 0.5 || r.bottom + ring > top + parent.clientHeight + 0.5)) clipped.push("세로");
    }
    return clipped;
  });
}

test("탭을 전환해도 첫 내용과 채움 격자의 간격을 유지한다", async ({ page }) => {
  const app = await open(page, "preview-grid-tabs");
  const gridGap = await topGap(app, '.ks-data-tab-panel:not([hidden]) .ks-data-button-card-action');
  await app.getByRole("tab", { name: "줄" }).click();
  const rowGap = await topGap(app, '.ks-data-tab-panel:not([hidden]) .ks-data-button > button');
  expect(gridGap).toBe(rowGap);

});

test("찾기 아래 채움 칸에 불필요한 스크롤이 생기지 않는다", async ({ page }) => {
  const app = await open(page, "preview-grid-tabs");
  await app.getByRole("tab", { name: "찾기" }).click();
  const fill = app.locator('.ks-data-tab-panel:not([hidden]) .ks-data-stack-item.is-fill');
  const sizes = await fill.evaluate((node) => ({ scroll: node.scrollHeight, client: node.clientHeight }));
  expect(sizes.scroll).toBe(sizes.client);
});

test("탭 안팎 격자를 키보드로 왕복할 때 포커스 링을 보인다", async ({ page }) => {
  for (const id of ["preview-grid-tabs", "preview-grid-outside"]) {
    const app = await open(page, id);
    await page.setViewportSize({ width: 700, height: 430 });
    const cards = app.locator('.ks-data-button-card-action');
    const scrolling = await cards.first().evaluate((button) => {
      let parent = button.parentElement;
      while (parent && parent.scrollHeight <= parent.clientHeight) parent = parent.parentElement;
      return parent?.scrollHeight ?? 0;
    });
    expect(scrolling).toBeGreaterThan(0);
    if (id === "preview-grid-tabs") {
      await app.getByRole("tab", { name: "격자" }).focus();
      await page.keyboard.press("Tab");
    } else {
      await cards.first().focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
    }
    for (let index = 0; index < 16; index += 1) {
      await expect(cards.nth(index)).toBeFocused();
      expect(await cards.nth(index).evaluate((button) => parseFloat(getComputedStyle(button).outlineWidth))).toBeGreaterThan(0);
      expect(await clippedRing(cards.nth(index))).toEqual([]);
      if (index < 15) await page.keyboard.press("Tab");
    }
    for (let index = 14; index >= 0; index -= 1) {
      await page.keyboard.press("Shift+Tab");
      await expect(cards.nth(index)).toBeFocused();
      expect(await clippedRing(cards.nth(index))).toEqual([]);
    }
  }
});

test("구역 안 markdown은 바탕 면 없이 제목 선에서 시작하고, 칸을 채우는 문서는 면을 유지한다", async ({ page }) => {
  const app = await open(page, "preview-markdown-surface");
  const section = await app.locator(".ks-data-tab-panel:not([hidden])").evaluate((panel) => {
    const view = panel.querySelector(".ks-markdown-view")!;
    const text = view.querySelector(".ks-markdown-text")!.getBoundingClientRect();
    const title = panel.querySelector(".ks-data-section-title")!.getBoundingClientRect();
    return { background: getComputedStyle(view).backgroundColor, textLeft: text.left, titleLeft: title.left };
  });
  expect(section.background).toBe("rgba(0, 0, 0, 0)");
  expect(Math.abs(section.textLeft - section.titleLeft)).toBeLessThanOrEqual(0.5);

  await app.getByRole("tab", { name: "문서" }).click();
  const filled = await app.locator(".ks-data-tab-panel:not([hidden]) > .ks-markdown-view").evaluate((view) => {
    const style = getComputedStyle(view);
    return { background: style.backgroundColor, padding: parseFloat(style.paddingLeft) };
  });
  expect(filled.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(filled.padding).toBeGreaterThan(0);
});
