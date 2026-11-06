import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test("입력 상태와 고르기 및 분할선이 구분되고 잠긴 조작은 실행되지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/?preview=input-control-states");
  const app = page.getByTestId("app-window-input-control-states");
  const open = app.getByRole("textbox", { name: "열림", exact: true });
  const readOnly = app.getByRole("textbox", { name: "결과", exact: true });
  const disabled = app.getByRole("textbox", { name: "잠김", exact: true });
  const empty = app.getByRole("textbox", { name: "빈 열림", exact: true });
  const emptyDisabled = app.getByRole("textbox", { name: "빈 잠김", exact: true });
  await expect(disabled).toBeDisabled();
  await expect(emptyDisabled).toBeDisabled();
  await expect(readOnly).toHaveAttribute("readonly", "");
  const styles = async (field: typeof open) => field.evaluate((el) => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor, opacity: getComputedStyle(el.parentElement!).opacity }));
  expect((await styles(readOnly)).color).toBe((await styles(open)).color);
  expect((await styles(readOnly)).background).toBe("rgba(0, 0, 0, 0)");
  expect((await styles(disabled)).opacity).toBe("0.56");
  expect((await styles(emptyDisabled)).background).toBe((await styles(empty)).background);
  for (const field of [disabled, emptyDisabled]) {
    const box = (await field.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await field.evaluate((el) => el === document.activeElement)).toBe(false);
  }
  await page.keyboard.type("변경");
  await expect(disabled).toHaveValue("같은 값");
  await expect(emptyDisabled).toHaveValue("");
  await expect(app.getByRole("spinbutton", { name: "잠긴 숫자" })).toBeDisabled();
  for (const name of ["늘리기", "줄이기", "날짜 선택", "지우기"]) {
    const button = app.getByRole("button", { name });
    await expect(button).toBeDisabled();
    const box = (await button.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await expect(app.getByRole("spinbutton", { name: "잠긴 숫자" })).toHaveValue("3");
  await expect(app.getByRole("dialog")).toHaveCount(0);
  await expect(app.getByRole("textbox", { name: "잠긴 검색" })).toHaveValue("찾기");

  const select = app.getByRole("button", { name: "선택됨" });
  const blankSelect = app.getByRole("button", { name: "선택 전" });
  const selectStyle = await select.evaluate((el) => ({ gap: getComputedStyle(el).gap, space: getComputedStyle(el).getPropertyValue("--ks-space-2").trim() }));
  expect(selectStyle.gap).toBe(selectStyle.space);
  await expect(blankSelect.locator(".ks-select-choice-label")).toBeHidden();
  expect((await blankSelect.boundingBox())!.width).toBeGreaterThan((await blankSelect.locator("svg").boundingBox())!.width);
  const group = app.getByRole("group", { name: "긴 이름표 테스트" });
  const segments = group.getByRole("button");
  await expect(segments).toHaveCount(4);
  for (const button of await segments.all()) {
    expect(await button.locator(".ks-truncate-label").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await group.evaluate((el) => { (el as HTMLElement).style.maxWidth = "160px"; });
  const bounds = await group.evaluate((el) => {
    const group = el.getBoundingClientRect();
    return [...el.querySelectorAll("button")].map((button) => {
      const box = button.getBoundingClientRect();
      return { left: box.left - group.left, right: box.right - group.right };
    });
  });
  for (const box of bounds) { expect(box.left).toBeGreaterThanOrEqual(-1); expect(box.right).toBeLessThanOrEqual(1); }
  for (const button of await segments.all()) { await button.click(); await expect(button).toHaveAttribute("aria-pressed", "true"); }
  await group.evaluate((el) => { (el as HTMLElement).style.maxWidth = ""; });
  await expect(app.locator(".ks-field-label").filter({ hasText: "긴 이름표" })).toHaveCSS("word-break", "keep-all");

  const separator = app.getByRole("separator");
  await app.getByRole("textbox", { name: "잠긴 날짜" }).evaluate((el) => (el as HTMLElement).focus());
  await page.keyboard.press("Tab");
  // 분할선은 직접 Tab 순서로 들어가 초점 표시를 확인한다.
  for (let i = 0; i < 20 && !(await separator.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(separator).toBeFocused();
  await expect(separator).toHaveCSS("outline-style", "none");
  expect(await separator.evaluate((el) => getComputedStyle(el, "::after").backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  const output = process.env.KS_INPUT_CONTROL_CAPTURE_DIR;
  if (output) { mkdirSync(output, { recursive: true }); await app.screenshot({ path: join(output, "states-wide.png") }); }
});
