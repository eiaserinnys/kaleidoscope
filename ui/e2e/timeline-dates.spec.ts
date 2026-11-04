import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

async function capture(page: Page, name: string) {
  const directory = process.env.KS_DATA_CAPTURE_DIR;
  if (directory) { mkdirSync(directory, { recursive: true }); await page.screenshot({ path: join(directory, `${name}.png`) }); }
}

async function chooseSchedule(page: Page, app: ReturnType<Page["getByTestId"]>) {
  const tab = app.getByRole("tab", { name: "일정" });
  if (await tab.isVisible()) await tab.click();
  else {
    await app.getByRole("button", { name: "탭 더 보기" }).click();
    await page.getByRole("menuitem", { name: "일정", exact: true }).click();
  }
}

test.use({ locale: "ko-KR" });

for (const width of [1200, 360]) {
  test(`날짜 일정표 ${width} 폭의 눈금과 고정 머리`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 });
    await page.goto("/?preview=block-gallery");
    const app = page.getByTestId("app-window-block-gallery");
    await chooseSchedule(page, app);
    const timeline = app.locator(".ks-timeline-dates");
    await expect(timeline).toBeVisible();
    await expect(timeline.locator(".ks-timeline-item").first()).toBeVisible();
    await expect(timeline).toHaveAttribute("data-scale", "day");
    const firstTrack = timeline.locator(".ks-dates-track").first();
    const trackBox = await firstTrack.boundingBox();
    const headerBox = await firstTrack.locator(".ks-dates-track-header").boundingBox();
    expect(Math.abs(trackBox!.height - headerBox!.height)).toBeLessThanOrEqual(1);
    await page.evaluate(() => document.fonts.ready);
    await capture(page, `dates-${width}-day`);
    if (width === 360) return;
    const alignment = await timeline.evaluate((root) => {
      const rect = (element: Element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; };
      const corner = rect(root.querySelector(".ks-dates-corner")!);
      const track = root.querySelector(".ks-dates-track")!;
      const head = rect(track.querySelector(".ks-dates-track-header")!);
      const rows = rect(track.querySelector(".ks-dates-track-rows")!);
      const scrollLeft = root.querySelector<HTMLElement>(".ks-dates-scroll")!.scrollLeft;
      const firstRow = rect(track.querySelector(".ks-dates-row")!);
      const name = rect(track.querySelector(".ks-dates-track-name .ks-list-title")!);
      const tick = [...root.querySelectorAll<HTMLElement>(".ks-dates-ticks > span")].find((element) => rect(element).cx > corner.right)!;
      const column = [...root.querySelectorAll<HTMLElement>(".ks-dates-background > span")].find((element) => element.style.left === tick.style.left && parseFloat(element.style.width) > 0)!;
      const bar = root.querySelector(".ks-timeline-item")!;
      const barBox = rect(bar), rowBox = rect(bar.closest(".ks-dates-row")!);
      const topGap = barBox.y - rowBox.y, bottomGap = rowBox.bottom - barBox.bottom;
      return { corner, head, rows, scrollLeft, rowsViewportLeft: rows.x + scrollLeft, firstRow, name, tick: rect(tick), column: rect(column), bar: barBox, row: rowBox, topGap, bottomGap,
        differences: { headWidth: Math.abs(corner.width-head.width), headEdge: Math.abs(head.right-(rows.x+scrollLeft)), tickCenter: Math.abs(rect(tick).cx-rect(column).cx), barSpacing: Math.abs(topGap-bottomGap), nameCenter: Math.abs(name.cy-firstRow.cy) } };
    });
    console.log(`날짜 정렬 좌표: ${JSON.stringify(alignment)}`);
    const directory = process.env.KS_DATA_CAPTURE_DIR;
    if (directory) writeFileSync(join(directory, "metrics.json"), JSON.stringify(alignment, null, 2));
    for (const [name, difference] of Object.entries(alignment.differences)) expect(difference, name).toBeLessThanOrEqual(1);
    for (let i = 0; i < 12 && await timeline.getAttribute("data-scale") === "day"; i++) await app.getByRole("button", { name: "축소" }).click();
    await expect(timeline).toHaveAttribute("data-scale", "week");
    await capture(page, `dates-${width}-week`);
    for (let i = 0; i < 12 && await timeline.getAttribute("data-scale") !== "month"; i++) await app.getByRole("button", { name: "축소" }).click();
    await expect(timeline).toHaveAttribute("data-scale", "month");
    await capture(page, `dates-${width}-month`);
    await app.getByRole("button", { name: "전체 맞춤" }).click();
    const zoomMetrics = () => timeline.evaluate((root) => {
      const scroller = root.querySelector<HTMLElement>(".ks-dates-scroll")!;
      const corner = root.querySelector<HTMLElement>(".ks-dates-corner")!;
      const axis = root.querySelector<HTMLElement>(".ks-dates-axis")!;
      return { left: scroller.scrollLeft, width: parseFloat(axis.style.width), visible: scroller.clientWidth - corner.getBoundingClientRect().width };
    });
    const fit = await zoomMetrics();
    await app.getByRole("button", { name: "확대" }).click();
    const enlarged = await zoomMetrics();
    const expectedLeft = (fit.left + fit.visible / 2) * enlarged.width / fit.width - enlarged.visible / 2;
    expect(Math.abs(enlarged.left - expectedLeft)).toBeLessThanOrEqual(1);
    await app.getByRole("button", { name: "확대" }).click({ clickCount: 4 });
    const scroll = timeline.locator(".ks-dates-scroll");
    const corner = timeline.locator(".ks-dates-corner");
    const before = await corner.boundingBox();
    await scroll.evaluate((element) => { element.scrollLeft = element.scrollWidth / 2; });
    await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    const firstHeader = timeline.locator(".ks-dates-track-header").first();
    expect(Math.abs((await firstHeader.boundingBox())!.x - before!.x)).toBeLessThanOrEqual(1);
    const monthLabel = await timeline.evaluate((root) => {
      const corner = root.querySelector(".ks-dates-corner")!.getBoundingClientRect();
      const right = root.querySelector(".ks-dates-scroll")!.getBoundingClientRect().right;
      return [...root.querySelectorAll(".ks-dates-month > span")].filter((element) => { const rect = element.getBoundingClientRect(); return rect.right > corner.right && rect.left < right; }).map((element) => element.textContent);
    });
    expect(monthLabel.some((label) => label?.includes("월"))).toBe(true);
    await capture(page, `dates-${width}-horizontal`);
    await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight / 2; });
    await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    const after = await corner.boundingBox();
    expect(Math.abs(before!.x - after!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(before!.y - after!.y)).toBeLessThanOrEqual(1);
    await capture(page, `dates-${width}-vertical`);
  });
}

