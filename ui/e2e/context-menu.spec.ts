import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/context-menu.html");
});

for (const [label, original, cut, selection] of [
  ["글", "abcde", "cde", "ab"], ["숫자", "12345", "345", "12"], ["메일", "abcde@example.com", "cde@example.com", "ab"],
]) {
  test(`${label}의 부분 선택 잘라내기와 붙여넣기`, async ({ page }) => {
    const input = page.getByLabel(label, { exact: true });
    await input.focus();
    await page.keyboard.press("Home"); await page.keyboard.press("Shift+ArrowRight"); await page.keyboard.press("Shift+ArrowRight");
    await input.click({ button: "right", position: { x: 8, y: 10 } });
    await page.getByRole("menuitem", { name: "잘라내기" }).click();
    await expect(input).toHaveValue(cut);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(selection);
    await page.keyboard.press("ContextMenu");
    await page.getByRole("menuitem", { name: "붙여넣기" }).click();
    await expect(input).toHaveValue(original);
  });
}

test("키보드로 연 입력 메뉴와 모두 선택", async ({ page }) => {
  const input = page.getByLabel("글", { exact: true });
  await input.focus(); await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "모두 선택" }).click();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("abcde");
  await page.keyboard.press("ContextMenu");
  await page.getByRole("menuitem", { name: "복사" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("abcde");
});

test("실제 블록 입력의 변경이 상태에 반영된다", async ({ page }) => {
  await page.goto("/?preview=shell-selection-test");
  const input = page.getByTestId("app-window-shell-selection-test").locator("textarea");
  await input.fill("abcde");
  await input.focus(); await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowRight"); await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("ContextMenu");
  await page.getByRole("menuitem", { name: "잘라내기" }).click();
  await expect(input).toHaveValue("cde");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("ab");
  await page.keyboard.press("ContextMenu");
  await page.getByRole("menuitem", { name: "붙여넣기" }).click();
  await expect(input).toHaveValue("abcde");
  await input.blur();
  await expect(input).toHaveValue("abcde");
});

test("코드 편집기에 붙여넣고 읽는 글의 선택을 복사한다", async ({ page }) => {
  await page.evaluate(() => navigator.clipboard.writeText("새 글"));
  const editor = page.locator(".cm-content");
  await editor.click(); await page.keyboard.press("Control+End");
  await editor.click({ button: "right" });
  await page.getByRole("menuitem", { name: "붙여넣기" }).click();
  await expect(editor).toContainText("편집기 원본새 글");
  const reading = page.locator("#reading");
  await reading.evaluate((element) => { const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
  await reading.click({ button: "right", position: { x: 8, y: 10 } });
  await expect(page.getByRole("menuitem")).toHaveCount(1);
  await page.getByRole("menuitem", { name: "복사" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("읽는 글을 선택합니다.");
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await reading.click({ button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);
});

for (const title of ["HTML 문서", "샌드박스"]) {
  test(`${title}에서 선택한 글 복사`, async ({ page }) => {
    const frame = page.frameLocator(`iframe[title="${title}"]`);
    const paragraph = frame.locator("#frame-text");
    await expect(paragraph).toBeVisible();
    await paragraph.evaluate((element) => { const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
    await paragraph.click({ button: "right" });
    await page.getByRole("menuitem", { name: "복사" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("프레임에서 고를 글입니다.");
  });
}

for (const [name, width, height] of [["wide", 1100, 760], ["narrow", 520, 720]] as const) {
  test(`${name} 메뉴 화면 캡처`, async ({ page }) => {
    const directory = process.env.KS_CONTEXT_CAPTURE_DIR ?? resolve(process.cwd(), "../../../.local/artifacts/context-menu/20261104-0100");
    await page.setViewportSize({ width, height });
    const input = page.getByLabel("글", { exact: true });
    await input.click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    if (directory) { mkdirSync(directory, { recursive: true }); await page.screenshot({ path: join(directory, `${name}-input.png`) }); }
    await page.keyboard.press("Escape");
    const reading = page.locator("#reading");
    await reading.evaluate((element) => { const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
    await reading.click({ button: "right", position: { x: 8, y: 10 } });
    await expect(page.getByRole("menuitem", { name: "복사" })).toBeVisible();
    if (directory) await page.screenshot({ path: join(directory, `${name}-reading.png`) });
    await page.goto("/context-menu.html?title=1");
    await page.locator(".ks-window-titlebar").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "창 닫기" })).toBeVisible();
    if (directory) await page.screenshot({ path: join(directory, `${name}-title.png`) });
  });
}
