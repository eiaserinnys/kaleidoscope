import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const captureDirectory = "/tmp/ks-chat-long-history-captures";

async function openLongHistory(page: Page, width = 1100) {
  await page.setViewportSize({ width: width + 32, height: 732 });
  await page.goto("/?preview=workspace-pas&conversation=ready&history=200");
  await page.addStyleTag({ content: ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const chat = page.getByTestId("app-window-workspace-pas");
  const history = chat.getByRole("log", { name: "대화 기록" });
  await expect(assistants(history).last()).toBeVisible();
  await expect(chat.getByRole("textbox", { name: "메시지" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await waitForFrames(page);
  return { chat, history };
}

async function waitForFrames(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function bottomGap(history: Locator) {
  return history.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
}

async function emitText(page: Page, text: string) {
  await page.evaluate((value) => {
    (window as Window & { conversationHarness: { emitText(text: string): void } }).conversationHarness.emitText(value);
  }, text);
}

function assistants(history: Locator) {
  return history.locator(".ks-agent-chat-content > .ks-agent-chat-assistant");
}

async function historyCalls(page: Page) {
  return page.evaluate(() => (window as Window & { conversationHarness: { calls(): Array<{ op: string }> } }).conversationHarness.calls().filter((call) => call.op === "conversation.history").length);
}

test.beforeAll(async () => mkdir(captureDirectory, { recursive: true }));

test("긴 기록을 처음 열고 스트리밍 중 맨 아래를 따라간다", async ({ page }) => {
  const { history } = await openLongHistory(page);
  expect(Math.abs(await bottomGap(history))).toBeLessThanOrEqual(1);

  await emitText(page, `추가 스트리밍 문장입니다. ${"응답 내용을 이어서 확인합니다. ".repeat(110)}`);
  await expect(assistants(history).last()).toContainText("추가 스트리밍 문장입니다.");
  await waitForFrames(page);
  expect(Math.abs(await bottomGap(history))).toBeLessThanOrEqual(1);
});

test("맨 아래에서 text 뒤에 item update가 와도 최신 답을 따라간다", async ({ page }) => {
  const { history } = await openLongHistory(page);
  await emitText(page, `이어지는 답변입니다. ${"마지막 조각을 기다립니다. ".repeat(40)}`);
  await page.evaluate(() => (window as any).conversationHarness.emit({
    event: "conversation.update",
    thread_id: "fake-thread",
    update: { kind: "item", item: { id: "chat-long-history-final", kind: "assistant", text: "완료된 최신 답변", at: "2026-10-28T00:00:00Z", attachments: [] } },
  }));
  await expect(assistants(history).last()).toContainText("완료된 최신 답변");
  await waitForFrames(page);
  expect(Math.abs(await bottomGap(history))).toBeLessThanOrEqual(1);
});

test("맨 아래에서 입력창이 여러 줄로 커져도 맨 아래를 유지한다", async ({ page }) => {
  const { chat, history } = await openLongHistory(page);
  const input = chat.getByRole("textbox", { name: "메시지" });
  await input.fill("첫째 줄 입력\n둘째 줄 입력\n셋째 줄 입력");
  await waitForFrames(page);
  expect(Math.abs(await bottomGap(history))).toBeLessThanOrEqual(1);
});

test("위로 읽는 동안 스트리밍은 scrollTop과 보이는 말풍선 위치를 유지한다", async ({ page }) => {
  const { history } = await openLongHistory(page);
  const bounds = await history.boundingBox();
  if (!bounds) throw new Error("대화 기록 영역을 찾지 못했습니다");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, -640);
  await waitForFrames(page);

  const before = await history.evaluate((element) => ({ scrollTop: element.scrollTop, maxScroll: element.scrollHeight - element.clientHeight }));
  expect(before.scrollTop).toBeGreaterThan(0);
  expect(before.scrollTop).toBeLessThan(before.maxScroll);
  const bubbles = assistants(history);
  const anchorIndex = await bubbles.evaluateAll((elements) => {
    const viewport = elements[0]?.parentElement?.parentElement?.getBoundingClientRect();
    if (!viewport) return -1;
    return elements.findIndex((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > viewport.top && rect.top < viewport.bottom;
    });
  });
  expect(anchorIndex).toBeGreaterThanOrEqual(0);
  const anchor = bubbles.nth(anchorIndex);
  const beforeTop = await anchor.evaluate((element) => element.getBoundingClientRect().top);

  await emitText(page, `위쪽 기록을 읽는 중입니다. ${"새 스트림은 화면 아래에서만 늘어납니다. ".repeat(90)}`);
  await expect(bubbles.last()).toContainText("위쪽 기록을 읽는 중입니다.");
  await waitForFrames(page);

  const afterScrollTop = await history.evaluate((element) => element.scrollTop);
  const afterTop = await anchor.evaluate((element) => element.getBoundingClientRect().top);
  expect(afterScrollTop).toBe(before.scrollTop);
  expect(Math.abs(afterTop - beforeTop)).toBeLessThanOrEqual(1);
});

test("이전 기록을 불러와도 scrollTop 0과 10에서 보던 말풍선이 같은 위치에 남는다", async ({ page }) => {
  const deviations: Array<{ scrollTop: number; pixels: number }> = [];
  for (const top of [0, 10]) {
    const { history } = await openLongHistory(page);
    const anchor = history.locator(".ks-agent-chat-user").filter({ hasText: "대화 1번째 기록입니다." }).first();
    const before = await history.evaluate((element, scrollTop) => {
      element.scrollTop = 100;
      element.scrollTop = scrollTop;
      const anchorTop = element.querySelector(".ks-agent-chat-user")?.getBoundingClientRect().top;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
      return { scrollTop: element.scrollTop, anchorTop };
    }, top);
    expect(before.scrollTop).toBe(top);

    await expect.poll(() => historyCalls(page)).toBeGreaterThan(0);
    await expect(history.locator(".ks-agent-chat-user").filter({ hasText: "이전 기록" })).toHaveCount(1);
    await page.waitForTimeout(50);
    await waitForFrames(page);

    const afterTop = await anchor.evaluate((element) => element.getBoundingClientRect().top);
    if (before.anchorTop === undefined) throw new Error("기준 말풍선을 찾지 못했습니다");
    deviations.push({ scrollTop: top, pixels: Math.abs(afterTop - before.anchorTop) });
  }
  expect(deviations.filter((item) => item.pixels > 1)).toEqual([]);
});

test("마우스 드래그와 Ctrl+C로 여러 말풍선의 글을 선택하고 복사한다", async ({ page }) => {
  const { history } = await openLongHistory(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const bubbles = assistants(history);
  const firstBubble = bubbles.nth(96);
  const secondBubble = bubbles.nth(97);
  await firstBubble.scrollIntoViewIfNeeded();
  const firstParagraph = firstBubble.locator(".ks-markdown-text > p").first();
  const secondParagraph = secondBubble.locator(".ks-markdown-text > p").first();
  const firstBounds = await firstParagraph.boundingBox();
  const secondBounds = await secondParagraph.boundingBox();
  if (!firstBounds || !secondBounds) throw new Error("선택할 말풍선 글을 찾지 못했습니다");

  await page.mouse.move(firstBounds.x + 2, firstBounds.y + 2);
  await page.mouse.down();
  await page.mouse.move(secondBounds.x + secondBounds.width - 2, secondBounds.y + secondBounds.height / 2, { steps: 18 });
  await page.mouse.up();
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  expect(selected).toContain("회의 내용을 정리하고 필요한 다음 행동을 확인합니다.");
  expect(selected).toContain("검토할 항목은 다음과 같습니다.");

  await page.keyboard.press("Control+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(selected);
});

test("창 폭을 바꿔도 말풍선 줄바꿈과 맨 아래 위치가 다시 맞고 입력창을 캡처한다", async ({ page }) => {
  const { chat, history } = await openLongHistory(page);
  const input = chat.getByRole("textbox", { name: "메시지" });

  await input.fill("한 줄 입력 내용");
  await chat.screenshot({ path: `${captureDirectory}/input-wide-one-line.png` });
  await input.fill("첫째 줄 입력\n둘째 줄 입력\n셋째 줄 입력");
  await chat.screenshot({ path: `${captureDirectory}/input-wide-multiline.png` });
  await input.fill("");

  const lastBubble = assistants(history).last();
  const wideHeight = await lastBubble.evaluate((element) => element.getBoundingClientRect().height);
  const historyBounds = await history.boundingBox();
  if (!historyBounds) throw new Error("대화 기록 영역을 찾지 못했습니다");
  await page.mouse.move(historyBounds.x + historyBounds.width / 2, historyBounds.y + historyBounds.height / 2);
  await page.mouse.wheel(0, 100_000);
  await waitForFrames(page);
  expect(Math.abs(await bottomGap(history))).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 592, height: 732 });
  await waitForFrames(page);
  const narrowHeight = await lastBubble.evaluate((element) => element.getBoundingClientRect().height);
  expect(narrowHeight).toBeGreaterThan(wideHeight);
  expect(Math.abs(await bottomGap(history))).toBeLessThanOrEqual(1);

  await input.fill("한 줄 입력 내용");
  await chat.screenshot({ path: `${captureDirectory}/input-narrow-one-line.png` });
  await input.fill("첫째 줄 입력\n둘째 줄 입력\n셋째 줄 입력");
  await chat.screenshot({ path: `${captureDirectory}/input-narrow-multiline.png` });
  await input.fill("");
  await page.setViewportSize({ width: 1132, height: 732 });
  await waitForFrames(page);
  const restoredHeight = await lastBubble.evaluate((element) => element.getBoundingClientRect().height);
  expect(Math.abs(restoredHeight - wideHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(await bottomGap(history))).toBeLessThanOrEqual(1);
});
