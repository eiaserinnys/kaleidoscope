import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?core=http://127.0.0.1:7420");
});

test("작업 표시줄에서 창을 복원하고 최대화와 이전 크기로 전환한다", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".ks-taskbar")).toHaveCount(0);
  await page.locator(".ks-shell-bar").getByRole("button", { name: "앱 열기" }).click();
  await page.getByRole("menuitem", { name: "계산기" }).click();

  const window = page.getByTestId("app-window-calculator");
  const taskbarItem = page.locator(".ks-taskbar-window").filter({ hasText: "계산기" });
  await expect(page.locator(".ks-taskbar")).toHaveCount(1);
  await expect(window).toBeVisible();
  await expect(taskbarItem).toHaveAttribute("data-state", "active");

  await window.getByRole("button", { name: "창 최소화" }).click();
  await expect(window).toHaveAttribute("data-minimized", "true");
  await expect(page.locator(".ks-taskbar")).toHaveCount(1);
  await expect(taskbarItem).toHaveAttribute("data-state", "minimized");
  await taskbarItem.click({ button: "right" });
  const contextMenu = page.locator(".ks-menu");
  await expect(contextMenu).toBeVisible();
  const [taskbarBox, menuBox] = await Promise.all([taskbarItem.boundingBox(), contextMenu.boundingBox()]);
  if (!taskbarBox || !menuBox) throw new Error("작업 표시줄 메뉴 위치를 확인하지 못했습니다");
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(taskbarBox.y);
  await page.screenshot({ path: testInfo.outputPath("taskbar-context-menu-1440x900.png") });
  await page.keyboard.press("Escape");
  await expect(contextMenu).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("taskbar-minimized-1440x900.png") });

  await taskbarItem.click();
  await expect(window).toBeVisible();
  await expect(taskbarItem).toHaveAttribute("data-state", "active");

  await window.getByRole("button", { name: "창 최대화" }).click();
  await expect(window).toHaveAttribute("data-maximized", "true");
  await expect(window.locator(".ks-window-resize-east")).toHaveCount(0);
  const titlebarIcons = await window.locator(".ks-window-title-actions svg").evaluateAll((icons) => icons.map((icon) => ({ width: icon.getAttribute("width"), className: icon.getAttribute("class") })));
  expect(titlebarIcons.every(({ width }) => width === "18")).toBe(true);
  expect(titlebarIcons.some(({ className }) => className?.split(" ").includes("lucide-minus"))).toBe(true);
  expect(titlebarIcons.some(({ className }) => className?.split(" ").includes("lucide-minimize-2"))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("window-maximized-1440x900.png") });

  await page.setViewportSize({ width: 960, height: 600 });
  const wideNarrowMetrics = await page.evaluate(() => {
    const area = document.querySelector(".ks-desktop-area")?.getBoundingClientRect();
    const appWindow = document.querySelector<HTMLElement>('[data-testid="app-window-calculator"]')?.getBoundingClientRect();
    const taskbar = document.querySelector<HTMLElement>(".ks-desktop-canvas:not([hidden]) .ks-taskbar")?.getBoundingClientRect();
    if (!area || !appWindow || !taskbar) throw new Error("창 최대화 영역을 찾지 못했습니다");
    return {
      left: appWindow.left - area.left,
      top: appWindow.top - area.top,
      right: area.right - appWindow.right,
      taskbarGap: taskbar.top - appWindow.bottom,
    };
  });
  expect(wideNarrowMetrics).toEqual({ left: 12, top: 12, right: 12, taskbarGap: 12 });
  await page.screenshot({ path: testInfo.outputPath("window-maximized-960x600.png") });

  await window.getByRole("button", { name: "이전 크기로 복원" }).click();
  await expect(window).toHaveAttribute("data-maximized", "false");
  const titlebar = window.locator(".ks-window-titlebar");
  await titlebar.dblclick({ position: { x: 80, y: 16 } });
  await expect(window).toHaveAttribute("data-maximized", "true");
  await titlebar.dblclick({ position: { x: 80, y: 16 } });
  await expect(window).toHaveAttribute("data-maximized", "false");

  await taskbarItem.click();
  await expect(window).toHaveAttribute("data-minimized", "true");
  await expect(taskbarItem).toHaveAttribute("data-state", "minimized");
  await taskbarItem.click();
  await expect(window).toBeVisible();
  await expect(taskbarItem).toHaveAttribute("data-state", "active");
});

test("작업 표시줄 창 항목은 공통 스크롤바와 탭 너비 토큰을 쓴다", async ({ page }) => {
  await page.locator(".ks-shell-bar").getByRole("button", { name: "앱 열기" }).click();
  await page.getByRole("menuitem", { name: "계산기" }).click();

  const taskbarItem = page.locator('.ks-taskbar-window[data-state="active"]').filter({ hasText: "계산기" });
  await expect(taskbarItem).toBeVisible();
  const taskbarStyles = await taskbarItem.evaluate((item) => {
    const row = item.parentElement;
    if (!row) throw new Error("작업 표시줄 창 목록을 찾지 못했습니다");
    return {
      maxWidth: getComputedStyle(item).maxWidth,
      expectedMaxWidth: getComputedStyle(document.documentElement).getPropertyValue("--ks-desktop-tab-max-width").trim(),
      scrollbarWidth: getComputedStyle(row).scrollbarWidth,
      scrollbarDisplay: getComputedStyle(row, "::-webkit-scrollbar").display,
    };
  });
  expect(taskbarStyles.scrollbarWidth).not.toBe("none");
  expect(taskbarStyles.scrollbarDisplay).not.toBe("none");
  expect(taskbarStyles.maxWidth).toBe(taskbarStyles.expectedMaxWidth);
});
