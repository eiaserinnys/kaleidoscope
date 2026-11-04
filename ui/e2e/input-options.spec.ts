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
      return { list: { x: list.x, y: list.y, right: list.right, bottom: list.bottom }, description: { x: description.x, y: description.y, right: description.right, bottom: description.bottom }, input: { x: input.x, right: input.right } };
    });
    expect(width === 360 ? layout.description.y >= layout.list.bottom : layout.description.x >= layout.list.right).toBe(true);
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
