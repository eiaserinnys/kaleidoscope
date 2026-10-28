import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const docsDir = process.env.KALEIDOSCOPE_E2E_DOCS;

test.beforeEach(async ({ page }) => {
  await page.goto("/?core=http://127.0.0.1:7420");
});

test("creates desktops, edits files, imports an app, and rejects an outside path", async ({ page }, testInfo) => {
  if (!docsDir) throw new Error("KALEIDOSCOPE_E2E_DOCS is required");

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

  await expect(page.getByText("열린 앱이 없습니다")).toBeVisible();
  await captureMatrix("empty-desktop");
  await page.getByRole("button", { name: "작업 1" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await captureMatrix("workspace-menu");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "데스크톱 추가" }).click();
  await page.getByRole("button", { name: "앱 열기" }).first().click();
  const appMenu = page.getByRole("menu");
  const appMenuBounds = await appMenu.boundingBox();
  if (!appMenuBounds) throw new Error("앱 메뉴의 위치를 확인하지 못했습니다");
  expect(appMenuBounds.x + appMenuBounds.width).toBeLessThanOrEqual(1440);
  await page.screenshot({ path: testInfo.outputPath("apps-menu-1440x900-light.png") });
  await page.getByRole("menuitem", { name: "마크다운 편집기" }).click();

  const editorWindow = page.getByTestId("app-window-md-editor");
  await editorWindow.getByRole("button", { name: "문서 폴더 고르기" }).click();
  await editorWindow.getByRole("button", { name: "a.md" }).click();
  const editor = editorWindow.getByRole("textbox", { name: "마크다운 편집기" });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nE2E saved");
  await expect.poll(async () => readFile(path.join(docsDir, "a.md"), "utf8")).toContain("E2E saved");

  const titlebar = editorWindow.locator(".ks-window-titlebar");
  const box = await titlebar.boundingBox();
  if (!box) throw new Error("편집기 창 제목 줄을 찾지 못했습니다");
  await page.mouse.move(box.x + 80, box.y + 16);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 76);
  await page.mouse.up();
  const movedBox = await editorWindow.boundingBox();
  if (!movedBox) throw new Error("편집기 창 위치를 확인하지 못했습니다");

  await page.getByRole("button", { name: "데스크톱 1" }).click();
  await page.getByRole("button", { name: "데스크톱 2" }).click();
  await expect(editor).toContainText("E2E saved");
  await page.reload();
  await expect(page.getByRole("button", { name: "데스크톱 2" })).toHaveAttribute("aria-pressed", "true");
  await expect(editorWindow).toHaveCSS("left", `${Math.round(movedBox.x)}px`);
  await expect(editor).toContainText("E2E saved");

  const viewerPath = path.join(root, "examples/md-viewer.json");
  await page.locator('input[type="file"]').setInputFiles(viewerPath);
  const viewerWindow = page.getByTestId("app-window-md-viewer");
  await expect(viewerWindow).toBeVisible();
  await viewerWindow.getByRole("button", { name: "읽을 폴더 고르기" }).click();
  await viewerWindow.getByRole("button", { name: "a.md" }).click();
  await expect(viewerWindow.locator(".ks-markdown-view")).toContainText("E2E saved");

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
});
