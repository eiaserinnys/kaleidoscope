import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
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
    await capture(page, `dates-${width}-day`);
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
    await scroll.evaluate((element) => { element.scrollLeft = element.scrollWidth / 2; element.scrollTop = element.scrollHeight / 2; });
    await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    const after = await corner.boundingBox();
    expect(Math.abs(before!.x - after!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(before!.y - after!.y)).toBeLessThanOrEqual(1);
    await capture(page, `dates-${width}-scrolled`);
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
  await page.evaluate(async () => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const appWindow = snapshot.shared.windows.find((item: any) => item.app_id === "block-gallery");
    const { view } = await harness.call({ op: "data.attach", window_id: appWindow.id });
    harness.emit({ event: "data.update", window_id: appWindow.id, view });
  });
  await capture(page, "dates-loading");
  await expect(app.locator(".ks-timeline-dates")).toBeVisible();
});
