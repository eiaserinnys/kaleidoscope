import { expect, test } from "@playwright/test";

for (const width of [880, 360]) test(`분할 구역 스크롤 바깥에 바닥 여백이 남는다 (${width})`, async ({ page }) => {
  await page.setViewportSize({ width, height: 600 });
  await page.goto('/?preview=nested-fill-split');
  const app = page.getByTestId('app-window-nested-fill-split');
  const sections = app.locator('.ks-split-pane > .ks-data-section');
  await expect(sections).toHaveCount(2);
  for (const section of await sections.all()) {
    const measure = () => section.evaluate(el => {
      const child = el.querySelector(':scope > .ks-data-section-child')!;
      return { gap: el.getBoundingClientRect().bottom - child.getBoundingClientRect().bottom,
        expected: parseFloat(getComputedStyle(el).getPropertyValue('--ks-space-3')) };
    });
    const before = await measure();
    expect(before.gap).toBeCloseTo(before.expected, 0);
    await section.locator(':scope > .ks-data-section-child').evaluate(el => { el.scrollTop = el.scrollHeight; });
    expect(await measure()).toEqual(before);
  }
});

test('창 직속 구역도 스크롤 바깥에 여백을 남긴다', async ({ page }) => {
  await page.goto('/?preview=root-section-list');
  const section = page.getByTestId('app-window-root-section-list').locator('.ks-data-window-body > .ks-data-section');
  await expect(section).toBeVisible();
  const gap = await section.evaluate(el => el.getBoundingClientRect().bottom - el.querySelector(':scope > .ks-data-section-child')!.getBoundingClientRect().bottom);
  expect(gap).toBeCloseTo(12, 0);
});

for (const kind of ['controls', 'markdown', 'editor', 'folder']) test(`구역 안 탭은 바닥 여백을 중복하지 않는다 (${kind})`, async ({ page }) => {
  await page.goto(`/?preview=bottom-tabs-${kind}`);
  const app = page.getByTestId(`app-window-bottom-tabs-${kind}`);
  const section = app.locator('.ks-split-pane > .ks-data-section');
  await expect(section).toBeVisible();
  expect(await section.evaluate(el => getComputedStyle(el).paddingBottom)).toBe('0px');
  const panel = section.locator('.ks-data-tab-panel');
  expect(await panel.evaluate(el => getComputedStyle(el).paddingBottom)).toBe(kind === 'controls' ? '12px' : '0px');
});

for (const width of [880, 360]) test(`구역 옆 직접 콘텐츠도 같은 바닥 끝선을 쓴다 (${width})`, async ({ page }) => {
  await page.setViewportSize({ width, height: 600 });
  await page.goto('/?preview=bottom-split-last');
  const app = page.getByTestId('app-window-bottom-split-last');
  const pane = app.locator('.ks-split-pane').first();
  const list = pane.locator(':scope > .ks-table-scroll');
  await expect(list).toBeVisible();
  if (width === 880) {
    const bottoms = await app.locator('.ks-split-pane > .ks-table-scroll, .ks-data-section-child').evaluateAll(els => els.map(el => el.getBoundingClientRect().bottom));
    expect(Math.abs(bottoms[0] - bottoms[1])).toBeLessThanOrEqual(1);
    expect(await pane.evaluate(el => el.getBoundingClientRect().bottom - el.firstElementChild!.getBoundingClientRect().bottom)).toBeCloseTo(12, 0);
  } else {
    // 중간 칸에는 기존 칸 사이 여백만 남는다.
    expect(await pane.evaluate(el => getComputedStyle(el).paddingBottom)).toBe('8px');
    const section = app.locator('.ks-data-section');
    expect(await section.evaluate(el => getComputedStyle(el).paddingBottom)).toBe('12px');
  }
  const header = list.locator('.ks-table-header');
  const top = (await header.boundingBox())!.y;
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(await list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect((await header.boundingBox())!.y).toBeCloseTo(top, 0);
});

test('뒤에 탭이 이어지는 중간 분할은 바닥 여백을 더하지 않는다', async ({ page }) => {
  await page.goto('/?preview=bottom-split-middle');
  const app = page.getByTestId('app-window-bottom-split-middle');
  const section = app.locator('.ks-split-pane > .ks-data-section');
  await expect(section).toBeVisible();
  expect(await section.evaluate(el => getComputedStyle(el).paddingBottom)).toBe('0px');
  const pane = app.locator('.ks-split-pane').first();
  expect(await pane.evaluate(el => getComputedStyle(el).paddingBottom)).toBe('0px');
});

test('창 본문이 스크롤하는 쌓기의 마지막 글 아래에 여백을 남긴다', async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 600 });
  await page.goto('/?preview=bottom-body-scroll');
  const app = page.getByTestId('app-window-bottom-body-scroll');
  const body = app.locator('.ks-data-window-body');
  const last = app.getByText('출처', { exact: true });
  await expect(last).toBeVisible();
  await body.evaluate(el => { [el, ...el.querySelectorAll('*')].forEach(node => { if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) node.scrollTop = node.scrollHeight; }); });
  const space = await last.evaluate(el => {
    const body = el.closest('.ks-data-window-body')!;
    return body.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom + parseFloat(getComputedStyle(el).paddingBottom);
  });
  expect(space).toBeCloseTo(12, 0);
});
