import { expect, test, type Locator, type Page } from "@playwright/test";
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

for (const [width, indents] of [[360, [40, 100]], [560, [60, 100]]] as const) {
  test(`${width} 폭의 깊은 들여쓰기도 기록 안에 첫 글자가 보인다`, async ({ page }) => {
    const pre = await emitFence(page, width, indents.map((count) => `${" ".repeat(count)}leaf: 1`).join("\n"));
    const layout = await pre.evaluate((element) => {
      const history = element.closest<HTMLElement>("[role=log]")!;
      const bounds = history.getBoundingClientRect();
      const firstLetters = [...element.querySelectorAll(".ks-code-line")].map((line) => {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const text = walker.currentNode;
          const index = text.textContent!.search(/\S/u);
          if (index < 0) continue;
          const range = document.createRange();
          range.setStart(text, index);
          range.setEnd(text, index + 1);
          const rect = range.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        }
        throw new Error("첫 글자가 없습니다");
      });
      return { scrollWidth: history.scrollWidth, clientWidth: history.clientWidth, left: bounds.left, right: bounds.right, firstLetters };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.firstLetters).toHaveLength(2);
    for (const letter of layout.firstLetters) {
      expect(letter.left).toBeGreaterThanOrEqual(layout.left);
      expect(letter.right).toBeLessThanOrEqual(layout.right);
    }
  });
}

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

const LONG_URL = "https://example.org/very/long/path/segments/that/keeps/going/and/going/abcdefghijklmnopqrstuvwxyz";
const TABLE_DOCUMENT = `# 긴 주소가 든 표

| 항목 | 주소 | 상태 |
|---|---|---|
| 공지 | ${LONG_URL} | 열림 |
| 문서 | https://example.org/short | 닫힘 |
`;
const PROSE_DOCUMENT = `# 긴 문장 칸만 있는 표

| 항목 | 설명 | 상태 |
|---|---|---|
| 공지 | 링크도 코드도 없이 아주 길게 이어지는 설명 문장으로, 창이 넓어도 한 줄에 다 들어가지 않을 만큼 길게 써서 다른 칸의 폭을 얼마나 가져가는지 봅니다 | 열림 |
| 문서 | 짧은 설명 | 닫힘 |
`;
const EN_WORDS_TABLE = `| Configuration | Responsibilities | Implementation | Documentation |
|---|---|---|---|
| Initialization | Synchronization | Internationalization | Troubleshooting |
`;
const PLAIN_SHA_TABLE = `| PR | 커밋 | 상태 |
|---|---|---|
| 544 | 32cd90b8e06a3591092003c29cf3a0280464f39a | 머지 |
`;

