import { expect, test } from "@playwright/test";

test("나란한 칸의 첫 줄과 목록 시작선을 맞춘다", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/?preview=pane-alignment-1015");
  const app = page.getByTestId("app-window-pane-alignment-1015");
  const panes = app.locator(".ks-split-row > .ks-split-pane");
  const list = panes.nth(0).locator(".ks-list");
  const group = list.locator('.ks-view-group strong').first();
  const firstRow = list.locator('.ks-list-row').first();
  await expect(firstRow).toBeVisible();
  const metrics = await app.evaluate(root => {
    const panes = [...root.querySelectorAll<HTMLElement>('.ks-split-row > .ks-split-pane')];
    const rect = (selector: string, pane: number) => panes[pane].querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const center = (r: DOMRect) => r.top + r.height / 2;
    const outerGroup = rect('.ks-view-group strong', 0);
    const outerRow = rect('.ks-list-row .ks-list-title', 0);
    const selected = rect('.ks-list-row.is-selected', 0);
    const innerGroup = rect('.ks-view-group strong', 2);
    const innerRow = rect('.ks-list-row .ks-list-title', 2);
    return {
      centers: [center(outerGroup), center(rect('.ks-data-section-title', 1)), center(rect('.ks-data-section-title', 2))],
      contentTop: [rect('.ks-data-section-child', 1).top, rect('.ks-data-section-child', 2).top],
      outside: outerGroup.left - outerRow.left, inside: innerGroup.left - innerRow.left,
      selectedInset: selected.left - panes[0].getBoundingClientRect().left,
      space: parseFloat(getComputedStyle(root).getPropertyValue('--ks-space-1')),
      rowTop: rect('.ks-list-row', 0).top, groupBottom: rect('.ks-view-group', 0).bottom,
    };
  });
  expect(Math.max(...metrics.centers) - Math.min(...metrics.centers)).toBeLessThanOrEqual(1);
  expect(metrics.contentTop[0]).toBe(metrics.contentTop[1]);
  expect(Math.abs(metrics.outside)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.inside)).toBeLessThanOrEqual(1);
  expect(metrics.selectedInset).toBe(metrics.space);
  expect(metrics.rowTop).toBeGreaterThanOrEqual(metrics.groupBottom);
  await list.evaluate(el => { el.scrollTop = el.scrollHeight / 2; });
  const sticky = list.locator('.ks-view-sticky .ks-view-group strong');
  await expect(sticky).toBeVisible();
  const stickyLeft = (await sticky.boundingBox())!.x;
  const rowLeft = (await list.locator('.ks-list-row .ks-list-title').first().boundingBox())!.x;
  expect(Math.abs(stickyLeft - rowLeft)).toBeLessThanOrEqual(1);
  await expect(group).toBeAttached();
});

test("구역 머리는 동작 종류에 관계없이 같은 높이다", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/?preview=pane-header-1015");
  const app = page.getByTestId("app-window-pane-header-1015");
  const headers = app.locator('.ks-data-section-header');
  await expect(headers).toHaveCount(3);
  const heights = await headers.evaluateAll(els => els.map(el => el.getBoundingClientRect().height));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
});

test("탭 안 가로 분할의 첫 묶음과 구역 제목을 맞춘다", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/?preview=pane-tab-alignment-1015");
  const app = page.getByTestId("app-window-pane-tab-alignment-1015");
  for (const tab of ["직접 분할", "첫 세로 칸", "둘째 세로 칸"]) {
    await app.getByRole("tab", { name: tab, exact: true }).click();
    const split = app.locator(".ks-data-tab-panel:visible .ks-split-row").first();
    await expect(split.locator(".ks-list-row").first()).toBeVisible();
    const centers = await split.evaluate(root => {
      const group = root.querySelector<HTMLElement>(".ks-list .ks-view-group strong")!.getBoundingClientRect();
      const title = root.querySelector<HTMLElement>(".ks-data-section-title")!.getBoundingClientRect();
      return { group: group.top + group.height / 2, title: title.top + title.height / 2 };
    });
    console.log(`탭 안 ${tab}: ${JSON.stringify(centers)}`);
    expect(Math.abs(centers.group - centers.title)).toBeLessThanOrEqual(1);
  }
});

