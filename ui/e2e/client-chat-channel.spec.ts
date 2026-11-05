import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

type ClientChatHarnessCall = {
  name: string;
  event: { request_id?: string; text?: string; stream_id?: string | null; attachments?: Array<{ byte_length: number; first_byte: number }> };
};

declare global {
  interface Window {
    clientChatHarness: {
      calls: () => ClientChatHarnessCall[];
      visibleText: () => string;
      control: (type: string) => void;
      coreCalls: () => number;
      pauseNextSnapshot: () => void;
      snapshotPending: () => boolean;
      resumeSnapshot: () => void;
      restartClient: () => Promise<void>;
      clientGeneration: () => number;
      chatState: () => { loading: boolean; busy: boolean; items: number; queued: number; attachments: number } | null;
      setLoading: (value: boolean) => void;
    };
  }
}

const captureDir = "/home/eias/workspace/.local/tmp/card933/chat-client";

test("대화를 불러오는 동안 입력 줄과 초안은 유지된다", async ({ page }) => {
  const capture = "/home/eias/workspace/.local/artifacts/c1009-chat-loading";
  await mkdir(capture, { recursive: true });
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.goto("/?preview=client-chat-test");
  await page.addStyleTag({ content: ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }" });
  const app = page.getByTestId("app-window-client-chat");
  await expect(app.getByText("파일을 살펴봐 줘")).toBeVisible();
  const input = app.getByRole("textbox", { name: "메시지" });
  await input.fill("남길 초안");
  const inputHandle = await input.elementHandle();
  const measure = () => app.evaluate((element) => {
    const bounds = (selector: string) => {
      const rect = element.querySelector(selector)!.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    return { history: bounds(".ks-agent-chat-history"), composer: bounds(".ks-agent-chat-input-area") };
  });
  const wideBefore = await measure();
  await app.screenshot({ path: `${capture}/wide-before.png` });
  await page.evaluate(() => window.clientChatHarness.setLoading(true));
  await expect(app.getByLabel("불러오는 중")).toBeVisible();
  await expect(input).toBeDisabled();
  expect(await input.evaluate((element, original) => element === original, inputHandle)).toBe(true);
  const wideLoading = await measure();
  expect(Math.abs(wideBefore.composer.top - wideLoading.composer.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(wideLoading.history.left - wideLoading.composer.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(wideLoading.history.right - wideLoading.composer.right)).toBeLessThanOrEqual(1);
  await app.screenshot({ path: `${capture}/wide-loading.png` });
  await page.setViewportSize({ width: 360, height: 820 });
  const narrowLoading = await measure();
  await app.screenshot({ path: `${capture}/narrow-loading.png` });
  await page.evaluate(() => window.clientChatHarness.setLoading(false));
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue("남길 초안");
  await expect(app.getByText("파일을 살펴봐 줘")).toBeVisible();
  const narrowAfter = await measure();
  expect(Math.abs(narrowAfter.composer.top - narrowLoading.composer.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(narrowLoading.history.left - narrowLoading.composer.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(narrowLoading.history.right - narrowLoading.composer.right)).toBeLessThanOrEqual(1);
  await app.screenshot({ path: `${capture}/narrow-after.png` });
  await writeFile(`${capture}/bounds.json`, JSON.stringify({ wideBefore, wideLoading, narrowLoading, narrowAfter }, null, 2));
});

test("클라이언트 채팅 채널의 기록, 입력, 첨부, 바닥글과 리로드 복구", async ({ page }) => {
  await mkdir(captureDir, { recursive: true });
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.goto("/?preview=client-chat-test&hold_chat_snapshot=1");
  await page.addStyleTag({ content: `
    .ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; }
    .ks-harness-dev-panel { display: none; }
  ` });

  const app = page.getByTestId("app-window-client-chat");
  await expect(app).toBeVisible();
  await expect(app.locator(".ks-agent-chat-history")).toBeVisible();
  await expect(app.getByLabel("불러오는 중")).toBeVisible();
  await app.screenshot({ path: `${captureDir}/loading.png` });
  await expect.poll(() => page.evaluate(() => window.clientChatHarness.snapshotPending())).toBe(true);
  await page.evaluate(() => window.clientChatHarness.resumeSnapshot());

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
  await input.fill("큐 중복 시험");
  await input.press("Enter");
  await expect(app.getByText("큐 중복 시험", { exact: true })).toHaveCount(1);
  const queueRequestId = await page.evaluate(() => window.clientChatHarness.calls().find((call) => call.name === "send" && call.event.text === "큐 중복 시험")?.event.request_id);
  expect(queueRequestId).toBeTruthy();
  await page.evaluate(() => window.clientChatHarness.control("chat-test-queue-ack"));
  await expect(app.getByText("큐 중복 시험", { exact: true })).toHaveCount(1);
  await page.evaluate(() => window.clientChatHarness.control("chat-test-queue-to-history"));
  await expect(app.getByText("큐 중복 시험", { exact: true })).toHaveCount(1);

  // 앞선 조작의 호출이 기준을 읽은 뒤에 도착하지 않게 잠잠해진 뒤 기준을 잡고,
  // 입력이 늦게 일으키는 호출도 잡도록 입력 뒤에도 같은 시간을 기다린다.
  const settledCoreCalls = () => page.evaluate(() => new Promise<number>((resolve) => {
    let last = window.clientChatHarness.coreCalls();
    const check = () => {
      const now = window.clientChatHarness.coreCalls();
      if (now === last) resolve(now);
      else { last = now; setTimeout(check, 500); }
    };
    setTimeout(check, 500);
  }));
  const coreCallsBeforeTyping = await settledCoreCalls();
  await input.fill("실패");
  expect(await settledCoreCalls()).toBe(coreCallsBeforeTyping);
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
  await expect.poll(() => page.evaluate(() => window.clientChatHarness.snapshotPending())).toBe(true);
  await page.evaluate(() => window.clientChatHarness.resumeSnapshot());
  await expect(reloadedApp.getByText("파일을 살펴봐 줘")).toBeVisible();
  await expect(reloadedApp.getByText("이미지에서 글자를 찾고 있습니다. 응답 조각이 도착했습니다.")).toBeVisible();
  await expect(reloadedApp.locator(".ks-agent-chat-history").getByText("도구 승인 대기")).toBeVisible();
});

test("클라이언트 채팅 큐 승인과 기록 전환에서 보낸 글을 한 번만 그린다", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.goto("/?preview=client-chat-test");
  const app = page.getByTestId("app-window-client-chat");
  await expect(app.getByText("파일을 살펴봐 줘")).toBeVisible();

  const input = app.getByRole("textbox", { name: "메시지" });
  await input.fill("큐 중복 시험");
  await input.press("Enter");
  await expect(app.getByText("큐 중복 시험", { exact: true })).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.clientChatHarness.calls().some((call) => call.name === "send" && call.event.text === "큐 중복 시험"))).toBe(true);
  await page.evaluate(() => window.clientChatHarness.control("chat-test-queue-ack"));
  await expect(app.getByText("큐 중복 시험", { exact: true })).toHaveCount(1);
  await page.evaluate(() => window.clientChatHarness.control("chat-test-queue-to-history"));
  await expect(app.getByText("큐 중복 시험", { exact: true })).toHaveCount(1);
});

test("클라이언트 재시작은 대기 중인 채팅 상태를 초기화한다", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.goto("/?preview=client-chat-test");
  const app = page.getByTestId("app-window-client-chat");
  await expect(app.getByText("이미지에서 글자를 찾고 있습니다. 응답 조각이 도착했습니다.")).toBeVisible();
  await expect(app.getByRole("button", { name: "멈춤" })).toBeVisible();

  const attachmentCallCount = await page.evaluate(() => window.clientChatHarness.calls().filter((call) => call.name === "attachment").length);
  await page.evaluate(() => window.clientChatHarness.control("chat-test-hold-next-attachment"));
  await expect.poll(() => page.evaluate(() => window.clientChatHarness.calls().some((call) => call.name === "attachment-held"))).toBe(true);
  await app.getByRole("button", { name: "메모.txt" }).click();
  await expect.poll(() => page.evaluate(() => window.clientChatHarness.calls().filter((call) => call.name === "attachment").length)).toBe(attachmentCallCount + 1);

  const input = app.getByRole("textbox", { name: "메시지" });
  await input.fill("재시작 대기");
  await input.press("Enter");
  await expect(app.getByText("재시작 대기", { exact: true })).toHaveCount(1);
  const oldGeneration = await page.evaluate(() => window.clientChatHarness.clientGeneration());
  await page.evaluate(() => window.clientChatHarness.pauseNextSnapshot());
  await page.evaluate(() => window.clientChatHarness.restartClient());
  await expect.poll(() => page.evaluate(() => window.clientChatHarness.clientGeneration())).toBe(oldGeneration + 1);
  await expect(app.getByLabel("불러오는 중")).toBeVisible();
  await expect(app.getByText("파일을 살펴봐 줘", { exact: true })).toHaveCount(0);
  await expect(app.getByText("이미지에서 글자를 찾고 있습니다. 응답 조각이 도착했습니다.", { exact: true })).toHaveCount(0);
  await expect(app.locator(".ks-agent-chat-history").getByText("재시작 대기", { exact: true })).toHaveCount(0);
  await expect(app.getByRole("button", { name: "멈춤" })).toHaveCount(0);
  expect(await page.evaluate(() => window.clientChatHarness.chatState())).toEqual({ loading: true, busy: false, items: 0, queued: 0, attachments: 0 });
});

test("첨부 응답은 사용한 뒤 채널 상태에서 비운다", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.goto("/?preview=client-chat-test");
  const app = page.getByTestId("app-window-client-chat");
  await app.getByRole("button", { name: "표식.png" }).waitFor({ state: "visible" });
  await app.getByRole("button", { name: "표식.png" }).click();
  await expect(page.getByRole("dialog", { name: "표식.png" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.clientChatHarness.chatState()?.attachments)).toBe(0);
});
