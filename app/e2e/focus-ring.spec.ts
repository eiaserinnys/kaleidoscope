import { expect as baseExpect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { coreUrl } from "./runtime.ts";
const expect = baseExpect.configure({ timeout: 30_000 });

type FocusState = { window: string | null; tag: string; role: string | null; ring: boolean };

// 쉘이 대신 옮긴 초점이 지금 어디에 있고, 브라우저가 그 요소에 :focus-visible을 주는지 읽는다.
const focusState = (page: Page) => page.evaluate((): FocusState => {
  const element = document.activeElement as HTMLElement | null;
  const frame = element?.closest<HTMLElement>("[data-testid^='app-window-']");
  return {
    window: frame?.getAttribute("data-testid") ?? null,
    tag: element?.tagName ?? "",
    role: element?.getAttribute("role") ?? null,
    ring: element?.matches(":focus-visible") ?? false,
  };
});

test.describe("입력 방식에 따른 초점 링", () => {
  test.setTimeout(240_000);

  test("키보드를 쓰지 않고 연 창은 초점이 있어도 링을 그리지 않는다", async ({ page }, testInfo) => {
    await page.goto("/harness.html?app-icons&window=explorer");
    await expect(page.getByTestId("app-window-explorer")).toBeVisible();
    await expect.poll(async () => {
      const state = await focusState(page);
      return `${state.window}:${state.role}`;
    }).toBe("app-window-explorer:option");
    const entry = await focusState(page);
    await testInfo.attach("entry-focus", { body: JSON.stringify(entry), contentType: "application/json" });
    expect(entry.ring).toBe(false);
    await page.screenshot({ path: testInfo.outputPath("entry-no-ring.png") });

    // 화살표로 옮긴 초점에는 링이 보인다.
    await page.keyboard.press("ArrowDown");
    await expect.poll(async () => {
      const state = await focusState(page);
      return `${state.window}:${state.role}:${state.ring}`;
    }).toBe("app-window-explorer:option:true");
    await page.screenshot({ path: testInfo.outputPath("after-arrow.png") });
  });

  test("키보드로 고른 앱의 창은 초점 링을 그린다", async ({ page }, testInfo) => {
    await page.goto(`/?core=${coreUrl}`);
    const bar = page.locator(".ks-taskbar");
    await expect(bar.getByRole("button", { name: "앱 열기" })).toBeEnabled();
    await bar.getByRole("button", { name: "앱 열기" }).click();
    const dialog = page.getByRole("dialog", { name: "앱 열기" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "계산기", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("app-window-calculator")).toBeVisible();
    await expect.poll(async () => (await focusState(page)).window).toBe("app-window-calculator");
    const opened = await focusState(page);
    await testInfo.attach("keyboard-opened-focus", { body: JSON.stringify(opened), contentType: "application/json" });
    expect(opened.ring).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("keyboard-opened-ring.png") });
  });

  test("내용 칸이 없는 창도 초점은 받고 링은 그리지 않는다", async ({ page }, testInfo) => {
    await page.goto("/harness.html?window=calculator");
    await expect(page.getByTestId("app-window-calculator")).toBeVisible();
    await expect.poll(async () => (await focusState(page)).window).toBe("app-window-calculator");
    const entry = await focusState(page);
    await testInfo.attach("no-content-focus", { body: JSON.stringify(entry), contentType: "application/json" });
    expect(entry.ring).toBe(false);
    await page.screenshot({ path: testInfo.outputPath("no-content-no-ring.png") });
  });
});