test("스크롤된 묶음 머리는 고른 행의 양 끝과 곡률을 따른다", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/?preview=pane-alignment-1015");
  const app = page.getByTestId("app-window-pane-alignment-1015");
  const list = app.locator(".ks-split-row > .ks-split-pane > .ks-list").first();
  await expect(list.locator(".ks-list-row").first()).toBeVisible();
  await list.evaluate(el => { el.scrollTop = el.scrollHeight / 2; });
  const sticky = list.locator(".ks-view-sticky .ks-view-group");
  await expect(sticky).toBeVisible();
  const visibleIndex = await list.locator(".ks-list-row").evaluateAll(rows => {
    const viewport = rows[0].closest(".ks-list")!.getBoundingClientRect();
    const heading = rows[0].closest(".ks-list")!.querySelector(".ks-view-sticky .ks-view-group")!.getBoundingClientRect();
    return rows.findIndex(row => {
      const box = row.getBoundingClientRect();
      return box.top >= heading.bottom && box.bottom <= viewport.bottom;
    });
  });
  expect(visibleIndex).toBeGreaterThanOrEqual(0);
  await list.locator(".ks-list-row").nth(visibleIndex).click();
  await expect(list.locator(".ks-list-row.is-selected")).toBeVisible();
  const metrics = await list.evaluate(el => {
    const heading = el.querySelector<HTMLElement>(".ks-view-sticky .ks-view-group")!;
    const selected = el.querySelector<HTMLElement>(".ks-list-row.is-selected")!;
    const text = heading.querySelector("strong")!.getBoundingClientRect();
    const rowText = selected.querySelector(".ks-list-title")!.getBoundingClientRect();
    const headBox = heading.getBoundingClientRect();
    const rowBox = selected.getBoundingClientRect();
    const paneBox = el.parentElement!.getBoundingClientRect();
    const style = getComputedStyle(heading);
    return { headLeft: headBox.left, headRight: headBox.right, rowLeft: rowBox.left, rowRight: rowBox.right,
      textLeft: text.left, rowTextLeft: rowText.left, paneLeft: paneBox.left,
      inset: parseFloat(style.getPropertyValue("--ks-space-1")), radius: parseFloat(style.borderTopLeftRadius),
      expectedRadius: parseFloat(getComputedStyle(selected).borderTopLeftRadius), scrollable: el.scrollHeight > el.clientHeight };
  });
  console.log(`붙는 묶음 머리: ${JSON.stringify(metrics)}`);
  expect(metrics.scrollable).toBe(true);
  expect(Math.abs(metrics.headLeft - metrics.rowLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.headRight - metrics.rowRight)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.textLeft - metrics.rowTextLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.rowLeft - metrics.paneLeft - metrics.inset)).toBeLessThanOrEqual(1);
  expect(metrics.radius).toBe(metrics.expectedRadius);
});

test("가로 분할 안의 세로 분할도 첫 줄과 머리 높이를 맞춘다", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/?preview=pane-nested-1015");
  const app = page.getByTestId("app-window-pane-nested-1015");
  await expect(app.locator('.ks-list-row').first()).toBeVisible();
  const result = await app.evaluate(root => {
    const group = root.querySelector('.ks-list .ks-view-group strong')!.getBoundingClientRect();
    const sections = [...root.querySelectorAll<HTMLElement>('.ks-data-section')];
    const headers = sections.map(section => section.querySelector<HTMLElement>(':scope > .ks-data-section-header')!.getBoundingClientRect());
    const titles = sections.map(section => section.querySelector<HTMLElement>(':scope > .ks-data-section-header .ks-data-section-title')!.getBoundingClientRect());
    const contents = sections.map(section => section.querySelector<HTMLElement>(':scope > .ks-data-section-child')!.getBoundingClientRect());
    return { centers: [group, titles[0], titles[2]].map(r => r.top + r.height / 2), heights: headers.map(r => r.height), tops: [contents[0].top, contents[2].top] };
  });
  expect(Math.max(...result.centers) - Math.min(...result.centers)).toBeLessThanOrEqual(1);
  expect(Math.max(...result.heights) - Math.min(...result.heights)).toBeLessThanOrEqual(1);
  expect(result.tops[0]).toBe(result.tops[1]);
});

