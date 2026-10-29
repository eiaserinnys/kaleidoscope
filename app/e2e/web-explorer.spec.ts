import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artifactDir = path.join(root, ".local/artifacts/20261030-web-view-explorer");

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
  await explorer.getByRole("button", { name: "볼 폴더 고르기" }).click();
  await expect(explorer.getByRole("button", { name: "notes" })).toBeVisible();
  await expect(explorer.getByRole("button", { name: "새 파일" })).toHaveCount(0);
  await explorer.getByRole("button", { name: "notes" }).click();
  await explorer.getByRole("button", { name: "a.md" }).dblclick();

  const editor = page.getByTestId("app-window-md-editor");
  await expect(editor).toBeVisible();
  await expect(editor.getByText("첫 번째 노트")).toBeVisible();
  const openedA = (await controls(page)).snapshot?.shared.windows.find((item) => item.app_id === "md-editor");
  expect(openedA?.state.current_file).toBe("notes/a.md");

  await page.setViewportSize({ width: 960, height: 600 });
  await screenshot(page, "md-editor-invariant-narrow-before-others.png");
  await page.setViewportSize({ width: 1440, height: 900 });

  await raiseExplorer(page, explorer);
  await explorer.getByRole("button", { name: "b.md" }).dblclick();
  await expect(editor.getByText("두 번째 노트")).toBeVisible();
  const afterB = (await controls(page)).snapshot?.shared.windows.filter((item) => item.app_id === "md-editor") ?? [];
  expect(afterB).toHaveLength(1);
  expect(afterB[0].id).toBe(openedA?.id);
  expect(afterB[0].state.current_file).toBe("notes/b.md");
  const invariantBefore = await editor.locator(".ks-file-tree").screenshot();

  await raiseExplorer(page, explorer);
  await explorer.getByRole("button", { name: "images" }).click();
  await explorer.getByRole("button", { name: "cover.png" }).dblclick();
  const noOpeners = page.getByRole("menuitem", { name: "열 수 있는 앱이 없습니다" });
  await expect(noOpeners).toBeVisible();
  await expect(noOpeners).toBeDisabled();
  await page.keyboard.press("Escape");

  await explorer.getByRole("button", { name: "a.md" }).click({ button: "right" });
  const appOpenMenu = page.getByRole("menu");
  await expect(appOpenMenu).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "마크다운 편집기" })).toBeVisible();
  const appOpenPlacement = await page.evaluate(() => {
    const anchor = document.querySelector<HTMLElement>('[data-file-path="notes/a.md"] button');
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
  const invariantAfter = await editor.locator(".ks-file-tree").screenshot();
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

test("keeps the last file open menu inside a 720x600 viewport", async ({ page }) => {
  await mkdir(artifactDir, { recursive: true });
  await page.setViewportSize({ width: 720, height: 600 });
  await page.goto("/harness.html?bottom-menu");

  const explorer = page.getByTestId("app-window-explorer");
  await expect(explorer).toBeVisible();
  await explorer.getByRole("button", { name: "볼 폴더 고르기" }).click();
  const files = explorer.locator("[data-file-path]");
  await expect(files).toHaveCount(30);
  const list = explorer.locator(".ks-file-tree-list");
  await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const lastFile = explorer.getByRole("button", { name: "z29.md" });
  await lastFile.scrollIntoViewIfNeeded();
  await expect(lastFile).toBeVisible();
  await expect.poll(() => list.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1)).toBe(true);

  await lastFile.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(page.getByRole("menuitem", { name: "마크다운 편집기" })).toBeVisible();
  const placement = await page.evaluate(() => {
    const anchor = document.querySelector<HTMLElement>('[data-file-path="z29.md"] button');
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
