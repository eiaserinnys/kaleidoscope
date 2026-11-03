import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

type ClientChatHarnessCall = {
  name: string;
  event: { text?: string; stream_id?: string | null; attachments?: Array<{ byte_length: number; first_byte: number }> };
};

declare global {
  interface Window {
    clientChatHarness: {
      calls: () => ClientChatHarnessCall[];
      control: (type: string) => void;
      coreCalls: () => number;
    };
  }
}

const captureDir = "/home/eias/workspace/.local/tmp/card933/chat-client";

test("클라이언트 채팅 채널의 기록, 입력, 첨부, 바닥글과 리로드 복구", async ({ page }) => {
  await mkdir(captureDir, { recursive: true });
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.goto("/?preview=client-chat-test");
  await page.addStyleTag({ content: `
    .ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; }
    .ks-harness-dev-panel { display: none; }
  ` });

  const app = page.getByTestId("app-window-client-chat");
  await expect(app).toBeVisible();
  await expect(app.locator(".ks-agent-chat-history")).toBeVisible();
  await expect(app.getByText("불러오는 중…")).toBeVisible();
  await app.screenshot({ path: `${captureDir}/loading.png` });

  await expect(app.getByText("파일을 살펴봐 줘")).toBeVisible();
  await expect(app.getByText("두 첨부를 확인하고 있습니다.")).toBeVisible();
  await expect(app.getByText("이미지에서 글자를 찾고 있습니다. 응답 조각이 도착했습니다.")).toBeVisible();
  await expect(app.locator(".ks-agent-chat-history").getByText("도구 승인 대기")).toBeVisible();
  await expect(app.getByRole("button", { name: "멈춤" })).toBeVisible();
  await app.getByRole("button", { name: "멈춤" }).click();
  await expect(app.getByRole("button", { name: "보내기" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.clientChatHarness.calls().filter((call) => call.name === "cancel").length)).toBe(1);
  const footerY = await app.locator(".ks-agent-chat-history").getByText("도구 승인 대기").evaluate((element) => element.getBoundingClientRect().y);
  const composerY = await app.locator(".ks-agent-chat-input-area").evaluate((element) => element.getBoundingClientRect().y);
  expect(footerY).toBeLessThan(composerY);
  await expect(app.getByRole("button", { name: "표식.png" })).toBeVisible();

  await app.getByRole("button", { name: "표식.png" }).click();
  const imagePreview = page.getByRole("dialog", { name: "표식.png" });
  await expect(imagePreview).toBeVisible();
  await expect.poll(() => imagePreview.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "닫기" }).click();

  const popup = page.waitForEvent("popup");
  await app.getByRole("button", { name: "메모.txt" }).click();
  const openedAttachment = await popup;
  await expect(openedAttachment.locator("body")).toContainText("fixture attachment");
  await openedAttachment.close();

  const input = app.getByRole("textbox", { name: "메시지" });
  const coreCallsBeforeTyping = await page.evaluate(() => window.clientChatHarness.coreCalls());
  await input.fill("실패");
  expect(await page.evaluate(() => window.clientChatHarness.coreCalls())).toBe(coreCallsBeforeTyping);
  await input.press("Enter");
  await expect(input).toHaveValue("실패");
  await expect(app.getByRole("alert")).toContainText("요청을 보내지 못했습니다");

  await app.locator('input[type="file"]').setInputFiles({
    name: "probe.txt", mimeType: "text/plain", buffer: Buffer.from("client payload"),
  });
  await input.fill("정상 보내기");
  await input.press("Enter");
  await expect(app.locator(".ks-agent-chat-history")).toContainText("정상 보내기");
  await expect.poll(() => page.evaluate(() => window.clientChatHarness.calls()))
    .toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "send", event: expect.objectContaining({ text: "정상 보내기", attachments: [expect.objectContaining({ byte_length: 14, first_byte: 99 })] }) }),
    ]));

  await page.evaluate(() => window.clientChatHarness.control("chat-test-emit-many"));
  await expect(app.getByText("조각 100", { exact: true })).toBeVisible();
  await app.screenshot({ path: `${captureDir}/wide.png` });

  await page.setViewportSize({ width: 392, height: 700 });
  await expect(app.getByText("조각 100", { exact: true })).toBeVisible();
  await app.screenshot({ path: `${captureDir}/narrow.png` });
  const overflow = await app.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);

  await page.reload();
  const reloadedApp = page.getByTestId("app-window-client-chat");
  await expect(reloadedApp.getByText("파일을 살펴봐 줘")).toBeVisible();
  await expect(reloadedApp.getByText("이미지에서 글자를 찾고 있습니다. 응답 조각이 도착했습니다.")).toBeVisible();
  await expect(reloadedApp.locator(".ks-agent-chat-history").getByText("도구 승인 대기")).toBeVisible();
});
