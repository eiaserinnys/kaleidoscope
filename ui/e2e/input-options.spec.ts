import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const run = (page: Page, label: string, action: Record<string, unknown>) => page.evaluate(async ({ label, action }) => {
  const api = (window as any).inputOptionsHarness;
  const view = api.read();
  const line = view.text.split("\n").find((item: string) => item.includes(label) && /^\[\d+\]/.test(item));
  if (!line) throw new Error(`번호 없음: ${label}\n${view.text}`);
  return api.act(view.view_id, { ...action, target: Number(line.match(/^\[(\d+)\]/)[1]) });
}, { label, action });

test("긴 선택지를 걸러 선택하고 창 조작과 입력 순서를 지킨다", async ({ page }) => {
  const output = process.env.KS_INPUT_OPTIONS_CAPTURE_DIR;
  const metrics: Record<string, unknown> = {};
  if (output) mkdirSync(output, { recursive: true });
  for (const [width, theme] of [[1200, "light"], [360, "dark"]] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/?preview=input-options-fixture");
    const app = page.getByTestId("app-window-input-options-fixture");
    const input = app.getByRole("combobox", { name: "목록 전용" });
    await expect(input).toBeVisible();
    await input.focus();
    await expect(page.getByRole("listbox")).toBeVisible();
    expect(await page.getByRole("option").count()).toBeLessThan(100);
    const initialBox = await page.locator(".ks-combobox-list").boundingBox();
    await input.press("ArrowUp");
    await expect(page.locator(".ks-combobox-description")).toHaveCount(0);
    await expect(page.locator(".ks-combobox-separator")).toHaveCount(0);
    expect(await page.locator(".ks-combobox-list").boundingBox()).toMatchObject({ x: initialBox!.x, width: initialBox!.width });
    await input.press("ArrowDown");
    await page.locator(".ks-combobox-option").first().hover();
    await input.press("ArrowDown");
    expect(await page.locator(".ks-combobox-option").evaluateAll((rows) => rows.filter((row) => getComputedStyle(row).backgroundImage !== "none").length)).toBe(1);
    if (output) await page.screenshot({ path: join(output, `전체-${width}-${theme}.png`) });
    const before = await page.evaluate(() => (window as any).inputOptionsHarness.calls().length);
    await input.fill("zom");
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => (window as any).inputOptionsHarness.calls().length)).toBe(before);
    await input.press("ArrowDown");
    const activeId = await input.getAttribute("aria-activedescendant");
    expect(activeId && await page.locator(`[id="${activeId}"]`).count()).toBe(1);
    const description = page.locator(".ks-combobox-description");
    await expect(description).toContainText("긴 설명");
    const layout = await page.evaluate(() => {
      const list = document.querySelector(".ks-combobox-list")!.getBoundingClientRect();
      const description = document.querySelector(".ks-combobox-description")!.getBoundingClientRect();
      const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!.getBoundingClientRect();
      const popup = document.querySelector(".ks-combobox-popup")!.getBoundingClientRect();
      return { list: { x: list.x, y: list.y, width: list.width, right: list.right, bottom: list.bottom }, description: { x: description.x, y: description.y, width: description.width, right: description.right, bottom: description.bottom }, input: { x: input.x, width: input.width, right: input.right }, popup: { x: popup.x, y: popup.y, bottom: popup.bottom } };
    });
    expect(width === 360 ? layout.description.y >= layout.list.bottom : layout.description.x >= layout.list.right).toBe(true);
    expect(Math.abs(layout.popup.x - layout.input.x)).toBeLessThan(1);
    expect(Math.abs(layout.list.width - layout.input.width)).toBeLessThan(1);
    metrics[`${width}-${theme}`] = layout;
    if (output) await page.screenshot({ path: join(output, `검색-설명-${width}-${theme}.png`) });
    await input.press("Enter");
    await app.getByRole("button", { name: "저장" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).inputOptionsHarness.state().saved)).toBe("entry-503");
    expect(await page.evaluate(() => (window as any).inputOptionsHarness.calls().filter((call: any) => call.pointer.endsWith("on_change")).length)).toBe(1);
    await input.focus();
    await input.fill("목록 밖 값");
    await expect(page.getByText("일치 없음")).toBeVisible();
    if (output) await page.screenshot({ path: join(output, `일치없음-${width}-${theme}.png`) });
    await input.blur();
    await expect(input).toHaveValue("entry-503");
    const free = app.getByRole("combobox", { name: "자유 입력" });
    const callsBeforeFree = await page.evaluate(() => (window as any).inputOptionsHarness.calls().length);
    await free.fill("임의의 이름");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).inputOptionsHarness.calls().length)).toBe(callsBeforeFree);
    await expect.poll(() => page.evaluate(() => (window as any).inputOptionsHarness.calls().length)).toBe(callsBeforeFree + 1);
    await free.blur();
    const select = app.getByRole("button", { name: "표시" });
    await select.click();
    await expect(page.getByText("첫째 선택지 설명")).toBeVisible();
    if (output) await page.screenshot({ path: join(output, `선택설명-${width}-${theme}.png`) });
    await page.keyboard.press("Escape");
    expect((await run(page, "목록 전용", { kind: "type", mode: "replace", text: "zom" })).applied).toBe(true);
    expect((await run(page, "목록 전용", { kind: "select", choice: { by: "label", value: "Zombie 마지막" } })).applied).toBe(true);
    expect((await run(page, "저장", { kind: "click" })).applied).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).inputOptionsHarness.state().saved)).toBe("entry-503");
  }
  if (output) writeFileSync(join(output, "metrics.json"), JSON.stringify(metrics, null, 2));
});

