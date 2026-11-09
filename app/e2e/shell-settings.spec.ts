import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { pathsFor, requiredRuntimeDir } from "./runtime.ts";

const { artifactsDir: captures } = pathsFor(requiredRuntimeDir());
const base = "/harness.html?preview=shell-settings";

test("설정 창을 열고 앱 창과 오가며 크기와 초점을 보존한다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}&link=connected`);
  await mkdir(captures, { recursive: true });
  await expect(page.locator(".ks-harness-webview")).toBeVisible();
  await page.screenshot({ path: `${captures}/desktop-before-1440.png` });
  const gear = page.locator(".ks-shell-bar").getByRole("button", { name: "설정", exact: true });
  await gear.click();
  const win = page.getByTestId("system-window-settings");
  await expect(win.locator(".ks-window-content")).toBeFocused();
  await expect(page.locator(".ks-desktop-area")).toBeVisible();
  await expect(win.getByText("https://eiaserinnys.me/kaleidoscope")).toBeVisible();
  await expect(win.getByText("AD02028236")).toBeVisible();
  await expect(win.locator(".ks-shell-settings").evaluate((el) => el.scrollHeight <= el.clientHeight)).resolves.toBe(true);
  await expect(page.locator(".ks-web-frozen-image")).toBeVisible();
  await expect(page.locator(".ks-harness-webview")).toHaveCount(0);
  await page.screenshot({ path: `${captures}/settings-default-1440.png` });
  const task = page.getByRole("toolbar", { name: "작업 표시줄" }).getByRole("button", { name: "설정", exact: true });
  await expect(task).toHaveAttribute("aria-pressed", "true");
  const app = page.locator("[data-testid=app-window-web-browser]");
  await app.locator(".ks-window-titlebar").click();
  await expect(task).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".ks-harness-webview")).toBeVisible();
  await page.screenshot({ path: `${captures}/web-window-on-top-1440.png` });
  await task.click();
  await expect(page.locator(".ks-harness-webview")).toHaveCount(0);
  await task.click(); await expect(win).toHaveAttribute("data-minimized", "true");
  await page.screenshot({ path: `${captures}/settings-minimized-1440.png` });
  await task.click(); await expect(win).toHaveAttribute("data-minimized", "false");
  await gear.click(); await expect(page.getByTestId("system-window-settings")).toHaveCount(1);
  await win.getByRole("button", { name: "창 최대화" }).click();
  await page.screenshot({ path: `${captures}/settings-maximized-1440.png` });
  const metrics = await page.evaluate(() => {
    const rect = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, centerY: (r.top + r.bottom) / 2 }; };
    return { column: rect(".ks-shell-settings-body"), group: rect(".ks-shell-settings h3"), label: rect(".ks-settings-row-label"), control: rect(".ks-settings-row-control > button"), select: rect(".ks-settings-row-select > button") };
  });
  await writeFile(`${captures}/metrics.json`, JSON.stringify(metrics, null, 2));
  expect(Math.abs(metrics.column.left - metrics.group.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.group.left - metrics.label.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.control.centerY - metrics.label.centerY)).toBeLessThanOrEqual(1);
  await win.getByRole("button", { name: "이전 크기로 복원" }).click();
  await app.locator(".ks-window-titlebar").click();
  await expect(task).toHaveAttribute("aria-pressed", "false");
  await task.click(); await expect(task).toHaveAttribute("aria-pressed", "true");
  await win.getByRole("button", { name: "창 닫기" }).click();
  await expect(gear).toBeFocused();
  await page.screenshot({ path: `${captures}/desktop-after-1440.png` });
});

