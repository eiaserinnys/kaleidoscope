import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const fixture = new URL("../harness/fixtures/text-wrap.md", import.meta.url);

async function openChat(page: Page, width: number) {
  await page.setViewportSize({ width: width + 32, height: 732 });
  await page.goto("/?preview=workspace-pas&conversation=ready");
  await page.addStyleTag({ content: ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }" });
  const chat = page.getByTestId("app-window-workspace-pas");
  const history = chat.getByRole("log", { name: "대화 기록" });
  await expect(chat.getByRole("textbox", { name: "메시지" })).toBeVisible();
  expect(await chat.evaluate((element) => element.getBoundingClientRect().width)).toBe(width);
  return { chat, history };
}

test("대화 글은 1100과 360 폭 안에서 줄바꿈하고 코드 들여쓰기와 복사를 보존한다", async ({ page }) => {
  const source = await readFile(fixture, "utf8");

  for (const width of [1100, 360]) {
    const { history } = await openChat(page, width);
    await page.evaluate((text) => {
      (window as Window & { conversationHarness: { emitText(text: string): void } }).conversationHarness.emitText(text);
    }, source);
    const answer = history.locator(".ks-agent-chat-assistant").last();
    const pre = answer.locator("pre");
    await expect(pre).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    const dimensions = await history.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    const codeLayout = await pre.evaluate((element) => {
      const styles = getComputedStyle(element);
      const lines = [...element.querySelectorAll<HTMLElement>(".ks-code-line")];
      const lineHeights = lines.map((line) => line.getBoundingClientRect().height);
      const padding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
      const border = Number.parseFloat(styles.borderTopWidth) + Number.parseFloat(styles.borderBottomWidth);
      return {
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        height: element.getBoundingClientRect().height,
        expectedHeight: lineHeights.reduce((sum, height) => sum + height, 0) + padding + border,
        blankLineHeights: lines.filter((line) => line.textContent === "\n").map((line) => line.getBoundingClientRect().height),
      };
    });
    expect(codeLayout.scrollWidth).toBeLessThanOrEqual(codeLayout.clientWidth);
    expect(Math.abs(codeLayout.height - codeLayout.expectedHeight)).toBeLessThanOrEqual(1);
    expect(codeLayout.blankLineHeights.length).toBeGreaterThan(0);
    for (const height of codeLayout.blankLineHeights) expect(height).toBeGreaterThan(0);
    const overflowing = await answer.evaluate((element) => {
      const historyElement = element.closest("[role=log]")!;
      const right = historyElement.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(historyElement).paddingRight || "0");
      return [...element.querySelectorAll("pre, table, blockquote, li, a")]
        .filter((child) => child.getBoundingClientRect().right > right + 1)
        .map((child) => child.tagName.toLowerCase());
    });
    expect(overflowing).toEqual([]);

    if (width === 360) {
      const hanging = await pre.locator(".ks-code-line").evaluateAll((elements) => {
        const line = elements.find((element) => element.textContent?.includes("두 번째 단계도"));
        if (!line) return null;
        const text = line.firstChild;
        if (!text || text.nodeType !== Node.TEXT_NODE) return null;
        const content = text.textContent ?? "";
        const starts = new Map<number, number>();
        for (let index = 0; index < content.length; index += 1) {
          if (/\s/.test(content[index])) continue;
          const range = document.createRange();
          range.setStart(text, index);
          range.setEnd(text, index + 1);
          const rect = range.getBoundingClientRect();
          if (rect.width) starts.set(Math.round(rect.top), Math.min(starts.get(Math.round(rect.top)) ?? Infinity, rect.left));
        }
        return [...starts.values()];
      });
      expect(hanging?.length).toBeGreaterThan(1);
      expect(Math.max(...(hanging ?? [])) - Math.min(...(hanging ?? []))).toBeLessThanOrEqual(1);
    }

    const originalCode = await pre.evaluate((element) => element.textContent);
    await pre.evaluate((element) => {
      const selection = window.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
    });
    const copiedCode = await page.evaluate(() => window.getSelection()?.toString());
    expect(copiedCode).toBe(originalCode);
  }
});

test("긴 사용자 말, 알림, 오류와 도구 이름이 360 폭 기록 안에 든다", async ({ page }) => {
  const { history } = await openChat(page, 360);
  const longText = "좁은창줄바꿈검증문자열".repeat(20);
  await page.evaluate((text) => {
    const harness = (window as Window & { conversationHarness: { emit(event: unknown): void } }).conversationHarness;
    const at = "2026-10-28T00:00:00Z";
    for (const [id, kind] of [["wrap-user", "user"], ["wrap-notice", "notice"], ["wrap-error", "error"]]) {
      harness.emit({ event: "conversation.update", thread_id: "fake-thread", update: { kind: "item", item: { id, kind, text, at, attachments: [] } } });
    }
    harness.emit({ event: "conversation.update", thread_id: "fake-thread", update: { kind: "activity", busy: true, tool: text } });
  }, longText);

  await expect(history.locator(".ks-agent-chat-working")).toContainText(longText);
  const widths = await history.evaluate((element) => ({
    history: [element.scrollWidth, element.clientWidth],
    text: [...element.querySelectorAll(".ks-agent-chat-working, .ks-agent-chat-user, .ks-agent-chat-notice, .ks-notice-message")]
      .map((item) => [item.scrollWidth, item.clientWidth]),
  }));
  expect(widths.history[0]).toBeLessThanOrEqual(widths.history[1]);
  for (const [scrollWidth, clientWidth] of widths.text) expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test("기본 에이전트의 실행 명령과 오류 명령이 360 폭 안에 든다", async ({ page }) => {
  await page.setViewportSize({ width: 392, height: 732 });
  await page.goto("/?preview=agent&agent-phase=awaiting_permission");
  await page.addStyleTag({ content: ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }" });
  const app = page.getByTestId("app-window-agent");
  const command = app.locator(".ks-agent-session-command");
  await expect(command).toBeVisible();
  expect(await command.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await command.evaluate((element) => element.parentElement!.scrollWidth <= element.parentElement!.clientWidth)).toBe(true);

  await page.goto("/?preview=agent&agent-phase=failed");
  await page.addStyleTag({ content: ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }" });
  const failedCommand = page.getByTestId("app-window-agent").locator(".ks-agent-session-command");
  await expect(failedCommand).toBeVisible();
  expect(await failedCommand.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await failedCommand.evaluate((element) => element.parentElement!.scrollWidth <= element.parentElement!.clientWidth)).toBe(true);
});

test("마크다운 편집기의 넓은 표와 긴 코드 줄이 360 폭 안에 든다", async ({ page }) => {
  await page.setViewportSize({ width: 392, height: 732 });
  await page.goto("/?preview=md-editor");
  await page.addStyleTag({ content: ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }" });
  const app = page.getByTestId("app-window-md-editor");
  await app.getByRole("button", { name: "문서 폴더 고르기" }).click();
  await expect(app.getByRole("treeitem", { name: "Kaleidoscope.md" })).toBeVisible();
  await app.getByRole("treeitem", { name: "Kaleidoscope.md" }).click();
  const scroller = app.locator(".cm-scroller");
  await expect(scroller).toBeVisible();
  const dimensions = await scroller.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
