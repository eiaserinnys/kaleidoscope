import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";

const captureDirectory = process.env.KS_SELECTION_CAPTURE_DIR;

async function capture(page: Page, name: string) {
  if (!captureDirectory) return;
  mkdirSync(captureDirectory, { recursive: true });
  await page.screenshot({ path: join(captureDirectory, `${name}.png`), fullPage: true });
}

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  expect(bounds, "visible element bounds").not.toBeNull();
  return bounds!;
}

function expectWithinOnePixel(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
}

async function dragText(page: Page, target: Locator) {
  const range = await target.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!(node.textContent ?? "").trim()) continue;
      const text = node.textContent ?? "";
      const selection = document.createRange();
      selection.setStart(node, 0);
      selection.setEnd(node, Math.min(text.length, 8));
      const rect = selection.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    return null;
  });
  expect(range, "target contains visible text").not.toBeNull();
  await page.mouse.move(range!.x + 1, range!.y + range!.height / 2);
  await page.mouse.down();
  await page.mouse.move(range!.x + Math.max(range!.width + 8, 28), range!.y + range!.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function selectionText(page: Page) {
  return page.evaluate(() => window.getSelection()?.toString() ?? "");
}

async function dragInputText(page: Page, input: Locator) {
  const box = await input.boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height / 2;
  await page.mouse.move(box!.x + 10, y);
  await page.mouse.down();
  await page.mouse.move(box!.x + Math.min(box!.width - 4, 130), y, { steps: 8 });
  await page.mouse.up();
}

test("쉘의 조작 글자는 선택되지 않고 읽을 내용은 선택된다", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?preview=shell-selection-test");
  const app = page.getByTestId("app-window-shell-selection-test");
  await expect(app.getByRole("tab", { name: "요약" })).toBeVisible();

  await dragText(page, app.locator(".ks-harness-window-header"));
  expect(await selectionText(page)).toBe("");
  await dragText(page, app.locator(".ks-data-toolbar .ks-data-text .ks-markdown-text").first());
  expect(await selectionText(page)).toBe("");
  await dragText(page, app.getByRole("tab", { name: "요약" }));
  expect(await selectionText(page)).toBe("");
  await dragText(page, app.locator(".ks-harness-window-header label"));
  expect(await selectionText(page)).toBe("");

  await dragText(page, app.locator(".ks-properties dd"));
  expect(await selectionText(page)).toContain("대기 중");
  await dragText(page, app.locator(".ks-data-tab-panel .ks-data-text .ks-markdown-text"));
  expect(await selectionText(page)).toContain("읽고 복사할");
  const input = app.locator("textarea");
  await input.fill("입력칸에서 선택할 글자");
  await dragInputText(page, input);
  expect(await app.locator("textarea").evaluate((element) => (element as HTMLTextAreaElement).selectionEnd)).toBeGreaterThan(0);

  await app.getByRole("tab", { name: "확인 항목" }).click();
  await dragText(page, app.locator(".ks-list-row").first());
  expect(await selectionText(page)).toBe("");
  await app.getByRole("tab", { name: "노트" }).click();
  await dragText(page, app.locator(".ks-feed-body").first());
  expect(await selectionText(page)).toContain("피드에서");
});
test("링크와 이미지에서 시작한 드래그 고스트는 막고 글 선택 드래그는 유지한다", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?preview=shell-selection-test");
  const text = page.getByTestId("app-window-shell-selection-test").locator(".ks-data-tab-panel .ks-data-text .ks-markdown-text").first();
  await text.evaluate((element) => {
    const fixtures = document.createElement("div");
    fixtures.innerHTML = '<a href="https://example.com">드래그 링크</a> <img alt="드래그 그림" width="32" height="32" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=">';
    element.append(fixtures);
    Object.assign(window, { __shellDragEvents: [] as Array<{ target: string; prevented: boolean }> });
    document.addEventListener("dragstart", (event) => {
      (window as Window & { __shellDragEvents: Array<{ target: string; prevented: boolean }> }).__shellDragEvents.push({
        target: (event.target as Element | null)?.tagName ?? "",
        prevented: event.defaultPrevented,
      });
    });
  });
  const link = text.getByRole("link", { name: "드래그 링크" });
  await dragText(page, link);
  const linkEvents = await page.evaluate(() => (window as Window & { __shellDragEvents: Array<{ target: string; prevented: boolean }> }).__shellDragEvents);
  expect(linkEvents.some((event) => event.target === "A" && event.prevented)).toBe(true);

  const image = text.getByRole("img", { name: "드래그 그림" });
  const imageBox = await image.boundingBox();
  expect(imageBox).not.toBeNull();
  await page.mouse.move(imageBox!.x + 4, imageBox!.y + 4);
  await page.mouse.down();
  await page.mouse.move(imageBox!.x + imageBox!.width + 18, imageBox!.y + 4, { steps: 8 });
  await page.mouse.up();
  const imageEvents = await page.evaluate(() => (window as Window & { __shellDragEvents: Array<{ target: string; prevented: boolean }> }).__shellDragEvents);
  expect(imageEvents.some((event) => event.target === "IMG" && event.prevented)).toBe(true);

  await text.evaluate((element) => { (window as Window & { __shellDragEvents: Array<{ target: string; prevented: boolean }> }).__shellDragEvents.length = 0; });
  await dragText(page, text);
  const selected = await selectionText(page);
  expect(selected).toContain("읽고 복사할");
  const selectedPoint = await text.evaluate((element) => {
    const range = document.createRange();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode()!;
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    return { x: rect.x + 3, y: rect.y + rect.height / 2 };
  });
  await page.mouse.move(selectedPoint.x, selectedPoint.y);
  await page.mouse.down();
  await page.mouse.move(selectedPoint.x + 32, selectedPoint.y, { steps: 5 });
  await page.mouse.up();
  const textEvents = await page.evaluate(() => (window as Window & { __shellDragEvents: Array<{ target: string; prevented: boolean }> }).__shellDragEvents);
  expect(textEvents.every((event) => !event.prevented)).toBe(true);
});