async function openTableDocument(page: Page, width: number, height = 720, text = TABLE_DOCUMENT, name = "wide-table.md") {
  await page.setViewportSize({ width, height });
  await page.goto("/?preview=md-editor");
  await page.addStyleTag({ content: ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }" });
  await page.waitForFunction(() => (window as any).__ksHarness !== undefined);
  await page.evaluate(async ({ text, name }) => {
    const harness = (window as any).__ksHarness;
    await harness.call({ op: "files.pick_folder", window_id: "editor-window", permission: "docs" });
    await harness.call({ op: "files.write", window_id: "editor-window", permission: "docs", path: name, text });
    const { snapshot } = await harness.call({ op: "state.get" });
    const win = snapshot.shared.windows.find((window: any) => window.app_id === "md-editor");
    win.state = { ...win.state, source: 1, current_file: name };
    harness.emit({ event: "state.changed", snapshot });
  }, { text, name });
  const app = page.getByTestId("app-window-md-editor");
  await expect(app.locator(".cm-content")).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return app;
}

async function openStorageDocument(page: Page, width: number, height: number, text: string) {
  await page.setViewportSize({ width, height });
  await page.goto("/?preview=storage-document");
  await page.addStyleTag({ content: ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }" });
  await page.waitForFunction(() => (window as any).__ksHarness !== undefined);
  await page.evaluate(async (content) => {
    const harness = (window as any).__ksHarness;
    const read = await harness.call({ op: "storage.get", window_id: "storage-window", entry: "memo" });
    await harness.call({ op: "storage.write", window_id: "storage-window", entry: "memo", content, expected_revision: read.result.revision });
  }, text);
  const app = page.getByTestId("app-window-storage-document");
  await expect(app.locator(".ks-markdown-text")).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return app;
}

// 칸 안 글의 줄 상자 수. 서로 다른 줄의 위 끝이 몇 개인지 센다.
async function shortCellLines(table: Locator) {
  const cells = await table.locator("th, td").evaluateAll((elements) =>
    elements.map((cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      return {
        text: cell.textContent ?? "",
        lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size,
      };
    }),
  );
  return cells.filter((cell) => cell.text.length <= 10 && !cell.text.startsWith("http"));
}

test("마크다운 편집기의 표 칸은 낱말 단위로 줄바꿈하고 긴 주소만 끊는다", async ({ page }) => {
  const app = await openTableDocument(page, 1132);
  const table = app.locator(".ks-live-table").first();
  await expect(table).toBeVisible();
  const lines = await table.locator("th, td").evaluateAll((cells) =>
    cells
      .filter((cell) => !(cell.textContent ?? "").startsWith("http"))
      .map((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        return {
          text: cell.textContent,
          lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size,
        };
      }),
  );
  expect(lines.length).toBeGreaterThanOrEqual(6);
  for (const cell of lines) expect(cell.lines, cell.text ?? "").toBe(1);

  await page.setViewportSize({ width: 392, height: 732 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const scroller = app.locator(".cm-scroller");
  const dimensions = await scroller.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test("마크다운 편집기의 표와 긴 코드 줄이 창 폭에 맞는다", async ({ page }) => {
  await page.setViewportSize({ width: 392, height: 732 });
  await page.goto("/?preview=md-editor");
  await page.addStyleTag({ content: ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }" });
  const app = page.getByTestId("app-window-md-editor");
  await app.getByRole("tab", { name: "내 폴더" }).click();
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

test("1180 폭 편집기의 긴 주소 표와 긴 문장 칸 표에서 짧은 칸은 한 줄이고 맨 주소는 링크로 그린다", async ({ page }) => {
  for (const [name, text] of [["wide-url.md", TABLE_DOCUMENT], ["prose-only.md", PROSE_DOCUMENT]] as const) {
    const app = await openTableDocument(page, 1180, 720, text, name);
    const table = app.locator(".ks-live-table").first();
    await expect(table).toBeVisible();
    const short = await shortCellLines(table);
    expect(short.length, name).toBeGreaterThanOrEqual(6);
    for (const cell of short) expect(cell.lines, `${name} ${cell.text}`).toBe(1);
    const dimensions = await app.locator(".cm-scroller").evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    expect(dimensions.scrollWidth, name).toBeLessThanOrEqual(dimensions.clientWidth);
    if (name === "wide-url.md") await expect(table.locator("td .ks-live-link")).toHaveCount(2);
  }
});

test("1180 폭 저장소 문서 보기의 긴 주소 표와 긴 문장 칸 표에서 짧은 칸은 한 줄이다", async ({ page }) => {
  for (const [name, text] of [["wide-url.md", TABLE_DOCUMENT], ["prose-only.md", PROSE_DOCUMENT]] as const) {
    const app = await openStorageDocument(page, 1180, 720, text);
    const view = app.locator(".ks-markdown-text");
    const table = view.locator("table").first();
    await expect(table).toBeVisible();
    const short = await shortCellLines(table);
    expect(short.length, name).toBeGreaterThanOrEqual(6);
    for (const cell of short) expect(cell.lines, `${name} ${cell.text}`).toBe(1);
    const dimensions = await view.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    expect(dimensions.scrollWidth, name).toBeLessThanOrEqual(dimensions.clientWidth);
  }
});

test("360 폭의 긴 영어 낱말 표와 맨 SHA 표는 is-tight로 물러서 넘치지 않고, 창을 넓히면 다시 낱말 단위로 돌아온다", async ({ page }) => {
  for (const [name, text] of [["en-words.md", EN_WORDS_TABLE], ["plain-sha.md", PLAIN_SHA_TABLE]] as const) {
    const app = await openTableDocument(page, 360, 240, text, name);
    const editorFit = app.locator(".ks-table-fit").first();
    await expect(editorFit).toHaveClass(/is-tight/, { timeout: 5000 });
    const dimensions = await app.locator(".cm-scroller").evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    expect(dimensions.scrollWidth, name).toBeLessThanOrEqual(dimensions.clientWidth);
    // 같은 표를 넓은 창에서 다시 맞추면 is-tight를 뗀다.
    await page.setViewportSize({ width: 1180, height: 720 });
    await expect(editorFit, name).not.toHaveClass(/is-tight/, { timeout: 5000 });

    const viewApp = await openStorageDocument(page, 360, 240, text);
    const viewFit = viewApp.locator(".ks-markdown-text .ks-table-fit").first();
    await expect(viewFit).toHaveClass(/is-tight/, { timeout: 5000 });
    const viewDimensions = await viewApp.locator(".ks-markdown-text").evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    expect(viewDimensions.scrollWidth, name).toBeLessThanOrEqual(viewDimensions.clientWidth);
    await page.setViewportSize({ width: 1180, height: 720 });
    await expect(viewFit, name).not.toHaveClass(/is-tight/, { timeout: 5000 });
  }
});
