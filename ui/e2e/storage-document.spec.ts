import { expect, test } from "@playwright/test";

test("기본 문서 생성, 원격 갱신과 충돌 선택", async ({ page }) => {
  await page.goto("/?preview=storage-document");
  const app = page.getByTestId("app-window-storage-document");
  const editor = app.locator(".cm-content");
  const view = app.locator(".ks-markdown-view");
  await expect(editor).toContainText("기본 문서");
  await expect(view).toContainText("기본 문서");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(" 첫 수정");
  await expect(view).toContainText("첫 수정", { timeout: 5000 });
  await page.getByRole("button", { name: "다른 기기에서 수정" }).click();
  await expect(editor).toContainText("다른 기기의 문서");
  await expect(view).toContainText("다른 기기의 문서");

  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(" 내 초안");
  await page.getByRole("button", { name: "다른 기기에서 수정" }).click();
  await expect(editor).toContainText("내 초안");
  await expect(app.getByRole("button", { name: "다시 불러오기" })).toBeVisible({ timeout: 5000 });
  await expect(app.getByRole("alert").filter({ hasText: "다른 곳에서 바뀌었습니다" })).toBeVisible();
  await app.getByRole("button", { name: "다시 불러오기" }).click();
  await expect(editor).not.toContainText("내 초안");

  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(" 덮어쓴 초안");
  await page.getByRole("button", { name: "다른 기기에서 수정" }).click();
  await expect(app.getByRole("button", { name: "덮어쓰기" })).toBeVisible({ timeout: 5000 });
  await app.getByRole("button", { name: "덮어쓰기" }).click();
  await expect(view).toContainText("덮어쓴 초안");
});