test("미리보기 이름은 기본 굵기다", async ({ page }) => {
  await page.goto("/?preview=preview-grid-tabs");
  const app = page.getByTestId("app-window-preview-grid-tabs");
  const label = app.locator('.ks-data-button-card-label .ks-data-button-label').first();
  await expect(label).toBeVisible();
  await expect(label).not.toHaveClass(/is-emphasized/);
});

test("좁은 칸에서 줄바꿈한 긴 머리와 본문이 겹치지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.goto("/?preview=pane-long-heading-1015");
  const app = page.getByTestId("app-window-pane-long-heading-1015");
  const section = app.locator('.ks-data-section');
  await expect(section.locator('.ks-feed-entry').first()).toBeVisible();
  const boxes = await section.evaluate(el => {
    const header = el.querySelector<HTMLElement>(':scope > .ks-data-section-header')!;
    const title = header.querySelector<HTMLElement>('.ks-data-section-title')!;
    const meta = header.querySelector<HTMLElement>('.ks-data-section-meta')!;
    const child = el.querySelector<HTMLElement>(':scope > .ks-data-section-child')!;
    return { title: title.getBoundingClientRect().toJSON(), meta: meta.getBoundingClientRect().toJSON(),
      header: header.getBoundingClientRect().toJSON(), child: child.getBoundingClientRect().toJSON(), lineHeight: parseFloat(getComputedStyle(title).lineHeight) };
  });
  expect(boxes.title.height).toBeGreaterThan(boxes.lineHeight);
  expect(boxes.header.bottom).toBeGreaterThanOrEqual(Math.max(boxes.title.bottom, boxes.meta.bottom));
  expect(boxes.child.top).toBeGreaterThanOrEqual(boxes.header.bottom);
});

for (const context of ["direct", "section", "tab", "dialog"]) {
  test(`격자 글 시작선과 붙는 띠 여백: ${context}`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto(`/?preview=pane-bands-1015-${context}`);
    const root = context === "dialog" ? page.locator('.ks-dialog') : page.getByTestId(`app-window-pane-bands-1015-${context}`);
    const grid = root.locator('.ks-list.is-grid');
    await expect(grid.locator('.ks-list-card').first()).toBeVisible();
    const metrics = await grid.evaluate(el => {
      const textLeft = (e: Element) => { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect().left; };
      const title = el.querySelector('.ks-list-title')!;
      const meta = el.querySelector('.ks-list-card > .ks-view-meta')!;
      return { group: textLeft(el.querySelector('.ks-view-group strong')!), title: textLeft(title), meta: textLeft(meta), letter: getComputedStyle(el.querySelector('.ks-view-group strong')!).letterSpacing };
    });
    expect(Math.abs(metrics.group - metrics.title)).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.meta - metrics.title)).toBeLessThanOrEqual(1);
    expect(metrics.letter).toBe("normal");
    await grid.evaluate(el => { el.scrollTop = 200; });
    const band = grid.locator('.ks-view-sticky .ks-view-group');
    await expect(band).toBeVisible();
    const stickyTop = await band.evaluate(el => Math.abs(el.getBoundingClientRect().top - el.closest('.ks-list')!.getBoundingClientRect().top));
    expect(stickyTop).toBeLessThanOrEqual(1);
    await expect(band).toHaveCSS('border-top-left-radius', '0px');
    await expect(band).toHaveCSS('border-top-right-radius', '0px');
    if (context === "section" || context === "tab") {
      const feed = root.locator('.ks-feed');
      await feed.evaluate(el => { el.scrollTop = 200; });
      const padding = await feed.locator('.ks-view-sticky .ks-view-group').evaluate(el => {
        const s = getComputedStyle(el);
        return { left: parseFloat(s.paddingLeft), right: parseFloat(s.paddingRight), space: parseFloat(s.getPropertyValue('--ks-space-2')) };
      });
      expect(padding.left).toBe(padding.space);
      expect(padding.right).toBe(padding.space);
    }
  });
}
