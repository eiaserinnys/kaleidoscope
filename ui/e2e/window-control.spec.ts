import { expect, test } from "@playwright/test";

test("다른 창의 초안과 선택을 유지하며 입력, 메뉴와 탭을 조작한다", async ({ page }) => {
  await page.goto("/window-control.html");
  await expect(page.getByRole("button", { name: "실행" })).toBeVisible();
  const other = page.getByLabel("다른 창");
  await other.click(); await other.fill("미확정 초안");
  await other.evaluate((input: HTMLInputElement) => input.setSelectionRange(1, 4));
  const run = async (label: string, action: Record<string, unknown>) => page.evaluate(async ({ label, action }) => {
    const api = (window as any).controlHarness;
    const view = api.read();
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const target = Number(view.text.match(new RegExp(`\\[(\\d+)\\] [^\\n]*${escaped}`))?.[1]);
    return api.act(view.view_id, { ...action, target });
  }, { label, action });
  expect((await run("실행", { kind: "click" })).applied).toBe(true);
  expect((await run("대상 입력", { kind: "type", text: "바뀐 글", mode: "replace" })).applied).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).controlHarness.state().text)).toBe("바뀐 글");
  expect((await run("종류", { kind: "select", choice: { by: "value", value: "둘" } })).applied).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).controlHarness.state().selected)).toBe("둘");
  expect((await run("표시", { kind: "click" })).applied).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).controlHarness.state().enabled)).toBe(true);
  expect((await run("둘째 탭", { kind: "click" })).applied).toBe(true);
  await expect(page.getByText("둘째 내용")).toBeVisible();
  expect((await run("대상 입력", { kind: "key", key: "Enter" })).applied).toBe(true);
  expect(await other.inputValue()).toBe("미확정 초안");
  expect(await other.evaluate((input: HTMLInputElement) => [document.activeElement === input, input.selectionStart, input.selectionEnd])).toEqual([true, 1, 4]);
  expect(await page.evaluate(() => (window as any).controlHarness.blurCommits)).toBe(0);
  await page.screenshot({ path: "test-results/window-control-focus.png" });
});
