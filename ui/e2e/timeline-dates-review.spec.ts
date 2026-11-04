import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.env.KS_DATA_CAPTURE_DIR;
test.use({ locale: "ko-KR", timezoneId: "Asia/Seoul" });
async function shot(page: Page, name: string) {
  const suffix = process.env.KS_CAPTURE_SUFFIX ?? "";
  if (suffix && !["r2-1200-fit", "r2-360-fit", "r2-1200-day"].includes(name)) return;
  if (out) { mkdirSync(out, { recursive: true }); await page.screenshot({ path: join(out, `${name}${suffix}.png`) }); }
}
async function schedule(page: Page) {
  await page.goto("/?preview=block-gallery");
  const app = page.getByTestId("app-window-block-gallery");
  const tab = app.getByRole("tab", { name: "일정", exact: true });
  if (await tab.isVisible()) await tab.click();
  else { await app.getByRole("button", { name: "탭 더 보기" }).click(); await page.getByRole("menuitem", { name: "일정", exact: true }).click(); }
  await expect(app.locator(".ks-timeline-dates")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return app;
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const { snapshot } = await (window as any).__ksHarness.call({ op: "state.get" });
    return snapshot.shared.windows.find((item: any) => item.app_id === "block-gallery").state;
  });
}
async function change(page: Page, mode: "prepare" | "earlier" | "empty") {
  await page.evaluate(async (mode) => {
    const h = (window as any).__ksHarness;
    const { snapshot } = await h.call({ op: "state.get" });
    const version = snapshot.shared.app_versions.find((item: any) => item.app_id === "block-gallery");
    const index = version.definition.ui.tabs.findIndex((item: any) => item.label === "일정");
    const timeline = version.definition.ui.tabs[index].child;
    const w = snapshot.shared.windows.find((item: any) => item.app_id === "block-gallery");
    if (mode === "prepare") {
      w.state.r2_tracks = timeline.tracks;
      for (const track of w.state.r2_tracks) for (const item of track.items) if (item.start) { item.movable = true; item.resizable = true; }
      version.definition.state.r2_tracks = w.state.r2_tracks;
      version.definition.state.r2_edit = null;
      timeline.tracks = { state: "r2_tracks" };
      timeline.on_edit = { set_state: "r2_edit" };
      version.version += 1; w.app_version = version.version;
    } else if (mode === "earlier") w.state.r2_tracks[0].items[0].start = "2025-12-15";
    else if (Array.isArray(timeline.tracks)) { timeline.tracks = []; version.version += 1; w.app_version = version.version; }
    else w.state.r2_tracks = [];
    w.state.tab = index;
    h.emit({ event: "state.changed", snapshot });
  }, mode);
}

