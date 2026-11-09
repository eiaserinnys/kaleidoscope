import { writeFile } from "node:fs/promises";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

// 카드 #1130: 결정 줄(단추, 도구 막대) 없이 고정 높이 조작 칸(한 줄 입력 등)이 채움 뒤에 오면
// 스크롤 영역이 쌓기의 마지막 자식이 되고, 스크롤 내용의 끝이 곧 칸의 끝이라 입력칸이 창
// 바닥에 붙었다. 다른 맨 끝 칸과 같은 --ks-space-3(12px)만큼 스크롤 내용 끝을 띄운다.
// 카드 #1133: 구역을 품은 목록 뒤의 맨 끝 글과 스크롤 밖 고정 결정 줄 꼬리, gap none의 라벨
// 없는 입력에도 같은 --ks-space-3 바닥 여백을 준다.

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

test("결정 줄이 있는 gap none 쌓기는 입력 끝을 끝 보충 여백 하나만큼 띄운다", async ({ page }, testInfo) => {
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
      space: parseFloat(getComputedStyle(root).getPropertyValue("--ks-space-3")),
      contentPadding: parseFloat(getComputedStyle(scroll.querySelector(".ks-stack-scroll-content")!).paddingBottom),
    };
  });
  await record(testInfo, "action-tail-none", m);
  await page.screenshot({ path: testInfo.outputPath("stack-scroll-action-tail-none.png") });
  expect(m.scrollIsLast).toBe(false);
  // 카드 #1133: gap none에서는 결정 줄 앞 내용 끝을 끝 보충 규칙이 맡는다. 라벨 있는 입력과 같다.
  expect(Math.abs(m.contentPadding - m.space)).toBeLessThanOrEqual(1);
  expect(Math.abs(m.inputToButton - m.space)).toBeLessThanOrEqual(1);
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

// 카드 #1133: 맨 끝 글, 스크롤 밖 고정 결정 줄 꼬리, gap none의 라벨 없는 입력의 바닥 여백.
const actionSmall = { ...reproduction, children: [toolbar, itemList, input, button] };
const actionNone = { ...actionSmall, gap: "none" };
const labeledNone = { ...actionNone, children: [toolbar, itemList, labeledInput, button] };
const actionRowSmall = {
  ...reproduction,
  children: [toolbar, itemList, input, {
    type: "stack", direction: "row", gap: "small",
    children: [{ type: "button", label: "취소", on_click: [] }, button],
  }],
};
const textEnd = { ...reproduction, children: [toolbar, itemList, text] };
const toolbarTail = {
  ...reproduction,
  children: [toolbar, itemList, input, { type: "toolbar", start: [], end: [button] }],
};
const sectionAction = { type: "section", title: "받은 항목", child: actionSmall };
const tabAction = { type: "tabs", tabs: [{ label: "탭", child: actionSmall }] };
const dialogAction = { type: "dialog", title: "대화", open: true, on_close: [], child: actionSmall };

// 마지막 단추가 든 꼬리 칸과 그 쌓기의 바닥, 입력 칸과 단추 사이를 잰다.
// 대화상자의 닫기 단추처럼 쌓기 밖에 있는 단추를 집지 않도록 꼬리 칸에서 단추를 찾는다.
async function tailSpace(app: Locator) {
  return app.evaluate((el) => {
    const stacks = [...el.querySelectorAll(".ks-data-stack.has-action-tail.is-column")];
    const tails = stacks
      .map((stack) => stack.lastElementChild)
      .filter((item): item is HTMLElement => item instanceof HTMLElement
        && item.classList.contains("ks-data-stack-item")
        && !item.classList.contains("ks-stack-scroll")
        && item.querySelector("button") !== null);
    const tail = tails[tails.length - 1];
    const stack = tail.parentElement as HTMLElement;
    const button = [...tail.querySelectorAll("button")]
      .filter((n) => n.getBoundingClientRect().height > 0)
      .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
    const inputEl = el.querySelector(".ks-data-window-body input") as HTMLInputElement | null;
    const rect = (node: Element) => node.getBoundingClientRect();
    return {
      tailPadding: parseFloat(getComputedStyle(tail).paddingBottom),
      tailToStack: rect(stack).bottom - rect(tail).bottom,
      buttonToStack: rect(stack).bottom - rect(button).bottom,
      inputToButton: inputEl ? rect(button).top - rect(inputEl).bottom : null,
      stackHasActionTail: stack.classList.contains("has-action-tail"),
      space: parseFloat(getComputedStyle(stack).getPropertyValue("--ks-space-3")),
    };
  });
}

