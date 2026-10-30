import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../.local/artifacts/20261030-explorer-pc");

interface HarnessWindow extends Window {
  __kaleidoscopeHarness?: {
    getSnapshot: () => {
      shared: { windows: Array<{ id: string; app_id: string; state: Record<string, unknown> }> };
    } | null;
    getWebPlaces: () => Array<{ window_id: string; bounds: { x: number; y: number; width: number; height: number } | null }>;
    getWebAttachCount: (windowId: string) => number;
  };
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: path.join(artifactDir, name), animations: "disabled" });
}

async function controls(page: Page) {
  return page.evaluate(() => {
    const harness = (window as HarnessWindow).__kaleidoscopeHarness;
    if (!harness) throw new Error("가짜 코어 조작부를 찾지 못했습니다");
    return {
      snapshot: harness.getSnapshot(),
      places: harness.getWebPlaces(),
      attachCount: harness.getWebAttachCount("web-browser-window"),
    };
  });
}

async function expectWebAligned(page: Page) {
  await expect.poll(async () => page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>("[data-ks-web-surface]");
    const mock = document.querySelector<HTMLElement>("[data-testid='fake-webview-web-browser-window']");
    if (!surface || !mock) return false;
    const actual = surface.getBoundingClientRect();
    const shown = mock.getBoundingClientRect();
    return Math.abs(actual.left - shown.left) <= 1
      && Math.abs(actual.top - shown.top) <= 1
      && Math.abs(actual.width - shown.width) <= 1
      && Math.abs(actual.height - shown.height) <= 1;
  })).toBe(true);
}

async function raiseExplorer(page: Page, explorer: Locator) {
  const bounds = await explorer.boundingBox();
  if (!bounds) throw new Error("탐색기 창 위치를 읽지 못했습니다");
  await page.mouse.click(bounds.x + bounds.width * 0.8, bounds.y + 16);
}

async function explorerHeaderMetrics(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-testid="app-window-explorer"]');
    const panes = root?.querySelectorAll<HTMLElement>(".ks-split-pane");
    const left = panes?.[0]?.querySelector<HTMLElement>(".ks-file-tree-header");
    const right = root?.querySelector<HTMLElement>(".ks-explorer-content > .ks-file-tree-header");
    if (!left || !right) throw new Error("탐색기 좌우 머리를 찾지 못했습니다");
    const leftBounds = left.getBoundingClientRect();
    const rightBounds = right.getBoundingClientRect();
    return {
      left: { top: leftBounds.top, height: leftBounds.height },
      right: { top: rightBounds.top, height: rightBounds.height },
      topDelta: leftBounds.top - rightBounds.top,
      heightDelta: leftBounds.height - rightBounds.height,
    };
  });
}

