import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test.use({ locale: "ko-KR", timezoneId: "Asia/Seoul" });

async function schedule(page: Page, empty: boolean) {
  await page.clock.setFixedTime(new Date("2026-11-05T03:00:00Z"));
  await page.goto("/?preview=block-gallery");
  const app = page.getByTestId("app-window-block-gallery");
  const tab = app.getByRole("tab", { name: "일정", exact: true });
  if (await tab.isVisible()) await tab.click();
  else {
    await app.getByRole("button", { name: "탭 더 보기" }).click();
    await page.getByRole("menuitem", { name: "일정", exact: true }).click();
  }
  await expect(app.locator(".ks-timeline-dates")).toBeVisible();
  await page.evaluate(async (empty) => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const version = snapshot.shared.app_versions.find((item: any) => item.app_id === "block-gallery");
    const index = version.definition.ui.tabs.findIndex((item: any) => item.label === "일정");
    const timeline = version.definition.ui.tabs[index].child;
    if (empty) timeline.tracks = [];
    else {
      timeline.tracks[0].items[1].muted = true;
      timeline.tracks[0].items[2].muted = true;
      timeline.tracks[0].items.push({ id: "a4", label: "추가 작업", tone: "warning" });
    }
    version.version += 1;
    const appWindow = snapshot.shared.windows.find((item: any) => item.app_id === "block-gallery");
    appWindow.app_version = version.version;
    appWindow.state.tab = index;
    harness.emit({ event: "state.changed", snapshot });
  }, empty);
  await page.evaluate(() => document.fonts.ready);
  return app;
}

test("주 눈금도 글자가 들어가는 경계 칸을 표시한다", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  const app = await schedule(page, true);
  const root = app.locator(".ks-timeline-dates");
  for (let i = 0; i < 12 && await root.getAttribute("data-scale") === "day"; i++) {
    await app.getByRole("button", { name: "축소" }).click();
  }
  await expect(root).toHaveAttribute("data-scale", "week");
  const result = await root.evaluate((element) => {
    const corner = element.querySelector(".ks-dates-corner")!.getBoundingClientRect();
    const scroll = element.querySelector(".ks-dates-scroll")!.getBoundingClientRect();
    const ticks = element.querySelector<HTMLElement>(".ks-dates-ticks")!;
    const canvas = document.createElement("canvas").getContext("2d")!;
    canvas.font = getComputedStyle(ticks).font;
    const rendered = [...ticks.querySelectorAll<HTMLElement>(":scope > span")].map((tick) => parseFloat(tick.style.left));
    const format = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", timeZone: "UTC" });
    const start = Date.UTC(2026, 9, 19);
    const columns = [...element.querySelectorAll<HTMLElement>(".ks-dates-background > span[style*='width']")];
    const candidates = columns.flatMap((column) => {
      const rect = column.getBoundingClientRect(), x = parseFloat(column.style.left);
      const day = Math.round(x / rect.width);
      if (day % 7 !== 0) return [];
      const text = format.format(new Date(start + day * 86400000));
      const half = canvas.measureText(text).width / 2, center = rect.left + rect.width * 7 / 2;
      return center - half >= corner.right && center + half <= scroll.right ? [{ x, text }] : [];
    });
    return { candidates, missing: candidates.filter((tick) => !rendered.some((x) => Math.abs(x - tick.x) < 0.1)) };
  });
  expect(result.candidates.length).toBeGreaterThan(0);
  expect(result.missing).toEqual([]);
});

