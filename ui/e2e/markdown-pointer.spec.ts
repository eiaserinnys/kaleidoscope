import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

async function open(page: Page) {
  await page.goto("/?preview=md-editor");
  const app = page.getByTestId("app-window-md-editor");
  await app.getByRole("button", { name: "문서 폴더 고르기" }).click();
  await app.getByRole("button", { name: "reclick.md" }).click();
  const editor = app.locator(".cm-content");
  await expect(editor).toContainText("다시 누르기 시험");
  return { app, editor };
}

async function snapshot(editor: Locator) {
  return editor.evaluate((element) => {
    const view = (element as any).cmTile.root.view;
    const range = view.state.selection.main;
    return { anchor: range.anchor, head: range.head, text: view.state.sliceDoc(),
      selected: view.state.sliceDoc(range.from, range.to), focused: view.hasFocus };
  });
}

async function glyph(editor: Locator, word: string) {
  return editor.evaluate((element, word) => {
    const line = [...element.querySelectorAll(".cm-line")].find((item) => item.textContent?.includes(word));
    if (!line) throw new Error(`줄을 찾지 못했습니다: ${word}`);
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const text = nodes.map((node) => node.data).join("");
    let index = text.indexOf(word) + Math.floor(word.length / 2);
    for (const node of nodes) {
      if (index < node.length) {
        const range = document.createRange();
        range.setStart(node, index); range.setEnd(node, index + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      index -= node.length;
    }
    throw new Error(`글자를 찾지 못했습니다: ${word}`);
  }, word);
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

for (const mode of ["포커스 없음", "다른 줄 포커스"] as const) {
  for (const target of [
    { name: "제목", word: "제목" },
    { name: "인용", word: "인용" },
    { name: "링크 문단", word: "글자들이" },
    { name: "들여쓴 코드", word: "첫째" },
  ]) {
    for (const clicks of [2, 3]) {
      test(`${mode} · ${target.name} ${clicks}회 누르기와 저장`, async ({ page }) => {
        const { editor } = await open(page);
        if (mode === "다른 줄 포커스") {
          await editor.evaluate((element) => {
            const view = (element as any).cmTile.root.view;
            view.focus();
            view.dispatch({ selection: { anchor: view.state.sliceDoc().indexOf("끝.") + 1 } });
          });
        }
        const initial = await snapshot(editor);
        const originalLine = initial.text.split("\n").find((line) => line.includes(target.word));
        if (!originalLine) throw new Error("원문 줄을 찾지 못했습니다");
        const line = editor.locator(".cm-line").filter({ hasText: target.word });
        const rendered = await line.textContent();
        const point = await glyph(editor, target.word);
        await page.mouse.move(point.x, point.y);
        for (let count = 1; count <= clicks; count++) {
          await page.mouse.down({ clickCount: count });
          expect(await line.textContent()).toBe(rendered);
          await page.mouse.up({ clickCount: count });
        }
        const selected = await snapshot(editor);
        expect(selected.selected).toBe(clicks === 2 ? target.word : `${originalLine}\n`);
        const from = Math.min(selected.anchor, selected.head);
        const to = Math.max(selected.anchor, selected.head);
        const expected = initial.text.slice(0, from) + "X" + initial.text.slice(to);
        await page.keyboard.type("X");
        await expect.poll(async () => (await snapshot(editor)).text).toBe(expected);
        await expectSaved(page, expected);
      });
    }
  }
}

test("문서의 CodeMirror mouseup 처리 뒤 window에서 원문을 반영한다", async ({ page }) => {
  const { editor } = await open(page);
  const point = await glyph(editor, "다시 누르기 시험");
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.evaluate(() => {
    (window as any).pointerOrder = [];
    const record = (stage: string) => {
      const el = document.querySelector(".cm-content") as any;
      const view = el.cmTile.root.view;
      (window as any).pointerOrder.push({ stage, mouseAlive: !!view.inputState.mouseSelection,
        text: el.querySelector(".cm-line").textContent });
    };
    document.addEventListener("mouseup", () => record("document"), { once: true });
    window.addEventListener("mouseup", () => record("window"), { once: true });
  });
  await page.mouse.up();
  const order = await page.evaluate(() => (window as any).pointerOrder);
  expect(order).toEqual([
    { stage: "document", mouseAlive: false, text: "다시 누르기 시험" },
    { stage: "window", mouseAlive: false, text: "# 다시 누르기 시험" },
  ]);
});

for (const signal of ["blur", "pointercancel", "buttons-0", "mousedown"] as const) {
  test(`mouseup을 놓친 뒤 ${signal} 신호로 원문 전환이 다시 따라온다`, async ({ page }) => {
    const { editor } = await open(page);
    const point = await glyph(editor, "다시 누르기 시험");
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await expect(editor.locator(".cm-line").first()).not.toContainText("#");
    await editor.evaluate((element, signal) => {
      if (signal === "blur") window.dispatchEvent(new Event("blur"));
      if (signal === "pointercancel") window.dispatchEvent(new PointerEvent("pointercancel"));
      if (signal === "buttons-0") window.dispatchEvent(new PointerEvent("pointermove", { buttons: 0 }));
      if (signal === "mousedown") element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1 }));
    }, signal);
    if (signal === "mousedown") {
      await expect(editor.locator(".cm-line").first()).toContainText("# 다시 누르기 시험");
      await page.evaluate(() => document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 })));
    }
    await editor.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(editor.locator(".cm-line").filter({ hasText: "제목 줄 글자" })).toContainText("## 제목 줄 글자");
    await page.mouse.up();
  });
}