test("web view overlap and explorer open behavior in the shell harness", async ({ page }) => {
  test.setTimeout(120_000);
  await mkdir(artifactDir, { recursive: true });
  await page.goto("/harness.html");

  const browser = page.getByTestId("app-window-web-browser");
  const explorer = page.getByTestId("app-window-explorer");
  const fakeWebView = page.getByTestId("fake-webview-web-browser-window");
  const surface = browser.locator("[data-ks-web-surface]");
  const address = page.getByRole("textbox", { name: "주소" });
  await expect(browser).toBeVisible();
  await expect(explorer).toBeVisible();
  await expect(fakeWebView).toBeVisible();
  await expectWebAligned(page);
  const toolbarChildren = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>(".ks-web-toolbar");
    if (!toolbar) throw new Error("웹 도구 줄을 찾지 못했습니다");
    const rootStyle = getComputedStyle(document.documentElement);
    const controlHeight = Number.parseFloat(rootStyle.getPropertyValue("--ks-control-height"));
    const iconButtonSize = Number.parseFloat(rootStyle.getPropertyValue("--ks-icon-button-size"));
    const toolbarBounds = toolbar.getBoundingClientRect();
    const toolbarCenterY = (toolbarBounds.top + toolbarBounds.bottom) / 2;
    return {
      toolbarHeight: toolbarBounds.height,
      controlHeight,
      iconButtonSize,
      toolbarCenterY,
      children: Array.from(toolbar.children).map((node) => {
        const child = node as HTMLElement;
        const style = getComputedStyle(child);
        const bounds = child.getBoundingClientRect();
        const height = bounds.height;
        const centerY = (bounds.top + bounds.bottom) / 2;
        return {
          tag: child.tagName,
          className: typeof child.className === "string" ? child.className : "",
          ariaLabel: child.getAttribute("aria-label"),
          height,
          centerY,
          centerDelta: centerY - toolbarCenterY,
          aboveIconButtonBy: height - iconButtonSize,
          withinControlHeight: height <= controlHeight,
          computedHeight: style.height,
          minHeight: style.minHeight,
          lineHeight: style.lineHeight,
          paddingBlock: style.paddingBlock,
        };
      }),
    };
  });
  await writeFile(path.join(artifactDir, "web-toolbar-child-measurements.json"), JSON.stringify(toolbarChildren, null, 2));
  expect((await controls(page)).attachCount).toBe(1);
  await screenshot(page, "web-view-wide-before-1440x900.png");

  await page.setViewportSize({ width: 960, height: 600 });
  await expectWebAligned(page);
  const narrowToolbar = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>(".ks-web-toolbar");
    const input = toolbar?.querySelector<HTMLInputElement>(".ks-text-input");
    return { toolbar: toolbar?.getBoundingClientRect().width ?? 0, input: input?.getBoundingClientRect().width ?? 0 };
  });
  expect(narrowToolbar.input).toBeGreaterThan(0);
  expect(narrowToolbar.input).toBeLessThan(narrowToolbar.toolbar);
  await screenshot(page, "web-view-narrow-before-960x600.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectWebAligned(page);

  await address.click();
  const editableAddress = page.getByRole("textbox", { name: "주소" });
  await editableAddress.fill("example.org");
  await editableAddress.press("Enter");
  await expect(page.getByRole("textbox", { name: "주소" })).toHaveValue("https://example.org");
  await expect(page.getByRole("button", { name: "뒤로" })).toBeEnabled();
  await page.getByRole("button", { name: "뒤로" }).click();
  await expect(page.getByRole("textbox", { name: "주소" })).toHaveValue("https://www.google.com/");

  await page.getByRole("button", { name: "kaleidoscope" }).click();
  const workspaceMenu = page.getByRole("menu");
  await expect(workspaceMenu).toBeVisible();
  const menuAndSurface = await page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>("[role=menu]")!.getBoundingClientRect();
    const surface = document.querySelector<HTMLElement>("[data-ks-web-surface]")!.getBoundingClientRect();
    return {
      overlaps: Math.min(menu.right, surface.right) > Math.max(menu.left, surface.left)
        && Math.min(menu.bottom, surface.bottom) > Math.max(menu.top, surface.top),
      point: { x: menu.left + menu.width / 2, y: menu.top + menu.height / 2 },
    };
  });
  expect(menuAndSurface.overlaps).toBe(true);
  await expect(fakeWebView).toHaveCount(0);
  await expect(surface.locator(".ks-web-frozen-image")).toBeVisible();
  const menuOwnsCenter = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    return Boolean(target?.closest("[role=menu]"));
  }, menuAndSurface.point);
  expect(menuOwnsCenter).toBe(true);
  await page.keyboard.press("Escape");
  await expect(workspaceMenu).toHaveCount(0);
  await expect(fakeWebView).toBeVisible();
  await expect(surface.locator(".ks-web-frozen-image")).toHaveCount(0);

  await raiseExplorer(page, explorer);
  await expect(fakeWebView).toHaveCount(0);
  await expect(surface.locator(".ks-web-frozen-image")).toBeVisible();
  const surfaceBounds = await surface.boundingBox();
  if (!surfaceBounds) throw new Error("웹 화면 자리를 읽지 못했습니다");
  await page.mouse.click(surfaceBounds.x + 80, surfaceBounds.y + 16);
  await expect(fakeWebView).toBeVisible();
  await expect(surface.locator(".ks-web-frozen-image")).toHaveCount(0);

  const titlebar = browser.locator(".ks-window-titlebar");
  const titlebarBounds = await titlebar.boundingBox();
  if (!titlebarBounds) throw new Error("브라우저 제목 줄을 읽지 못했습니다");
  const start = { x: titlebarBounds.x + titlebarBounds.width / 2, y: titlebarBounds.y + titlebarBounds.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 48, start.y + 24, { steps: 3 });
  await expect.poll(async () => page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>("[data-ks-web-surface]")?.getBoundingClientRect();
    const mock = document.querySelector<HTMLElement>("[data-testid='fake-webview-web-browser-window']")?.getBoundingClientRect();
    return Boolean(surface && mock && Math.abs(surface.left - mock.left) <= 1 && Math.abs(surface.top - mock.top) <= 1);
  })).toBe(true);
  const movingBounds = await fakeWebView.boundingBox();
  expect(movingBounds).not.toBeNull();
  expect(Math.abs(movingBounds!.x - surfaceBounds.x)).toBeGreaterThan(0);
  await page.mouse.move(start.x + 96, start.y + 48, { steps: 3 });
  await page.mouse.up();
  await expectWebAligned(page);

  const attachCount = (await controls(page)).attachCount;
  await page.getByRole("button", { name: "두 번째 화면" }).click();
  await expect(fakeWebView).toHaveCount(0);
  await page.getByRole("button", { name: "작업" }).click();
  await expect(fakeWebView).toBeVisible();
  await expectWebAligned(page);
  expect((await controls(page)).attachCount).toBe(attachCount);
  await expect(page.getByRole("textbox", { name: "주소" })).toHaveValue("https://www.google.com/");
  await screenshot(page, "web-view-wide-after-1440x900.png");
  await page.setViewportSize({ width: 960, height: 600 });
  await expectWebAligned(page);
  await screenshot(page, "web-view-narrow-after-960x600.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectWebAligned(page);

  await raiseExplorer(page, explorer);
  await expect(explorer.getByRole("button", { name: "이 PC의 파일 읽기 허용" })).toBeVisible();
  await screenshot(page, "explorer-permission-1440x900.png");
  await explorer.getByRole("button", { name: "이 PC의 파일 읽기 허용" }).click();
  const folders = explorer.getByRole("tree", { name: "폴더 목록" });
  const contents = explorer.getByRole("listbox", { name: "폴더 내용" });
  await expect(folders.getByRole("button", { name: "문서" })).toBeVisible();
  await expect(contents.getByRole("option", { name: "문서" })).toBeVisible();
  await expect(contents.getByRole("option", { name: "다운로드" })).toBeVisible();
  await expect(contents.getByRole("option", { name: "로컬 디스크 (C:)" })).toBeVisible();
  await expect(folders.locator('[data-folder-path="documents"]')).toBeVisible();
  await expect(explorer.locator('.ks-explorer-breadcrumb [aria-current="page"]')).toHaveText("내 PC");
  await expect(contents.getByRole("option", { name: "문서" }).locator("svg")).toHaveClass(/lucide-file-text/);
  await expect(contents.getByRole("option", { name: "로컬 디스크 (C:)" }).locator("svg")).toHaveClass(/lucide-hard-drive/);
  await screenshot(page, "explorer-pc-icons-wide-1440x900.png");
  await page.setViewportSize({ width: 720, height: 600 });
  await screenshot(page, "explorer-pc-icons-narrow-720x600.png");
  await explorer.getByRole("button", { name: "자세히 보기" }).click();
  await expect(explorer.getByRole("table", { name: "폴더 내용" })).toBeVisible();
  await screenshot(page, "explorer-pc-details-narrow-720x600.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  await screenshot(page, "explorer-pc-details-wide-1440x900.png");
  await explorer.getByRole("button", { name: "아이콘 보기" }).click();
  await folders.getByRole("button", { name: "문서" }).click();
  await expect(folders.getByRole("button", { name: "notes" })).toBeVisible();
  await folders.getByRole("button", { name: "notes" }).click();
  await expect(explorer.getByRole("button", { name: "새 파일" })).toHaveCount(0);
  await expect(explorer.locator('[data-file-path="documents/notes/a.md"]')).toBeVisible();
  await expect(explorer.locator(".ks-explorer-crumb-button")).toHaveText(["내 PC", "문서"]);
  await expect(explorer.locator('.ks-explorer-breadcrumb [aria-current="page"]')).toHaveText("notes");
  await screenshot(page, "explorer-path-documents-notes-1440x900.png");

  const explorerTitlebar = explorer.locator(".ks-window-titlebar");
  const explorerTitlebarBounds = await explorerTitlebar.boundingBox();
  if (!explorerTitlebarBounds) throw new Error("탐색기 제목 줄을 찾지 못했습니다");
  const explorerTitlebarCenter = {
    x: explorerTitlebarBounds.x + explorerTitlebarBounds.width / 2,
    y: explorerTitlebarBounds.y + explorerTitlebarBounds.height / 2,
  };
  await page.mouse.move(explorerTitlebarCenter.x, explorerTitlebarCenter.y);
  await page.mouse.down();
  await page.mouse.move(explorerTitlebarCenter.x - 480, explorerTitlebarCenter.y - 150, { steps: 3 });
  await page.mouse.up();
  await page.setViewportSize({ width: 720, height: 600 });
  await screenshot(page, "explorer-icons-narrow-720x600.png");
  await explorer.getByRole("button", { name: "자세히 보기" }).click();
  await expect(explorer.getByRole("table", { name: "폴더 내용" })).toBeVisible();
  await screenshot(page, "explorer-details-narrow-720x600.png");
  const narrowExplorerHeaders = await explorerHeaderMetrics(page);
  expect(Math.abs(narrowExplorerHeaders.topDelta)).toBeLessThanOrEqual(1);
  expect(Math.abs(narrowExplorerHeaders.heightDelta)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await screenshot(page, "explorer-details-wide-1440x900.png");
  const wideExplorerHeaders = await explorerHeaderMetrics(page);
  expect(Math.abs(wideExplorerHeaders.topDelta)).toBeLessThanOrEqual(1);
  expect(Math.abs(wideExplorerHeaders.heightDelta)).toBeLessThanOrEqual(1);
  await writeFile(path.join(artifactDir, "explorer-header-measurements.json"), JSON.stringify({ wide: wideExplorerHeaders, narrow: narrowExplorerHeaders }, null, 2));
  await explorer.getByRole("button", { name: "아이콘 보기" }).click();
  await expect(explorer.locator('[data-file-path="documents/notes/a.md"]')).toBeVisible();
  const movedExplorerBounds = await explorer.boundingBox();
  if (!movedExplorerBounds) throw new Error("옮긴 탐색기 창 위치를 읽지 못했습니다");
  await page.mouse.move(movedExplorerBounds.x + movedExplorerBounds.width / 2, movedExplorerBounds.y + 16);
  await page.mouse.down();
  await page.mouse.move(movedExplorerBounds.x + movedExplorerBounds.width / 2 + 480, movedExplorerBounds.y + 166, { steps: 3 });
  await page.mouse.up();
  await explorer.locator('[data-file-path="documents/notes/a.md"]').dblclick();

  const editor = page.getByTestId("app-window-md-editor");
  await expect(editor).toBeVisible();
  await expect(editor.getByText("첫 번째 노트")).toBeVisible();
  const openedA = (await controls(page)).snapshot?.shared.windows.find((item) => item.app_id === "md-editor");
  expect(openedA?.state.current_file).toBe("a.md");

  await page.setViewportSize({ width: 960, height: 600 });
  await screenshot(page, "md-editor-invariant-narrow-before-others.png");
  await page.setViewportSize({ width: 1440, height: 900 });

  await raiseExplorer(page, explorer);
  await explorer.locator('[data-file-path="documents/notes/b.md"]').dblclick();
  await expect(editor.getByText("두 번째 노트")).toBeVisible();
  const afterB = (await controls(page)).snapshot?.shared.windows.filter((item) => item.app_id === "md-editor") ?? [];
  expect(afterB).toHaveLength(1);
  expect(afterB[0].id).toBe(openedA?.id);
  expect(afterB[0].state.current_file).toBe("b.md");
  await editor.locator(".ks-window-titlebar").click();
  const editorFileTree = editor.locator(".ks-file-tree");
  const invariantBefore = await editorFileTree.screenshot({ path: path.join(artifactDir, "md-editor-file-tree-before.png") });

  await raiseExplorer(page, explorer);
  await folders.getByRole("button", { name: "문서" }).click();
  await folders.getByRole("button", { name: "images" }).click();
  await explorer.locator('[data-file-path="documents/images/cover.png"]').dblclick();
  const noOpeners = page.getByRole("menuitem", { name: "열 수 있는 앱이 없습니다" });
  await expect(noOpeners).toBeVisible();
  await expect(noOpeners).toBeDisabled();
  await page.keyboard.press("Escape");

  await folders.getByRole("button", { name: "문서" }).click();
  await folders.getByRole("button", { name: "notes" }).click();
  await expect(explorer.locator('[data-file-path="documents/notes/a.md"]')).toBeVisible();
  await explorer.locator('[data-file-path="documents/notes/a.md"]').click({ button: "right" });
  const appOpenMenu = page.getByRole("menu");
  await expect(appOpenMenu).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "마크다운 편집기" })).toBeVisible();
  const appOpenPlacement = await page.evaluate(() => {
    const anchor = document.querySelector<HTMLElement>('[data-file-path="documents/notes/a.md"]');
    const menu = document.querySelector<HTMLElement>("[role=menu]");
    if (!anchor || !menu) throw new Error("앱 열기 메뉴의 위치를 읽지 못했습니다");
    const anchorBounds = anchor.getBoundingClientRect();
    const menuBounds = menu.getBoundingClientRect();
    return { anchorBottom: anchorBounds.bottom, menuTop: menuBounds.top, menuLeft: menuBounds.left };
  });
  expect(Math.abs(appOpenPlacement.menuTop - appOpenPlacement.anchorBottom)).toBeLessThanOrEqual(1);
  await screenshot(page, "app-open-menu-wide-after-1440x900.png");
  await page.keyboard.press("Escape");
  await expect(editor.getByRole("button", { name: "새 파일" })).toBeVisible();

  await page.setViewportSize({ width: 960, height: 600 });
  await screenshot(page, "md-editor-invariant-narrow-after-others.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  const invariantAfter = await editorFileTree.screenshot({ path: path.join(artifactDir, "md-editor-file-tree-after.png") });
  const beforeHash = createHash("sha256").update(invariantBefore).digest("hex");
  const afterHash = createHash("sha256").update(invariantAfter).digest("hex");
  expect(afterHash).toBe(beforeHash);
  await writeFile(path.join(artifactDir, "md-editor-file-tree-invariant.sha256"), `${beforeHash}\n`);
  await screenshot(page, "md-editor-invariant-wide-1440x900.png");
  await screenshot(page, "explorer-and-browser-wide-1440x900.png");
  const toolbarMetrics = await page.evaluate(() => {
    const webHeader = document.querySelector<HTMLElement>(".ks-web-toolbar")?.getBoundingClientRect();
    const fileHeader = document.querySelector<HTMLElement>('[data-testid="app-window-md-editor"] .ks-file-tree-header')?.getBoundingClientRect();
    const webContent = document.querySelector<HTMLElement>('[data-testid="app-window-web-browser"] .ks-window-content')?.getBoundingClientRect();
    const editorContent = document.querySelector<HTMLElement>('[data-testid="app-window-md-editor"] .ks-window-content')?.getBoundingClientRect();
    if (!webHeader || !fileHeader || !webContent || !editorContent) return null;
    const webChildren = Array.from(document.querySelectorAll<HTMLElement>(".ks-web-toolbar > *"));
    const webCenterY = (webHeader.top + webHeader.bottom) / 2;
    return {
      webHeaderHeight: webHeader.height,
      fileHeaderHeight: fileHeader.height,
      webLeftInset: Math.round(webHeader.left - webContent.left),
      fileTreeLeftInset: Math.round(fileHeader.left - editorContent.left),
      maxChildCenterDelta: Math.max(...webChildren.map((child) => {
        const bounds = child.getBoundingClientRect();
        return Math.abs((bounds.top + bounds.bottom) / 2 - webCenterY);
      })),
    };
  });
  expect(toolbarMetrics).not.toBeNull();
  await writeFile(path.join(artifactDir, "ui-measurements.json"), JSON.stringify({ narrowToolbar, menuAndSurface, toolbarMetrics }, null, 2));
  expect(Math.abs(toolbarMetrics!.webHeaderHeight - toolbarMetrics!.fileHeaderHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(toolbarMetrics!.webLeftInset - toolbarMetrics!.fileTreeLeftInset)).toBeLessThanOrEqual(1);
  expect(toolbarMetrics!.maxChildCenterDelta).toBeLessThanOrEqual(1);

  const finalPlaces = (await controls(page)).places.filter((place) => place.window_id === "web-browser-window");
  expect(finalPlaces.some((place) => place.bounds === null)).toBe(true);
  expect(finalPlaces.some((place) => place.bounds !== null)).toBe(true);
  const placements = JSON.stringify(finalPlaces, null, 2);
  await writeFile(path.join(artifactDir, "web-place-calls.json"), placements);
});

