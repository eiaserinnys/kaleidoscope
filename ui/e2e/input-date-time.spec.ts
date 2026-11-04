import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const run = (page: Page, label: string, action: Record<string, unknown>) => page.evaluate(async ({ label, action }) => {
  const api = (window as any).inputDateTimeHarness;
  const view = api.read();
  const line = view.text.split("\n").find((item: string) => item.includes(label) && /^\[\d+\]/.test(item));
  if (!line) throw new Error(`번호 없음: ${label}\n${view.text}`);
  return api.act(view.view_id, { ...action, target: Number(line.match(/^\[(\d+)\]/)[1]) });
}, { label, action });

test("날짜 키보드와 같이 보기 입력, 좁은 창의 팝업 위치", async ({ page }) => {
  const output = process.env.KS_DATE_TIME_CAPTURE_DIR;
  if (output) mkdirSync(output, { recursive: true });
  for (const [width, theme] of [[1200, "light"], [360, "dark"]] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/?preview=input-date-time-fixture");
    const app = page.getByTestId("app-window-input-date-time-fixture");
    const input = app.getByRole("textbox", { name: "날짜", exact: true });
    await expect(input).toBeVisible();
    if (output) await page.screenshot({ path: join(output, `입력-${width}-${theme}.png`) });
    await input.focus(); await input.press("Alt+ArrowDown");
    const dialog = page.getByRole("dialog", { name: "날짜" });
    await expect(dialog).toBeVisible();
    const [fieldBox, dialogBox] = await Promise.all([input.boundingBox(), dialog.boundingBox()]);
    const gap = await input.evaluate((element) => parseFloat(getComputedStyle(element).getPropertyValue("--ks-space-2")));
    expect(dialogBox!.y - (fieldBox!.y + fieldBox!.height)).toBe(gap);
    if (output) await page.screenshot({ path: join(output, `달력-${width}-${theme}.png`) });
    await page.keyboard.press("ArrowRight"); await page.keyboard.press("Enter");
    await expect(input).toBeFocused();
    await app.getByRole("button", { name: "저장" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).inputDateTimeHarness.state().saved)).toBe("2026-11-21");
    expect((await run(page, "날짜", { kind: "type", mode: "replace", text: "2026-11-23" })).applied).toBe(true);
    expect((await run(page, "저장", { kind: "click" })).applied).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).inputDateTimeHarness.state().saved)).toBe("2026-11-23");
    await page.evaluate(() => (window as any).inputDateTimeHarness.hold("2026-11-24"));
    await input.fill("2026-11-24");
    await app.getByRole("button", { name: "저장" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).inputDateTimeHarness.waiting())).toBe(true);
    expect(await page.evaluate(() => (window as any).inputDateTimeHarness.state().saved)).toBe("2026-11-23");
    await page.evaluate(() => (window as any).inputDateTimeHarness.release());
    await expect.poll(() => page.evaluate(() => (window as any).inputDateTimeHarness.state().saved)).toBe("2026-11-24");
    await app.getByRole("combobox", { name: "시간", exact: true }).focus();
    await expect(page.getByRole("listbox")).toBeVisible();
    if (output) await page.screenshot({ path: join(output, `시간-${width}-${theme}.png`) });
  }
});

test("화면 아래 날짜 칸의 달력은 위로 열린다", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 500 });
  await page.goto("/?preview=input-date-time-fixture");
  const input = page.getByRole("textbox", { name: "마감일" });
  await input.evaluate((element) => element.scrollIntoView({ block: "end" }));
  await input.focus();
  await input.press("Alt+ArrowDown");
  const dialog = page.getByRole("dialog", { name: "마감일" });
  await expect(dialog).toBeVisible();
  const [fieldBox, dialogBox] = await Promise.all([input.boundingBox(), dialog.boundingBox()]);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(fieldBox!.y);
  if (process.env.KS_DATE_TIME_CAPTURE_DIR) await page.screenshot({ path: join(process.env.KS_DATE_TIME_CAPTURE_DIR, "달력-위로-360.png") });
});

test("같이 보기 창 조작으로 달력과 날짜를 누른다", async ({ page }) => {
  await page.goto("/?preview=input-date-time-fixture");
  await expect(page.getByRole("textbox", { name: "날짜", exact: true })).toBeVisible();
  expect((await run(page, "날짜 선택", { kind: "click" })).applied).toBe(true);
  await expect(page.getByRole("dialog", { name: "날짜" })).toBeVisible();
  expect((await run(page, "2026년 11월 22일", { kind: "click" })).applied).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).inputDateTimeHarness.state().date)).toBe("2026-11-22");
});

test("범위 원천을 기다려도 아래 칸이 움직이지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/?preview=input-date-time-fixture&bounds-delay=6000");
  const app = page.getByTestId("app-window-input-date-time-fixture");
  const input = app.getByRole("textbox", { name: "연결 범위" });
  const field = app.locator(".ks-data-stack-item").filter({ has: input });
  const below = app.getByRole("textbox", { name: "아래 칸" });
  await expect(input).toBeVisible();
  await expect(field.getByRole("status")).toHaveCount(0);
  const before = await below.boundingBox();
  await input.focus(); await input.press("Alt+ArrowDown");
  const day = page.getByRole("dialog", { name: "연결 범위" }).getByRole("button", { name: "2026년 11월 18일" });
  await expect(day).toBeEnabled();
  await expect(day).toBeDisabled({ timeout: 12000 });
  expect((await below.boundingBox())!.y).toBe(before!.y);
});

test("날짜 단추와 입력칸의 정렬을 넓은 창과 좁은 창에서 잰다", async ({ page }) => {
  const metrics: Record<string, unknown> = {};
  for (const width of [1200, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/?preview=input-date-time-fixture");
    const input = page.getByRole("textbox", { name: "날짜", exact: true });
    await expect(input).toBeVisible();
    const values = await input.evaluate((element) => {
      const button = element.parentElement!.querySelector("button")!;
      const field = element.getBoundingClientRect(), icon = button.getBoundingClientRect();
      const time = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
      return { field: { left: field.left, right: field.right, top: field.top, bottom: field.bottom }, button: { left: icon.left, right: icon.right, top: icon.top, bottom: icon.bottom }, fieldFont: getComputedStyle(element).fontSize, timeFont: getComputedStyle(time).fontSize };
    });
    expect(values.button.right).toBeLessThan(values.field.right);
    expect(values.button.left).toBeGreaterThan(values.field.left);
    expect(Math.abs((values.button.top + values.button.bottom - values.field.top - values.field.bottom) / 2)).toBeLessThanOrEqual(1);
    expect(values.fieldFont).toBe(values.timeFont);
    metrics[String(width)] = values;
  }
  if (process.env.KS_DATE_TIME_CAPTURE_DIR) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(process.env.KS_DATE_TIME_CAPTURE_DIR, "정렬.json"), JSON.stringify(metrics, null, 2));
  }
});
