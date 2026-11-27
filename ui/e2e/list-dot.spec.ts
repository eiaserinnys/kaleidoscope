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

// 점 둘레 틈: 점의 칠한 고리 자리를 뚫어 그 행의 바탕이 보여야 한다. 점 둘레 화소 가운데 바탕도 점 색도 아닌 것(옛 칠한 고리)이 남은 것을 센다.
async function ringMatchesRowBackground(page: Page, row: Locator) {
  const lead = await row.evaluate((element) => {
    const dot = element.querySelector<HTMLElement>(".ks-list-lead > .ks-list-dot")!;
    const rect = dot.getBoundingClientRect();
    const rowRect = element.getBoundingClientRect();
    const leadRect = dot.parentElement!.getBoundingClientRect();
    const dotRadius = rect.width / 2;
    const line = parseFloat(getComputedStyle(element).getPropertyValue("--ks-line-width")) || 1;
    const dotColor = getComputedStyle(dot).backgroundColor.match(/\d+/g)!.slice(0, 3).map(Number);
    return { dotColor, cx: rect.left + dotRadius - rowRect.left, cy: rect.top + dotRadius - rowRect.top, radius: dotRadius + line / 2, backgroundX: leadRect.right + 3 - rowRect.left, backgroundY: leadRect.top + leadRect.height / 2 - rowRect.top };
  });
  const shot = (await row.screenshot()).toString("base64");
  return page.evaluate(async ({ shot, lead }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${shot}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixel = (x: number, y: number) => [...context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data.slice(0, 3)];
    const background = pixel(lead.backgroundX, lead.backgroundY);
    const distance = (a: number[], b: number[]) => Math.hypot(...a.map((channel, index) => channel - b[index]));
    // 점 가장자리 화소는 바탕과 점 색의 섞임이므로 바탕과 점 색을 잇는 선 위의 화소도 틈이 비어 있는 것으로 센다.
    const toSegment = (rgb: number[]) => {
      const direction = lead.dotColor.map((channel: number, index: number) => channel - background[index]);
      const length2 = direction.reduce((sum: number, value: number) => sum + value * value, 0);
      const t = Math.min(1, Math.max(0, rgb.reduce((sum, channel, index) => sum + (channel - background[index]) * direction[index], 0) / length2));
      return distance(rgb, background.map((channel, index) => channel + direction[index] * t));
    };
    const samples = Array.from({ length: 16 }, (_, index) => {
      const angle = (index / 16) * Math.PI * 2;
      return pixel(lead.cx + Math.cos(angle) * lead.radius, lead.cy + Math.sin(angle) * lead.radius);
    });
    const blocked = samples.filter((rgb) => distance(rgb, background) > 6 && toSegment(rgb) > 6).length;
    return { blocked, total: samples.length, background, dot: lead.dotColor, samples };
  }, { shot, lead });
}

for (const theme of ["light", "dark"] as const) {
  for (const state of ["selected", "hover"] as const) {
    test(`${theme} ${state} 행에서 점 둘레 틈이 그 행의 바탕색으로 보인다`, async ({ page }) => {
      const { app, rows } = await openDots(page, theme);
      const target = rows.nth(0);
      if (state === "selected") await target.click();
      if (state === "hover") await target.hover(); else await page.mouse.move(0, 0);
      await expect(target).toHaveAttribute("aria-selected", state === "selected" ? "true" : "false");
      const result = await ringMatchesRowBackground(page, target);
      expect(result.blocked, JSON.stringify(result)).toBeLessThanOrEqual(2);
      if (evidence) await app.screenshot({ path: `${evidence}/list-dot-${theme}-${state}.png` });
    });
  }

  test(`${theme} 네모 그림 행과 아이콘 행도 점 둘레 틈이 행 바탕색이다`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/?preview=data-views-test");
    const app = page.getByTestId("app-window-data-views-test");
    await selectTab(app, "점 모양 시험");
    const rows = app.getByRole("option");
    await expect(rows).toHaveCount(2);
    await expect(app.locator(".ks-media-thumbnail.is-ready")).toHaveCount(1);
    for (const index of [0, 1]) {
      const target = rows.nth(index);
      await target.hover();
      const result = await ringMatchesRowBackground(page, target);
      if (evidence) await target.screenshot({ path: `${evidence}/list-dot-${theme}-shapes-${index + 1}.png` });
      expect(result.blocked, `${index}: ${JSON.stringify(result)}`).toBeLessThanOrEqual(2);
      const style = await target.evaluate((element) => {
        const dot = element.querySelector<HTMLElement>(".ks-list-lead > .ks-list-dot")!;
        const picture = dot.parentElement!.firstElementChild as HTMLElement;
        const mask = getComputedStyle(picture);
        return { shadow: getComputedStyle(dot).boxShadow, mask: mask.maskImage || mask.webkitMaskImage };
      });
      expect(style.shadow).toBe("none");
      expect(style.mask).toContain("radial-gradient");
    }
    if (evidence) await app.screenshot({ path: `${evidence}/list-dot-${theme}-shapes.png` });
  });
}
