import { expect, test, type Locator } from "@playwright/test";

const selection = (input: Locator) => input.evaluate((e: HTMLInputElement) => [e.selectionStart, e.selectionEnd]);
const textPoint = (input: Locator, count: number) => input.evaluate((e: HTMLInputElement, n) => {
  const ctx = document.createElement("canvas").getContext("2d")!;
  const css = getComputedStyle(e); ctx.font = css.font;
  const r = e.getBoundingClientRect();
  return { x: r.left + parseFloat(css.paddingLeft) + parseFloat(css.borderLeftWidth) + ctx.measureText(e.value.slice(0, n)).width, y: r.top + r.height / 2 };
}, count);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.goto("/?preview=input-options-fixture");
});

test("포인터 드래그와 더블클릭은 일부 글자 선택을 보존한다", async ({ page }) => {
  const f = page.getByRole("combobox", { name: "글자 선택" });
  await f.scrollIntoViewIfNeeded();
  await page.evaluate(() => { (window as any).dragStarts = 0; document.addEventListener("dragstart", () => (window as any).dragStarts++); });
  const a = await textPoint(f, 2); const b = await textPoint(f, 8);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
  expect(await selection(f)).toEqual([2, 8]);
  expect(await page.evaluate(() => (window as any).dragStarts)).toBe(0);
  await f.blur();
  const word = await textPoint(f, 7);
  await page.mouse.dblclick(word.x, word.y);
  expect(await selection(f)).toEqual([6, 10]);
});

for (const method of ["이름", "행", "방향키"]) test(method + " 선택 직후 blur 없이 다시 입력한다", async ({ page }) => {
  const f = page.getByRole("combobox", { name: "글자 선택" });
  await f.click();
  if (method === "이름") { await page.keyboard.type("포"); await f.press("Enter"); }
  else if (method === "행") await page.getByRole("option", { name: "포도", exact: true }).click();
  else { await f.press("ArrowDown"); await f.press("Enter"); }
  await page.keyboard.type("배");
  await expect(f).toHaveValue("배");
  await f.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await f.press("Escape"); await f.click(); await page.keyboard.type("포");
  await expect(f).toHaveValue("포");
});

test("실패 Enter와 Esc는 초안과 목록을 함께 되돌린다", async ({ page }) => {
  const f = page.getByRole("combobox", { name: "글자 선택" });
  for (const key of ["Enter", "Escape"]) {
    await f.click(); await f.fill("없는 이름"); await f.press(key);
    await expect(f).toHaveValue("Alpha beta gamma");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  }
});

test("검색 칸은 꺾쇠를 그리지 않는다", async ({ page }) => {
  const f = page.getByRole("combobox", { name: "검색 전용" });
  const parent = f.locator("..");
  await expect(parent.locator(".ks-combobox-indicator")).toHaveCount(0);
});

test("검색 전용의 지우기는 빈 값을 저장한다", async ({ page }) => {
  const f = page.getByRole("combobox", { name: "검색 전용" });
  const parent = f.locator("..");
  await parent.getByRole("button", { name: "지우기" }).click();
  await expect(f).toHaveValue("");
  await expect.poll(() => page.evaluate(() => (window as any).inputOptionsHarness.state().search)).toBe("");
});

test("columns 여섯 글자를 가리지 않는다", async ({ page }) => {
  const f = page.getByRole("combobox", { name: "여섯 글자" });
  const geometry = () => f.evaluate((e) => ({ width: e.getBoundingClientRect().width, client: e.clientWidth, scroll: e.scrollWidth }));
  await f.scrollIntoViewIfNeeded();
  const before = await geometry();
  expect(before.scroll).toBe(before.client);
});

test("꺾쇠 색은 입력 글자색을 따른다", async ({ page }) => {
  const f = page.getByRole("combobox", { name: "여섯 글자" });
  const colors = await f.evaluate(e => ({ indicator: getComputedStyle(e.parentElement!.querySelector(".ks-combobox-indicator")!).color, text: getComputedStyle(e).color }));
  expect(colors.indicator).toBe(colors.text);
});

test("잠금 전환에도 꺾쇠와 칸 폭을 유지한다", async ({ page }) => {
  const f = page.getByRole("combobox", { name: "여섯 글자" });
  await f.scrollIntoViewIfNeeded();
  const before = (await f.boundingBox())!;
  await page.getByRole("button", { name: "잠금 전환" }).click();
  await expect(f).toBeDisabled();
  await expect(f.locator("..").locator(".ks-combobox-indicator")).toBeVisible();
  expect((await f.boundingBox())!.width).toBe(before.width);
});