test("응답을 기다릴 때 일정표의 로딩 상태를 표시한다", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 600 });
  await page.goto("/?preview=block-gallery");
  const app = page.getByTestId("app-window-block-gallery");
  await chooseSchedule(page, app);
  await expect(app.locator(".ks-timeline-dates")).toBeVisible();
  await page.evaluate(async () => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const version = snapshot.shared.app_versions.find((item: any) => item.app_id === "block-gallery");
    const timeline = version.definition.ui.tabs.find((item: any) => item.label === "일정").child;
    const tracks = timeline.tracks;
    timeline.tracks = { expr: "$data.sample ? $state.schedule_tracks : $state.schedule_tracks" };
    version.definition.state.schedule_tracks = tracks;
    version.definition.sources.sample = { kind: "request", permission: "slow", path: "/sample" };
    version.definition.permissions.push({ module: "http", id: "slow", label: "자료", base_url: "https://example.com", paths: ["/sample"] });
    version.version += 1;
    const appWindow = snapshot.shared.windows.find((item: any) => item.app_id === "block-gallery");
    appWindow.app_version = version.version; appWindow.state = { ...appWindow.state, tab: version.definition.ui.tabs.findIndex((item: any) => item.label === "일정"), schedule_tracks: tracks };
    harness.emit({ event: "state.changed", snapshot });
  });
  await expect(app.getByRole("status")).toBeVisible();
  await capture(page, "dates-loading");
  await expect(app.locator(".ks-timeline-dates")).toBeVisible();
});
