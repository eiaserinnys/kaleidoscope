import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

type EditorSnapshot = { anchor: number; head: number; text: string; focused: boolean };

async function snapshot(editor: Locator): Promise<EditorSnapshot> {
  return editor.evaluate((element) => {
    const view = (element as any).cmTile.root.view;
    const { anchor, head } = view.state.selection.main;
    return { anchor, head, text: view.state.sliceDoc(), focused: view.hasFocus };
  });
}

async function glyph(editor: Locator, needle: string, offset: number): Promise<{ x: number; y: number }> {
  return editor.evaluate((element, [needle, offset]) => {
    const line = [...element.querySelectorAll(".cm-line")].find((item) => item.textContent?.includes(needle));
    if (!line) throw new Error(`줄을 찾지 못했습니다: ${needle}`);
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const full = nodes.map((node) => node.data).join("");
    let index = full.indexOf(needle) + offset;
    for (const node of nodes) {
      if (index < node.length) {
        const range = document.createRange();
        range.setStart(node, index); range.setEnd(node, index + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + 1, y: rect.top + rect.height / 2 };
      }
      index -= node.length;
    }
    throw new Error(`글자를 찾지 못했습니다: ${needle}`);
  }, [needle, offset] as const);
}

async function open(page: Page) {
  await page.goto("/?preview=1");
  const app = page.getByTestId("app-window-md-editor");
  await app.getByRole("button", { name: "문서 폴더 고르기" }).click();
  await app.getByRole("button", { name: "reclick.md" }).click();
  const editor = app.locator(".cm-content");
  await expect(editor).toContainText("다시 누르기 시험");
  return { app, editor };
}

async function blurOnTree(app: Locator, page: Page, editor: Locator) {
  const box = await app.locator(".ks-file-tree-list").boundingBox();
  if (!box) throw new Error("파일 목록을 찾지 못했습니다");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 12);
  await expect.poll(async () => (await snapshot(editor)).focused).toBe(false);
}

async function expectSaved(page: Page, expected: string) {
  const panel = page.getByTestId("fake-files-panel").locator("pre");
  await expect.poll(async () => {
    const files = await panel.textContent() ?? "";
    const marker = "reclick.md\n";
    const offset = files.lastIndexOf(marker);
    return offset < 0 ? null : files.slice(offset + marker.length);
  }, { timeout: 6_000 }).toBe(expected);
}

async function typeOneAndCheck(page: Page, editor: Locator, expectedBefore: string, character: string) {
  const selected = await snapshot(editor);
  expect(selected.anchor).toBe(selected.head);
  expect(selected.text).toBe(expectedBefore);
  const expected = expectedBefore.slice(0, selected.head) + character + expectedBefore.slice(selected.head);
  await page.keyboard.type(character);
  await expect.poll(async () => (await snapshot(editor)).text).toBe(expected);
  await expectSaved(page, expected);
  return expected;
}

test("파일을 연 직후 첫 줄을 한 번 눌러도 선택 없이 한 글자만 저장한다", async ({ page }) => {
  const { editor } = await open(page);
  const before = await snapshot(editor);
  expect(before.focused).toBe(false);
  expect(before.anchor).toBe(0);
  const point = await glyph(editor, "다시 누르기 시험", 4);
  const line = editor.locator(".cm-line").first();
  const rendered = await line.textContent();
  expect(rendered).not.toContain("#");
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  expect(await line.textContent()).toBe(rendered);
  await page.mouse.up();
  await expect.poll(async () => await line.textContent()).toContain("#");
  await typeOneAndCheck(page, editor, before.text, "X");
});

for (const { name, firstNeedle, needle, offset } of [
  { name: "제목", firstNeedle: "글자", needle: "제목", offset: 1 },
  { name: "인용", firstNeedle: "글자들", needle: "인용", offset: 1 },
  { name: "링크 문단", firstNeedle: "본문에", needle: "뒤의 글자들", offset: 1 },
  { name: "들여쓴 코드", firstNeedle: "코드 줄", needle: "첫째", offset: 1 },
]) {
  test(`${name} 줄을 고치고 포커스를 잃은 뒤 다시 눌러도 한 글자만 저장한다`, async ({ page }) => {
    const { app, editor } = await open(page);
    const initial = (await snapshot(editor)).text;
    const first = await glyph(editor, firstNeedle, 1);
    await page.mouse.click(first.x, first.y);
    const edited = await typeOneAndCheck(page, editor, initial, "A");
    await blurOnTree(app, page, editor);
    const second = await glyph(editor, needle, offset);
    await page.mouse.click(second.x, second.y);
    await typeOneAndCheck(page, editor, edited, "X");
  });
}