test("shows the unavailable state when the shell cannot attach a web view", async ({ page }) => {
  await page.goto("/harness.html?web=unavailable");
  const browser = page.getByTestId("app-window-web-browser");
  await expect(browser.getByText("이 쉘에서는 웹 화면을 열 수 없습니다")).toBeVisible();
  await expect(page.getByTestId("fake-webview-web-browser-window")).toHaveCount(0);
});

test("keeps the current folder visible after a long ancestor", async ({ page }) => {
  const longFolder = "아주 긴 폴더 이름을 넣어서 경로의 마지막 마디가 어떻게 보이는지 확인하는 폴더";
  await page.setViewportSize({ width: 720, height: 600 });
  await page.goto("/harness.html?long-folder");
  const explorer = page.getByTestId("app-window-explorer");
  await explorer.getByRole("button", { name: "이 PC의 파일 읽기 허용" }).click();
  await explorer.getByRole("option", { name: "문서", exact: true }).dblclick();
  await explorer.getByRole("option", { name: "notes", exact: true }).dblclick();
  await explorer.getByRole("option", { name: longFolder, exact: true }).dblclick();
  await explorer.getByRole("option", { name: "inner", exact: true }).dblclick();
  const current = explorer.locator('.ks-explorer-breadcrumb [aria-current="page"]');
  await expect(current).toHaveText("inner");
  await expect.poll(() => current.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const nav = element.closest("nav")!.getBoundingClientRect();
    return bounds.width > 0 && bounds.left >= nav.left && bounds.right <= nav.right && element.scrollWidth <= element.clientWidth;
  })).toBe(true);
  const nav = explorer.locator(".ks-explorer-breadcrumb");
  const longCrumb = nav.locator(".ks-explorer-crumb").last();
  await nav.evaluate((element) => {
    const crumb = Array.from(element.querySelectorAll<HTMLElement>(".ks-explorer-crumb")).at(-1)!;
    const button = crumb.querySelector<HTMLButtonElement>("button")!;
    const icon = crumb.querySelector<SVGElement>("svg")!;
    const buttonStyle = getComputedStyle(button);
    const gap = parseFloat(getComputedStyle(crumb).gap);
    const reserved = icon.getBoundingClientRect().width + parseFloat(buttonStyle.paddingLeft) + parseFloat(buttonStyle.paddingRight) + gap;
    element.style.flex = `0 0 ${element.querySelector<HTMLElement>('[aria-current="page"]')!.getBoundingClientRect().width + reserved}px`;
  });
  await expect(longCrumb).toBeHidden();
  await expect(current).toBeVisible();
  await nav.evaluate((element) => { element.style.flex = ""; });
  await expect(longCrumb).toBeVisible();
  await longCrumb.getByRole("button", { name: longFolder }).click();
  await expect(explorer.getByRole("option", { name: "inner", exact: true })).toBeVisible();
});

