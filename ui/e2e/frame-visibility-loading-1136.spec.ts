import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test";

// 카드 #1136 B1: 최소화된 창의 샌드박스 프레임은 앱의 rAF 루프를 멈추고, 복원하면 다시 돌며,
// 최소화 중에도 같이 보기 글 갱신은 이어진다. 프레임이 다시 붙지 않으므로 스크롤도 남는다.
// 카드 #1136 B2: 클라이언트가 준비되기 전 canvas는 빈 어두운 화면이 아니라 기존 로딩 표시를 보여 준다.

const CAPTURE = "/home/eias/workspace/.local/artifacts/c1136-frame-visibility-loading";
const STYLE = ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }";

test.setTimeout(120_000);

async function setMinimized(page: Page, appId: string, minimized: boolean) {
  await page.evaluate(async ({ appId, minimized }) => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const next = JSON.parse(JSON.stringify(snapshot));
    const target = next.shared.windows.find((item: any) => item.app_id === appId);
    if (!target) throw new Error(`창을 찾지 못했습니다: ${appId}`);
    target.minimized = minimized;
    harness.emit({ event: "state.changed", snapshot: next });
  }, { appId, minimized });
}

function railScroll(frame: FrameLocator) {
  return frame.locator("#rail").evaluate((element) => {
    const rail = element as HTMLElement;
    return { scrollTop: rail.scrollTop, scrollHeight: rail.scrollHeight, clientHeight: rail.clientHeight };
  });
}

