import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { selectTab } from "./tab-helper";

const evidence = process.env.KS_LIST_DOT_EVIDENCE;

async function openDots(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await selectTab(app, "점 시험");
  const rows = app.getByRole("option");
  await expect(rows).toHaveCount(5);
  await expect(app.locator(".ks-media-thumbnail.is-ready")).toHaveCount(3);
  return { app, rows };
}

async function geometry(row: Locator) {
  return row.evaluate((element) => {
    const dot = element.querySelector<HTMLElement>(".ks-list-dot");
    const title = element.querySelector<HTMLElement>(".ks-list-title")!;
    const picture = element.querySelector<HTMLElement>(".ks-media-thumbnail");
    const row = element.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const result = { title: { left: titleRect.left, ellipsed: title.scrollWidth > title.clientWidth }, dot: null as null | Record<string, unknown> };
    if (!dot) return result;
    const rect = dot.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const box = picture?.getBoundingClientRect();
    result.dot = {
      width: rect.width,
      visibleInRow: rect.left >= row.left && rect.right <= row.right && rect.top >= row.top && rect.bottom <= row.bottom,
      onTop: document.elementFromPoint(cx, cy) === dot,
      bottomRightOfPicture: box ? cx > box.left + box.width / 2 && cy > box.top + box.height / 2 : null,
      background: getComputedStyle(dot).backgroundColor,
    };
    return result;
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} 줄 목록의 상태 점이 그림 모서리와 제목 뒤에 앉는다`, async ({ page }) => {
    const { app, rows } = await openDots(page, theme);
    const [first, second, third, fourth, fifth] = await Promise.all([0, 1, 2, 3, 4].map((index) => geometry(rows.nth(index))));
    const positive = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.background = "var(--ks-color-positive)";
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    expect(first.dot).toMatchObject({ visibleInRow: true, onTop: true, bottomRightOfPicture: true, background: positive });
    expect(second.dot).toBeNull();
    expect(third.dot).toMatchObject({ visibleInRow: true, onTop: true, bottomRightOfPicture: true });
    expect(fourth.dot).toMatchObject({ visibleInRow: true, onTop: true });
    expect(fifth.dot).toBeNull();
    expect(fourth.title.ellipsed).toBe(true);
    expect(fourth.title.left).toBeCloseTo(fifth.title.left, 1);
    if (evidence) await app.screenshot({ path: `${evidence}/list-dot-${theme}.png` });
  });
}
