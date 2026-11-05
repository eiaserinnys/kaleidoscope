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
