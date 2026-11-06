import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?core=http://127.0.0.1:7420");
});

test.describe("125% 화면 배율", () => {
  test.use({ deviceScaleFactor: 1.25, viewport: { width: 600, height: 900 } });

  test("목록 끝까지 스크롤하면 오른쪽 페이드가 꺼진다", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const bar = page.locator(".ks-taskbar");
    const list = bar.locator(".ks-taskbar-windows");
    const windows = page.getByTestId("app-window-calculator");
    for (let count = 1; count <= 5; count += 1) {
      await bar.getByRole("button", { name: "앱 열기" }).click();
      await page.getByRole("dialog", { name: "앱 열기" }).getByRole("button", { name: "계산기", exact: true }).click();
      await expect(windows).toHaveCount(count);
    }
    await list.hover();
    await page.mouse.wheel(0, -10000);
    await expect(list).toHaveAttribute("data-fade-start", "false");
    await expect(list).toHaveAttribute("data-fade-end", "true");
    await page.mouse.wheel(0, 10000);
    await expect(list).toHaveAttribute("data-fade-start", "true");
    await expect(list).toHaveAttribute("data-fade-end", "false");
    const metrics = await list.evaluate((element) => ({
      deviceScaleFactor: window.devicePixelRatio, scrollLeft: element.scrollLeft,
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      remaining: element.scrollWidth - element.clientWidth - element.scrollLeft,
      fadeEnd: element.getAttribute("data-fade-end"),
    }));
    expect(metrics.deviceScaleFactor).toBe(1.25);
    expect(metrics.scrollLeft).toBeGreaterThan(1);
    expect(Math.abs(metrics.remaining)).toBeLessThanOrEqual(1);
    console.log("125% 목록 끝 측정", JSON.stringify(metrics));
    await testInfo.attach("125-percent-end", { body: JSON.stringify(metrics), contentType: "application/json" });
    await page.screenshot({ path: testInfo.outputPath("125-percent-end.png") });
    for (let count = 5; count > 0; count -= 1) {
      await windows.last().getByRole("button", { name: "창 닫기" }).click();
      await expect(windows).toHaveCount(count - 1);
    }
  });
});