test("탭 줄과 네 가지 카드 탭의 첫 내용 간격이 8px이다", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?preview=shell-selection-test");
  const app = page.getByTestId("app-window-shell-selection-test");
  const toolbar = app.locator(".ks-data-toolbar");
  const panels = [
    { label: "요약", content: ".ks-properties dt" },
    { label: "확인 항목", content: ".ks-list-row" },
    { label: "요청", content: ".ks-data-text > .ks-markdown-text > :first-child" },
    { label: "노트", content: ".ks-feed-entry" },
  ];

  for (const [index, item] of panels.entries()) {
    const tab = app.getByRole("tab", { name: item.label });
    if (index > 0) await tab.click();
    const gap = await tab.evaluate((element, contentSelector) => {
      const tabRect = element.getBoundingClientRect();
      const content = element.closest(".ks-data-tabs")?.querySelector<HTMLElement>(contentSelector);
      const contentRect = content?.getBoundingClientRect();
      return contentRect ? contentRect.top - (tabRect.top + tabRect.height) : null;
    }, item.content);
    expect(gap, `${item.label} tab content`).not.toBeNull();
    expect(gap).toBeCloseTo(8, 0);
    if (index === 0) {
      const topGap = await tab.evaluate((element) => {
        const tabRect = element.getBoundingClientRect();
        const toolbarRect = element.closest(".ks-data-stack-item")?.previousElementSibling?.querySelector(".ks-data-toolbar")?.getBoundingClientRect();
        return toolbarRect ? tabRect.top - toolbarRect.bottom : null;
      });
      expect(topGap).toBeCloseTo(8, 0);
    }
  }
});