test("세 행 여유가 부족하면 쉘 세로 범위 안에서 연다", async ({ page }) => {
  const app = page.getByTestId("app-window-input-options-fixture");
  await app.evaluate(e => { Object.assign(e.style, { width: "360px", height: "420px" }); });
  const f = page.getByRole("combobox", { name: "목록 전용" });
  await f.focus();
  const popup = page.locator(".ks-combobox-popup");
  const host = await app.locator(".ks-data-window").boundingBox(); const box = await popup.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(host!.x);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  const description = await page.locator(".ks-combobox-description").evaluate(e => {
    const css = getComputedStyle(e);
    return { height: e.getBoundingClientRect().height, line: parseFloat(css.lineHeight) + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) };
  });
  expect(description.height).toBeGreaterThanOrEqual(description.line);
  await f.fill("entry-0"); await f.press("Enter"); await f.click(); await f.press("ArrowDown");
  const changed = await page.locator(".ks-combobox-description").boundingBox();
  expect(changed!.height).toBeGreaterThanOrEqual(description.line);
});

test("칸이 스크롤로 사라지면 목록을 닫는다", async ({ page }) => {
  const app = page.getByTestId("app-window-input-options-fixture");
  await app.evaluate(e => { Object.assign(e.style, { width: "360px", height: "420px" }); });
  const f = page.getByRole("combobox", { name: "목록 전용" });
  await f.focus();
  const popup = page.locator(".ks-combobox-popup");
  await f.evaluate(e => { for (let p = e.parentElement; p; p = p.parentElement) if (p.scrollHeight > p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY)) { p.scrollTop = p.scrollHeight; break; } });
  await expect(popup).toHaveCount(0);
});

test("선택 표식과 설명 Esc, 꺾쇠 토글, 뒤 공백", async ({ page }) => {
  const f = page.getByRole("combobox", { name: "목록 전용" });
  await f.click();
  await expect(page.getByRole("option", { selected: true }).locator(".ks-menu-check")).toBeVisible();
  const description = page.locator(".ks-combobox-description");
  await description.click(); await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await f.click();
  await f.locator("..").locator(".ks-combobox-indicator").click({ force: true });
  await expect(page.getByRole("listbox")).toHaveCount(0);
  const letters = page.getByRole("combobox", { name: "글자 선택" });
  await letters.fill("포도 "); await letters.press("Enter");
  await expect(letters).toHaveValue("포도");
});

for (const ending of ["Enter", "Escape", "꺾쇠"]) test(`되돌림과 ${ending} 닫기 직후 입력은 교체한다`, async ({ page }) => {
  const f = page.getByRole("combobox", { name: "글자 선택" });
  await f.click();
  if (ending !== "꺾쇠") { await page.keyboard.type("없는 이름"); await f.press(ending); }
  else { const b = (await f.boundingBox())!; await page.mouse.click(b.x + b.width - 20, b.y + b.height / 2); }
  await page.keyboard.type("포");
  await expect(f).toHaveValue("포");
});

test("자동 전체 선택 뒤 끌어 놓아도 다른 칸으로 값을 보내지 않는다", async ({ page }) => {
  const f = page.getByRole("combobox", { name: "글자 선택" });
  await f.click(); await expect.poll(() => selection(f)).toEqual([0, 16]);
  await page.evaluate(() => { (window as any).dragStarts = 0; document.addEventListener("dragstart", () => (window as any).dragStarts++); });
  const a = await textPoint(f, 2), b = await textPoint(f, 8);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
  expect(await selection(f)).toEqual([2, 8]);
  await f.blur(); await f.click(); await page.waitForTimeout(150);
  const target = page.getByRole("combobox", { name: "검색 전용" }); const box = (await target.boundingBox())!;
  const original = await target.inputValue();
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(box.x + 30, box.y + 16, { steps: 8 }); await page.mouse.up();
  expect(await page.evaluate(() => (window as any).dragStarts)).toBe(0);
  await expect(target).toHaveValue(original);
});

test("110ms 간격의 더블클릭은 단어를 고른다", async ({ page }) => {
  const f = page.getByRole("combobox", { name: "글자 선택" }); await f.scrollIntoViewIfNeeded();
  const p = await textPoint(f, 7);
  await page.mouse.move(p.x, p.y); await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 });
  await expect.poll(() => selection(f)).toEqual([0, 16]); await page.waitForTimeout(110);
  await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
  expect(await selection(f)).toEqual([6, 10]);
});

test("검색 X 뒤 바로 입력할 수 있다", async ({ page }) => {
  const f = page.getByRole("combobox", { name: "검색 전용" });
  await f.locator("..").getByRole("button", { name: "지우기" }).click();
  await expect(f).toBeFocused(); await page.keyboard.type("포"); await expect(f).toHaveValue("포");
});

test("설명 없는 행과 있는 행을 오가도 목록 상자와 세 줄 여유를 지킨다", async ({ page }) => {
  const app = page.getByTestId("app-window-input-options-fixture");
  await app.evaluate(e => { Object.assign(e.style, { width: "360px", height: "320px" }); });
  const f = page.getByRole("combobox", { name: "목록 전용" }); await f.fill("entry-0"); await f.press("Enter"); await f.click();
  const list = page.locator(".ks-combobox-list");
  const before = (await list.boundingBox())!;
  const row = (await page.getByRole("option").first().boundingBox())!;
  expect(before.height).toBeGreaterThanOrEqual(row.height * 3);
  await f.press("ArrowDown"); await page.waitForTimeout(100);
  const after = (await list.boundingBox())!;
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
});

 test("일반 검색 X도 입력에 초점을 남긴다", async ({ page }) => {
  const f = page.getByLabel("일반 검색", { exact: true });
  await f.locator("..").getByRole("button", { name: "지우기" }).click();
  await expect(f).toBeFocused(); await page.keyboard.type("새 검색"); await expect(f).toHaveValue("새 검색");
});

