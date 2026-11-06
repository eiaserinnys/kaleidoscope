import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?core=http://127.0.0.1:7420");
});

test("많은 창에서도 양 끝 조작을 고정하고 창 목록만 스크롤한다", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  for (let index = 0; index < 20; index += 1) {
    await page.locator(".ks-taskbar").getByRole("button", { name: "앱 열기" }).click();
    await page.getByRole("dialog", { name: "앱 열기" }).getByRole("button", { name: "계산기" }).click();
    await expect(page.getByTestId("app-window-calculator")).toHaveCount(index + 1);
  }
  await expect(page.locator(".ks-taskbar-window")).toHaveCount(20);
  for (const width of [1440, 600]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.locator(".ks-taskbar").evaluate((bar) => {
      const list = bar.querySelector<HTMLElement>(".ks-taskbar-windows")!;
      const buttons = [...bar.querySelectorAll<HTMLElement>(":scope > .ks-icon-button")];
      return { overflow: list.scrollWidth > list.clientWidth, fixed: buttons.every((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth;
      }) };
    });
    expect(metrics).toEqual({ overflow: true, fixed: true });
    await page.screenshot({ path: testInfo.outputPath(`taskbar-many-${width}.png`) });
  }
  for (let index = 0; index < 20; index += 1) {
    await page.getByTestId("app-window-calculator").last().getByRole("button", { name: "창 닫기" }).click();
    await expect(page.getByTestId("app-window-calculator")).toHaveCount(19 - index);
  }
});

test("전체 최대화는 설정을 포함한 창의 실제 겹침 순서를 지킨다", async ({ page }) => {
  for (const name of ["계산기", "마크다운 편집기"]) {
    await page.locator(".ks-taskbar").getByRole("button", { name: "앱 열기" }).click();
    await page.getByRole("dialog", { name: "앱 열기" }).getByRole("button", { name, exact: true }).click();
  }
  const taskbar = page.locator(".ks-taskbar");
  await page.locator(".ks-shell-bar").getByRole("button", { name: "설정", exact: true }).click();
  await taskbar.getByRole("button", { name: "마크다운 편집기" }).click();
  const a = page.getByTestId("app-window-calculator");
  const b = page.getByTestId("app-window-md-editor");
  const settings = page.getByTestId("system-window-settings");
  const ordered = async () => page.evaluate(() => {
    const windows = ["app-window-calculator", "system-window-settings", "app-window-md-editor"].map((id) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!);
    return windows.sort((left, right) => Number(getComputedStyle(left).zIndex) - Number(getComputedStyle(right).zIndex)
      || (left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)).map((element) => element.dataset.testid);
  });
  const expected = ["app-window-calculator", "system-window-settings", "app-window-md-editor"];
  await expect.poll(ordered).toEqual(expected);
  await taskbar.getByRole("button", { name: "계산기" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "창 최소화" }).click();
  await expect(a).toHaveAttribute("data-minimized", "true");
  await taskbar.getByRole("button", { name: "모든 창 최대화" }).click();
  await expect(a).toHaveAttribute("data-minimized", "false");
  await expect(b).toHaveAttribute("data-maximized", "true");
  await expect(settings).toHaveAttribute("data-maximized", "true");
  await expect.poll(ordered).toEqual(expected);
  const visibleStack = await page.evaluate(() => {
    const area = document.querySelector<HTMLElement>(".ks-desktop-area")!.getBoundingClientRect();
    const b = document.querySelector<HTMLElement>('[data-testid="app-window-md-editor"]')!;
    const settings = document.querySelector<HTMLElement>('[data-testid="system-window-settings"]')!;
    const atPoint = () => document.elementFromPoint(area.left + area.width / 2, area.top + area.height / 2)?.closest<HTMLElement>(".ks-window")?.dataset.testid;
    const top = atPoint();
    b.style.visibility = "hidden";
    const middle = atPoint();
    settings.style.visibility = "hidden";
    const bottom = atPoint();
    b.style.visibility = "";
    settings.style.visibility = "";
    return [bottom, middle, top];
  });
  expect(visibleStack).toEqual(expected);
  await taskbar.getByRole("button", { name: "설정" }).click();
  const previousZ = await b.evaluate((element) => Number(getComputedStyle(element).zIndex));
  await taskbar.getByRole("button", { name: "모든 창 최대화" }).click();
  await expect.poll(() => b.evaluate((element) => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(previousZ);
  await expect.poll(ordered).toEqual(["app-window-calculator", "app-window-md-editor", "system-window-settings"]);
  await settings.getByRole("button", { name: "창 닫기" }).click();
  for (const [name, window] of [["계산기", a], ["마크다운 편집기", b]] as const) {
    const item = taskbar.getByRole("button", { name });
    if (await item.getAttribute("data-state") !== "active") await item.click();
    await expect(item).toHaveAttribute("data-state", "active");
    await window.getByRole("button", { name: "창 닫기" }).click();
    await expect(window).toHaveCount(0);
  }
});

test("작업 표시줄에서 창을 복원하고 최대화와 이전 크기로 전환한다", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".ks-taskbar")).toHaveCount(1);
  await page.locator(".ks-taskbar").getByRole("button", { name: "앱 열기" }).click();
  await page.getByRole("dialog", { name: "앱 열기" }).getByRole("button", { name: "계산기" }).click();

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
  expect(titlebarIcons.every(({ width }) => width === "14")).toBe(true);
  expect(titlebarIcons.some(({ className }) => className?.split(" ").includes("lucide-minus"))).toBe(true);
  expect(titlebarIcons.some(({ className }) => className?.split(" ").includes("lucide-minimize-2"))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("window-maximized-1440x900.png") });

  await page.setViewportSize({ width: 960, height: 600 });
  const wideNarrowMetrics = await page.evaluate(() => {
    const area = document.querySelector(".ks-desktop-area")?.getBoundingClientRect();
    const appWindow = document.querySelector<HTMLElement>('[data-testid="app-window-calculator"]')?.getBoundingClientRect();
    const taskbar = document.querySelector<HTMLElement>(".ks-taskbar")?.getBoundingClientRect();
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
  await page.locator(".ks-taskbar").getByRole("button", { name: "앱 열기" }).click();
  await page.getByRole("dialog", { name: "앱 열기" }).getByRole("button", { name: "계산기" }).click();

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
