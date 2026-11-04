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
