import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { selectTab } from "./tab-helper";

test("key가 빠진 표 행을 알리면서 정상 행은 보인다", async ({ page }) => {
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await selectTab(app, "잘못된 행 시험");
  await expect(app.getByRole("alert")).toContainText("표 행 1개에 문자열 key가 없어");
  await expect(app.getByRole("table")).toContainText("정상 행");
});

const output = process.env.KS_DATA_CAPTURE_DIR;
async function capture(page: Page, name: string) {
  if (!output) return;
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
}

async function changedPixels(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(async ([first, second]) => {
    const load = (data: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `data:image/png;base64,${data}`;
    });
    const [left, right] = await Promise.all([load(first), load(second)]);
    if (left.width !== right.width || left.height !== right.height) return Number.POSITIVE_INFINITY;
    const pixels = (image: HTMLImageElement) => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const one = pixels(left);
    const two = pixels(right);
    let changed = 0;
    for (let index = 0; index < one.length; index += 4) {
      const diff = Math.max(Math.abs(one[index] - two[index]), Math.abs(one[index + 1] - two[index + 1]), Math.abs(one[index + 2] - two[index + 2]));
      if (diff > 8) changed += 1;
    }
    return changed;
  }, [a.toString("base64"), b.toString("base64")] as const);
}