for (const width of [1200, 360]) {
  test(`${width} 날짜 숫자·이름표·맞춤·가로 이동과 처음 화면`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    const app = await schedule(page);
    const root = app.locator(".ks-timeline-dates"), scroll = root.locator(".ks-dates-scroll");
    const metrics = await root.evaluate((root) => {
      const rect = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      const ticks = [...root.querySelectorAll(".ks-dates-ticks > span")].map((el) => el.textContent);
      const row = root.querySelector(".ks-dates-markers")!, rowBox = rect(row);
      const labels = [...row.children].filter((el) => getComputedStyle(el).visibility !== "hidden").map((el) => ({ text: el.textContent, ...rect(el) }));
      const scroller = root.querySelector(".ks-dates-scroll")!, edge = rect(root.querySelector(".ks-dates-corner")!).right;
      const today = root.querySelector(".ks-dates-background .is-today")!;
      return { ticks, labels, row: rowBox, edge, right: rect(scroller).right, today: rect(today) };
    });
    expect(metrics.ticks.every((text) => /^\d+$/.test(text!))).toBe(true);
    expect(metrics.today.x).toBeGreaterThanOrEqual(metrics.edge);
    expect(metrics.today.x).toBeLessThanOrEqual(metrics.edge + (metrics.right - metrics.edge) * 2 / 3 + 1);
    if (width === 360) expect(Math.abs(metrics.today.x - metrics.edge - (metrics.right - metrics.edge) / 3)).toBeLessThanOrEqual(1);
    for (const label of metrics.labels) expect(Math.abs((label.y - metrics.row.y) - (metrics.row.bottom - label.bottom))).toBeLessThanOrEqual(1);
    await shot(page, `r2-${width}-day`);
    if (width === 360) await shot(page, "r2-360-initial");
    if (out) writeFileSync(join(out, `r2-${width}-metrics.json`), JSON.stringify(metrics, null, 2));
    if (out && !process.env.KS_CAPTURE_SUFFIX) {
      const session = await page.context().newCDPSession(page);
      const capture = await session.send("Page.captureScreenshot", { format: "png", clip: { x: metrics.edge, y: metrics.row.y, width: metrics.right - metrics.edge, height: metrics.row.height, scale: 2 } });
      writeFileSync(join(out, `r2-${width}-markers.png`), Buffer.from(capture.data, "base64"));
      await session.detach();
    }
    await page.evaluate(() => {
      const original = HTMLElement.prototype.getBoundingClientRect;
      (window as any).r2MarkerReads = 0;
      (window as any).r2RestoreMeasure = () => { HTMLElement.prototype.getBoundingClientRect = original; };
      HTMLElement.prototype.getBoundingClientRect = function () {
        if (this.hasAttribute("data-marker")) (window as any).r2MarkerReads++;
        return original.call(this);
      };
    });
    await scroll.evaluate((el) => { el.scrollLeft += 430; });
    await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(430);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const markerReads = await page.evaluate(() => { (window as any).r2RestoreMeasure(); return (window as any).r2MarkerReads; });
    expect(markerReads).toBe(0);
    const labels = await root.evaluate((root) => {
      const edge = root.querySelector(".ks-dates-corner")!.getBoundingClientRect().right;
      return [...root.querySelectorAll(".ks-timeline-item")].filter((el) => { const r = el.getBoundingClientRect(); return r.left < edge && r.right > edge + 12; }).map((el) => {
        const label = el.querySelector(".ks-timeline-label")!, r = label.getBoundingClientRect();
        return { x: r.x, right: r.right, edge, end: el.getBoundingClientRect().right };
      });
    });
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) { expect(Math.abs(label.x - label.edge)).toBeLessThanOrEqual(1); expect(label.right).toBeLessThanOrEqual(label.end + 1); }
    await shot(page, `r2-${width}-hscroll430`);
    await app.getByRole("button", { name: "전체 맞춤" }).click();
    await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBe(0);
    const fitted = await scroll.evaluate((el) => ({ width: el.clientWidth, total: el.scrollWidth }));
    expect(fitted.total).toBeLessThanOrEqual(fitted.width + 1);
    const periodLabels = await root.locator(".ks-dates-period-text").evaluateAll((labels) => labels.map((label) => {
      const box = (label.closest(".ks-dates-month") ?? label.parentElement)!.getBoundingClientRect();
      return { text: label.textContent, visible: getComputedStyle(label).visibility !== "hidden", width: label.getBoundingClientRect().width, box: box.width };
    }));
    expect(periodLabels.find((label) => label.text === "2025년")?.visible).toBe(false);
    expect(periodLabels.find((label) => label.text === "2027년")?.visible).toBe(false);
    expect(periodLabels.find((label) => label.text === "2026년")?.visible).toBe(true);
    if (width === 1200) expect(periodLabels.filter((label) => label.text === "12월")[0].visible).toBe(false);
    for (const label of periodLabels.filter((label) => label.visible)) expect(label.width).toBeLessThanOrEqual(label.box);
    const outside = await root.locator(".ks-timeline-label.is-outside").evaluateAll((labels) => labels.map((label) => ({ x: label.getBoundingClientRect().x, end: label.parentElement!.getBoundingClientRect().right })));
    expect(outside.length).toBeGreaterThan(0);
    for (const label of outside) expect(Math.abs(label.x - label.end - 4)).toBeLessThanOrEqual(1);
    const chips = await root.locator(".ks-dates-markers").evaluate((row) => [...row.children].filter((el) => getComputedStyle(el).visibility !== "hidden").map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; }).sort((a, b) => a.left - b.left));
    for (let i = 1; i < chips.length; i++) expect(chips[i].left - chips[i - 1].right).toBeGreaterThanOrEqual(4 - 1);
    await shot(page, `r2-${width}-fit`);
  });
}