test("목록 가장자리 페이드는 실제 스크롤과 폭과 창 수를 따른다", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const bar = page.locator(".ks-taskbar");
  const list = bar.locator(".ks-taskbar-windows");
  const windows = page.getByTestId("app-window-calculator");
  const fade = async (start: boolean, end: boolean) => {
    await expect(list).toHaveAttribute("data-fade-start", String(start));
    await expect(list).toHaveAttribute("data-fade-end", String(end));
    expect(await list.evaluate((element) => getComputedStyle(element).maskImage === "none")).toBe(!start && !end);
  };
  const shot = async (name: string) => {
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  };
  for (let count = 1; count <= 20; count += 1) {
    await bar.getByRole("button", { name: "앱 열기" }).click();
    await page.getByRole("dialog", { name: "앱 열기" }).getByRole("button", { name: "계산기", exact: true }).click();
    await expect(windows).toHaveCount(count);
    if (count === 5 || count === 20) {
      for (const width of count === 5 ? [600, 360] : [1440]) {
        await page.setViewportSize({ width, height: 900 });
        await list.hover();
        await page.mouse.wheel(0, -10000);
        await fade(false, true);
        await shot(`fade-${count}-${width}-start`);
        await page.mouse.wheel(0, 60);
        await fade(true, true);
        await shot(`fade-${count}-${width}-middle`);
        await page.mouse.wheel(0, 10000);
        await fade(true, false);
        await shot(`fade-${count}-${width}-end`);
      }
      if (count === 5) {
        await page.setViewportSize({ width: 1440, height: 900 });
        await fade(false, false);
        await shot("fade-five-no-overflow");
      }
    }
  }
  // 맨 위 창 변경의 scrollIntoView 뒤에도 끝의 알약은 마스크되지 않는다.
  await page.keyboard.press("Control+Alt+Tab");
  await expect(list.locator(".ks-taskbar-item").first()).toHaveAttribute("data-state", "active");
  await fade(false, true);
  await page.keyboard.press("Control+Alt+Shift+Tab");
  await expect(list.locator(".ks-taskbar-item").last()).toHaveAttribute("data-state", "active");
  await fade(true, false);
  const activeOutsideFade = () => list.evaluate((element) => {
    const row = element.getBoundingClientRect();
    const active = element.querySelector<HTMLElement>('[data-state="active"]')!.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(element).getPropertyValue("--ks-space-5"));
    const atStart = element.scrollLeft <= 1;
    const atEnd = element.scrollWidth - element.clientWidth - element.scrollLeft <= 1;
    return {
      left: atStart || active.left - row.left >= padding - 1,
      right: atEnd || row.right - active.right >= padding - 1,
    };
  });
  // 양 끝 항목은 예외이고, 중간 항목은 페이드가 켜진 쪽에서 토큰 폭만큼 떨어진다.
  for (const direction of ["Control+Alt+Tab", "Control+Alt+Shift+Tab"]) {
    for (let step = 0; step < 20; step += 1) {
      await page.keyboard.press(direction);
      const index = direction === "Control+Alt+Tab" ? step : 18 - step;
      await expect(list.locator(".ks-taskbar-item").nth((index + 20) % 20)).toHaveAttribute("data-state", "active");
      await expect.poll(activeOutsideFade).toEqual({ left: true, right: true });
    }
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("fade-twenty-dark-active-end");
  await page.emulateMedia({ colorScheme: "light" });
  for (let count = 20; count > 0; count -= 1) {
    const lastItem = list.locator(".ks-taskbar-item").last();
    if (await lastItem.getAttribute("data-state") !== "active") await lastItem.click();
    await expect(lastItem).toHaveAttribute("data-state", "active");
    await windows.last().getByRole("button", { name: "창 닫기" }).click();
    await expect(windows).toHaveCount(count - 1);
  }
  await fade(false, false);
});

test("막대 단추에 Tab으로 들어가면 초점 고리가 안쪽 여백에 들어간다", async ({ page }, testInfo) => {
  const settings = page.locator(".ks-shell-bar").getByRole("button", { name: "설정", exact: true });
  await settings.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(settings).toBeFocused();
  await expect(settings).toHaveCSS("outline-offset", "2px");
  const launcher = page.locator(".ks-taskbar").getByRole("button", { name: "앱 열기" });
  await launcher.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(launcher).toBeFocused();
  const metrics = await launcher.evaluate((element) => {
    const style = getComputedStyle(element);
    const button = element.getBoundingClientRect();
    const bar = element.closest(".ks-taskbar")!.getBoundingClientRect();
    const ring = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    return { visible: element.matches(":focus-visible"), offset: style.outlineOffset,
      top: button.top - ring - bar.top, bottom: bar.bottom - button.bottom - ring };
  });
  expect(metrics).toEqual({ visible: true, offset: "0px", top: 2, bottom: 2 });
  await page.screenshot({ path: testInfo.outputPath("focus-taskbar.png") });
  const bar = await page.locator(".ks-taskbar").boundingBox();
  if (!bar) throw new Error("작업 표시줄을 찾지 못했습니다");
  await page.screenshot({ path: testInfo.outputPath("focus-taskbar-detail.png"), clip: { x: bar.x, y: bar.y - 4, width: 120, height: bar.height + 8 } });
});

