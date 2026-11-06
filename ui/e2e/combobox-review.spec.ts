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

test("팝업은 세로 창 안에서 줄어든다", async ({ page }) => {
  const app = page.getByTestId("app-window-input-options-fixture");
  await app.evaluate(e => { Object.assign(e.style, { width: "360px", height: "420px" }); });
  const f = page.getByRole("combobox", { name: "목록 전용" });
  await f.focus();
  const popup = page.locator(".ks-combobox-popup");
  const host = await app.locator(".ks-data-window").boundingBox(); const box = await popup.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(host!.y);
  expect(box!.y + box!.height).toBeLessThanOrEqual(host!.y + host!.height);
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
