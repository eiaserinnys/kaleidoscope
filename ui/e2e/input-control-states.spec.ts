import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test("분할 선택은 남는 자리에서 여백을 유지하고 좁은 칸에서는 여백부터 줄인다", async ({ page }) => {
  await page.goto("/?preview=input-control-states");
  const app = page.getByTestId("app-window-input-control-states");
  const group = app.getByRole("group", { name: "긴 이름표 테스트" });
  // 창 폭과 독립적으로 이름표가 붙은 실제 필드의 칸을 좁힌다.
  const resize = async (width: number) => group.evaluate((el, width) => {
    (el.parentElement as HTMLElement).style.width = `${width}px`;
  }, width);
  const measure = () => group.getByRole("button").evaluateAll((buttons) => buttons.map((button) => {
    const label = button.querySelector(".ks-truncate-label")!;
    return { inset: label.getBoundingClientRect().left - button.getBoundingClientRect().left,
      visible: label.clientWidth, full: label.scrollWidth };
  }));
  // 남는 폭의 가운데 정렬과 분리해 분할 자체의 자연 너비와 여백을 검증한다.
  await group.evaluate(el => { el.style.flexGrow = "0"; });
  await resize(400);
  const wide = await measure();
  for (const label of wide) { expect(label.inset).toBeCloseTo(13, 0); expect(label.visible).toBeGreaterThanOrEqual(label.full); }
  const natural = await group.evaluate((el) => el.getBoundingClientRect().width);
  await resize(natural - 16);
  const narrow = await measure();
  for (const label of narrow) { expect(label.inset).toBeLessThan(13); expect(label.visible).toBeGreaterThanOrEqual(label.full); }
  expect(await group.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(natural);
  await resize(136);
  for (const label of await measure()) expect(label.visible).toBeGreaterThan(0);
});

test("글 없는 분할 단추는 여백 자리를 더하지 않아 아이콘 폭을 유지한다", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
  await page.goto("/?preview=html-report");
  const app = page.getByTestId("app-window-html-report");
  await app.getByRole("button", { name: "고르기" }).click();
  const measure = (buttons: Element[]) => buttons.map((button) => {
    const style = getComputedStyle(button);
    const icon = button.querySelector("svg")!.getBoundingClientRect().width;
    return { width: button.getBoundingClientRect().width, before: getComputedStyle(button, "::before").content,
      minimum: Math.max(parseFloat(style.minWidth) || 0, icon + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)) };
  });
  const faces = await app.locator(".ks-html-header-faces .ks-button").evaluateAll(measure);
  expect(faces).toHaveLength(2);
  for (const face of faces) { expect(face.before).toBe("none"); expect(face.width).toBeCloseTo(face.minimum, 0); }
  await page.close();
});

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
  for (const button of await segments.all()) { await button.click(); await expect(button).toHaveAttribute("aria-pressed", "true"); }
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

test("읽기 전용 결과와 잠긴 부속 단추가 두 테마에서 구분된다", async ({ page }) => {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 880, height: 900 });
    await page.goto("/?preview=input-control-review");
    const app = page.getByTestId("app-window-input-control-review");
    const open = app.getByRole("textbox", { name: "열림", exact: true });
    const result = app.getByRole("textbox", { name: "결과", exact: true });
    const style = async (field: typeof open) => field.evaluate((el) => {
      const css = getComputedStyle(el);
      return { color: css.color, background: css.backgroundColor, border: css.borderLeftColor,
        textInset: parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft) };
    });
    const opened = await style(open);
    const readOnly = await style(result);
    expect(readOnly.color).toBe(opened.color);
    expect(readOnly.textInset).toBe(opened.textInset);
    expect(readOnly.background).toBe("rgba(0, 0, 0, 0)");
    expect(readOnly.border).toBe("rgba(0, 0, 0, 0)");
    await open.focus();
    await page.keyboard.press("Tab");
    await expect(result).toBeFocused();
    expect(await result.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
    const box = (await result.boundingBox())!;
    await page.mouse.move(box.x + 12, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 12, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    const selected = await result.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]);
    expect(selected[1]!).toBeGreaterThan(selected[0]!);
    for (const [label, selector] of [["읽기 숫자", ".ks-number-spin"], ["읽기 날짜", ".ks-data-input-clear"], ["읽기 검색", ".ks-data-input-clear"]] as const) {
      await expect(app.getByLabel(label, { exact: true }).locator("..").locator(selector)).toBeHidden();
    }
    for (const label of ["읽기 시간", "읽기 선택지"]) await expect(app.getByLabel(label, { exact: true })).toHaveAttribute("readonly", "");
    for (const name of ["늘리기", "줄이기", "날짜 선택", "지우기"]) {
      const button = app.getByRole("button", { name, exact: true });
      await expect(button).toBeDisabled();
      await expect(button).toHaveCSS("opacity", "1");
    }
  }
});

test("이름표가 있는 분할 선택지가 좁은 구역 안에 머문다", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto("/?preview=input-control-review");
  const app = page.getByTestId("app-window-input-control-review");
  const group = app.getByRole("group", { name: "포트 범위" });
  const field = group.locator("..");
  const geometry = await field.evaluate((el) => {
    const section = el.closest(".ks-data-section-child")!;
    const content = section.getBoundingClientRect();
    const root = el.getBoundingClientRect();
    const group = el.querySelector(".ks-data-segmented")!;
    return { sectionScroll: section.scrollWidth, sectionWidth: section.clientWidth,
      fieldLeft: root.left, fieldRight: root.right, contentLeft: content.left, contentRight: content.right,
      groupScroll: group.scrollWidth, groupWidth: group.clientWidth,
      buttons: [...group.querySelectorAll("button")].map((button) => { const rect = button.getBoundingClientRect(); return { left: rect.left, right: rect.right }; }) };
  });
  expect(geometry.fieldLeft).toBeGreaterThanOrEqual(geometry.contentLeft - 1);
  expect(geometry.fieldRight).toBeLessThanOrEqual(geometry.contentRight + 1);
  expect(geometry.sectionScroll).toBeLessThanOrEqual(geometry.sectionWidth + 1);
  expect(geometry.groupScroll).toBeLessThanOrEqual(geometry.groupWidth + 1);
  for (const box of geometry.buttons) expect(box.right).toBeLessThanOrEqual(geometry.contentRight + 1);
  const label = field.locator(".ks-field-label");
  await expect(label).toHaveCSS("word-break", "keep-all");
  await expect(label).toHaveCSS("overflow-wrap", "break-word");
  for (const button of await group.getByRole("button").all()) { await button.click(); await expect(button).toHaveAttribute("aria-pressed", "true"); }
});
