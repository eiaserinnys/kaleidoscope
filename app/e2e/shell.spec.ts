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
  test.setTimeout(120_000);
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
    const tabs = [...scroller.querySelectorAll(".ks-desktop-tab")];
    const lastTab = tabs.at(-1);
    const name = active.querySelector(".ks-desktop-tab-name");
    if (!lastTab || !name) throw new Error("탭 이름을 찾지 못했습니다");
    const nameRect = rect(name);
    return {
      workspaceHeight: workspaceRect.height,
      workspaceCenterY: workspaceRect.top + workspaceRect.height / 2,
      activeCenterY: activeRect.top + activeRect.height / 2,
      activeVisible: activeRect.left >= scrollRect.left && activeRect.right <= scrollRect.right,
      plusVisible: plusRect.left >= 0 && plusRect.right <= window.innerWidth,
      plusOutsideScroll: plusRect.left >= scrollRect.right,
      plusGap: plusRect.left - scrollRect.right,
      lastTabGap: plusRect.left - rect(lastTab).right,
      tabGap: Number.parseFloat(getComputedStyle(scroller).columnGap),
      nameLeftGap: nameRect.left - activeRect.left,
      nameRightGap: activeRect.right - nameRect.right,
      overflowing: (scroller as HTMLElement).scrollWidth > (scroller as HTMLElement).clientWidth,
      buttonHeights: [...document.querySelectorAll<HTMLElement>(".ks-button")]
        .filter((button) => button.getBoundingClientRect().height > 0)
        .map((button) => button.getBoundingClientRect().height),
    };
  });

  const captureCascade = async (width: number, height: number) => {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const windows = page.getByTestId("app-window-md-editor");
    for (let index = 0; index < 4; index += 1) {
      await page.getByRole("button", { name: "앱 열기" }).first().click();
      await page.getByRole("menuitem", { name: "마크다운 편집기" }).click();
      await expect(windows).toHaveCount(index + 1);
    }

    const area = await page.locator(".ks-desktop-area").boundingBox();
    if (!area) throw new Error("데스크톱 영역을 찾지 못했습니다");
    const rectangles = [];
    for (let index = 0; index < 4; index += 1) {
      const rect = await windows.nth(index).boundingBox();
      if (!rect) throw new Error("새 창의 위치를 찾지 못했습니다");
      expect(rect.x - area.x).toBe(48 + 32 * index);
      expect(rect.y - area.y).toBe(48 + 32 * index);
      expect(rect.x + rect.width).toBeLessThanOrEqual(area.x + area.width - 12);
      expect(rect.y + rect.height).toBeLessThanOrEqual(area.y + area.height - 12);
      rectangles.push({ x: rect.x - area.x, y: rect.y - area.y, width: rect.width, height: rect.height });
    }
    measurements[`cascade${width}`] = { area, rectangles };
    await captureThemePair(`cascade-four-${width}`);
    for (let count = 4; count > 0; count -= 1) {
      await windows.last().getByRole("button", { name: "창 닫기" }).click();
      await expect(windows).toHaveCount(count - 1);
    }
  };

  await expect(page.getByText("열린 앱이 없습니다")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "앱 열기" }).first()).toBeVisible();
  await captureCascade(960, 600);
  await captureCascade(1440, 900);
  await captureMatrix("empty-desktop");
  const wideTabMetrics = await tabMetrics();
  expect(wideTabMetrics.lastTabGap).toBe(wideTabMetrics.tabGap);
  expect(Math.abs(wideTabMetrics.nameLeftGap - wideTabMetrics.nameRightGap)).toBeLessThanOrEqual(1);
  measurements.tabs1440 = wideTabMetrics;
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
  expect(tenTabMetrics.plusGap).toBe(tenTabMetrics.tabGap);
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
  expect(smallWindow.height).toBe(492);
  expect(smallWindow.y + smallWindow.height).toBeLessThanOrEqual(smallArea.y + smallArea.height - 12);
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
  const resizeTargetY = resizeStartY - 32;
  await page.mouse.move(resizeX, resizeTargetY);
  await page.mouse.up();
  const expectedResizedHeight = Math.min(
    Math.round(492 + resizeTargetY - resizeStartY),
    smallArea.height - 12 - 48,
  );
  await expect(editorWindow).toHaveCSS("height", `${expectedResizedHeight}px`);
  const resizedBounds = await editorWindow.boundingBox();
  const resizedArea = await page.locator(".ks-desktop-area").boundingBox();
  if (!resizedBounds || !resizedArea) throw new Error("리사이즈한 창의 위치를 확인하지 못했습니다");
  expect(resizedBounds.y + resizedBounds.height).toBeLessThanOrEqual(resizedArea.y + resizedArea.height);
  measurements.bottomResize960 = { area: resizedArea, window: resizedBounds };
  await captureThemePair("small-window-bottom-resize-960");

  const bottomHandle = await southHandle.boundingBox();
  if (!bottomHandle) throw new Error("창의 크기 조절 띠를 찾지 못했습니다");
  const shrinkStartY = bottomHandle.y + bottomHandle.height / 2;
  await page.mouse.move(bottomHandle.x + bottomHandle.width / 2, shrinkStartY);
  await page.mouse.down();
  await page.mouse.move(bottomHandle.x + bottomHandle.width / 2, shrinkStartY + 160);
  await page.mouse.up();
  await expect(editorWindow).toHaveCSS("height", "492px");
  const shrunkBounds = await editorWindow.boundingBox();
  if (!shrunkBounds) throw new Error("하단 손잡이로 줄인 창의 위치를 확인하지 못했습니다");
  expect(shrunkBounds.y + shrunkBounds.height).toBeLessThanOrEqual(resizedArea.y + resizedArea.height);
  measurements.bottomGrow960 = { area: resizedArea, window: shrunkBounds, handle: bottomHandle };
  await captureThemePair("small-window-bottom-grow-960");

  await page.setViewportSize({ width: 1440, height: 900 });
  const tallHandle = await southHandle.boundingBox();
  if (!tallHandle) throw new Error("창의 크기 조절 띠를 찾지 못했습니다");
  await page.mouse.move(tallHandle.x + tallHandle.width / 2, tallHandle.y + tallHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(tallHandle.x + tallHandle.width / 2, tallHandle.y + tallHandle.height / 2 + 208);
  await page.mouse.up();
  await expect(editorWindow).toHaveCSS("height", "700px");
  await captureMatrix("tall-window");
  await page.setViewportSize({ width: 960, height: 600 });
  await expect(editorWindow).toHaveCSS("height", "528px");
  const frameMetrics = await editorWindow.evaluate((element) => {
    const frame = element.querySelector(".ks-window-frame");
    if (!frame) throw new Error("창 틀을 찾지 못했습니다");
    const outer = element.getBoundingClientRect();
    const inner = frame.getBoundingClientRect();
    const outerStyle = getComputedStyle(element);
    return { bottomDifference: outer.bottom - inner.bottom, background: outerStyle.backgroundColor, border: outerStyle.borderBottomWidth };
  });
  expect(frameMetrics.bottomDifference).toBe(0);
  expect(frameMetrics.background).toBe("rgba(0, 0, 0, 0)");
  expect(frameMetrics.border).toBe("0px");
  measurements.windowFrame = frameMetrics;
  await captureThemePair("bottom-window-frame-960");
  const frameBounds = await editorWindow.boundingBox();
  if (!frameBounds) throw new Error("창 틀을 찾지 못했습니다");
  await page.screenshot({
    path: testInfo.outputPath("bottom-window-frame-detail-960.png"),
    clip: { x: frameBounds.x, y: frameBounds.y + frameBounds.height - 20, width: frameBounds.width, height: 32 },
  });
  const clampedHandle = await southHandle.boundingBox();
  if (!clampedHandle) throw new Error("축소된 창의 크기 조절 띠를 찾지 못했습니다");
  const handleX = clampedHandle.x + clampedHandle.width / 2;
  const handleY = clampedHandle.y + clampedHandle.height / 2;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.move(handleX, handleY - 120);
  const titleBeforeRelease = await editorWindow.locator(".ks-window-titlebar").boundingBox();
  await page.mouse.up();
  await expect(editorWindow).toHaveCSS("height", "408px");
  const titleAfterRelease = await editorWindow.locator(".ks-window-titlebar").boundingBox();
  if (!titleBeforeRelease || !titleAfterRelease) throw new Error("창 제목 줄을 찾지 못했습니다");
  expect(titleAfterRelease.y - titleBeforeRelease.y).toBe(0);
  measurements.shrinkAfterViewportResize = { titleBeforeRelease, titleAfterRelease };
  await captureThemePair("viewport-shrink-release-960");

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

  const viewerPath = path.join(root, "apps/md-viewer.json");
  const viewerDefinition = JSON.parse(await readFile(viewerPath, "utf8"));
  viewerDefinition.id = "test-md-viewer";
  await page.locator('input[type="file"]').setInputFiles({ name: "viewer.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(viewerDefinition)) });
  const viewerWindow = page.getByTestId("app-window-test-md-viewer");
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
    viewerWindow.locator(".ks-markdown-text").evaluate((element) => {
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
  const viewerEast = await viewerWindow.locator(".ks-window-resize-east").boundingBox();
  if (!viewerEast) throw new Error("뷰어 창의 크기 조절 띠를 찾지 못했습니다");
  await page.mouse.move(viewerEast.x + viewerEast.width / 2, viewerEast.y + 80);
  await page.mouse.down();
  await page.mouse.move(viewerEast.x + viewerEast.width / 2 + 180, viewerEast.y + 80);
  await page.mouse.up();
  await expect.poll(async () => (await viewerWindow.boundingBox())?.width ?? 0).toBeGreaterThan(948);
  await captureMatrix("wide-viewer");
  await page.setViewportSize({ width: 960, height: 600 });
  const narrowArea = await page.locator(".ks-desktop-area").boundingBox();
  const wideClose = viewerWindow.getByRole("button", { name: "창 닫기" });
  const wideCloseBounds = await wideClose.boundingBox();
  if (!narrowArea || !wideCloseBounds) throw new Error("뷰어 닫기 단추를 찾지 못했습니다");
  expect(wideCloseBounds.x + wideCloseBounds.width).toBeLessThanOrEqual(narrowArea.x + narrowArea.width - 12);
  measurements.wideWindowClose = { area: narrowArea, close: wideCloseBounds };
  await captureThemePair("wide-viewer-close-960");
  await wideClose.click();
  await expect(viewerWindow).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });

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

  await editorWindow.getByRole("button", { name: "notes", exact: true }).click();
  const treeList = editorWindow.locator(".ks-file-tree-list");
  const treeScrollbar = await treeList.evaluate((element) => {
    const node = element as HTMLElement;
    const bounds = node.getBoundingClientRect();
    const thumbHeight = Math.max(20, node.clientHeight * node.clientHeight / node.scrollHeight);
    return { x: bounds.right - 4, startY: bounds.top + thumbHeight / 2, endY: bounds.bottom - thumbHeight / 2, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, before: node.scrollTop };
  });
  expect(treeScrollbar.scrollHeight).toBeGreaterThan(treeScrollbar.clientHeight);
  await captureMatrix("tree-scrollbar-before-drag");
  await page.mouse.move(treeScrollbar.x, treeScrollbar.startY);
  await page.mouse.down();
  await page.mouse.move(treeScrollbar.x, treeScrollbar.endY, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => treeList.evaluate((element) => (element as HTMLElement).scrollTop)).toBeGreaterThan(treeScrollbar.before);
  measurements.treeScrollbar = { ...treeScrollbar, after: await treeList.evaluate((element) => (element as HTMLElement).scrollTop) };
  await captureMatrix("tree-scrollbar-after-drag");

  const treeHeader = await editorWindow.locator(".ks-file-tree-header").boundingBox();
  const splitHandle = await editorWindow.locator(".ks-split-handle").boundingBox();
  if (!treeHeader || !splitHandle) throw new Error("분할 기준선을 측정하지 못했습니다");
  const dividerGap = Math.abs(treeHeader.x + treeHeader.width - splitHandle.x);
  expect(dividerGap).toBeLessThanOrEqual(0.5);
  await editor.click();
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

  await editorWindow.getByRole("button", { name: "notes", exact: true }).click();
  const selectedTreeRow = editorWindow.getByRole("button", { name: longDocument });
  const selectedTab = page.getByRole("button", { name: "데스크톱 2" });
  for (const [name, locator] of [["tree", selectedTreeRow], ["tab", selectedTab]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.mouse.move(0, 0);
      const before = await locator.evaluate((element) => getComputedStyle(element).backgroundColor);
      await locator.hover();
      const after = await locator.evaluate((element) => ({ color: getComputedStyle(element).backgroundColor, image: getComputedStyle(element).backgroundImage }));
      expect(after.color).toBe(before);
      expect(after.image).toContain("linear-gradient");
      measurements[`selectedHover-${name}-${scheme}`] = { before, after };
      await page.screenshot({ path: testInfo.outputPath(`selected-hover-${name}-1440-${scheme}.png`) });
      await page.setViewportSize({ width: 960, height: 600 });
      await locator.hover();
      await page.screenshot({ path: testInfo.outputPath(`selected-hover-${name}-960-${scheme}.png`) });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
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

  const area1440 = await page.locator(".ks-desktop-area").boundingBox();
  const finalTitle = await editorWindow.locator(".ks-window-titlebar").boundingBox();
  if (!area1440 || !finalTitle) throw new Error("데스크톱이나 창 제목 줄을 찾지 못했습니다");
  await page.mouse.move(finalTitle.x + 60, finalTitle.y + 16);
  await page.mouse.down();
  await page.mouse.move(area1440.x + 2, area1440.y + 2);
  await page.mouse.up();
  await expect(editorWindow).not.toHaveClass(/ks-window-gesturing/);
  await expect(editorWindow).toHaveCSS("left", "12px");
  await expect(editorWindow).toHaveCSS("top", "12px");

  const maxCorner = await editorWindow.locator(".ks-window-resize-corner").boundingBox();
  if (!maxCorner) throw new Error("창 모서리 크기 조절 영역을 찾지 못했습니다");
  await page.mouse.move(maxCorner.x + 6, maxCorner.y + 6);
  await page.mouse.down();
  await page.mouse.move(area1440.x + area1440.width - 1, area1440.y + area1440.height - 1);
  await page.mouse.up();
  await expect(editorWindow).not.toHaveClass(/ks-window-gesturing/);

  const windowGaps = async () => {
    const area = await page.locator(".ks-desktop-area").boundingBox();
    const window = await editorWindow.boundingBox();
    if (!area || !window) throw new Error("데스크톱이나 창의 위치를 찾지 못했습니다");
    return {
      area,
      window,
      gaps: {
        left: window.x - area.x,
        top: window.y - area.y,
        right: area.x + area.width - window.x - window.width,
        bottom: area.y + area.height - window.y - window.height,
      },
    };
  };
  const max1440 = await windowGaps();
  expect(max1440.gaps).toEqual({ left: 12, top: 12, right: 12, bottom: 12 });
  measurements.symmetricMax1440 = max1440;
  await captureThemePair("symmetric-max-1440");

  await page.setViewportSize({ width: 960, height: 600 });
  await expect(editorWindow).toHaveCSS("width", "936px");
  await expect(editorWindow).toHaveCSS("height", "528px");
  const fitted960 = await windowGaps();
  expect(fitted960.gaps).toEqual({ left: 12, top: 12, right: 12, bottom: 12 });
  measurements.symmetricFitted960 = fitted960;
  await captureThemePair("symmetric-fitted-960");

  const dragResizeHandle = async (selector: string, dx: number, dy: number) => {
    const handle = await editorWindow.locator(selector).boundingBox();
    if (!handle) throw new Error(`크기 조절 영역을 찾지 못했습니다: ${selector}`);
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, { x, y });
    expect(hit).toContain(selector.slice(1));
    const before = await windowGaps();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy);
    await page.mouse.up();
    await expect(editorWindow).not.toHaveClass(/ks-window-gesturing/);
    const after = await windowGaps();
    expect(after.window.width - before.window.width).toBe(dx);
    expect(after.window.height - before.window.height).toBe(dy);
    return { hit, before: before.window, after: after.window };
  };
  measurements.resizeHandles960 = {
    east: await dragResizeHandle(".ks-window-resize-east", -40, 0),
    south: await dragResizeHandle(".ks-window-resize-south", 0, -40),
    corner: await dragResizeHandle(".ks-window-resize-corner", -30, -30),
  };
  const beforeReload = await windowGaps();
  await page.reload();
  await expect(editorWindow).toBeVisible();
  await expect(editorWindow).toHaveCSS("width", `${beforeReload.window.width}px`);
  const afterReload = await windowGaps();
  expect(afterReload.window).toEqual(beforeReload.window);
  measurements.symmetricReload960 = { before: beforeReload.window, after: afterReload.window };
  await captureThemePair("symmetric-after-reload-960");

  await writeFile(testInfo.outputPath("measurements.json"), JSON.stringify(measurements, null, 2), "utf8");
});