test("최소 창에서 연결 상태와 결과를 확인한다", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await mkdir(captures, { recursive: true });
  for (const state of ["connected", "embedded", "pairing"]) {
    await page.goto(`${base}&link=${state}`);
    await page.locator(".ks-shell-bar").getByRole("button", { name: "설정", exact: true }).click();
    const win = page.getByTestId("system-window-settings");
    const corner = await win.locator(".ks-window-resize-east").boundingBox();
    if (!corner) throw new Error("크기 조절 손잡이를 찾지 못했습니다");
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
    await page.mouse.down(); await page.mouse.move(corner.x - 1000, corner.y + corner.height / 2); await page.mouse.up();
    expect(Math.round((await win.boundingBox())!.width)).toBe(360);
    expect(await win.locator(".ks-shell-settings").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `${captures}/narrow-${state}.png` });
    const measureFirstLine = () => win.locator(".ks-settings-row").first().evaluate((row) => {
      const label = row.querySelector(".ks-settings-row-label")!;
      const center = (rect: DOMRect) => (rect.top + rect.bottom) / 2;
      const text = [...label.children].find((element) => element.tagName === "SPAN" && element.classList.length === 0)!;
      const range = document.createRange(); range.selectNodeContents(text);
      const marks = [label.querySelector(".shell-server-dot"), label.querySelector("button"), row.querySelector(".ks-settings-row-control > button")]
        .filter((element): element is Element => element !== null).map((element) => center(element.getBoundingClientRect()));
      const lines = new Set([...label.querySelectorAll("span:not([aria-hidden]):not(.ks-accessible-hidden)")].flatMap((element) => [...element.getClientRects()].map((rect) => Math.round(rect.top))));
      return { line: center(range.getClientRects()[0]), marks, code: label.querySelector(".ks-pairing-code")?.getClientRects().length ?? 1, lines: lines.size };
    });
    const checkFirstLine = async () => {
      const firstLine = await measureFirstLine();
      for (const mark of firstLine.marks) expect(Math.abs(mark - firstLine.line)).toBeLessThanOrEqual(1);
      expect(firstLine.code).toBe(1);
      expect(firstLine.lines).toBeLessThanOrEqual(2);
    };
    await checkFirstLine();
    if (state === "pairing") {
      await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => undefined } }));
      await win.getByRole("button", { name: "코드 복사" }).click();
      await expect(win.locator('.ks-accessible-hidden[role="status"]')).toHaveText("복사했습니다");
      await expect(win.getByRole("button", { name: "코드 복사" }).locator(".lucide-check")).toHaveCount(1);
      await checkFirstLine();
    }
  }
  // 1440x900 기본 크기 창은 가져오기 결과까지 스크롤 없이 담는다. 스크롤이 생겨도 좌우 여백이 같은지 보려고 낮은 화면에서 연다.
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(`${base}&link=connected&transfer-skips&slow-link`);
  await page.locator(".ks-shell-bar").getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.getByText("가져오기 완료 3개")).toBeVisible();
  await page.screenshot({ path: `${captures}/transfer-success.png` });
  const gaps = await page.getByTestId("system-window-settings").locator(".ks-shell-settings").evaluate((element) => {
    const outer = element.getBoundingClientRect(); const body = element.querySelector(".ks-shell-settings-body")!.getBoundingClientRect();
    return { left: body.left - outer.left, right: outer.right - body.right, scrolls: element.scrollHeight > element.clientHeight };
  });
  expect(gaps.scrolls).toBe(true);
  expect(Math.abs(gaps.left - gaps.right)).toBeLessThanOrEqual(1);
  const transfer = page.getByRole("button", { name: "가져오기", exact: true });
  const before = await transfer.boundingBox(); await transfer.click();
  await expect(transfer).toHaveAttribute("aria-busy", "true");
  expect(await transfer.boundingBox()).toEqual(before);
  await page.screenshot({ path: `${captures}/transfer-busy.png` });
  await expect(transfer).not.toHaveAttribute("aria-busy", "true");
  await page.goto(`${base}&link=connected&transfer-skips&transfer-error`);
  await page.locator(".ks-shell-bar").getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.getByText("가져오지 못했습니다. 다시 시도하세요.")).toBeVisible();
  await expect(page.getByText("가져오기 완료 3개")).toHaveCount(0);
  await page.screenshot({ path: `${captures}/transfer-error.png` });
});

