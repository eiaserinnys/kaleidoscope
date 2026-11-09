import { writeFile } from "node:fs/promises";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

// 카드 #1130: 결정 줄(단추, 도구 막대) 없이 고정 높이 조작 칸(한 줄 입력 등)이 채움 뒤에 오면
// 스크롤 영역이 쌓기의 마지막 자식이 되고, 스크롤 내용의 끝이 곧 칸의 끝이라 입력칸이 창
// 바닥에 붙었다. 다른 맨 끝 칸과 같은 --ks-space-3(12px)만큼 스크롤 내용 끝을 띄운다.

const APP_ID = "data-controls";
const STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }";

async function open(page: Page, ui: object, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(`/?preview=${APP_ID}`);
  // 노드 부하가 높으면 하네스가 늦게 붙는다. 상태를 넣기 전에 하네스를 기다린다.
  await page.waitForFunction(() => (window as any).__ksHarness !== undefined);
  await page.evaluate(async (layout) => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const version = snapshot.shared.app_versions.find((v: any) => v.app_id === "data-controls");
    version.definition.state = { value: "", on: true, dialogOpen: false };
    version.definition.ui = layout;
    version.version += 1;
    const win = snapshot.shared.windows.find((w: any) => w.app_id === "data-controls");
    win.app_version = version.version;
    win.state = { value: "", on: true, dialogOpen: false };
    harness.emit({ event: "state.changed", snapshot });
  }, ui);
  await page.addStyleTag({ content: STYLE });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return page.getByTestId(`app-window-${APP_ID}`);
}

async function record(testInfo: TestInfo, name: string, value: unknown) {
  const body = JSON.stringify(value, null, 2);
  await testInfo.attach(`${name}.json`, { body, contentType: "application/json" });
  await writeFile(testInfo.outputPath(`${name}.json`), body);
}

const rows = Array.from({ length: 12 }, (_, i) => ({ key: String(i), name: `항목 ${i + 1}` }));
const itemList = {
  type: "repeat", items: rows, key: "key", layout: "grid",
  grid: { columns: "auto", item_width: "large" }, gap: "large",
  template: { type: "section", title: { item: "name" }, child: { type: "text", value: "한 줄" } },
};
const toolbar = { type: "toolbar", start: [{ type: "text", value: "받은 항목" }] };
const input = { type: "input", value: { state: "value" }, on_change: [], placeholder: "메모" };
const labeledInput = { type: "input", label: "메모", value: { state: "value" }, on_change: [] };
const button = { type: "button", label: "보내기", on_click: [] };
const text = { type: "text", value: "맨 끝 글" };
const reproduction = { type: "stack", direction: "column", gap: "small", fill: 1, children: [toolbar, itemList, input] };

// 스크롤을 끝까지 내린 뒤 입력칸 바깥 상자 아래와 스크롤 영역 바닥 사이를 잰다.
async function scrollEnd(app: Locator) {
  const scroll = app.locator(".ks-stack-scroll");
  await expect(scroll).toHaveCount(1);
  await expect(scroll).toBeVisible();
  await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  return scroll.evaluate((el) => {
    const content = el.querySelector(".ks-stack-scroll-content") as HTMLElement;
    const stack = el.parentElement as HTMLElement;
    const box = el.querySelector<HTMLInputElement>('input[placeholder="메모"]')!.closest(".ks-data-stack-item") as HTMLElement;
    const scrollRect = el.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    return {
      gap: scrollRect.bottom - boxRect.bottom,
      space: parseFloat(getComputedStyle(el).getPropertyValue("--ks-space-3")),
      contentPadding: parseFloat(getComputedStyle(content).paddingBottom),
      scrollIsLast: stack.lastElementChild === el,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  });
}

for (const [width, height] of [[1180, 720], [360, 240]] as const) {
  test(`결정 줄 없는 채움 쌓기의 입력칸 아래에 칸 끝 여백이 있다 (${width}×${height})`, async ({ page }, testInfo) => {
    const app = await open(page, reproduction, width, height);
    const m = await scrollEnd(app);
    await record(testInfo, `repro-${width}x${height}`, m);
    await page.screenshot({ path: testInfo.outputPath(`stack-scroll-end-${width}x${height}.png`) });
    expect(m.scrollIsLast).toBe(true);
    expect(Math.abs(m.contentPadding - m.space)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.gap - m.space)).toBeLessThanOrEqual(1);
    // 내용이 칸에 들어가는 크기에서는 새 스크롤이 생기지 않는다.
    if (width === 1180) expect(m.scrollHeight).toBeLessThanOrEqual(m.clientHeight + 1);
  });
}