test("창 수가 달라도 같은 자리를 연속으로 눌러 데스크톱을 순환한다", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const bar = page.locator(".ks-taskbar");
  const launcher = bar.getByRole("button", { name: "앱 열기" });
  for (let index = 0; index < 3; index += 1) {
    await launcher.click();
    await page.getByRole("dialog", { name: "앱 열기" }).getByRole("button", { name: "계산기" }).click();
    await expect(page.getByTestId("app-window-calculator")).toHaveCount(index + 1);
  }
  await page.getByRole("button", { name: "데스크톱 추가" }).click();
  const first = page.getByRole("button", { name: "데스크톱 1", exact: true });
  const second = page.getByRole("button", { name: "데스크톱 2", exact: true });
  await expect(second).toHaveAttribute("aria-pressed", "true");
  const next = bar.getByRole("button", { name: "다음 데스크톱" });
  const nextBefore = await next.boundingBox();
  const launchBefore = await launcher.boundingBox();
  if (!nextBefore || !launchBefore) throw new Error("작업 표시줄 단추를 찾지 못했습니다");
  await page.screenshot({ path: testInfo.outputPath("two-desktops-empty.png") });
  await page.mouse.move(nextBefore.x + nextBefore.width / 2, nextBefore.y + nextBefore.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  const nextAfter = await next.boundingBox();
  const launchAfter = await launcher.boundingBox();
  if (!nextAfter || !launchAfter) throw new Error("전환 후 작업 표시줄 단추를 찾지 못했습니다");
  await page.screenshot({ path: testInfo.outputPath("two-desktops-three-windows.png") });
  await page.mouse.down();
  await page.mouse.up();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  expect(nextAfter.x).toBe(nextBefore.x);
  expect(launchAfter.x).toBe(launchBefore.x);
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  const windows = page.getByTestId("app-window-calculator");
  for (let remaining = 3; remaining > 0; remaining -= 1) {
    await expect(windows.last()).toHaveAttribute("data-minimized", "false");
    await windows.last().getByRole("button", { name: "창 닫기" }).click();
    await expect(windows).toHaveCount(remaining - 1);
  }
});