test("아이콘 목록과 탐색기가 같은 칸을 쓰고 방향키와 메뉴가 동작한다", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await selectTab(app, "아이콘 시험");
  const list = app.getByRole("listbox", { name: "목록" });
  const first = list.getByRole("option", { name: "계산기 플러스" });
  await expect(first).toBeVisible();
  await expect(first.locator("span.ks-app-icon")).toHaveCSS("mask-image", /data:image\/svg/);
  const metrics: Record<string, unknown> = {};
  for (const [width, expected] of [[360, 3], [1000, 9]] as const) {
    await list.evaluate((element, value) => { element.style.width = `${value}px`; }, width);
    const row = list.locator(".ks-list-icon-row").first();
    await expect.poll(() => row.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(expected);
    const boxes = await row.locator(".ks-icon-tile").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()));
    metrics[width] = boxes;
    await first.focus();
    await page.keyboard.press("ArrowDown");
    await expect(list.getByRole("option").nth(expected)).toBeFocused();
    expect(await list.getByRole("option").nth(expected).evaluate((element) => {
      const style = getComputedStyle(element);
      return parseFloat(style.outlineOffset) === -parseFloat(style.outlineWidth);
    })).toBe(true);
    await page.keyboard.press("Enter");
    await expect(list.getByRole("option").nth(expected)).toHaveAttribute("aria-selected", "true");
    await capture(page, `icons-${width}`);
  }
  await first.click({ button: "right" });
  await page.getByRole("menuitem", { name: "주소 복사" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("https://example.com/0");
  await list.evaluate((element) => { element.style.width = ""; });
  for (const width of [360, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    await capture(page, `icons-viewport-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await selectTab(app, "빈 아이콘");
  await expect(app.getByText("없음", { exact: true })).toBeVisible();
  await capture(page, "icons-empty");
  await selectTab(app, "탐색기 확인");
  await app.getByRole("button", { name: "그림 고르기" }).click();
  await app.getByRole("button", { name: "아이콘 보기" }).click();
  const explorer = app.getByRole("listbox", { name: "폴더 내용" });
  await expect(explorer.getByRole("option").first()).toBeVisible();
  const { execFileSync } = await import("node:child_process");
  const originalCss = execFileSync("git", ["show", "d38c4fb:ui/src/styles/blocks.css"], { encoding: "utf8" });
  const start = originalCss.indexOf(".ks-explorer-icons {");
  const end = originalCss.indexOf(".ks-explorer-detail-name {", start);
  const oldTiles = originalCss.slice(start, end).replaceAll(".ks-explorer-icon-name", ".ks-icon-tile-name").replaceAll(".ks-explorer-icon", ".ks-icon-tile").replaceAll(".ks-icon-tiles", ".ks-explorer-icons");
  for (const width of [360, 1000]) {
    await explorer.evaluate((element, value) => { element.style.width = `${value}px`; }, width);
    await expect(explorer.locator(".ks-icon-tile").first()).toBeVisible();
    const old = await page.addStyleTag({ content: `${oldTiles}\n.ks-icon-tile-name { word-break: normal; }` });
    await capture(page, `explorer-before-${width}`);
    await old.evaluate((element) => element.remove());
    await explorer.getByRole("option").first().focus();
    await page.keyboard.press("ArrowRight");
    expect(await explorer.getByRole("option").nth(1).evaluate((element) => {
      const style = getComputedStyle(element);
      return parseFloat(style.outlineOffset) === -parseFloat(style.outlineWidth);
    })).toBe(true);
    await capture(page, `explorer-icons-${width}`);
  }
  await app.getByRole("button", { name: "자세히 보기" }).click();
  await expect(app.getByRole("table", { name: "폴더 내용" }).getByText("README.md")).toBeVisible();
  await capture(page, "explorer-details");
  if (output) writeFileSync(join(output, "icons-metrics.json"), JSON.stringify(metrics, null, 2));
});

test("긴 목록과 격자에서 가상 스크롤과 키보드 선택", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await page.addStyleTag({ path: new URL("../../app/src/shell.css", import.meta.url).pathname });
  const backdropFilters = await page.evaluate(() => {
    const frame = document.createElement("div");
    frame.className = "ks-window-frame";
    frame.style.cssText = "left: -10000px; width: 1px; height: 1px;";
    document.body.append(frame);
    return {
      frame: getComputedStyle(frame).backdropFilter,
      before: getComputedStyle(frame, "::before").backdropFilter,
    };
  });
  expect(backdropFilters.frame).toBe("none");
  expect(backdropFilters.before).toBe("blur(24px) saturate(1.05)");
  const list = app.getByRole("listbox");
  await expect(list.getByRole("option", { name: "항목 1", exact: true })).toBeVisible();
  expect(await list.getByRole("option").count()).toBeLessThan(100);
  await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const last = list.getByRole("option", { name: "항목 1000", exact: true });
  await expect(last).toBeVisible();
  await expect(list.locator('[role="option"][tabindex="0"]')).toHaveCount(1);
  await last.click();
  await expect(last).toHaveAttribute("aria-selected", "true");
  await app.getByRole("tab", { name: "격자 시험" }).click();
  const first = app.getByRole("option", { name: "그림 1", exact: true });
  await expect(first).toBeVisible();
  await expect(first.locator("img")).toBeVisible();
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(app.getByRole("option", { name: "그림 2", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(app.locator('[role="option"]:focus')).not.toHaveAttribute("aria-label", "그림 2");
  await page.keyboard.press("ArrowUp");
  await expect(app.getByRole("option", { name: "그림 2", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(first).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(app.locator('[role="option"]:focus')).toHaveAttribute("aria-selected", "true");
  await capture(page, "grid-wide");
});

test("구역 안 고정 묶음 머리는 목록 행과 글 시작선을 맞춘다", async ({ page }) => {
  await page.goto("/?preview=data-views-test");
  const alignment = await page.evaluate(() => {
    const section = document.createElement("div");
    section.className = "ks-data-section";
    const list = document.createElement("div");
    list.className = "ks-list";
    const sticky = document.createElement("div");
    sticky.className = "ks-view-sticky";
    const group = document.createElement("div");
    group.className = "ks-view-group";
    const heading = document.createElement("strong");
    heading.textContent = "묶음";
    group.append(heading);
    sticky.append(group);
    const row = document.createElement("button");
    row.className = "ks-row ks-list-row";
    const content = document.createElement("span");
    content.className = "ks-list-content";
    const title = document.createElement("span");
    title.className = "ks-list-title";
    title.textContent = "행";
    content.append(title);
    row.append(content);
    list.append(sticky, row);
    section.append(list);
    document.body.append(section);
    const rowStyle = getComputedStyle(row);
    const result = {
      headingLeft: heading.getBoundingClientRect().left,
      titleLeft: title.getBoundingClientRect().left,
      headingInset: parseFloat(getComputedStyle(group).paddingLeft),
      rowInset: parseFloat(rowStyle.borderLeftWidth) + parseFloat(rowStyle.paddingLeft),
    };
    section.remove();
    return result;
  });
  expect(alignment.headingInset).toBe(alignment.rowInset);
  expect(Math.abs(alignment.headingLeft - alignment.titleLeft)).toBeLessThanOrEqual(1);
});

test("표 머리 고정과 가로 스크롤, 흐름 따라가기", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await app.getByRole("tab", { name: "표 시험" }).click();
  const table = app.getByRole("table");
  const header = app.locator(".ks-table-header");
  await expect(header).toBeVisible();
  const top = (await header.boundingBox())!.y;
  const dims = await table.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(dims.scroll).toBeGreaterThan(dims.client);
  const badgeBounds = await app.locator(".ks-table-cell:has(.ks-badge)").first().evaluate((cell) => {
    const badge = cell.querySelector(".ks-badge")!;
    const cellRect = cell.getBoundingClientRect();
    const badgeRect = badge.getBoundingClientRect();
    return { cellWidth: cellRect.width, badgeWidth: badgeRect.width, badgeClientWidth: badge.clientWidth, badgeScrollWidth: badge.scrollWidth };
  });
  expect(badgeBounds.cellWidth).toBeGreaterThanOrEqual(badgeBounds.badgeWidth);
  expect(badgeBounds.badgeClientWidth).toBeGreaterThanOrEqual(badgeBounds.badgeScrollWidth);
  await table.evaluate((element) => { element.scrollTop = 500; element.scrollLeft = 300; });
  await expect.poll(async () => (await header.boundingBox())!.y).toBeCloseTo(top, 0);
  expect(await table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await capture(page, "table-narrow");
  await selectTab(app, "흐름 시험");
  const feed = app.locator(".ks-feed");
  await expect(feed.getByText("내용 35")).toBeVisible();
  await app.getByRole("button", { name: "추가" }).click();
  await expect(feed.getByText("새 내용")).toBeVisible();
  await feed.evaluate((element) => { element.scrollTop = 0; });
  await app.getByRole("button", { name: "추가" }).click();
  await expect.poll(() => feed.evaluate((element) => element.scrollTop)).toBe(0);
});

test("400px 표에서 긴 배지 열을 포함한 머리와 본문이 맞는다", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await app.getByRole("tab", { name: "표 시험" }).click();
  const table = app.getByRole("table");
  await expect(table.locator(".ks-table-row").first()).toBeVisible();
  const firstColumnWidth = (await table.getByRole("columnheader").first().boundingBox())!.width;
  await table.evaluate((element, width) => { element.scrollLeft = width; }, firstColumnWidth);
  const headers = await table.getByRole("columnheader").evaluateAll((cells) => cells.map((cell) => {
    const rect = cell.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  }));
  const cells = await table.locator(".ks-table-row").first().getByRole("cell").evaluateAll((elements) => elements.map((cell) => {
    const rect = cell.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  }));
  expect(cells).toHaveLength(headers.length);
  for (let index = 0; index < headers.length; index++) {
    expect(Math.abs(cells[index].left - headers[index].left)).toBeLessThanOrEqual(1);
    expect(Math.abs(cells[index].width - headers[index].width)).toBeLessThanOrEqual(1);
  }
  await capture(page, "table-columns-400");
  if (output) writeFileSync(join(output, "table-columns-400.json"), JSON.stringify({ headers, cells }, null, 2));
});

test("400px 선택 흐름에 Tab으로 들어가고 화살표와 Enter로 고른다", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  const tab = app.getByRole("tab", { name: "선택 흐름 시험" });
  await selectTab(app, "선택 흐름 시험");
  await tab.focus();
  await page.keyboard.press("Tab");
  await expect(app.getByRole("button", { name: "탭 더 보기" })).toBeFocused();
  const feed = app.getByRole("feed");
  const first = feed.getByRole("article").filter({ hasText: "첫 번째 내용" });
  const second = feed.getByRole("article").filter({ hasText: "두 번째 내용" });
  await expect(first).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await expect(feed.locator('article[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await expect(second).toBeFocused();
  const focus = await second.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.outlineWidth, style: style.outlineStyle, offset: style.outlineOffset };
  });
  expect(focus.style).toBe("solid");
  expect(parseFloat(focus.width)).toBeGreaterThan(0);
  expect(parseFloat(focus.offset)).toBeLessThan(0);
  await capture(page, "feed-focus-400");
  await page.keyboard.press("Enter");
  await expect(second).toHaveAttribute("aria-current", "true");
});

test("흐름 본문을 넓은 화면에서 나란히, 좁은 화면에서 쌓고 원문을 복사한다", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const metrics: Record<string, unknown> = {};
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const assertContained = (inner: { x: number; y: number; width: number; height: number }, outer: { x: number; y: number; width: number; height: number }) => {
    expect(inner.x).toBeGreaterThanOrEqual(outer.x);
    expect(inner.y).toBeGreaterThanOrEqual(outer.y);
    expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width);
    expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height);
  };
  const copyAtCenter = async (button: Locator, text: string) => {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  };

  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await app.getByRole("tab", { name: "병기 시험" }).click();
  const firstEntry = app.locator(".ks-feed-entry").first();
  const cells = firstEntry.locator(".ks-feed-body.is-columns > .ks-feed-copy-cell");
  await expect(cells).toHaveCount(2);
  const wide = await cells.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()));
  expect(Math.abs(wide[0].y - wide[1].y)).toBeLessThanOrEqual(1);
  await firstEntry.hover();
  const header = firstEntry.locator(".ks-feed-header");
  const metaButton = firstEntry.locator(".ks-feed-meta-copy").getByRole("button", { name: "복사" });
  const bodyButtons = cells.locator(".ks-feed-copy-control > button");
  await expect(metaButton).toBeVisible();
  await expect(bodyButtons).toHaveCount(2);
  const headerRect = await header.boundingBox();
  const metaRect = await metaButton.boundingBox();
  const bodyRects = await Promise.all([0, 1].map((index) => bodyButtons.nth(index).boundingBox()));
  const cellRects = await cells.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()));
  expect(headerRect).not.toBeNull();
  expect(metaRect).not.toBeNull();
  expect(bodyRects.every((rect) => rect !== null)).toBe(true);
  assertContained(metaRect!, headerRect!);
  bodyRects.forEach((rect, index) => assertContained(rect!, cellRects[index]));
  const wideButtons = [metaRect!, ...bodyRects.map((rect) => rect!)];
  for (let left = 0; left < wideButtons.length; left++) {
    for (let right = left + 1; right < wideButtons.length; right++) expect(overlaps(wideButtons[left], wideButtons[right])).toBe(false);
  }
  metrics.wide = { header: headerRect, buttons: wideButtons, cells: cellRects };
  await capture(page, "feed-columns-wide-900");
  if (output) {
    mkdirSync(output, { recursive: true });
    await firstEntry.screenshot({ path: join(output, "feed-copy-900-header-first-row.png") });
  }
  await capture(page, "feed-copy-hover-900");

  await page.setViewportSize({ width: 400, height: 700 });
  const narrow = await cells.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()));
  expect(narrow[1].y).toBeGreaterThan(narrow[0].y);
  await firstEntry.hover();
  const narrowButtons = await Promise.all([metaButton, bodyButtons.nth(0), bodyButtons.nth(1)].map((button) => button.boundingBox()));
  const narrowHeader = await header.boundingBox();
  expect(narrowButtons.every((rect) => rect !== null)).toBe(true);
  expect(narrowHeader).not.toBeNull();
  assertContained(narrowButtons[0]!, narrowHeader!);
  narrowButtons.slice(1).forEach((rect, index) => assertContained(rect!, narrow[index]));
  expect(overlaps(narrowButtons[1]!, narrowButtons[2]!)).toBe(false);
  metrics.narrow = { header: narrowHeader, buttons: narrowButtons, cells: narrow };
  await capture(page, "feed-columns-narrow-400");
  if (output) {
    await firstEntry.screenshot({ path: join(output, "feed-copy-400-stacked.png") });
    writeFileSync(join(output, "feed-copy-button-metrics.json"), JSON.stringify(metrics, null, 2));
  }

  await copyAtCenter(metaButton, "id-001");
  await copyAtCenter(bodyButtons.nth(0), "문을 열어라.\n지금 바로.");
  await copyAtCenter(bodyButtons.nth(1), "Open the door.\nRight now.");
});

test("견본의 다섯 보기와 다크 배지 캡처", async ({ page }) => {
  const coordinates = [];
  for (const width of [1440, 400]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?preview=block-gallery");
    const app = page.getByTestId("app-window-block-gallery");
    await expect(app.getByRole("tab", { name: "목록" })).toBeVisible();
    const lineCounts = await app.getByRole("tab").evaluateAll((tabs) => tabs.map((tab) => {
      const range = document.createRange();
      range.selectNodeContents(tab);
      return range.getClientRects().length;
    }));
    expect(lineCounts.every((count) => count === 1)).toBe(true);
    await expect(app.locator(".ks-list")).toBeVisible();
    const tabBox = await app.locator(".ks-data-tab-list").boundingBox();
    const listBox = await app.locator(".ks-list").boundingBox();
    const rowBox = await app.locator(".ks-list-row").first().boundingBox();
    const propertiesBox = await app.locator(".ks-properties").boundingBox();
    const labelBox = await app.locator(".ks-properties dt").first().boundingBox();
    const valueBox = await app.locator(".ks-properties dd").first().boundingBox();
    if (width === 400) expect(valueBox!.y).toBeGreaterThan(labelBox!.y);
    else expect(valueBox!.y).toBe(labelBox!.y);
    const fits = await app.locator(".ks-list-row .ks-badge").evaluateAll((elements) => elements.every((element) => {
      if (getComputedStyle(element).visibility === "hidden") return true;
      const badge = element.getBoundingClientRect();
      const group = element.parentElement!.getBoundingClientRect();
      return badge.left >= group.left && badge.right <= group.right + 0.5;
    }));
    expect(fits).toBe(true);
    await capture(page, `gallery-list-${width}`);
    await app.getByRole("tab", { name: "표와 트리" }).click();
    await expect(app.getByRole("tree")).toBeVisible();
    await expect(app.getByRole("table")).toBeVisible();
    const treeBox = await app.getByRole("tree").boundingBox();
    const tableBox = await app.getByRole("table").boundingBox();
    expect(Math.abs(treeBox!.y - tableBox!.y)).toBeLessThanOrEqual(1);
    coordinates.push({ width, tabBox, listBox, rowBox, propertiesBox, treeBox, tableBox });
    await capture(page, `gallery-table-tree-${width}`);
    const flowTab = app.getByRole("tab", { name: "흐름과 글" });
    if (!await flowTab.isVisible()) {
      await app.getByRole("button", { name: "탭 더 보기" }).first().click();
      await page.getByRole("menuitem", { name: "흐름과 글" }).click();
    } else await flowTab.click();
    await expect(app.locator(".ks-feed")).toBeVisible();
    await capture(page, `gallery-feed-${width}`);
  }
  if (output) writeFileSync(join(output, "gallery-coordinates.json"), JSON.stringify(coordinates, null, 2));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?preview=block-gallery");
  await expect(page.getByTestId("app-window-block-gallery").locator(".ks-badge").first()).toBeVisible();
  await capture(page, "gallery-badges-dark");
});

test("확인 트리의 확인 상자와 기본 펼침을 밝은 화면과 어두운 화면에서 캡처한다", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?preview=block-gallery");
    const app = page.getByTestId("app-window-block-gallery");
    await expect(app.getByRole("tab", { name: "목록" })).toBeVisible();
    const tab = app.getByRole("tab", { name: "확인 트리" });
    if (await tab.isVisible()) await tab.click();
    else {
      await app.getByRole("button", { name: "탭 더 보기" }).first().click();
      await page.getByRole("menuitem", { name: "확인 트리" }).click();
    }
    const tree = app.getByRole("tree");
    const milk = app.getByRole("treeitem", { name: "우유 사기" });
    const laundry = app.getByRole("treeitem", { name: "빨래 널기" });
    const note = app.getByRole("treeitem", { name: "메모만 남긴 항목" });
    const book = app.getByRole("treeitem", { name: "책 반납" });
    await expect(tree).toBeVisible();
    await expect(milk).toBeVisible();
    await expect(laundry).toBeVisible();
    await expect(note).toBeVisible();
    await expect(book).toBeVisible();
    expect(await app.locator(".ks-tree-check").count()).toBe(3);
    expect(await app.locator(".ks-tree-check.is-checked").count()).toBe(1);
    await expect(milk).toHaveAttribute("aria-checked", "false");
    await expect(laundry).toHaveAttribute("aria-checked", "true");
    await expect(note).not.toHaveAttribute("aria-checked");
    await capture(page, `gallery-tree-check-${scheme}`);

    const today = app.getByRole("treeitem", { name: "오늘 할 일" });
    await expect(today).toHaveAttribute("aria-expanded", "true");
    await today.click();
    await expect(today).toHaveAttribute("aria-expanded", "true");
    await expect(today).toHaveAttribute("aria-selected", "true");
    await expect(milk).toBeVisible();
    await today.locator(".ks-chevron").click();
    await expect(today).toHaveAttribute("aria-expanded", "false");
    await expect(milk).toBeHidden();
    await today.locator(".ks-chevron").click();
    await expect(today).toHaveAttribute("aria-expanded", "true");
    await expect(milk).toBeVisible();

    await milk.locator("[data-tree-check]").click();
    await expect(milk).toHaveAttribute("aria-checked", "true");
    await expect(app.locator(".ks-tree-check.is-checked")).toHaveCount(2);
    await expect(milk).toHaveAttribute("aria-selected", "false");
    await capture(page, `gallery-tree-check-toggled-${scheme}`);
  }
});

test("파일 트리 행의 공통화 전후 모습을 비교한다", async ({ page }) => {
  const { execFileSync } = await import("node:child_process");
  const baselineCss = execFileSync("git", ["show", "781091b:ui/src/styles/blocks.css"], { encoding: "utf8" });
  for (const width of [1440, 400]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?preview=md-editor");
    const app = page.getByTestId("app-window-md-editor");
    await app.getByRole("tab", { name: "내 폴더" }).click();
    await app.getByRole("button", { name: "문서 폴더 고르기" }).click();
    await app.getByRole("treeitem", { name: "notes" }).click();
    await app.getByRole("treeitem", { name: "README.md" }).click();
    await expect(app.getByRole("treeitem", { name: "README.md" })).toHaveAttribute("aria-current", "page");
    const folderTree = app.locator(".ks-split-pane").first().locator(".ks-data-tab-panel:visible .ks-file-tree");
    await expect(folderTree).toHaveCount(1);
    await page.evaluate((css) => {
      const style = document.createElement("style");
      style.id = "old-file-tree-css";
      style.textContent = css;
      document.head.appendChild(style);
      document.querySelectorAll(".ks-file-tree-row").forEach((row) => row.classList.remove("ks-row"));
    }, baselineCss);
    await capture(page, `file-tree-before-${width}`);
    const screenshotRows = async () => {
      const list = folderTree.locator(".ks-file-tree-list");
      return page.screenshot({
        clip: await list.evaluate((element) => {
          const rows = element.querySelectorAll<HTMLElement>(".ks-file-tree-row");
          const first = rows.item(0).getBoundingClientRect();
          const last = rows.item(rows.length - 1).getBoundingClientRect();
          const listRect = element.getBoundingClientRect();
          return { x: listRect.x, y: first.y, width: listRect.width, height: last.bottom - first.y };
        }),
      });
    };
    const before = await screenshotRows();
    await page.evaluate(() => {
      document.getElementById("old-file-tree-css")?.remove();
      document.querySelectorAll(".ks-file-tree-row").forEach((row) => row.classList.add("ks-row"));
    });
    await capture(page, `file-tree-after-${width}`);
    const after = await screenshotRows();
    // 펼친 화살표(회전된 SVG)는 두 번 그릴 때 테두리 안티에일리어싱이 최대 2/255 달라 바이트 비교가 흔들린다. Windows 기록기와 같은 기준(8/255 초과 픽셀 16개)을 쓴다.
    expect(await changedPixels(page, after, before)).toBeLessThanOrEqual(16);
  }
});