test("포커스를 잃은 뒤 다른 줄을 누르면 선택 없이 그 줄을 편집한다", async ({ page }) => {
  const { app, editor } = await open(page);
  const initial = (await snapshot(editor)).text;
  const first = await glyph(editor, "제목 줄 글자", 2);
  await page.mouse.click(first.x, first.y);
  await blurOnTree(app, page, editor);
  const target = await glyph(editor, "뒤의 글자들이", 1);
  await page.mouse.click(target.x, target.y);
  await typeOneAndCheck(page, editor, initial, "X");
});

test("Tab으로 편집기에 들어가면 커서가 있는 줄을 바로 원문으로 보인다", async ({ page }) => {
  const { app, editor } = await open(page);
  await app.getByRole("button", { name: "reclick.md" }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect.poll(async () => (await snapshot(editor)).focused).toBe(true);
  await expect(editor.locator(".cm-line").first()).toContainText("# 다시 누르기 시험");
});

test("렌더된 여러 줄을 드래그하는 동안 배치를 유지하고 선택한다", async ({ page }) => {
  const { editor } = await open(page);
  const source = (await snapshot(editor)).text;
  const start = await glyph(editor, "다시 누르기 시험", 1);
  const end = await glyph(editor, "인용 줄 안의 글자들", 3);
  const firstLine = editor.locator(".cm-line").first();
  const rendered = await firstLine.textContent();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  expect(await firstLine.textContent()).toBe(rendered);
  const during = await snapshot(editor);
  expect(during.anchor).not.toBe(during.head);
  await page.mouse.up();
  const selected = await snapshot(editor);
  expect(selected.anchor).not.toBe(selected.head);
  expect(selected.text).toBe(source);
  expect(source.slice(Math.min(selected.anchor, selected.head), Math.max(selected.anchor, selected.head))).toContain("제목 줄 글자");
});

test("Shift 클릭으로 기존 앵커에서 다른 줄까지 선택을 늘린다", async ({ page }) => {
  const { editor } = await open(page);
  const start = await glyph(editor, "제목 줄 글자", 1);
  await page.mouse.click(start.x, start.y);
  const first = await snapshot(editor);
  expect(first.anchor).toBe(first.head);
  const end = await glyph(editor, "뒤의 글자들이", 1);
  await page.keyboard.down("Shift");
  await page.mouse.click(end.x, end.y);
  await page.keyboard.up("Shift");
  const selected = await snapshot(editor);
  expect(selected.anchor).toBe(first.anchor);
  expect(selected.head).not.toBe(first.head);
  expect(selected.text.slice(Math.min(selected.anchor, selected.head), Math.max(selected.anchor, selected.head))).toContain("인용 줄 안의 글자들");
});

test("표는 누르고 있는 동안 렌더 상태를 유지하고 뗀 뒤 원문으로 바뀐다", async ({ page }) => {
  const { editor } = await open(page);
  const cell = editor.locator("table td").first();
  await expect(cell).toBeVisible();
  const box = await cell.boundingBox();
  if (!box) throw new Error("표 칸을 찾지 못했습니다");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(editor.locator("table")).toBeVisible();
  await page.mouse.up();
  await expect(editor.locator("table")).toHaveCount(0);
  await expect(editor).toContainText("| 하나 | 둘 |");
});

test("이미지 대체 글을 다시 누르는 동안 해당 줄을 렌더 상태로 유지한다", async ({ page }) => {
  await page.goto("/?preview=1");
  const app = page.getByTestId("app-window-md-editor");
  await app.getByRole("button", { name: "문서 폴더 고르기" }).click();
  await app.getByRole("button", { name: "Kaleidoscope.md" }).click();
  const editor = app.locator(".cm-content");
  const image = editor.locator(".ks-live-image");
  await image.scrollIntoViewIfNeeded();
  await image.click();
  await blurOnTree(app, page, editor);
  const line = editor.locator(".cm-line").filter({ hasText: "표식 아이콘" });
  const rendered = await line.textContent();
  expect(rendered).not.toContain("marker.png");
  const box = await image.boundingBox();
  if (!box) throw new Error("이미지 대체 글을 찾지 못했습니다");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  expect(await line.textContent()).toBe(rendered);
  await page.mouse.up();
  await expect(line).toContainText("![표식 아이콘](marker.png)");
  const selected = await snapshot(editor);
  expect(selected.anchor).toBe(selected.head);
});
