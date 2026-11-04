import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test("숫자 입력 화면 비교", async ({ page }) => {
  const output = process.env.KS_SPIN_CAPTURE_DIR;
  const phase = process.env.KS_SPIN_CAPTURE_PHASE ?? "after";
  const measurements: Record<string, unknown> = {};
  if (output) mkdirSync(output, { recursive: true });
  for (const [width, theme] of [[1200, "light"], [1200, "dark"], [360, "dark"]] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/?preview=input-spin-test");
    const app = page.getByTestId("app-window-input-spin-test");
    const amount = app.getByRole("spinbutton", { name: "금액" });
    const count = app.getByRole("spinbutton", { name: "수량" });
    await expect(count).toBeVisible();
    const spin = app.getByRole("spinbutton", { name: "조정" });
    const up = spin.locator("..").getByRole("button", { name: "늘리기" });
    const down = spin.locator("..").getByRole("button", { name: "줄이기" });
    await expect(up).toHaveAttribute("tabindex", "-1");
    await expect(down).toHaveAttribute("tabindex", "-1");
    await expect(up).toHaveAttribute("title", "");
    await expect(down).toHaveAttribute("title", "");
    if (output) await app.screenshot({ path: join(output, `idle-${width}-${theme}.png`) });
    await down.hover();
    await page.waitForTimeout(600);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    const geometry = await spin.evaluate((node) => {
      const field = node.getBoundingClientRect();
      const buttons = node.parentElement!.querySelectorAll<HTMLButtonElement>(".ks-number-spin button");
      const up = buttons[0].getBoundingClientRect(), down = buttons[1].getBoundingClientRect();
      const centers = [...buttons].map((button) => {
        const rect = button.getBoundingClientRect();
        const icon = button.querySelector("svg")!.getBoundingClientRect();
        return (icon.top + icon.bottom - rect.top - rect.bottom) / 2;
      });
      return { top: up.top - field.top, bottom: field.bottom - down.bottom, end: field.right - up.right, centers };
    });
    for (const inset of [geometry.top, geometry.bottom, geometry.end]) expect(inset).toBeCloseTo(2, 1);
    for (const offset of geometry.centers) expect(Math.abs(offset)).toBeLessThanOrEqual(0.5);
    if (output) await app.screenshot({ path: join(output, `hover-down-${width}-${theme}.png`) });
    await page.mouse.down();
    if (output) await app.screenshot({ path: join(output, `pressed-down-${width}-${theme}.png`) });
    await page.mouse.up();
    await up.hover();
    if (output) await app.screenshot({ path: join(output, `hover-up-${width}-${theme}.png`) });
    await page.mouse.down();
    if (output) await app.screenshot({ path: join(output, `pressed-up-${width}-${theme}.png`) });
    await page.mouse.up();
    const current = { amount: (await amount.boundingBox())!, count: (await count.boundingBox())! };
    const limited = app.getByRole("spinbutton", { name: "한도" });
    expect((await limited.boundingBox())!.width - current.count.width).toBeCloseTo(30, 1);
    measurements[`${width}-${theme}`] = { ...current, geometry };
    if (output) await app.screenshot({ path: join(output, `${phase}-${width}-${theme}.png`) });
    await app.getByRole("spinbutton", { name: "조정" }).focus();
    if (output) await app.screenshot({ path: join(output, `${phase}-focus-${width}-${theme}.png`) });
    await page.keyboard.press("Tab");
    await expect(app.getByRole("spinbutton", { name: "빈 값" })).toBeFocused();
  }
  if (output) writeFileSync(join(output, `${phase}-metrics.json`), JSON.stringify(measurements, null, 2));
});

test("소수점 뒤에 멈췄다가 이어 치고 지워도 숫자 초안이 유지된다", async ({ page }) => {
  await page.goto("/?preview=input-spin-test");
  const app = page.getByTestId("app-window-input-spin-test");
  const field = app.getByRole("spinbutton", { name: "빈 값" });
  await field.focus();
  await page.keyboard.type("1.");
  await page.waitForTimeout(700);
  await expect(field).toHaveValue("1.");
  const output = process.env.KS_SPIN_CAPTURE_DIR;
  if (output) await app.screenshot({ path: join(output, "typing-decimal.png") });
  await page.keyboard.type("5");
  await page.waitForTimeout(700);
  await expect(field).toHaveValue("1.5");
  await field.fill("150");
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(700);
  await page.keyboard.type("7");
  await expect(field).toHaveValue("17");
  if (output) writeFileSync(join(output, "typing-results.json"), JSON.stringify({ decimal: "1.5", backspace: await field.inputValue() }, null, 2));
});