test("팔레트 간격과 막대 단추를 맞추고 넘치는 창은 세로 휠로 스크롤한다", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const bar = page.locator(".ks-taskbar");
  const launcher = bar.getByRole("button", { name: "앱 열기" });
  const defaultIcon = page.locator(".ks-shell-bar").getByRole("button", { name: "설정", exact: true });
  const defaultStyle = await defaultIcon.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.width, height: style.height, radius: style.borderRadius };
  });
  expect(defaultStyle).toEqual({ width: "28px", height: "28px", radius: "8px" });
  await launcher.click();
  const popup = page.getByRole("dialog", { name: "앱 열기" });
  const [barRect, popupRect, launcherRect] = await Promise.all([bar.boundingBox(), popup.boundingBox(), launcher.boundingBox()]);
  if (!barRect || !popupRect || !launcherRect) throw new Error("팔레트나 작업 표시줄을 찾지 못했습니다");
  expect.soft(barRect.y - popupRect.y - popupRect.height).toBe(8);
  expect.soft(popupRect.x).toBe(launcherRect.x);
  await page.screenshot({ path: testInfo.outputPath("palette.png") });
  await page.keyboard.press("Escape");
  await expect(launcher).toBeFocused();
  for (let index = 0; index < 5; index += 1) {
    await launcher.click();
    await popup.getByRole("button", { name: "계산기" }).click();
    await expect(page.getByTestId("app-window-calculator")).toHaveCount(index + 1);
  }
  expect.soft(await bar.getByRole("button", { name: "모든 창 최소화" }).locator("svg").getAttribute("class")).toContain("lucide-minus");
  for (const width of [600, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await bar.evaluate((element) => {
      const list = element.querySelector<HTMLElement>(".ks-taskbar-windows")!;
      const item = list.querySelector<HTMLElement>(".ks-taskbar-item")!;
      const icon = element.querySelector<HTMLElement>(".ks-app-launcher-button")!;
      const itemRect = item.getBoundingClientRect();
      const iconRect = icon.getBoundingClientRect();
      return {
        itemCenter: itemRect.top + itemRect.height / 2,
        iconCenter: iconRect.top + iconRect.height / 2,
        itemHeight: itemRect.height,
        iconHeight: iconRect.height,
        itemRadius: getComputedStyle(item).borderRadius,
        iconRadius: getComputedStyle(icon).borderRadius,
        itemWidth: itemRect.width,
        scrollbar: getComputedStyle(list).scrollbarWidth,
        scrollbarDisplay: getComputedStyle(list, "::-webkit-scrollbar").display,
      };
    });
    expect.soft(metrics.itemCenter).toBe(metrics.iconCenter);
    expect.soft(metrics.itemHeight).toBe(metrics.iconHeight);
    expect.soft(metrics.itemRadius).toBe(metrics.iconRadius);
    expect.soft(metrics.itemWidth).toBeGreaterThanOrEqual(104);
    expect.soft(metrics.itemWidth).toBeLessThan(160);
    expect.soft(metrics.scrollbar).toBe("none");
    expect.soft(metrics.scrollbarDisplay).toBe("none");
    await page.screenshot({ path: testInfo.outputPath(`five-windows-${width}.png`) });
    const list = bar.locator(".ks-taskbar-windows");
    await list.hover();
    await page.mouse.wheel(0, -5000);
    await expect.poll(() => list.evaluate((element) => element.scrollLeft)).toBe(0);
    await page.mouse.wheel(0, 120);
    await expect.poll(() => list.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  }
  const windows = page.getByTestId("app-window-calculator");
  for (let remaining = 5; remaining > 0; remaining -= 1) {
    await windows.last().getByRole("button", { name: "창 닫기" }).click();
    await expect(windows).toHaveCount(remaining - 1);
  }
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
      const item = list.querySelector<HTMLElement>(".ks-taskbar-item")!.getBoundingClientRect();
      return { overflow: list.scrollWidth > list.clientWidth, aligned: buttons.every((button) => {
        const rect = button.getBoundingClientRect();
        return Math.abs((rect.top + rect.height / 2) - (item.top + item.height / 2)) <= 1;
      }), scrollbar: getComputedStyle(list).scrollbarWidth, fixed: buttons.every((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth;
      }) };
    });
    expect(metrics).toEqual({ overflow: true, aligned: true, scrollbar: "none", fixed: true });
    await page.screenshot({ path: testInfo.outputPath(`taskbar-many-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".ks-taskbar").getByRole("button", { name: "앱 열기" }).click();
  await page.getByRole("dialog", { name: "앱 열기" }).getByRole("button", { name: "계산기" }).click();
  await expect(page.getByTestId("app-window-calculator")).toHaveCount(21);
  const list = page.locator(".ks-taskbar-windows");
  const activeItemVisible = () => list.evaluate((element) => {
    const active = element.querySelector<HTMLElement>('[data-state="active"]');
    if (!active) return false;
    const row = element.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    return item.left >= row.left && item.right <= row.right;
  });
  await expect.poll(activeItemVisible).toBe(true);
  await page.keyboard.press("Control+Alt+Tab");
  await expect(list.locator(".ks-taskbar-item").first()).toHaveAttribute("data-state", "active");
  await expect.poll(activeItemVisible).toBe(true);
  for (let index = 0; index < 21; index += 1) {
    const lastItem = list.locator(".ks-taskbar-item").last();
    if (await lastItem.getAttribute("data-state") !== "active") await lastItem.click();
    await expect(lastItem).toHaveAttribute("data-state", "active");
    await page.getByTestId("app-window-calculator").last().getByRole("button", { name: "창 닫기" }).click();
    await expect(page.getByTestId("app-window-calculator")).toHaveCount(20 - index);
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
  const wideNarrowMetrics = () => page.evaluate(() => {
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
  await expect.poll(wideNarrowMetrics).toEqual({ left: 12, top: 12, right: 12, taskbarGap: 12 });
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

test("작업 표시줄 창 항목은 탭 너비 토큰과 높이를 차지하지 않는 스크롤을 쓴다", async ({ page }) => {
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
  expect(taskbarStyles.scrollbarWidth).toBe("none");
  expect(taskbarStyles.scrollbarDisplay).toBe("none");
  expect(taskbarStyles.maxWidth).toBe(taskbarStyles.expectedMaxWidth);
});