async function capture(page: Page, name: string) {
  const screenshot = await page.screenshot();
  const directory = process.env.KS_DATA_CAPTURE_DIR;
  if (directory) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${name}.png`), screenshot);
  }
  return screenshot;
}

for (const width of [1200, 360]) {
  test(`${width} 처음 그린 일정표의 날짜 글자는 보이는 만큼 표시한다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    const app = await schedule(page, true);
    const root = app.locator(".ks-timeline-dates");
    await expect(root).toHaveAttribute("data-scale", "day");
    await expect(root.locator(".ks-dates-ticks > span").first()).toBeVisible();
    await capture(page, `initial-empty-${width}`);
    const metrics = await root.evaluate((element) => {
      const corner = element.querySelector(".ks-dates-corner")!.getBoundingClientRect();
      const scroll = element.querySelector(".ks-dates-scroll")!.getBoundingClientRect();
      const ticks = element.querySelector<HTMLElement>(".ks-dates-ticks")!;
      const style = getComputedStyle(ticks);
      const canvas = document.createElement("canvas").getContext("2d")!;
      canvas.font = style.font;
      const rendered = [...ticks.querySelectorAll<HTMLElement>(":scope > span")].map((tick) => parseFloat(tick.style.left));
      const start = Date.UTC(2026, 9, 19);
      const number = new Intl.DateTimeFormat("ko-KR", { day: "numeric", timeZone: "UTC" });
      const columns = [...element.querySelectorAll<HTMLElement>(".ks-dates-background > span[style*='width']")];
      const candidates = columns.map((column) => {
        const rect = column.getBoundingClientRect();
        const x = parseFloat(column.style.left);
        const day = Math.round(x / rect.width);
        const text = number.formatToParts(new Date(start + day * 86400000)).find((part) => part.type === "day")!.value;
        const half = canvas.measureText(text).width / 2;
        const center = rect.left + rect.width / 2;
        return { x, text, left: center - half, right: center + half };
      }).filter((tick) => tick.left >= corner.right && tick.right <= scroll.right);
      const missing = candidates.filter((tick) => !rendered.some((x) => Math.abs(x - tick.x) < 0.1));
      const first = ticks.querySelector("span")!;
      const range = document.createRange(); range.selectNodeContents(first);
      const firstLeft = range.getBoundingClientRect().left;
      const month = [...element.querySelectorAll(".ks-dates-month")].find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.right > corner.right && rect.left < scroll.right;
      })!;
      const monthLeft = month.querySelector("span")!.getBoundingClientRect().left;
      return { candidates, missing, firstLeft, monthLeft, dayWidth: columns[0].getBoundingClientRect().width };
    });
    expect(metrics.candidates.length).toBeGreaterThan(0);
    expect(metrics.missing).toEqual([]);
    expect(Math.abs(metrics.firstLeft - metrics.monthLeft)).toBeLessThanOrEqual(metrics.dayWidth);
  });

  test(`${width} 트랙이 있는 처음 일정표의 끝 날짜는 잘리지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    const app = await schedule(page, false);
    const root = app.locator(".ks-timeline-dates");
    await expect(root).toHaveAttribute("data-scale", "day");
    await expect(root.locator(".ks-dates-ticks > span").first()).toBeVisible();
    await capture(page, `initial-tracks-${width}`);
    const metrics = await root.evaluate((element) => {
      const corner = element.querySelector(".ks-dates-corner")!.getBoundingClientRect();
      const scroll = element.querySelector(".ks-dates-scroll")!.getBoundingClientRect();
      const texts = [...element.querySelectorAll(".ks-dates-ticks > span")].map((tick) => {
        const range = document.createRange(); range.selectNodeContents(tick);
        const rect = range.getBoundingClientRect();
        return { text: tick.textContent, left: rect.left, right: rect.right };
      }).filter((tick) => tick.right > corner.right && tick.left < scroll.right);
      return { texts, left: corner.right, right: scroll.right };
    });
    expect(metrics.texts.length).toBeGreaterThan(0);
    for (const tick of metrics.texts) {
      expect.soft(tick.left, `눈금 ${tick.text}의 왼쪽`).toBeGreaterThanOrEqual(metrics.left - 1);
      expect.soft(tick.right, `눈금 ${tick.text}의 오른쪽`).toBeLessThanOrEqual(metrics.right + 1);
    }
  });

  test(`${width} 날짜 없는 항목의 흐림과 색`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    const app = await schedule(page, false);
    const muted = app.getByRole("button", { name: "추가 검토 날짜 없음" });
    const toned = app.getByRole("button", { name: "추가 작업 날짜 없음" });
    await expect(toned).toBeVisible();
    await capture(page, `chips-${width}`);
    await expect.soft(muted).toHaveClass(/\bis-muted\b/, { timeout: 500 });
    await expect.soft(toned).toHaveClass(/\bis-warning\b/, { timeout: 500 });
    const styles = await toned.evaluate((element) => {
      const style = getComputedStyle(element);
      const probe = document.createElement("div");
      probe.style.color = "var(--ks-color-warning)";
      element.appendChild(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { border: style.borderTopColor, borderStyle: style.borderTopStyle, expected };
    });
    expect.soft(styles.border).toBe(styles.expected);
    expect(styles.borderStyle).toBe("dashed");
    const opacity = await muted.evaluate((element) => getComputedStyle(element).opacity);
    expect.soft(opacity).toBe(await app.locator(".ks-timeline-item.is-muted").first().evaluate((element) => getComputedStyle(element).opacity));
    await toned.click();
    await expect(toned).toHaveClass(/\bis-selected\b/);
    const selected = await toned.evaluate((element) => {
      const style = getComputedStyle(element);
      const probe = document.createElement("div");
      probe.style.color = "var(--ks-color-accent)";
      element.appendChild(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return { border: style.borderTopColor, borderStyle: style.borderTopStyle, accent };
    });
    expect(selected.borderStyle).toBe("solid");
    expect(selected.border).toBe(selected.accent);
  });

  test(`${width} 빈 일정표의 행 머리와 끝 눈금`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    const app = await schedule(page, true);
    const root = app.locator(".ks-timeline-dates");
    const scroll = root.locator(".ks-dates-scroll");
    await expect(app.getByText("없음", { exact: true })).toBeVisible();
    await scroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const screenshot = await capture(page, `empty-${width}`);
    const metrics = await root.evaluate((element) => {
      const corner = element.querySelector(".ks-dates-corner")!.getBoundingClientRect();
      const body = element.querySelector(".ks-dates-body")!.getBoundingClientRect();
      const scroll = element.querySelector(".ks-dates-scroll")!.getBoundingClientRect();
      const empty = element.querySelector(".ks-dates-empty")!.getBoundingClientRect();
      const texts = [...element.querySelectorAll(".ks-dates-ticks > span")].map((tick) => {
        const text = document.createRange();
        text.selectNodeContents(tick);
        const bounds = text.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, text: tick.textContent };
      }).filter((text) => text.right > corner.right && text.left < scroll.right);
      return { left: Math.ceil(corner.left + 4), right: Math.floor(corner.right - 4), y: Math.round(body.top + 10),
        color: getComputedStyle(element.querySelector(".ks-dates-corner")!).backgroundColor,
        tickLeft: corner.right, tickRight: scroll.right, texts,
        emptyTop: empty.top, bodyTop: body.top, emptyBottom: empty.bottom, scrollBottom: scroll.bottom };
    });
    const mismatch = await page.evaluate(async ({ png, metrics }) => {
      const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(metrics.left, metrics.y, metrics.right - metrics.left, 1).data;
      ctx.fillStyle = metrics.color; ctx.fillRect(0, 0, 1, 1);
      const expected = ctx.getImageData(0, 0, 1, 1).data;
      let mismatch = 0;
      for (let i = 0; i < pixels.length; i += 4) if ([0, 1, 2].some((channel) => Math.abs(pixels[i + channel] - expected[channel]) > 2)) mismatch++;
      return mismatch;
    }, { png: screenshot.toString("base64"), metrics });
    console.log(`${width} 빈 일정표: ${JSON.stringify({ ...metrics, mismatch })}`);
    expect.soft(mismatch).toBe(0);
    expect.soft(Math.abs(metrics.emptyTop - metrics.bodyTop)).toBeLessThanOrEqual(1);
    expect.soft(metrics.emptyBottom).toBeLessThanOrEqual(metrics.scrollBottom + 1);
    for (const tick of metrics.texts) {
      expect.soft(tick.left, `눈금 ${tick.text}의 왼쪽`).toBeGreaterThanOrEqual(metrics.tickLeft - 1);
      expect.soft(tick.right, `눈금 ${tick.text}의 오른쪽`).toBeLessThanOrEqual(metrics.tickRight + 1);
    }
  });
}
