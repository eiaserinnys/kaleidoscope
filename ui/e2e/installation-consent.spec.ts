import { expect, test } from "@playwright/test";

test.use({ deviceScaleFactor: 2 });

test("설치 전 권한의 실제 조작과 화면", async ({ page }) => {
  for (const [width, theme] of [[1000, "light"], [360, "dark"], [1000, "dark"], [360, "light"]] as const) {
    await page.setViewportSize({ width, height: 780 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/installation-consent.html");
    await page.evaluate(async () => { await (window as any).installationHarness.ready; (window as any).installationHarness.show("heavy"); });
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "취소" })).toBeFocused();
    await expect(dialog).toContainText("https://apps.example.org/store");
    await expect(dialog).toContainText("서버 실행 코드");
    await expect(dialog).toContainText("기준 주소: https://archive.example.org");
    await expect(dialog).toContainText("허용 경로: /articles, /images");
    await expect(dialog).toContainText("모음: threads");
    await expect(dialog).toContainText("범위: 창별");
    const alignment = await dialog.evaluate((node) => {
      const title = node.querySelector(".ks-dialog-title")!.getBoundingClientRect();
      const body = node.querySelector(".ks-dialog-body")!.getBoundingClientRect();
      const scroll = node.querySelector(".ks-dialog-scroll")!;
      return { titleLeft: title.left, bodyLeft: body.left, scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth };
    });
    console.log(`installation-${width}-${theme}: ${JSON.stringify(alignment)}`);
    expect(Math.abs(alignment.titleLeft - alignment.bodyLeft)).toBeLessThanOrEqual(1);
    expect(alignment.scrollWidth).toBeLessThanOrEqual(alignment.clientWidth);
    expect(await dialog.getByText("자료 수집", { exact: true }).evaluate((node) => getComputedStyle(node).userSelect)).toBe("text");
    await page.screenshot({ path: `test-results/installation-consent-heavy-${width}-${theme}.png` });
    const scroll = dialog.locator(".ks-dialog-scroll");
    expect(await scroll.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await dialog.getByText("코드 보기").click();
    await expect(dialog.getByText("def run(action, data):", { exact: false })).toBeVisible();
    await page.screenshot({ path: `test-results/installation-consent-details-${width}-${theme}.png` });
  }
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "허용하고 설치" }).evaluate((button: HTMLButtonElement) => button.click());
  expect(await page.evaluate(() => (window as any).installationHarness.answers)).toEqual([]);
  await dialog.getByRole("button", { name: "허용하고 설치" }).click();
  expect(await page.evaluate(() => (window as any).installationHarness.answers)).toEqual([
    { op: "app.respond_install_permission", window_id: "editor-window", request_id: "heavy", digest: "sha256-test-digest", allow: true },
  ]);

  for (const [width, theme] of [[1000, "light"], [360, "dark"], [1000, "dark"], [360, "light"]] as const) {
    await page.setViewportSize({ width, height: 780 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/installation-consent.html");
    await page.evaluate(async () => { await (window as any).installationHarness.ready; (window as any).installationHarness.show("light"); });
    await expect(page.getByRole("dialog")).toContainText("선언된 권한이 없습니다");
    await page.screenshot({ path: `test-results/installation-consent-light-${width}-${theme}.png` });
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => (window as any).installationHarness.answers[0].allow)).toBe(false);
  }
});