test("화면 아래에서 연 목록은 거른 뒤에도 입력 바로 위에 붙어 있다", async ({ page }) => {
  const output = process.env.KS_INPUT_OPTIONS_CAPTURE_DIR;
  const metrics: Record<string, unknown> = {};
  for (const [width, height, theme] of [[1200, 470, "light"], [360, 540, "dark"]] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width, height });
    await page.goto("/?preview=block-gallery");
    await page.getByTestId("app-window-block-gallery").getByRole("tab", { name: "입력" }).click();
    const input = page.getByRole("combobox", { name: "이름" });
    await input.scrollIntoViewIfNeeded();
    await input.focus();
    const popup = page.locator(".ks-combobox-popup");
    await expect(popup).toBeVisible();
    const before = { input: (await input.boundingBox())!, popup: (await popup.boundingBox())! };
    expect(before.popup.y + before.popup.height).toBeLessThan(before.input.y);
    await input.fill("배");
    await expect(page.getByRole("option", { name: "배" })).toBeVisible();
    const after = { input: (await input.boundingBox())!, popup: (await popup.boundingBox())! };
    expect(Math.abs((before.popup.y + before.popup.height) - (after.popup.y + after.popup.height))).toBeLessThan(1);
    expect(Math.abs(after.popup.x - after.input.x)).toBeLessThan(1);
    const gap = await input.evaluate((element) => Number.parseFloat(getComputedStyle(element).getPropertyValue("--ks-space-2")));
    expect(Math.abs(after.input.y - (after.popup.y + after.popup.height) - gap)).toBeLessThan(1);
    metrics[`${width}x${height}-${theme}`] = { before, after };
    if (output) await page.screenshot({ path: join(output, `아래쪽-${width}x${height}-${theme}.png`) });
  }
  if (output) writeFileSync(join(output, "bottom-metrics.json"), JSON.stringify(metrics, null, 2));
});

test("원천 선택지를 기다리는 화면과 잘못된 선택지 오류를 볼 수 있다", async ({ page }) => {
  const output = process.env.KS_INPUT_OPTIONS_CAPTURE_DIR;
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/?preview=input-options-fixture&options-delay=6000");
  const app = page.getByTestId("app-window-input-options-fixture");
  const loadingField = app.locator(".ks-data-stack-item").filter({ has: page.getByRole("combobox", { name: "연결 선택지" }) });
  await expect(loadingField.getByRole("status")).toHaveCount(0);
  const next = app.getByRole("combobox", { name: "잘못된 선택지" });
  const before = await next.boundingBox();
  if (output) await page.screenshot({ path: join(output, "원천-받기전.png") });
  await loadingField.getByRole("combobox").focus();
  await expect(page.getByRole("listbox").getByRole("status")).toBeVisible();
  expect(await page.locator(".ks-combobox-skeleton i").count()).toBe(3);
  if (output) await page.screenshot({ path: join(output, "원천-뼈대.png") });
  await expect(page.getByRole("option", { name: "첫째" })).toBeVisible();
  expect((await next.boundingBox())!.y).toBe(before!.y);
  if (output) {
    await page.screenshot({ path: join(output, "원천-받은뒤.png") });
    writeFileSync(join(output, "loading-metrics.json"), JSON.stringify({ before, after: await next.boundingBox() }));
  }
  await expect(app.getByText("SHELL_INPUT_OPTIONS_KEY_NOT_STRING")).toBeVisible();
  if (output) await page.screenshot({ path: join(output, "원천-불러오는중.png") });
});


test("세 선택지가 아래에 들어가고 스크롤 뒤에도 칸을 따른다", async ({ page }) => {
  const output = process.env.KS_INPUT_OPTIONS_CAPTURE_DIR;
  const metrics = [];
  for (const [width, theme] of [[1200, "light"], [360, "dark"]] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/?preview=block-gallery");
    await page.getByTestId("app-window-block-gallery").getByRole("tab", { name: "입력" }).click();
    const input = page.getByRole("combobox", { name: "이름" });
    await input.scrollIntoViewIfNeeded(); await input.focus();
    const popup = page.locator(".ks-combobox-popup");
    await expect(popup).toBeVisible();
    expect(await popup.evaluate((e) => e.classList.contains("is-above"))).toBe(false);
    const row = page.getByRole("option").first(); await row.hover();
    const boxes = { input: (await input.boundingBox())!, popup: (await popup.boundingBox())!, row: (await row.boundingBox())! };
    expect(boxes.row.x - boxes.popup.x).toBe(4);
    expect(boxes.popup.width).toBe(boxes.input.width);
    metrics.push({ width, theme, boxes, below: 800 - boxes.input.y - boxes.input.height });
    if (output) {
      await page.screenshot({ path: join(output, `이름-${width}.png`) });
      await popup.screenshot({ path: join(output, `행-확대-${width}.png`), scale: "css" });
    }
    await input.press("Escape");
  }
  await page.setViewportSize({ width: 1200, height: 470 });
  const input = page.getByRole("combobox", { name: "이름" });
  await input.blur(); await input.scrollIntoViewIfNeeded(); await input.focus();
  await input.hover(); await page.mouse.wheel(0, 80); await page.waitForTimeout(100);
  const i = (await input.boundingBox())!; const p = (await page.locator(".ks-combobox-popup").boundingBox())!;
  expect(Math.abs(i.x - p.x)).toBeLessThan(1);
  expect(Math.min(Math.abs(p.y - i.y - i.height - 8), Math.abs(i.y - p.y - p.height - 8))).toBeLessThan(1);
  if (output) {
    await page.screenshot({ path: join(output, "스크롤-1200x470.png") });
    writeFileSync(join(output, "fix2-metrics.json"), JSON.stringify({ metrics, scroll: { input: i, popup: p } }, null, 2));
  }
});
