import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const docsDir = process.env.KALEIDOSCOPE_E2E_DOCS;

test.beforeEach(async ({ page }) => {
  await page.goto("/?core=http://127.0.0.1:7420");
});

test("creates desktops, edits files, imports an app, and rejects an outside path", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  if (!docsDir) throw new Error("KALEIDOSCOPE_E2E_DOCS is required");
  const measurements: Record<string, unknown> = {};

  const captureMatrix = async (state: string) => {
    for (const viewport of [
      { width: 1440, height: 900, label: "1440x900" },
      { width: 960, height: 600, label: "960x600" },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.screenshot({
          path: testInfo.outputPath(`${state}-${viewport.label}-${colorScheme}.png`),
        });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
  };

  const captureThemePair = async (state: string) => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({ path: testInfo.outputPath(`${state}-${colorScheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: "light" });
  };

  const tabMetrics = async () => page.evaluate(() => {
    const workspace = document.querySelector(".ks-workspace-control .ks-button");
    const active = document.querySelector(".ks-desktop-tab-active");
    const plus = document.querySelector('[aria-label="데스크톱 추가"]');
    const scroller = document.querySelector(".ks-desktop-tab-scroll");
    if (!workspace || !active || !plus || !scroller) throw new Error("탭 줄을 찾지 못했습니다");
    const rect = (element: Element) => element.getBoundingClientRect();
    const workspaceRect = rect(workspace);
    const activeRect = rect(active);
    const plusRect = rect(plus);
    const scrollRect = rect(scroller);
    return {
      workspaceHeight: workspaceRect.height,
      workspaceCenterY: workspaceRect.top + workspaceRect.height / 2,
      activeCenterY: activeRect.top + activeRect.height / 2,
      activeVisible: activeRect.left >= scrollRect.left && activeRect.right <= scrollRect.right,
      plusVisible: plusRect.left >= 0 && plusRect.right <= window.innerWidth,
      plusOutsideScroll: plusRect.left >= scrollRect.right,
      overflowing: (scroller as HTMLElement).scrollWidth > (scroller as HTMLElement).clientWidth,
      buttonHeights: [...document.querySelectorAll<HTMLElement>(".ks-button")]
        .filter((button) => button.getBoundingClientRect().height > 0)
        .map((button) => button.getBoundingClientRect().height),
    };
  });

  await expect(page.getByText("열린 앱이 없습니다")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "앱 열기" }).first()).toBeVisible();
  await captureMatrix("empty-desktop");
  await page.setViewportSize({ width: 960, height: 600 });
  await captureThemePair("tabs-one-desktop-960");
  const oneTabMetrics = await tabMetrics();
  expect(Math.abs(oneTabMetrics.activeCenterY - oneTabMetrics.workspaceCenterY)).toBeLessThanOrEqual(0.5);
  expect(oneTabMetrics.workspaceHeight).toBe(32);
  expect(oneTabMetrics.overflowing).toBe(false);
  expect(oneTabMetrics.buttonHeights.every((height) => height === 32)).toBe(true);
  measurements.tabsWithoutOverflow = oneTabMetrics;

  await page.getByRole("button", { name: "작업 1" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await captureMatrix("workspace-menu");

  await page.getByRole("menuitem", { name: "새 워크스페이스" }).click();
  const newWorkspaceInput = page.getByRole("textbox", { name: "워크스페이스 이름" });
  await expect(newWorkspaceInput).toHaveValue("작업 2");
  const newWorkspaceSelection = await newWorkspaceInput.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]);
  expect(newWorkspaceSelection).toEqual([0, "작업 2".length]);
  await captureThemePair("rename-new-workspace-selected");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "작업 2" }).click();
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();
  const workspaceRenameInput = page.getByRole("textbox", { name: "워크스페이스 이름" });
  const workspaceSelection = await workspaceRenameInput.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]);
  expect(workspaceSelection).toEqual([0, "작업 2".length]);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 960, height: 600 });
  await page.getByRole("button", { name: "데스크톱 추가" }).click();
  const secondDesktop = page.getByRole("button", { name: "데스크톱 2" });
  await expect(secondDesktop).toBeVisible();
  await secondDesktop.dblclick();
  const doubleClickInput = page.getByRole("textbox", { name: "데스크톱 이름" });
  const doubleClickSelection = await doubleClickInput.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]);
  expect(doubleClickSelection).toEqual([0, "데스크톱 2".length]);
  await captureThemePair("rename-desktop-double-click-selected");
  await page.keyboard.press("Escape");

  await secondDesktop.click({ button: "right" });
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();
  const menuRenameInput = page.getByRole("textbox", { name: "데스크톱 이름" });
  const menuSelection = await menuRenameInput.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]);
  expect(menuSelection).toEqual([0, "데스크톱 2".length]);
  await captureThemePair("rename-desktop-menu-selected");
  await page.keyboard.press("Escape");

  for (let index = 3; index <= 10; index += 1) {
    await page.getByRole("button", { name: "데스크톱 추가" }).click();
    await expect(page.getByRole("button", { name: `데스크톱 ${index}` })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "데스크톱 10" })).toHaveAttribute("aria-pressed", "true");
  await captureThemePair("tabs-ten-desktops-960");
  const tenTabMetrics = await tabMetrics();
  expect(Math.abs(tenTabMetrics.activeCenterY - tenTabMetrics.workspaceCenterY)).toBeLessThanOrEqual(0.5);
  expect(tenTabMetrics.workspaceHeight).toBe(32);
  expect(tenTabMetrics.overflowing).toBe(true);
  expect(tenTabMetrics.activeVisible).toBe(true);
  expect(tenTabMetrics.plusVisible).toBe(true);
  expect(tenTabMetrics.plusOutsideScroll).toBe(true);
  expect(tenTabMetrics.buttonHeights.every((height) => height === 32)).toBe(true);
  measurements.tabsWithOverflow = tenTabMetrics;

  await page.getByRole("button", { name: "데스크톱 2" }).click();
  await page.getByRole("button", { name: "앱 열기" }).first().click();
  const appMenu = page.getByRole("menu");
  const appMenuBounds = await appMenu.boundingBox();
  if (!appMenuBounds) throw new Error("앱 메뉴의 위치를 확인하지 못했습니다");
  expect(appMenuBounds.x + appMenuBounds.width).toBeLessThanOrEqual(960);
  await page.screenshot({ path: testInfo.outputPath("apps-menu-960x600-light.png") });
  await page.getByRole("menuitem", { name: "마크다운 편집기" }).click();

  const editorWindow = page.getByTestId("app-window-md-editor");
  const smallArea = await page.locator(".ks-desktop-area").boundingBox();
  const smallWindow = await editorWindow.boundingBox();
  if (!smallArea || !smallWindow) throw new Error("작은 창의 위치를 확인하지 못했습니다");
  expect(smallWindow.x - smallArea.x).toBe(48);
  expect(smallWindow.y - smallArea.y).toBe(48);
  expect(smallWindow.width).toBe(880);
  expect(smallWindow.height).toBe(480);
  expect(smallWindow.y + smallWindow.height).toBeLessThanOrEqual(smallArea.y + smallArea.height);
  measurements.newWindowRect960 = { area: smallArea, window: smallWindow };
  await captureThemePair("small-window-empty-path-960");
  await expect(editorWindow.getByText("폴더를 먼저 선택하세요")).toHaveCount(0);
  await expect(editorWindow.getByText("파일을 선택하세요")).toHaveCount(0);
  const blockButtonHeight = await editorWindow.locator(".ks-button").evaluate((element) => element.getBoundingClientRect().height);
  expect(blockButtonHeight).toBe(32);
  measurements.blockButtonHeight = blockButtonHeight;

  const southHandle = editorWindow.locator(".ks-window-resize-south");
  const southHandleBounds = await southHandle.boundingBox();
  if (!southHandleBounds) throw new Error("창 아래 크기 조절 띠를 찾지 못했습니다");
  const resizeX = southHandleBounds.x + southHandleBounds.width / 2;
  const resizeStartY = southHandleBounds.y + southHandleBounds.height / 2;
  await page.mouse.move(resizeX, resizeStartY);
  await page.mouse.down();
  const resizeTargetY = resizeStartY + 160;
  await page.mouse.move(resizeX, resizeTargetY);
  await page.mouse.up();
  const expectedResizedHeight = Math.min(
    Math.round(480 + resizeTargetY - resizeStartY),
    smallArea.height - 48,
  );
  await expect(editorWindow).toHaveCSS("height", `${expectedResizedHeight}px`);
  const resizedBounds = await editorWindow.boundingBox();
  const resizedArea = await page.locator(".ks-desktop-area").boundingBox();
  if (!resizedBounds || !resizedArea) throw new Error("리사이즈한 창의 위치를 확인하지 못했습니다");
  expect(resizedBounds.y + resizedBounds.height).toBeLessThanOrEqual(resizedArea.y + resizedArea.height);
  measurements.bottomResize960 = { area: resizedArea, window: resizedBounds };
  await captureThemePair("small-window-bottom-resize-960");

  const bottomHandle = await southHandle.boundingBox();
  if (!bottomHandle) throw new Error("하단에 닿은 창의 크기 조절 띠를 찾지 못했습니다");
  expect(bottomHandle.y).toBeGreaterThanOrEqual(resizedArea.y + resizedArea.height - 12);
  expect(bottomHandle.y + bottomHandle.height).toBeLessThanOrEqual(resizedArea.y + resizedArea.height);
  const shrinkStartY = bottomHandle.y + bottomHandle.height / 2;
  await page.mouse.move(bottomHandle.x + bottomHandle.width / 2, shrinkStartY);
  await page.mouse.down();
  await page.mouse.move(bottomHandle.x + bottomHandle.width / 2, shrinkStartY - 32);
  await page.mouse.up();
  const expectedShrunkHeight = expectedResizedHeight - 32;
  await expect(editorWindow).toHaveCSS("height", `${expectedShrunkHeight}px`);
  const shrunkBounds = await editorWindow.boundingBox();
  if (!shrunkBounds) throw new Error("하단 손잡이로 줄인 창의 위치를 확인하지 못했습니다");
  expect(shrunkBounds.y + shrunkBounds.height).toBeLessThanOrEqual(resizedArea.y + resizedArea.height);
  measurements.bottomShrink960 = { area: resizedArea, window: shrunkBounds, handle: bottomHandle };
  await captureThemePair("small-window-bottom-shrink-960");

  await editorWindow.getByRole("button", { name: "문서 폴더 고르기" }).click();
  await editorWindow.getByRole("button", { name: "a.md" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  const editor = editorWindow.getByRole("textbox", { name: "마크다운 편집기" });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nE2E saved");
  await expect(page.getByRole("status", { name: "저장 대기" })).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({ path: testInfo.outputPath("editor-save-pending-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.keyboard.type("!");
  await expect(page.getByRole("status", { name: "저장 대기" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("editor-save-pending-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(async () => readFile(path.join(docsDir, "a.md"), "utf8")).toContain("E2E saved!");
  await expect(page.getByRole("status", { name: "저장 대기" })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "저장 중" })).toHaveCount(0);
  await captureThemePair("editor-save-complete");

  const titlebar = editorWindow.locator(".ks-window-titlebar");
  const box = await titlebar.boundingBox();
  if (!box) throw new Error("편집기 창 제목 줄을 찾지 못했습니다");
  await page.mouse.move(box.x + 80, box.y + 16);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 76);
  await page.mouse.up();
  const movedBox = await editorWindow.boundingBox();
  if (!movedBox) throw new Error("편집기 창 위치를 확인하지 못했습니다");

  await page.getByRole("button", { name: "데스크톱 1", exact: true }).click();
  await page.getByRole("button", { name: "데스크톱 2", exact: true }).click();
  await expect(editor).toContainText("E2E saved");
  await page.reload();
  await expect(page.getByRole("button", { name: "데스크톱 2" })).toHaveAttribute("aria-pressed", "true");
  await expect(editorWindow).toHaveCSS("left", `${Math.round(movedBox.x)}px`);
  await expect(editor).toContainText("E2E saved");

  const viewerPath = path.join(root, "examples/md-viewer.json");
  await page.locator('input[type="file"]').setInputFiles(viewerPath);
  const viewerWindow = page.getByTestId("app-window-md-viewer");
  await expect(viewerWindow).toBeVisible();
  await expect(viewerWindow.locator(".ks-markdown-view")).toHaveCount(0);
  await captureThemePair("viewer-empty-path");
  await viewerWindow.getByRole("button", { name: "읽을 폴더 고르기" }).click();
  await viewerWindow.getByRole("button", { name: "a.md" }).click();
  await expect(viewerWindow.locator(".ks-markdown-view")).toContainText("E2E saved");

  const typography = await Promise.all([
    editorWindow.locator(".cm-editor").evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontSize: style.fontSize, lineHeight: style.lineHeight };
    }),
    viewerWindow.locator(".ks-markdown-view").evaluate((element) => {
      const style = getComputedStyle(element);
      const heading = element.querySelector("h1");
      return {
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        headingSize: heading ? getComputedStyle(heading).fontSize : null,
      };
    }),
  ]);
  expect(typography[0]).toEqual({ fontSize: "15px", lineHeight: "25.5px" });
  expect(typography[1].fontSize).toBe("15px");
  expect(typography[1].lineHeight).toBe("25.5px");
  expect(Number.parseFloat(typography[1].headingSize ?? "0")).toBeGreaterThan(19.9);
  expect(Number.parseFloat(typography[1].headingSize ?? "0")).toBeLessThan(20.1);
  measurements.documentTypography = typography;
  await captureThemePair("document-typography");

  await captureMatrix("overlapping-windows");

  const invalidDefinition = {
    id: "outside-path-app",
    name: "Outside path",
    requires: { blocks: 1, modules: { files: 1 } },
    permissions: [{ module: "files", id: "docs", access: "read", label: "문서 폴더" }],
    state: {},
    ui: { type: "markdown_view", file: { permission: "docs", path: "../secret.md" } },
  };
  await page.locator('input[type="file"]').setInputFiles({
    name: "outside.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(invalidDefinition)),
  });
  await expect(page.getByRole("alert")).toContainText("앱 정의");
  await expect(page.getByRole("alert")).toContainText("../secret.md");
  const importDetailsColor = await page.locator(".ks-notice-details").evaluate((element) => getComputedStyle(element).color);
  const importTextColor = await page.locator(".ks-notice").evaluate((element) => getComputedStyle(element).color);
  expect(importDetailsColor).toBe(importTextColor);
  measurements.importDetailsColor = importDetailsColor;
  await captureMatrix("import-rejection");
  await page.getByRole("alert").getByRole("button", { name: "닫기" }).click();

  const editorBounds = await editorWindow.boundingBox();
  const viewerBounds = await viewerWindow.boundingBox();
  if (!editorBounds || !viewerBounds) throw new Error("겹친 앱 창의 위치를 확인하지 못했습니다");
  const exposedTitleX = Math.min(
    editorBounds.x + editorBounds.width - 64,
    viewerBounds.x + viewerBounds.width + 8,
  );
  await page.mouse.click(exposedTitleX, editorBounds.y + 16);
  await expect.poll(async () => {
    const [editorZ, viewerZ] = await Promise.all([
      editorWindow.evaluate((element) => Number(getComputedStyle(element).zIndex)),
      viewerWindow.evaluate((element) => Number(getComputedStyle(element).zIndex)),
    ]);
    return editorZ > viewerZ;
  }).toBe(true);

  const crlfPath = path.join(docsDir, "crlf.md");
  const crlfBefore = await readFile(crlfPath, "utf8");
  await editorWindow.getByRole("button", { name: "crlf.md" }).click();
  await editor.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("X");
  const crlfExpected = `${crlfBefore.slice(0, 1)}X${crlfBefore.slice(1)}`;
  await expect.poll(async () => readFile(crlfPath, "utf8")).toBe(crlfExpected);

  const viewerBoundsForClose = await viewerWindow.boundingBox();
  const editorBoundsAfterRaise = await editorWindow.boundingBox();
  if (!viewerBoundsForClose || !editorBoundsAfterRaise) throw new Error("겹친 앱 창의 위치를 확인하지 못했습니다");
  const viewerTitleX = Math.min(viewerBoundsForClose.x + 64, editorBoundsAfterRaise.x - 8);
  await page.mouse.click(viewerTitleX, viewerBoundsForClose.y + 16);
  await expect.poll(async () => {
    const [viewerZ, editorZ] = await Promise.all([
      viewerWindow.evaluate((element) => Number(getComputedStyle(element).zIndex)),
      editorWindow.evaluate((element) => Number(getComputedStyle(element).zIndex)),
    ]);
    return viewerZ > editorZ;
  }).toBe(true);
  await viewerWindow.getByRole("button", { name: "창 닫기" }).click();
  await expect(viewerWindow).toBeHidden();

  const longDocument = "긴 문서.md";
  await editorWindow.getByRole("button", { name: longDocument }).click();
  await expect(editor).toContainText("세라피엘 검수용 긴 문서");
  await editor.click();
  const scroller = editorWindow.locator(".cm-scroller");
  const scrollMetrics = await scroller.evaluate((element) => {
    const node = element as HTMLElement;
    const bounds = node.getBoundingClientRect();
    const scrollbar = getComputedStyle(node, "::-webkit-scrollbar");
    const thumb = getComputedStyle(node, "::-webkit-scrollbar-thumb");
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      clientWidth: node.clientWidth,
      offsetWidth: node.offsetWidth,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      scrollbarWidth: scrollbar.width,
      layoutGutterWidth: node.offsetWidth - node.clientWidth,
      thumbBorder: thumb.borderLeftWidth,
      thumbVisibleWidth: Number.parseFloat(scrollbar.width)
        - 2 * Number.parseFloat(thumb.borderLeftWidth),
      scrollTop: node.scrollTop,
    };
  });
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
  expect(scrollMetrics.scrollbarWidth).toBe("8px");
  expect(scrollMetrics.thumbBorder).toBe("2px");
  expect(scrollMetrics.thumbVisibleWidth).toBe(4);
  measurements.editorScrollbar = scrollMetrics;
  await captureThemePair("editor-scrollbar-before-drag");

  const scrollbarThumb = await scroller.evaluate((element) => {
    const node = element as HTMLElement;
    const bounds = node.getBoundingClientRect();
    const viewport = node.clientHeight;
    const thumbHeight = Math.max(20, viewport * viewport / node.scrollHeight);
    const trackWidth = Number.parseFloat(getComputedStyle(node, "::-webkit-scrollbar").width);
    return {
      x: bounds.right - trackWidth / 2,
      startY: bounds.top + thumbHeight / 2,
      endY: bounds.bottom - thumbHeight / 2,
      thumbHeight,
    };
  });
  await page.mouse.move(scrollbarThumb.x, scrollbarThumb.startY);
  await page.mouse.down();
  await page.mouse.move(scrollbarThumb.x, scrollbarThumb.endY, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => scroller.evaluate((element) => (element as HTMLElement).scrollTop)).toBeGreaterThan(0);
  const scrollTopAfterDrag = await scroller.evaluate((element) => (element as HTMLElement).scrollTop);
  measurements.editorScrollbar = { ...scrollMetrics, scrollTopAfterDrag };
  await captureThemePair("editor-scrollbar-after-drag");

  const treeHeader = await editorWindow.locator(".ks-file-tree-header").boundingBox();
  const splitHandle = await editorWindow.locator(".ks-split-handle").boundingBox();
  if (!treeHeader || !splitHandle) throw new Error("분할 기준선을 측정하지 못했습니다");
  const dividerGap = Math.abs(treeHeader.x + treeHeader.width - (splitHandle.x + splitHandle.width / 2));
  expect(dividerGap).toBeLessThanOrEqual(0.5);
  const editorContent = editorWindow.locator(".ks-editor-content");
  const focusBorderWidth = await editorContent.evaluate((element) => getComputedStyle(element, "::after").borderTopWidth);
  expect(focusBorderWidth).toBe("2px");
  measurements.dividerAndFocus = { dividerGap, focusBorderWidth, scrollTopAfterDrag };
  await captureThemePair("divider-focus-scrolled");
  await page.screenshot({
    path: testInfo.outputPath("divider-alignment-zoom.png"),
    clip: {
      x: Math.max(0, treeHeader.x + treeHeader.width - 12),
      y: treeHeader.y,
      width: 40,
      height: treeHeader.height,
    },
  });
  const editorContentBounds = await editorContent.boundingBox();
  if (!editorContentBounds) throw new Error("편집기 영역을 찾지 못했습니다");
  await page.screenshot({
    path: testInfo.outputPath("editor-focus-overlay-zoom.png"),
    clip: {
      x: editorContentBounds.x + 8,
      y: editorContentBounds.y,
      width: Math.min(320, editorContentBounds.width - 8),
      height: 48,
    },
  });

  await editorWindow.getByRole("button", { name: "a.md" }).hover();
  measurements.hoverFileRow = await editorWindow.getByRole("button", { name: "a.md" }).evaluate((element) => getComputedStyle(element).backgroundColor);
  await captureThemePair("hover-file-row");
  await page.getByRole("button", { name: "데스크톱 2" }).hover();
  await captureThemePair("hover-desktop-tab");
  await page.getByRole("button", { name: "작업 2" }).hover();
  await captureThemePair("hover-workspace-button");
  const closeButton = editorWindow.getByRole("button", { name: "창 닫기" });
  await closeButton.hover();
  measurements.hoverWindowClose = await closeButton.evaluate((element) => getComputedStyle(element).backgroundColor);
  await captureThemePair("hover-window-close");
  await page.getByRole("button", { name: "작업 2" }).click();
  const renameMenuItem = page.getByRole("menuitem", { name: "이름 바꾸기" });
  await renameMenuItem.hover();
  measurements.hoverMenuItem = await renameMenuItem.evaluate((element) => getComputedStyle(element).backgroundColor);
  await captureThemePair("hover-menu-item");
  await page.keyboard.press("Escape");

  const conflictPath = path.join(docsDir, longDocument);
  const externalText = `${await readFile(conflictPath, "utf8")}\n외부 변경`;
  await writeFile(conflictPath, externalText, "utf8");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" conflict");
  const conflictNotice = page.getByRole("alert");
  await expect(conflictNotice).toContainText("디스크에서 바뀌었습니다");
  await expect(conflictNotice).not.toContainText("파일이 읽은 뒤 바뀌었거나 이미 존재합니다");
  await expect(editorWindow.getByRole("status", { name: "저장 대기" })).toHaveCount(0);
  measurements.conflictNotice = await conflictNotice.innerText();
  await captureMatrix("editor-conflict");
  await conflictNotice.getByRole("button", { name: "다시 불러오기" }).click();

  await writeFile(testInfo.outputPath("measurements.json"), JSON.stringify(measurements, null, 2), "utf8");
});