// 구역을 품은 채움 뒤 맨 끝 글의 안쪽 여백과 창 몸통 바닥까지의 간격을 잰다.
async function textEndSpace(app: Locator) {
  return app.evaluate((el) => {
    const body = el.querySelector(".ks-data-window-body") as HTMLElement;
    const root = body.firstElementChild as HTMLElement;
    const textEl = root.lastElementChild!.querySelector(".ks-data-text") as HTMLElement;
    const padding = parseFloat(getComputedStyle(textEl).paddingBottom);
    return {
      scrollCount: root.querySelectorAll(":scope > .ks-stack-scroll").length,
      padding,
      contentToBody: body.getBoundingClientRect().bottom - textEl.getBoundingClientRect().bottom + padding,
      space: parseFloat(getComputedStyle(root).getPropertyValue("--ks-space-3")),
    };
  });
}

for (const [width, height] of [[1180, 720], [360, 240]] as const) {
  test(`구역을 품은 채움 뒤 맨 끝 글도 창 바닥에서 띄운다 (${width}×${height})`, async ({ page }, testInfo) => {
    const app = await open(page, textEnd, width, height);
    const m = await textEndSpace(app);
    await record(testInfo, `text-end-${width}x${height}`, m);
    await page.screenshot({ path: testInfo.outputPath(`text-end-${width}x${height}.png`) });
    expect(m.scrollCount).toBe(0);
    expect(Math.abs(m.padding - m.space)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.contentToBody - m.space)).toBeLessThanOrEqual(1);
  });
}

for (const [width, height] of [[1180, 720], [360, 240]] as const) {
  for (const [name, ui] of [["small", actionSmall], ["none", actionNone], ["row-small", actionRowSmall]] as const) {
    test(`스크롤 밖 고정 결정 줄 꼬리가 창 바닥에서 띄운다 (${name}, ${width}×${height})`, async ({ page }, testInfo) => {
      const app = await open(page, ui, width, height);
      const before = await tailSpace(app);
      await record(testInfo, `tail-${name}-${width}x${height}-default`, before);
      await page.screenshot({ path: testInfo.outputPath(`tail-${name}-${width}x${height}-default.png`) });
      expect(before.stackHasActionTail).toBe(true);
      expect(Math.abs(before.tailPadding - before.space)).toBeLessThanOrEqual(1);
      expect(Math.abs(before.buttonToStack - before.space)).toBeLessThanOrEqual(1);
      const scroll = app.locator(".ks-stack-scroll");
      await expect(scroll).toHaveCount(1);
      await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      const end = await tailSpace(app);
      await record(testInfo, `tail-${name}-${width}x${height}-end`, end);
      expect(Math.abs(end.tailPadding - end.space)).toBeLessThanOrEqual(1);
      expect(Math.abs(end.buttonToStack - end.space)).toBeLessThanOrEqual(1);
    });
  }
}

for (const [width, height] of [[1180, 720], [360, 240]] as const) {
  for (const [name, ui] of [["unlabeled", actionNone], ["labeled", labeledNone]] as const) {
    test(`gap none 결정 줄에서 입력과 단추 사이가 끝 여백만큼 떨어진다 (${name}, ${width}×${height})`, async ({ page }, testInfo) => {
      const app = await open(page, ui, width, height);
      const m = await tailSpace(app);
      await record(testInfo, `input-${name}-${width}x${height}`, m);
      await page.screenshot({ path: testInfo.outputPath(`input-${name}-${width}x${height}.png`) });
      expect(m.inputToButton).not.toBeNull();
      expect(Math.abs(m.inputToButton! - m.space)).toBeLessThanOrEqual(1);
    });
  }
}

test("도구 막대 결정 줄 꼬리는 자기 안쪽 여백을 그대로 쓴다", async ({ page }, testInfo) => {
  const app = await open(page, toolbarTail, 1180, 720);
  const m = await tailSpace(app);
  await record(testInfo, "toolbar-tail", m);
  await page.screenshot({ path: testInfo.outputPath("toolbar-tail.png") });
  expect(m.stackHasActionTail).toBe(true);
  expect(m.tailPadding).toBe(0);
  // 도구 막대의 안쪽 여백이 만드는 간격(8px)은 바뀌지 않는다.
  expect(Math.abs(m.buttonToStack - 8)).toBeLessThanOrEqual(1);
});

for (const [name, ui] of [["section", sectionAction], ["tab", tabAction], ["dialog", dialogAction]] as const) {
  test(`구역, 탭, 대화상자 안 결정 줄 꼬리는 그쪽이 끝 여백을 소유한다 (${name})`, async ({ page }, testInfo) => {
    const app = await open(page, ui, 1180, 720);
    const m = await tailSpace(app);
    await record(testInfo, `context-${name}`, m);
    await page.screenshot({ path: testInfo.outputPath(`context-${name}.png`) });
    expect(m.tailPadding).toBe(0);
  });
}
