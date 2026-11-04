import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test("정보 알림은 몸통 높이를 유지하고 시간이 지나면 사라진다", async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 600 });
  await page.goto("/?preview=client-chat-test");
  const app = page.getByTestId("app-window-client-chat");
  await expect(app.locator(".ks-agent-chat-history")).toBeVisible();
  const body = app.locator(".ks-data-window-body");
  const before = await body.boundingBox();
  await page.evaluate(() => window.clientChatHarness.control("chat-test-notice"));
  const notice = app.getByRole("status").filter({ hasText: "저장했습니다" });
  await expect(notice).toBeVisible();
  const after = await body.boundingBox();
  expect(after!.height).toBe(before!.height);
  expect(await notice.getAttribute("data-ks-overlay")).toBeNull();
  expect(await notice.locator("..").getAttribute("data-ks-overlay")).not.toBeNull();
  expect(await page.evaluate(() => window.clientChatHarness.visibleText())).toContain("저장했습니다");
  const output = process.env.KS_NOTICE_CAPTURE_DIR;
  if (output) { mkdirSync(output, { recursive: true }); await app.screenshot({ path: join(output, "status-wide.png") }); }
  await expect(notice).toHaveCount(0, { timeout: 8000 });
  expect(await page.evaluate(() => window.clientChatHarness.visibleText())).not.toContain("저장했습니다");
});

test("최소 창에서도 정보 알림이 본문 높이를 유지하고 닫힌다", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.goto("/?preview=client-chat-test");
  const app = page.getByTestId("app-window-client-chat");
  await expect(app.locator(".ks-agent-chat-history")).toBeVisible();
  const body = app.locator(".ks-data-window-body");
  const before = await body.boundingBox();
  await page.evaluate(() => window.clientChatHarness.control("chat-test-notice"));
  const notice = app.getByRole("status").filter({ hasText: "저장했습니다" });
  await expect(notice).toBeVisible();
  expect((await body.boundingBox())!.height).toBe(before!.height);
  const output = process.env.KS_NOTICE_CAPTURE_DIR;
  if (output) { mkdirSync(output, { recursive: true }); await app.screenshot({ path: join(output, "status-narrow.png") }); }
  await notice.getByRole("button", { name: "닫기" }).click();
  await expect(notice).toHaveCount(0);
});

for (const width of [1000, 360]) test(`${width} 폭에서 떠 있는 알림 아래 도구 단추를 누르고 알림을 닫는다`, async ({ page }) => {
  await page.setViewportSize({ width, height: 600 });
  await page.goto("/?preview=notice-fixture");
  const app = page.getByTestId("app-window-notice-fixture");
  const target = app.getByRole("button", { name: width === 360 ? "시작 단추" : "끝 단추 하나" });
  await expect(target).toBeVisible();
  await page.evaluate(() => (window as unknown as { noticeFixture: { show(): void } }).noticeFixture.show());
  const notice = app.getByRole("status").filter({ hasText: "저장했습니다" });
  await expect(notice).toBeVisible();
  const geometry = await target.evaluate((el) => {
    const button = el.getBoundingClientRect();
    const notice = el.closest(".ks-data-window")!.querySelector('.ks-window-status [role="status"]')!.getBoundingClientRect();
    const x = button.left + button.width / 2, y = button.top + button.height / 2;
    return { button: button.toJSON(), notice: notice.toJSON(), overlap: x > notice.left && x < notice.right && y > notice.top && y < notice.bottom };
  });
  const output = process.env.KS_NOTICE_CAPTURE_DIR;
  if (output) { mkdirSync(output, { recursive: true }); await app.screenshot({ path: join(output, `notice-click-${width}.png`) }); }
  expect(geometry.overlap, JSON.stringify(geometry)).toBe(true);
  await target.click({ timeout: 1500 });
  await expect(app.getByText(width === 360 ? "시작 누름" : "끝 누름")).toBeVisible();
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "닫기" }).click({ timeout: 1500 });
  await expect(notice).toHaveCount(0);
});