test("설명 칸에서 편집을 취소한 직후에도 교체한다", async ({ page }) => {
  const f = page.getByRole("combobox", { name: "목록 전용" });
  await f.fill("항목 1"); await f.press("ArrowDown");
  await page.locator(".ks-combobox-description").click(); await page.keyboard.press("Escape");
  await page.keyboard.type("배"); await expect(f).toHaveValue("배");
});

test("옆 설명은 필요할 때만 그리면서 짧은 목록의 행을 고정한다", async ({ page }) => {
  const f = page.getByLabel("짧은 목록", { exact: true }); await f.scrollIntoViewIfNeeded(); await f.focus();
  const list = page.locator(".ks-combobox-list"); const before = (await list.boundingBox())!;
  await expect(page.locator(".ks-combobox-description")).toHaveCount(0);
  await f.press("ArrowUp"); await page.waitForTimeout(100);
  await expect(page.locator(".ks-combobox-description")).toBeVisible();
  const after = (await list.boundingBox())!;
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
});

for (const ending of ["Enter", "Escape"]) test(`닫힌 ${ending} 뒤 Enter는 다음 첫 글자를 고르지 않는다`, async ({ page }) => {
  const f = page.getByRole("combobox", { name: "글자 선택" });
  await f.click();
  if (ending === "Enter") await f.fill("포도");
  await f.press(ending); await f.press("Enter");
  await page.keyboard.type("x"); await page.waitForTimeout(120); await page.keyboard.type("y");
  await expect(f).toHaveValue("xy");
});

test("자동 전체 선택의 우클릭은 선택과 복사·잘라내기를 유지한다", async ({ page }) => {
  const f = page.getByRole("combobox", { name: "글자 선택" });
  await f.click(); await expect.poll(() => selection(f)).toEqual([0, 16]);
  const point = await textPoint(f, 4);
  await page.mouse.click(point.x, point.y, { button: "right" });
  expect(await selection(f)).toEqual([0, 16]);
  await expect(page.getByRole("menuitem", { name: /^복사/ })).toBeEnabled();
  await expect(page.getByRole("menuitem", { name: /^잘라내기/ })).toBeEnabled();
});

for (const name of ["검색 전용", "선택지 검색", "일반 검색"]) for (const keyboard of [false, true]) test(`${name} ${keyboard ? "키보드" : "포인터"} X는 닫고 비운 뒤 입력을 기다린다`, async ({ page }) => {
  const f = page.getByLabel(name, { exact: true });
  const clear = f.locator("..").getByRole("button", { name: "지우기" });
  if (keyboard) { await clear.focus(); await clear.press("Enter"); } else await clear.click();
  await expect(f).toBeFocused(); await expect(f).toHaveValue("");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await f.press("Enter"); await expect(f).toHaveValue("");
  await page.keyboard.type("항목"); await expect(f).toHaveValue("항목");
  await expect(page.getByRole("listbox")).toHaveCount(name === "일반 검색" ? 0 : 1);
});

test("설명 없는 활성·검색·일치 없음에는 빈 설명 칸이 없다", async ({ page }) => {
  const f = page.getByRole("combobox", { name: "목록 전용" });
  await f.fill("entry-0"); await f.press("Enter"); await f.click();
  for (const query of [null, "항목", "없는 이름"]) {
    if (query !== null) await f.fill(query);
    await expect(page.locator(".ks-combobox-description")).toHaveCount(0);
    await expect(page.locator(".ks-combobox-separator")).toHaveCount(0);
  }
});

test("처음 재는 순간에도 목록 높이를 제한해 가상 행을 전부 그리지 않는다", async ({ page }) => {
  await page.evaluate(() => {
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!;
    (window as any).comboboxPeak = { height: 0, rows: 0 };
    Object.defineProperty(Element.prototype, "clientHeight", { ...original, get(this: Element) {
      const height = original.get!.call(this);
      if (this.matches(".ks-combobox-list")) {
        const peak = (window as any).comboboxPeak;
        peak.height = Math.max(peak.height, height);
        peak.rows = Math.max(peak.rows, this.querySelectorAll('[role="option"]').length);
      }
      return height;
    } });
  });
  const f = page.getByRole("combobox", { name: "목록 전용" });
  for (let i = 0; i < 2; i++) { await f.focus(); await expect(page.getByRole("listbox")).toBeVisible(); await f.press("Escape"); await f.blur(); }
  const peak = await page.evaluate(() => (window as any).comboboxPeak);
  console.log("초기 목록 측정", peak);
  const limit = await f.evaluate(e => 2 * parseFloat(getComputedStyle(e).getPropertyValue("--ks-pane-min-size")));
  expect(peak.height, JSON.stringify(peak)).toBeLessThanOrEqual(limit);
  expect(peak.rows, JSON.stringify(peak)).toBeLessThan(100);
});