test("날짜 없음 고르기·초점과 갤러리 날짜 편집 완료", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  const app = await schedule(page);
  await change(page, "prepare");
  const chip = app.locator(".ks-dates-undated").first();
  await chip.click();
  await expect(chip).toHaveClass(/is-selected/);
  await expect.poll(async () => (await state(page)).timeline_selection?.ids).toEqual(["a3"]);
  await shot(page, "r2-chip-selected");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(chip).toBeFocused();
  expect(await chip.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
  await shot(page, "r2-chip-focus");
  const bar = app.locator('.ks-timeline-item[aria-label^="일정 검토,"]');
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).r2_edit?.phase).toBe("commit");
  const edit = (await state(page)).r2_edit;
  expect(edit.start).not.toBe("2026-11-09");
  await shot(page, "r2-gallery-edit-commit");
  await expect(page.getByText("명령을 처리할 수 없습니다.", { exact: true })).toHaveCount(0);
});

test("범위 시작 자료 변경 전후와 빈 상태 전환·첫 진입", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  const app = await schedule(page);
  await change(page, "prepare");
  const root = app.locator(".ks-timeline-dates");
  const todayX = () => root.locator(".ks-dates-background .is-today").evaluate((el) => el.getBoundingClientRect().x);
  const before = await todayX();
  await shot(page, "r2-data-before");
  await change(page, "earlier");
  await expect.poll(async () => Math.abs(await todayX() - before)).toBeLessThanOrEqual(1);
  await shot(page, "r2-data-after");
  await change(page, "empty");
  await expect(app.getByText("없음", { exact: true })).toBeVisible();
  await shot(page, "r2-empty-changed");
  const empty = await root.evaluate((root) => {
    const rect = root.querySelector(".ks-dates-empty")!.getBoundingClientRect();
    return { center: rect.x + rect.width / 2, edge: root.querySelector(".ks-dates-corner")!.getBoundingClientRect().right, right: root.querySelector(".ks-dates-scroll")!.getBoundingClientRect().right };
  });
  expect(Math.abs(empty.center - (empty.edge + empty.right) / 2)).toBeLessThanOrEqual(1);
  await page.reload();
  await change(page, "empty");
  await expect(app.getByText("없음", { exact: true })).toBeVisible();
  await shot(page, "r2-empty-fresh");
});

for (const width of [1200, 360]) {
  test(`${width} 날짜 없는 칩은 줄 안에서 막대와 같은 위아래 여백을 둔다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    const app = await schedule(page);
    const chip = app.locator(".ks-dates-undated").first();
    const spacing = await chip.evaluate((el) => {
      const c = el.getBoundingClientRect(), row = el.closest(".ks-dates-row")!.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(el).getPropertyValue("--ks-space-1"));
      return { top: c.top - row.top, bottom: row.bottom - c.bottom, gap };
    });
    expect(Math.abs(spacing.top - spacing.gap)).toBeLessThanOrEqual(1);
    expect(Math.abs(spacing.bottom - spacing.gap)).toBeLessThanOrEqual(1);
    expect(Math.abs(spacing.top - spacing.bottom)).toBeLessThanOrEqual(1);
    if (out) writeFileSync(join(out, `r3-${width}-chip-metrics.json`), JSON.stringify(spacing, null, 2));
    if (width === 360) await shot(page, "r3-360-chip");
    else {
      if (out) {
        const root = (await app.locator(".ks-timeline-dates").boundingBox())!;
        const row = (await chip.locator("..").boundingBox())!;
        const session = await page.context().newCDPSession(page);
        const capture = await session.send("Page.captureScreenshot", { format: "png", clip: { x: root.x, y: row.y, width: root.width, height: row.height, scale: 2 } });
        writeFileSync(join(out, "r3-chip-row.png"), Buffer.from(capture.data, "base64"));
        await session.detach();
      }
      await chip.click(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
      await expect(chip).toBeFocused();
      expect(await chip.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
      await shot(page, "r3-chip-focus");
    }
  });
}