test("최소화하면 샌드박스의 rAF가 멈추고 복원하면 다시 돌며 같이 보기 글은 최소화 중에도 갱신된다", async ({ page }, testInfo) => {
  await mkdir(CAPTURE, { recursive: true });
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.goto("/?preview=frame-visibility-1136");
  await page.addStyleTag({ content: STYLE });
  const app = page.getByTestId("app-window-frame-visibility-1136");
  const frame = page.frameLocator('iframe[title="프레임 보임 시험"]');
  const sandbox = app.locator(".ks-sandbox");
  const body = frame.locator("body");
  const framesNow = () => body.evaluate(() => (window as any).__frames as number);
  const shareSeq = async () => Number(await sandbox.getAttribute("data-share-seq"));

  // 앱 스크립트의 rAF 루프가 돌기 시작했는지 먼저 확인한다.
  await expect.poll(framesNow, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(shareSeq).toBeGreaterThan(0);
  const iframe = app.locator('iframe[title="프레임 보임 시험"]');
  const original = await iframe.elementHandle();
  const originalSource = await iframe.getAttribute("srcdoc");

  // 보이는 동안의 rAF 횟수.
  const shownStart = await framesNow();
  await page.waitForTimeout(1500);
  const shownDelta = (await framesNow()) - shownStart;
  expect(shownDelta, `보임 rAF/초: ${shownDelta / 1.5}`).toBeGreaterThan(20);

  // 스크롤을 옮겨 두고 최소화한다. 프레임이 다시 붙으면 스크롤이 사라진다.
  const rail = await railScroll(frame);
  expect(rail.scrollHeight).toBeGreaterThan(rail.clientHeight);
  await frame.locator("#rail").evaluate((element) => { (element as HTMLElement).scrollTop = 60; });
  expect((await railScroll(frame)).scrollTop).toBe(60);

  await setMinimized(page, "frame-visibility-1136", true);
  await page.waitForTimeout(400);
  const hiddenStartFrames = await framesNow();
  const hiddenStartSeq = await shareSeq();
  const hiddenStartText = await frame.locator("#share").textContent();
  await page.waitForTimeout(1500);
  const hiddenDelta = (await framesNow()) - hiddenStartFrames;
  const hiddenEndSeq = await shareSeq();
  const hiddenEndText = await frame.locator("#share").textContent();
  expect(hiddenDelta, `최소화 rAF/초: ${hiddenDelta / 1.5}`).toBeLessThanOrEqual(2);
  expect(hiddenEndSeq).toBeGreaterThan(hiddenStartSeq);
  expect(hiddenEndText).not.toBe(hiddenStartText);
  expect((await railScroll(frame)).scrollTop).toBe(60);
  expect(await iframe.evaluate((element, first) => element === first, original)).toBe(true);

  // 복원하면 프레임은 그대로인 채 rAF가 다시 돌고, 스크롤도 남는다.
  await setMinimized(page, "frame-visibility-1136", false);
  await page.waitForTimeout(400);
  const restoredStart = await framesNow();
  await page.waitForTimeout(1500);
  const restoredDelta = (await framesNow()) - restoredStart;
  expect(restoredDelta, `복원 rAF/초: ${restoredDelta / 1.5}`).toBeGreaterThan(20);
  expect((await railScroll(frame)).scrollTop).toBe(60);
  expect(await iframe.getAttribute("srcdoc")).toBe(originalSource);
  expect(await iframe.evaluate((element, first) => element === first, original)).toBe(true);

  const measurements = { shownDelta, hiddenDelta, restoredDelta, hiddenStartSeq, hiddenEndSeq, hiddenStartText, hiddenEndText };
  const bodyText = JSON.stringify(measurements, null, 2);
  await testInfo.attach("frame-visibility.json", { body: bodyText, contentType: "application/json" });
  await writeFile(`${CAPTURE}/frame-visibility.json`, bodyText);
});

test("클라이언트가 준비되기 전 canvas는 빈 화면 대신 기존 로딩 표시를 보여 준다", async ({ page }, testInfo) => {
  await mkdir(CAPTURE, { recursive: true });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/__slow-client.js", async (route) => {
    await gate;
    await route.fulfill({ status: 200, contentType: "text/javascript", body: "document.documentElement.dataset.clientScript = '1';" });
  });
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.goto("/?preview=canvas-loading-1136", { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: STYLE });
  const app = page.getByTestId("app-window-canvas-loading-1136");
  const canvas: Locator = app.locator(".ks-canvas");
  const loading = app.locator('.ks-canvas-loading .ks-data-progress.is-indeterminate[role="progressbar"]');
  await expect(loading).toBeVisible();
  await expect(canvas).toHaveAttribute("aria-busy", "true");
  await expect(canvas).toHaveAttribute("aria-label", "준비된 색상 무대, 불러오는 중");

  const measure = () => canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const overlay = element.querySelector(".ks-canvas-loading")!.getBoundingClientRect();
    const bounds = (value: DOMRect) => ({ left: value.left, top: value.top, right: value.right, bottom: value.bottom });
    return { canvas: bounds(rect), overlay: bounds(overlay) };
  });
  const wide = await measure();
  await app.screenshot({ path: `${CAPTURE}/wide-loading.png` });

  await page.setViewportSize({ width: 400, height: 760 });
  await expect(loading).toBeVisible();
  const narrow = await measure();
  await app.screenshot({ path: `${CAPTURE}/narrow-loading.png` });

  for (const [name, value] of [["wide", wide], ["narrow", narrow]] as const) {
    for (const edge of ["left", "top", "right", "bottom"] as const) {
      const delta = Math.abs(value.overlay[edge] - value.canvas[edge]);
      expect(delta, `${name} ${edge} 차이 ${delta}`).toBeLessThanOrEqual(1);
    }
  }

  release();
  await expect(loading).toHaveCount(0);
  await expect(canvas).toHaveAttribute("aria-label", "준비된 색상 무대");
  await expect(canvas).not.toHaveAttribute("aria-busy");
  await app.screenshot({ path: `${CAPTURE}/narrow-ready.png` });

  const bodyText = JSON.stringify({ wide, narrow }, null, 2);
  await testInfo.attach("canvas-loading.json", { body: bodyText, contentType: "application/json" });
  await writeFile(`${CAPTURE}/canvas-loading.json`, bodyText);
});
