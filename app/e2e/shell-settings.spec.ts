import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const captures = "/home/eias/workspace/.local/tmp/card982/implementation";
const base = "/harness.html?preview=shell-settings";

test("서버 설정 진입과 전환, 닫기와 초점", async ({ page }) => {
  await page.goto(`${base}&link=embedded`);
  await expect(page.locator(".ks-harness-webview")).toBeVisible();
  const gear = page.getByRole("button", { name: "설정", exact: true });
  await gear.click();
  await expect(page.getByRole("heading", { name: "설정" })).toBeFocused();
  await expect(page.locator(".ks-desktop-area")).toBeHidden();
  await expect(page.locator(".ks-harness-webview")).toHaveCount(0);
  await mkdir(captures, { recursive: true });
  const metrics = await page.evaluate(() => {
    const rect = (selector: string) => {
      const value = document.querySelector(selector)!.getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
    };
    return {
      brand: rect(".ks-brand"), back: rect(".ks-shell-settings .ks-data-toolbar button"),
      group: rect(".ks-shell-settings .ks-settings-group h3"), entry: rect(".ks-shell-settings .ks-settings-entry"),
      address: rect(".ks-settings-inline input"), connect: rect(".ks-settings-inline button"),
      select: rect(".ks-shell-settings .ks-select-button"),
    };
  });
  await writeFile(`${captures}/metrics.json`, JSON.stringify(metrics, null, 2));
  await page.getByRole("button", { name: "내 PC 서버", exact: true }).click();
  const input = page.getByLabel("원격 서버 주소");
  await expect(input).toBeFocused();
  await input.fill("https://eiaserinnys.me/kaleidoscope");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "코드 복사" })).toBeVisible();
  await page.getByRole("button", { name: "내 PC 서버로 돌아가기" }).click();
  await expect(input).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(gear).toBeFocused();
  await expect(page.locator(".ks-desktop-area")).toBeVisible();
  await expect(page.locator(".ks-harness-webview")).toBeVisible();
});

test("서버 상태를 넓은 화면과 최소 화면에서 확인한다", async ({ page }) => {
  test.setTimeout(60_000);
  await mkdir(captures, { recursive: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 960, height: 600 }]) {
    await page.setViewportSize(viewport);
    for (const state of ["connected", "embedded", "embedded-offline", "pairing", "revoked", "offline"]) {
      await page.goto(`${base}&link=${state}`);
      await expect(page.locator(".ks-harness-webview")).toBeVisible();
      await page.getByRole("button", { name: "설정", exact: true }).click();
      await expect(page.getByRole("heading", { name: "설정" })).toBeFocused();
      await expect(page.locator(".ks-harness-webview")).toHaveCount(0);
      await page.screenshot({ path: `${captures}/${state}-${viewport.width}.png` });
      expect(await page.locator(".ks-shell-settings").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      if (state === "pairing") {
        await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => undefined } }));
        await page.getByRole("button", { name: "코드 복사" }).click();
        await expect(page.getByText("코드 복사됨")).toBeVisible();
        await page.screenshot({ path: `${captures}/copied-${viewport.width}.png` });
      }
    }
    await page.goto(`${base}&link=connected&transfer-skips&slow-link`);
    await expect(page.locator(".ks-harness-webview")).toBeVisible();
    await page.getByRole("button", { name: "설정", exact: true }).click();
    await expect(page.locator(".ks-harness-webview")).toHaveCount(0);
    await expect(page.getByText("가져오기 완료 3개")).toBeVisible();
    await expect(page.locator(".shell-server-skipped")).not.toHaveAttribute("open");
    await page.screenshot({ path: `${captures}/transfer-${viewport.width}.png` });
    await page.getByRole("button", { name: "내 PC 앱과 데이터 가져오기" }).click();
    await expect(page.getByRole("status", { name: "처리 중" })).toBeVisible();
    await page.screenshot({ path: `${captures}/busy-${viewport.width}.png` });
    await expect(page.getByRole("status", { name: "처리 중" })).toHaveCount(0);
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${base}&link=connected`);
  await expect(page.locator(".ks-harness-webview")).toBeVisible();
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.locator(".ks-harness-webview")).toHaveCount(0);
  await page.screenshot({ path: `${captures}/connected-dark-960.png` });
});

test("기본 에이전트를 고르고 대기와 비연결 상태를 확인한다", async ({ page }) => {
  test.setTimeout(60_000);
  await mkdir(captures, { recursive: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 960, height: 600 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`${base}&link=connected&slow-preferences`);
    await expect(page.locator(".ks-harness-webview")).toBeVisible();
    await page.getByRole("button", { name: "설정", exact: true }).click();
    await expect(page.locator(".ks-harness-webview")).toHaveCount(0);
    const select = page.getByRole("button", { name: "기본 에이전트" });
    await expect(select).toContainText("에이전트");
    await page.screenshot({ path: `${captures}/account-${viewport.width}.png` });
    await select.click();
    await page.screenshot({ path: `${captures}/account-options-${viewport.width}.png` });
    await page.getByRole("menuitem", { name: "작업 PAS" }).click();
    await expect(select).toBeDisabled();
    await expect(select).toContainText("에이전트");
    await expect(page.getByText("저장 중")).toBeVisible();
    await page.screenshot({ path: `${captures}/account-saving-${viewport.width}.png` });
    await expect(select).toContainText("작업 PAS");
    await page.goto(`${base}&link=unlinked`);
    await expect(page.locator(".ks-harness-webview")).toBeVisible();
    await page.getByRole("button", { name: "설정", exact: true }).click();
    await expect(page.locator(".ks-harness-webview")).toHaveCount(0);
    await expect(page.getByText("서버에 연결하면 기본 에이전트를 고를 수 있습니다")).toBeVisible();
    await page.screenshot({ path: `${captures}/account-unlinked-${viewport.width}.png` });
    await page.goto(`${base}&link=connected&prefs=waiting`);
    await expect(page.locator(".ks-harness-webview")).toBeVisible();
    await page.getByRole("button", { name: "설정", exact: true }).click();
    await expect(page.locator(".ks-harness-webview")).toHaveCount(0);
    await expect(page.locator(".ks-settings-control[aria-busy=true]")).toBeVisible();
    await page.screenshot({ path: `${captures}/account-waiting-${viewport.width}.png` });
    await expect(page.getByRole("button", { name: "기본 에이전트" })).toContainText("에이전트", { timeout: 10000 });
  }
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
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.evaluate(() => window.__kaleidoscopeHarness?.setPreferences({ revision: 3, default_message_app_id: "agent", asked_message_app_ids: [] }));
  dialog = page.getByRole("dialog", { name: "기본 에이전트를 작업 PAS로 바꿀까요?" });
  await expect(dialog).toBeVisible();
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
    await dialog.getByRole("button", { name: "바꾸기" }).click();
    await expect(dialog.getByRole("status", { name: "저장 중" })).toBeVisible();
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