test("누르고 놓은 스핀은 마지막 값만 보내고 바로 누른 동작은 새 값을 쓴다", async ({ page }) => {
  await page.goto("/?preview=input-spin-test");
  const app = page.getByTestId("app-window-input-spin-test");
  const field = app.getByRole("spinbutton", { name: "조정" });
  const up = field.locator("..").getByRole("button", { name: "늘리기" });
  const calls = () => page.evaluate(() => (window as any).conversationHarness.calls().filter((call: any) => call.op === "data.act" && call.pointer?.endsWith("/on_change")));
  const initial = (await calls()).length;
  await up.hover();
  await page.mouse.down();
  await page.waitForTimeout(1000);
  const value = Number(await field.inputValue());
  expect(value).toBeGreaterThan(3);
  expect((await calls()).length).toBe(initial);
  await page.mouse.up();
  await expect.poll(async () => (await calls()).length).toBe(initial + 1);
  expect((await calls()).at(-1).event).toBe(value);
  await up.click();
  const next = Number(await field.inputValue());
  await app.getByRole("button", { name: "적용" }).click();
  const actions = () => page.evaluate(() => (window as any).conversationHarness.calls().filter((call: any) => call.op === "data.act"));
  await expect.poll(async () => (await actions()).some((call: any) => call.pointer.endsWith("/on_click"))).toBe(true);
  const ordered = await actions();
  const index = ordered.findIndex((call: any) => call.pointer.endsWith("/on_click"));
  expect(ordered.slice(0, index).at(-1).event).toBe(next);
  const max = app.getByRole("spinbutton", { name: "한도" }).locator("..");
  await expect(max.getByRole("button", { name: "늘리기" })).toBeDisabled();
  await expect(max.getByRole("button", { name: "줄이기" })).toBeEnabled();
  const locked = app.getByRole("spinbutton", { name: "읽기 전용" }).locator("..");
  await expect(locked.getByRole("button", { name: "늘리기" })).toBeDisabled();
  await expect(locked.getByRole("button", { name: "줄이기" })).toBeDisabled();
});

test("같이 보기의 키와 단추 조작은 각각 한 번 증감한다", async ({ page }) => {
  await page.goto("/window-control.html");
  await expect(page.getByRole("spinbutton", { name: "숫자 입력" })).toBeVisible();
  const run = (label: string, action: Record<string, unknown>) => page.evaluate(async ({ label, action }) => {
    const api = (window as any).controlHarness;
    const view = api.read();
    const target = Number(view.text.match(new RegExp(`\\[(\\d+)\\] [^\\n]*${label}`))?.[1]);
    return api.act(view.view_id, { ...action, target });
  }, { label, action });
  expect((await run("숫자 입력", { kind: "key", key: "ArrowUp" })).applied).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).controlHarness.state().number)).toBe(3);
  expect((await run("늘리기", { kind: "click" })).applied).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).controlHarness.state().number)).toBe(4);
  expect((await run("줄이기", { kind: "key", key: "Enter" })).applied).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).controlHarness.state().number)).toBe(3);
  expect((await run("줄이기", { kind: "key", key: "Space" })).applied).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).controlHarness.state().number)).toBe(2);
});

test("최대값에 도달해도 놓기 전에는 보내지 않는다", async ({ page }) => {
  await page.goto("/?preview=input-spin-test");
  const app = page.getByTestId("app-window-input-spin-test");
  const field = app.getByRole("spinbutton", { name: "조정" });
  const up = field.locator("..").getByRole("button", { name: "늘리기" });
  const calls = () => page.evaluate(() => (window as any).conversationHarness.calls().filter((call: any) => call.op === "data.act" && call.pointer?.endsWith("/on_change")));
  await field.fill("49");
  await expect.poll(async () => (await calls()).some((call: any) => call.event === 49)).toBe(true);
  const before = (await calls()).length;
  await up.hover(); await page.mouse.down();
  await expect(field).toHaveValue("50");
  await expect(up).toBeDisabled();
  await page.waitForTimeout(1000);
  expect((await calls()).length).toBe(before);
  await page.mouse.up();
  await expect.poll(async () => (await calls()).length).toBe(before + 1);
  expect((await calls()).at(-1).event).toBe(50);
});