test("기본 에이전트를 고르고 비연결 이유를 확인한다", async ({ page }) => {
  await page.goto(`${base}&link=connected&slow-preferences`);
  await page.locator(".ks-shell-bar").getByRole("button", { name: "설정", exact: true }).click();
  const select = page.getByRole("button", { name: "기본 에이전트" });
  await select.click(); await page.screenshot({ path: `${captures}/account-options.png` });
  await page.getByRole("menuitem", { name: "작업 PAS" }).click();
  await expect(select).toBeDisabled(); await expect(page.getByText("저장 중")).toBeVisible();
  await expect(select).toContainText("작업 PAS"); await expect(select).toBeFocused();
  await page.goto(`${base}&link=unlinked`);
  await page.locator(".ks-shell-bar").getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.getByText("서버에 연결하면 기본 에이전트를 고를 수 있습니다")).toBeVisible();
  await page.screenshot({ path: `${captures}/account-unlinked.png` });
});

test("새 앱 질문이 데스크톱과 열린 설정 위에서 답을 받는다", async ({ page }) => {
  await page.goto(`${base}&link=connected&prompt`);
  let dialog = page.getByRole("dialog", { name: "기본 에이전트를 작업 PAS로 바꿀까요?" });
  await expect(dialog).toBeVisible();
  await expect(page.locator(".ks-harness-webview")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "그대로 두기" })).toBeFocused();
  await page.screenshot({ path: `${captures}/question-desktop-1440.png` });
  await page.setViewportSize({ width: 960, height: 600 });
  await page.screenshot({ path: `${captures}/question-desktop-960.png` });
  await dialog.getByRole("button", { name: "그대로 두기" }).click();
  await expect(dialog).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".ks-shell-bar").getByRole("button", { name: "설정", exact: true }).click();
  await page.evaluate(() => window.__kaleidoscopeHarness?.setPreferences({ revision: 3, default_message_app_id: "agent", asked_message_app_ids: [] }));
  dialog = page.getByRole("dialog", { name: "기본 에이전트를 작업 PAS로 바꿀까요?" });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("system-window-settings").evaluate((element) => Boolean(element.closest("[inert]")))).resolves.toBe(true);
  await page.screenshot({ path: `${captures}/question-settings-1440.png` });
  await page.setViewportSize({ width: 960, height: 600 });
  await page.screenshot({ path: `${captures}/question-settings-960.png` });
  await dialog.getByRole("button", { name: "바꾸기" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "기본 에이전트" })).toContainText("작업 PAS");
});

test("새 앱 질문 저장 중과 실패 후 재시도", async ({ page }) => {
  test.setTimeout(60_000);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 960, height: 600 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`${base}&link=connected&prompt&slow-preferences`);
    let dialog = page.getByRole("dialog", { name: "기본 에이전트를 작업 PAS로 바꿀까요?" });
    const confirm = dialog.getByRole("button", { name: "바꾸기" });
    const dialogBefore = await dialog.boundingBox();
    const buttonBefore = await confirm.boundingBox();
    await confirm.click();
    await expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(await dialog.boundingBox()).toEqual(dialogBefore);
    expect(await confirm.boundingBox()).toEqual(buttonBefore);
    await page.screenshot({ path: `${captures}/question-saving-${viewport.width}.png` });
    await expect(dialog).toHaveCount(0);
    await page.goto(`${base}&link=connected&prompt&fail-answer`);
    dialog = page.getByRole("dialog", { name: "기본 에이전트를 작업 PAS로 바꿀까요?" });
    await dialog.getByRole("button", { name: "바꾸기" }).click();
    await expect(dialog.getByRole("alert")).toContainText("서버에 연결되어 있지 않아");
    await page.screenshot({ path: `${captures}/question-error-${viewport.width}.png` });
    await dialog.getByRole("button", { name: "그대로 두기" }).click();
    await expect(dialog).toHaveCount(0);
  }
});