test("결정 줄이 있는 같은 쌓기는 스크롤 내용 끝 여백을 더하지 않는다 (gap small)", async ({ page }, testInfo) => {
  const app = await open(page, { ...reproduction, children: [toolbar, itemList, input, button] }, 1180, 720);
  const m = await app.evaluate((el) => {
    const root = el.querySelector(".ks-data-window-body")!.firstElementChild as HTMLElement;
    const scroll = root.querySelector(":scope > .ks-stack-scroll") as HTMLElement;
    const buttonItem = root.lastElementChild as HTMLElement;
    const inputBox = scroll.querySelector('input[placeholder="메모"]')!.closest(".ks-data-stack-item") as HTMLElement;
    return {
      gap: parseFloat(getComputedStyle(root).rowGap),
      inputToButton: buttonItem.getBoundingClientRect().top - inputBox.getBoundingClientRect().bottom,
      buttonToStack: root.getBoundingClientRect().bottom - buttonItem.getBoundingClientRect().bottom,
      scrollIsLast: root.lastElementChild === scroll,
      contentPadding: parseFloat(getComputedStyle(scroll.querySelector(".ks-stack-scroll-content")!).paddingBottom),
    };
  });
  await record(testInfo, "action-tail-small", m);
  await page.screenshot({ path: testInfo.outputPath("stack-scroll-action-tail-small.png") });
  expect(m.scrollIsLast).toBe(false);
  // 스크롤 뒤에 결정 줄이 남아 있으므로 스크롤 내용 끝에 여백을 더하지 않는다.
  expect(m.contentPadding).toBe(0);
  expect(Math.abs(m.inputToButton - m.gap)).toBeLessThanOrEqual(1);
});

test("결정 줄이 있는 같은 쌓기는 스크롤 내용 끝 여백을 더하지 않는다 (gap none)", async ({ page }, testInfo) => {
  const app = await open(page, { ...reproduction, gap: "none", children: [toolbar, itemList, input, button] }, 1180, 720);
  const m = await app.evaluate((el) => {
    const root = el.querySelector(".ks-data-window-body")!.firstElementChild as HTMLElement;
    const scroll = root.querySelector(":scope > .ks-stack-scroll") as HTMLElement;
    const buttonItem = root.lastElementChild as HTMLElement;
    const inputBox = scroll.querySelector('input[placeholder="메모"]')!.closest(".ks-data-stack-item") as HTMLElement;
    return {
      inputToButton: buttonItem.getBoundingClientRect().top - inputBox.getBoundingClientRect().bottom,
      buttonToStack: root.getBoundingClientRect().bottom - buttonItem.getBoundingClientRect().bottom,
      scrollIsLast: root.lastElementChild === scroll,
      contentPadding: parseFloat(getComputedStyle(scroll.querySelector(".ks-stack-scroll-content")!).paddingBottom),
    };
  });
  await record(testInfo, "action-tail-none", m);
  await page.screenshot({ path: testInfo.outputPath("stack-scroll-action-tail-none.png") });
  expect(m.scrollIsLast).toBe(false);
  expect(m.contentPadding).toBe(0);
});

test("글이 맨 끝인 같은 쌓기는 스크롤 영역이 생기지 않는다", async ({ page }, testInfo) => {
  const app = await open(page, { ...reproduction, children: [toolbar, itemList, text] }, 1180, 720);
  expect(await app.locator(".ks-stack-scroll").count()).toBe(0);
  const m = await app.evaluate((el) => {
    const root = el.querySelector(".ks-data-window-body")!.firstElementChild as HTMLElement;
    const last = root.lastElementChild as HTMLElement;
    return {
      lastToStack: root.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom,
      lastPadding: parseFloat(getComputedStyle(last).paddingBottom),
    };
  });
  await record(testInfo, "text-end", m);
  await page.screenshot({ path: testInfo.outputPath("stack-scroll-text-end.png") });
});

test("구역이 끝 여백을 소유하는 같은 쌓기는 스크롤 내용 끝 여백을 더하지 않는다", async ({ page }, testInfo) => {
  const app = await open(page, { type: "section", title: "받은 항목", child: reproduction }, 1180, 720);
  const m = await app.evaluate((el) => {
    const section = el.querySelector(".ks-data-section") as HTMLElement;
    const scroll = el.querySelector(".ks-stack-scroll") as HTMLElement;
    const content = scroll.querySelector(".ks-stack-scroll-content") as HTMLElement;
    const inputBox = scroll.querySelector('input[placeholder="메모"]')!.closest(".ks-data-stack-item") as HTMLElement;
    return {
      sectionPadding: parseFloat(getComputedStyle(section).paddingBottom),
      contentPadding: parseFloat(getComputedStyle(content).paddingBottom),
      gap: scroll.getBoundingClientRect().bottom - inputBox.getBoundingClientRect().bottom,
    };
  });
  await record(testInfo, "section-owned-end", m);
  expect(m.sectionPadding).toBe(12);
  expect(m.contentPadding).toBe(0);
  expect(m.gap).toBeLessThanOrEqual(1);
});

test("gap none에서도 스크롤 영역이 쌓기의 끝이면 같은 끝 여백을 쓴다", async ({ page }, testInfo) => {
  const app = await open(page, { ...reproduction, gap: "none" }, 1180, 720);
  const m = await scrollEnd(app);
  await record(testInfo, "gap-none-repro", m);
  expect(m.scrollIsLast).toBe(true);
  expect(Math.abs(m.gap - m.space)).toBeLessThanOrEqual(1);
});

test("gap none에서 라벨 입력의 기존 끝 여백은 그대로다", async ({ page }) => {
  const app = await open(page, { ...reproduction, gap: "none", children: [toolbar, itemList, labeledInput] }, 1180, 720);
  expect(await app.locator(".ks-stack-scroll-content").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))).toBe(12);
});