test("keeps the last file open menu inside a 720x600 viewport", async ({ page }) => {
  await mkdir(artifactDir, { recursive: true });
  await page.setViewportSize({ width: 720, height: 600 });
  await page.goto("/harness.html?bottom-menu");

  const explorer = page.getByTestId("app-window-explorer");
  await expect(explorer).toBeVisible();
  await explorer.getByRole("button", { name: "이 PC의 파일 읽기 허용" }).click();
  await explorer.getByRole("option", { name: "문서", exact: true }).dblclick();
  const files = explorer.locator(".ks-explorer-content [data-file-path]");
  await expect(files).toHaveCount(30);
  const list = explorer.locator(".ks-explorer-content .ks-data-view");
  await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const lastFile = explorer.locator('[data-file-path="documents/z29.md"]');
  await lastFile.scrollIntoViewIfNeeded();
  await expect(lastFile).toBeVisible();
  await expect.poll(() => list.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1)).toBe(true);

  await lastFile.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(page.getByRole("menuitem", { name: "마크다운 편집기" })).toBeVisible();
  const placement = await page.evaluate(() => {
    const anchor = document.querySelector<HTMLElement>('[data-file-path="documents/z29.md"]');
    const menu = document.querySelector<HTMLElement>("[role=menu]");
    if (!anchor || !menu) throw new Error("마지막 파일 메뉴의 위치를 읽지 못했습니다");
    const anchorBounds = anchor.getBoundingClientRect();
    const menuBounds = menu.getBoundingClientRect();
    const inset = Number.parseFloat(getComputedStyle(menu).getPropertyValue("--ks-space-3")) || 0;
    return {
      anchorTop: anchorBounds.top,
      anchorBottom: anchorBounds.bottom,
      menuTop: menuBounds.top,
      menuBottom: menuBounds.bottom,
      menuLeft: menuBounds.left,
      menuRight: menuBounds.right,
      inset,
      height: innerHeight,
      width: innerWidth,
      itemBounds: Array.from(menu.querySelectorAll("[role=menuitem]")).map((item) => {
        const bounds = item.getBoundingClientRect();
        return { top: bounds.top, bottom: bounds.bottom };
      }),
    };
  });
  expect(placement.anchorBottom + (placement.menuBottom - placement.menuTop)).toBeGreaterThan(placement.height - placement.inset);
  expect(placement.menuTop).toBeLessThan(placement.anchorTop);
  expect(placement.menuTop).toBeGreaterThanOrEqual(placement.inset);
  expect(placement.menuBottom).toBeLessThanOrEqual(placement.height - placement.inset);
  expect(placement.menuLeft).toBeGreaterThanOrEqual(placement.inset);
  expect(placement.menuRight).toBeLessThanOrEqual(placement.width - placement.inset);
  for (const item of placement.itemBounds) {
    expect(item.top).toBeGreaterThanOrEqual(placement.inset);
    expect(item.bottom).toBeLessThanOrEqual(placement.height - placement.inset);
  }
  await writeFile(path.join(artifactDir, "bottom-menu-720x600.json"), JSON.stringify(placement, null, 2));
  await screenshot(page, "bottom-menu-720x600.png");
  await expect(menu).toBeVisible();
});