test("분할 탭의 첫 내용 간격과 패널 가로 시작선을 맞춘다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/?preview=block-gallery");
  const gallery = page.getByTestId("app-window-block-gallery");
  const tableTreeTab = gallery.getByRole("tab", { name: "표와 트리" });
  await tableTreeTab.click();
  const tableTreeTabBox = await box(tableTreeTab);
  const tableTreePanes = gallery.locator(".ks-data-tab-panel > .ks-split-row > .ks-split-pane");
  const treeFirstRow = tableTreePanes.nth(0).getByRole("treeitem").first();
  const tableHeader = tableTreePanes.nth(1).locator(".ks-table-header");
  const treeBox = await box(treeFirstRow);
  const tableBox = await box(tableHeader);
  const tableTreeContentTop = tableTreeTabBox.y + tableTreeTabBox.height + 8;
  expectWithinOnePixel(treeBox.y, tableTreeContentTop);
  expectWithinOnePixel(tableBox.y, tableTreeContentTop);
  expectWithinOnePixel(treeBox.y, tableBox.y);
  await capture(page, "block-gallery-table-tree-wide");

  const flowTab = gallery.getByRole("tab", { name: "흐름과 글" });
  await flowTab.click();
  const flowTabBox = await box(flowTab);
  const flowPanes = gallery.locator(".ks-data-tab-panel > .ks-split-row > .ks-split-pane");
  const flowToolbar = flowPanes.nth(0).locator(".ks-data-toolbar").first();
  const sectionHeader = flowPanes.nth(1).locator(".ks-data-section-header").first();
  const toolbarBox = await box(flowToolbar);
  const sectionBox = await box(sectionHeader);
  const flowContentTop = flowTabBox.y + flowTabBox.height + 8;
  expectWithinOnePixel(toolbarBox.y, flowContentTop);
  expectWithinOnePixel(sectionBox.y, flowContentTop);
  expectWithinOnePixel(toolbarBox.y, sectionBox.y);

  const firstTabButton = await box(gallery.getByRole("tab").first());
  const toolbarButton = await box(flowToolbar.locator("button").first());
  const groupTitle = await box(flowPanes.nth(0).locator(".ks-view-group strong").first());
  const feedText = await box(flowPanes.nth(0).locator(".ks-feed-body").first());
  expectWithinOnePixel(toolbarButton.x, firstTabButton.x);
  expectWithinOnePixel(groupTitle.x, firstTabButton.x);
  expectWithinOnePixel(feedText.x, firstTabButton.x);
  await capture(page, "block-gallery-flow-text-wide");

  const inputTab = gallery.getByRole("tab", { name: "입력" });
  await inputTab.click();
  const inputTabBox = await box(inputTab);
  const inputToolbar = gallery.locator(".ks-data-tab-panel .ks-data-toolbar").first();
  const inputButton = await box(inputToolbar.locator("button").first());
  const firstInputTabButton = await box(gallery.getByRole("tab").first());
  expectWithinOnePixel(inputButton.x, firstInputTabButton.x);
  expectWithinOnePixel(inputButton.y, inputTabBox.y + inputTabBox.height + 8);
  await capture(page, "block-gallery-input-wide");

  await page.goto("/?preview=earth");
  const earth = page.getByTestId("app-window-earth");
  const earthTab = earth.getByRole("tab", { name: "주변 지형과 지질" });
  await earthTab.click();
  const earthTabBox = await box(earthTab);
  const earthFirstHeader = earth.locator(".ks-data-tab-panel > .ks-split-row > .ks-split-pane:first-child .ks-data-section-header").first();
  const earthHeaderBox = await box(earthFirstHeader);
  expectWithinOnePixel(earthHeaderBox.y, earthTabBox.y + earthTabBox.height + 8);
  await capture(page, "earth-wide");

  await page.goto("/?preview=reader");
  const reader = page.getByTestId("app-window-reader");
  const readerTab = reader.getByRole("tab", { name: "오픈소스 저장소" });
  await readerTab.click();
  const readerTabBox = await box(readerTab);
  const readerFirstHeader = reader.locator(".ks-data-tab-panel > .ks-split-row > .ks-split-pane:first-child .ks-data-section-header").first();
  const readerHeaderBox = await box(readerFirstHeader);
  expectWithinOnePixel(readerHeaderBox.y, readerTabBox.y + readerTabBox.height + 8);
  await capture(page, "reader-wide");

  await page.goto("/?preview=shell-selection-test");
  const selectionApp = page.getByTestId("app-window-shell-selection-test");
  const summaryTab = selectionApp.getByRole("tab", { name: "요약" });
  await summaryTab.click();
  const summaryTabButton = await box(selectionApp.getByRole("tab").first());
  const summaryMarkdown = await box(selectionApp.locator(".ks-data-tab-panel .ks-data-text .ks-markdown-text").first());
  expectWithinOnePixel(summaryMarkdown.x, summaryTabButton.x);
});

test("하니스의 오류 설명은 드래그해 선택하고 복사할 수 있다", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?preview=data-controls");
  const app = page.getByTestId("app-window-data-controls");
  const errorText = app.locator(".ks-empty-state-text").filter({ hasText: "데이터를 받지 못했습니다" }).first();
  await expect(errorText).toBeVisible();
  await dragText(page, errorText);
  expect(await selectionText(page)).toContain("데이터");
});
