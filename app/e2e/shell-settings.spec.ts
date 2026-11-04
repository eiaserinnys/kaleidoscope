import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

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
