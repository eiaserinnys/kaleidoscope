import { expect, test } from "@playwright/test";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("opens, edits, autosaves, and reads a markdown file in both app definitions", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByTestId("app-window-md-editor");
  const viewer = page.getByTestId("app-window-md-viewer");

  await editor.getByRole("button", { name: "문서 폴더 고르기" }).click();
  await viewer.getByRole("button", { name: "읽을 폴더 고르기" }).click();
  await editor.getByRole("button", { name: "README.md" }).click();
  await viewer.getByRole("button", { name: "README.md" }).click();

  const editorContent = editor.locator(".cm-content");
  await expect(editorContent).toContainText("첫 문서");
  await editorContent.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nPlaywright 자동 저장 확인");

  const filePanel = page.getByTestId("fake-files-panel");
  await filePanel.locator("summary").click();
  await expect(filePanel).toContainText("Playwright 자동 저장 확인", { timeout: 5_000 });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(viewer.locator(".ks-markdown-view")).toContainText("Playwright 자동 저장 확인");
});

test("captures empty and opened views at both sizes and color schemes", async ({ browser }, testInfo) => {
  const viewports = [
    { width: 1280, height: 800, label: "wide" },
    { width: 900, height: 700, label: "narrow" },
  ];
  const themes = ["light", "dark"] as const;

  for (const viewport of viewports) {
    for (const colorScheme of themes) {
      const context = await browser.newContext({ viewport, colorScheme });
      const page = await context.newPage();
      const label = `${viewport.label}-${colorScheme}`;
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "kaleidoscope" })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`${label}-folder-unselected.png`),
        fullPage: true,
      });

      const editor = page.getByTestId("app-window-md-editor");
      const viewer = page.getByTestId("app-window-md-viewer");
      await editor.getByRole("button", { name: "문서 폴더 고르기" }).click();
      await viewer.getByRole("button", { name: "읽을 폴더 고르기" }).click();
      await editor.getByRole("button", { name: "Kaleidoscope.md" }).click();
      await viewer.getByRole("button", { name: "Kaleidoscope.md" }).click();
      await expect(editor.locator(".cm-content")).toContainText("kaleidoscope 작업 메모");
      await expect(viewer.locator(".ks-markdown-view")).toContainText("진행 중인 일");
      await page.screenshot({
        path: testInfo.outputPath(`${label}-file-open.png`),
        fullPage: true,
      });
      await context.close();
    }
  }
});
