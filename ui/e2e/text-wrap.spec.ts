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
        const starts = new Map<number, number>();
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const text = walker.currentNode;
          const content = text.textContent ?? "";
          for (let index = 0; index < content.length; index += 1) {
            if (/\s/.test(content[index])) continue;
            const range = document.createRange();
            range.setStart(text, index);
            range.setEnd(text, index + 1);
            const rect = range.getBoundingClientRect();
            if (rect.width) starts.set(Math.round(rect.top), Math.min(starts.get(Math.round(rect.top)) ?? Infinity, rect.left));
          }
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

async function emitFence(page: Page, width: number, code: string) {
  const { history } = await openChat(page, width);
  await page.evaluate((text) => {
    (window as Window & { conversationHarness: { emitText(text: string): void } }).conversationHarness.emitText(text);
  }, `\`\`\`text\n${code}\n\`\`\``);
  const pre = history.locator(".ks-agent-chat-assistant").last().locator("pre");
  await expect(pre).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return pre;
}

test("1100 폭의 짧은 들여쓰기 펜스는 각 줄이 한 행이다", async ({ page }) => {
  const pre = await emitFence(page, 1100, "root:\n  child:\n    - 손자\n      leaf: 1");
  const heights = await pre.locator(".ks-code-line").evaluateAll((lines) => lines.map((line) => line.getBoundingClientRect().height));
  expect(heights).toHaveLength(4);
  for (const height of heights) expect(height).toBeCloseTo(heights[0], 0);
});

test("360 폭의 12·16·20칸 들여쓰기는 첫 글자 위치를 보존한다", async ({ page }) => {
  const indents = [12, 16, 20];
  const pre = await emitFence(page, 360, indents.map((count) => `${" ".repeat(count)}leaf: 1`).join("\n"));
  const offsets = await pre.evaluate((element) => {
    const code = element.querySelector("code")!;
    const probe = document.createElement("span");
    probe.textContent = "0";
    code.append(probe);
    const charWidth = probe.getBoundingClientRect().width;
    probe.remove();
    const style = getComputedStyle(element);
    const start = element.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    return [...code.querySelectorAll(".ks-code-line")].map((line) => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode;
        const index = text.textContent!.search(/\S/u);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(text, index);
        range.setEnd(text, index + 1);
        return { left: range.getBoundingClientRect().left - start, charWidth };
      }
      throw new Error("첫 글자가 없습니다");
    });
  });
  for (const [index, offset] of offsets.entries()) {
    expect(Math.abs(offset.left - indents[index] * offset.charWidth)).toBeLessThanOrEqual(1.5);
  }
});

test("360·560 폭의 들여쓴 긴 토큰은 첫 행부터 글자가 나온다", async ({ page }) => {
  for (const width of [360, 560]) {
    const pre = await emitFence(page, width, `        ${"x".repeat(70)}`);
    const topGap = await pre.locator(".ks-code-line").evaluate((line) => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode;
        const index = text.textContent!.search(/\S/u);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(text, index);
        range.setEnd(text, index + 1);
        return range.getBoundingClientRect().top - line.getBoundingClientRect().top;
      }
      throw new Error("첫 글자가 없습니다");
    });
    expect(topGap).toBeLessThan(10);
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

test("마크다운 편집기의 표와 긴 코드 줄이 창 폭에 맞는다", async ({ page }) => {
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

  await page.setViewportSize({ width: 1132, height: 732 });
  const table = app.locator(".ks-live-table").last();
  await table.scrollIntoViewIfNeeded();
  const columnWidths = await table.locator("tr:first-child > *").evaluateAll((cells) =>
    cells.map((cell) => cell.getBoundingClientRect().width),
  );
  expect(columnWidths.length).toBeGreaterThan(1);
  expect(Math.max(...columnWidths) - Math.min(...columnWidths)).toBeGreaterThan(1);
});