for (const movement of ["누르기", "칸 사이 끌기"] as const) {
  test(`표 ${movement} 후 누른 칸의 원문으로 들어간다`, async ({ page }) => {
    const { editor } = await open(page);
    const source = (await snapshot(editor)).text;
    const first = editor.locator("table td").first();
    const second = editor.locator("table td").nth(1);
    const a = await first.boundingBox(), b = await second.boundingBox();
    if (!a || !b) throw new Error("표 칸을 찾지 못했습니다");
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    if (movement === "칸 사이 끌기") await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await expect(editor.locator("table")).toBeVisible();
    await page.mouse.up();
    await expect(editor.locator("table")).toHaveCount(0);
    const selected = await snapshot(editor);
    const pos = source.indexOf("하나");
    expect(selected.anchor).toBe(selected.head);
    expect(selected.head).toBeGreaterThanOrEqual(pos - 1);
    expect(selected.head).toBeLessThanOrEqual(pos + "하나".length);
    expect(selected.focused).toBe(true);
  });
}

for (const mode of ["포커스 없음", "다른 줄 포커스"] as const) {
  for (const target of [
    { name: "머리 칸", selector: "th", text: "항목", word: "항목", source: "항목" },
    { name: "본문 칸", selector: "td", text: "하나", word: "하나", source: "하나" },
    { name: "굵은 글자 칸", selector: "td", text: "굵은 글자", word: "글자", source: "**굵은 글자**" },
    { name: "인라인 코드 칸", selector: "td", text: "코드 낱말", word: "낱말", source: "`코드 낱말`" },
  ]) {
    for (const clicks of [2, 3]) {
      test(`${mode} · 표 ${target.name} ${clicks}회 누르기와 저장`, async ({ page }) => {
        const { editor } = await open(page);
        if (mode === "다른 줄 포커스") {
          await editor.evaluate((element) => {
            const view = (element as any).cmTile.root.view;
            view.focus();
            view.dispatch({ selection: { anchor: view.state.sliceDoc().indexOf("끝.") + 1 } });
          });
        }
        const initial = await snapshot(editor);
        const cell = editor.locator(`table ${target.selector}`).filter({ hasText: target.text });
        const point = await cell.evaluate((element, word) => {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const text = walker.currentNode as Text;
            const offset = text.data.indexOf(word);
            if (offset < 0) continue;
            const range = document.createRange();
            const index = offset + Math.floor(word.length / 2);
            range.setStart(text, index); range.setEnd(text, index + 1);
            const rect = range.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          }
          throw new Error(`칸의 글자를 찾지 못했습니다: ${word}`);
        }, target.word);
        await page.mouse.move(point.x, point.y);
        for (let count = 1; count <= clicks; count++) {
          await page.mouse.down({ clickCount: count });
          await page.mouse.up({ clickCount: count });
        }
        const selected = await snapshot(editor);
        const from = Math.min(selected.anchor, selected.head), to = Math.max(selected.anchor, selected.head);
        const cellFrom = initial.text.indexOf(target.source), cellTo = cellFrom + target.source.length;
        expect(selected.selected).toBe(clicks === 2 ? target.word : target.source);
        expect(from).toBeGreaterThanOrEqual(cellFrom);
        expect(to).toBeLessThanOrEqual(cellTo);
        await expect(editor.locator("table")).toHaveCount(0);
        const expected = initial.text.slice(0, from) + "X" + initial.text.slice(to);
        await page.keyboard.type("X");
        await expect.poll(async () => (await snapshot(editor)).text).toBe(expected);
        await expectSaved(page, expected);
      });
    }
  }
}

test("렌더 줄에서 편집기 밖으로 끌고 놓아도 선택과 키보드 이동이 이어진다", async ({ page }) => {
  const { app, editor } = await open(page);
  const point = await glyph(editor, "글자들이");
  const tree = await app.locator(".ks-file-tree-list").boundingBox();
  if (!tree) throw new Error("파일 목록을 찾지 못했습니다");
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  const start = await snapshot(editor);
  await page.mouse.move(tree.x + tree.width / 2, tree.y + tree.height - 12, { steps: 8 });
  await page.mouse.up();
  const selected = await snapshot(editor);
  expect(selected.anchor).toBe(start.anchor);
  expect(selected.anchor).not.toBe(selected.head);
  await page.keyboard.press("ArrowLeft");
  expect((await snapshot(editor)).anchor).toBe((await snapshot(editor)).head);
});