test("shell document does not scroll and the top bar stays at the top", async ({ page }) => {
  await mkdir(artifactDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/harness.html");

  const explorer = page.getByTestId("app-window-explorer");
  await expect(explorer).toBeVisible();
  await explorer.getByRole("button", { name: "이 PC의 파일 읽기 허용" }).click();
  await explorer.getByRole("option", { name: "문서", exact: true }).dblclick();
  const notes = explorer.getByRole("option", { name: "notes", exact: true });
  await expect(notes).toBeVisible();
  await notes.dblclick();
  await expect(explorer.locator('.ks-explorer-breadcrumb [aria-current="page"]')).toHaveText("notes");

  const expectShellAtTop = async () => {
    const metrics = await page.evaluate(() => {
      const documentElement = document.scrollingElement;
      const appRoot = document.querySelector<HTMLElement>(".app-root");
      const shellBar = document.querySelector<HTMLElement>(".ks-shell-bar");
      if (!documentElement || !appRoot || !shellBar) throw new Error("쉘 스크롤 측정 대상을 찾지 못했습니다");
      return {
        documentScrollHeight: documentElement.scrollHeight,
        documentClientHeight: documentElement.clientHeight,
        documentScrollTop: documentElement.scrollTop,
        appRootScrollTop: appRoot.scrollTop,
        shellBarTop: shellBar.getBoundingClientRect().top,
      };
    });
    expect(metrics.documentScrollHeight).toBeLessThanOrEqual(metrics.documentClientHeight);
    expect(metrics.documentScrollTop).toBe(0);
    expect(metrics.appRootScrollTop).toBe(0);
    expect(metrics.shellBarTop).toBe(0);
  };
  const wheelOver = async (locator: Locator, capture?: string) => {
    const bounds = await locator.boundingBox();
    if (!bounds) throw new Error("휠 동작 위치를 읽지 못했습니다");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, 400);
    if (capture) await screenshot(page, capture);
    await expectShellAtTop();
  };

  const shellBar = page.locator(".ks-shell-bar");
  await wheelOver(shellBar, "shell-document-scroll-after-1440x900.png");

  await wheelOver(explorer.locator(".ks-explorer-content .ks-data-view"));

  await page.getByRole("button", { name: "kaleidoscope" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expectShellAtTop();

  await page.getByRole("button", { name: "두 번째 화면" }).click();
  await expectShellAtTop();
  await page.getByRole("button", { name: "작업" }).click();
  await expect(explorer).toBeVisible();
  await expectShellAtTop();

  const titlebar = explorer.locator(".ks-window-titlebar");
  const titleBounds = await titlebar.boundingBox();
  if (!titleBounds) throw new Error("탐색기 제목 줄을 찾지 못했습니다");
  const dragX = titleBounds.x + titleBounds.width / 2;
  const dragY = titleBounds.y + titleBounds.height / 2;
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX, dragY + 40, { steps: 4 });
  await page.mouse.up();
  await expectShellAtTop();

  await page.setViewportSize({ width: 960, height: 600 });
  await wheelOver(shellBar);
});
