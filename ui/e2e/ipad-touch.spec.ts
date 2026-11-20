import { expect, test, type Page } from "@playwright/test";
import { selectTab } from "./tab-helper";

// Playwright의 touchscreen은 짧은 탭만 흉내 내므로, 길게 누르기는 포인터 사건을 직접 보낸다.
async function pointer(page: Page, type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number) {
  await page.evaluate(({ type, x, y }) => {
    const target = type === "pointerdown" ? document.elementFromPoint(x, y) ?? document : document;
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, pointerId: 7, pointerType: "touch", isPrimary: true,
      button: 0, buttons: type === "pointerup" ? 0 : 1,
    }));
  }, { type, x, y });
}

// 목록은 첫 그림을 추정 높이(40px)로 그린 뒤 잰 높이(32px)로 다시 그린다. 그 사이에 미리 잰 상자로
// 누르면 행이 밀린 만큼 이웃 행을 누르게 되어, 메뉴는 열리지만 다른 행이 지워진다.
// 누르는 순간의 자리에서 좌표를 잡고 그 자리가 그 행에 닿는 것을 확인한 뒤 같은 과제에서 누른다.
// release를 주면 길게 누르기 문턱(500ms) 전에 떼는 탭이 된다. 누름과 뗌을 같은 과제에서 보내야
// 그 사이 지연이 문턱을 넘지 않는다.
async function rowGesture(page: Page, name: string, release = false) {
  const row = page.getByTestId("app-window-data-views-test").getByRole("option", { name, exact: true });
  await expect(row).toBeVisible();
  const key = await row.getAttribute("data-row-key");
  if (key === null) throw new Error(`행 키를 읽지 못했습니다: ${name}`);
  const point = await page.evaluate(({ key, release }) => {
    const target = document.querySelector<HTMLElement>(`[data-testid="app-window-data-views-test"] [role="option"][data-row-key="${key}"]`);
    if (!target) throw new Error(`누를 행을 찾지 못했습니다: ${key}`);
    const box = target.getBoundingClientRect();
    const x = box.left + Math.min(48, box.width / 3);
    const y = box.top + box.height / 2;
    const element = document.elementFromPoint(x, y) ?? target;
    if (element.closest('[role="option"]') !== target) throw new Error(`누를 자리가 그 행이 아닙니다: ${key}`);
    const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 7, pointerType: "touch", isPrimary: true, button: 0 };
    element.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
    if (release) document.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
    return { x, y };
  }, { key, release });
  return { row, x: point.x, y: point.y };
}

const rowPress = (page: Page, name: string) => rowGesture(page, name, false);
const rowTap = (page: Page, name: string) => rowGesture(page, name, true);

test("행을 길게 누르면 누른 자리에 메뉴가 뜬다", async ({ page }) => {
  await page.goto("/?preview=data-views-test");
  const { x, y } = await rowPress(page, "항목 1");
  await expect(page.getByRole("menuitem", { name: "주소 복사" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "주소 복사" })).toBeVisible();
  await pointer(page, "pointerup", x, y);
  const menuBox = (await page.getByRole("menu").boundingBox())!;
  expect(Math.abs(menuBox.x - x)).toBeLessThanOrEqual(4);
  expect(Math.abs(menuBox.y - y)).toBeLessThanOrEqual(4);
});

test("10px 넘게 움직이거나 일찍 떼면 메뉴가 뜨지 않는다", async ({ page }) => {
  await page.goto("/?preview=data-views-test");
  const { x, y } = await rowPress(page, "항목 1");
  await pointer(page, "pointermove", x + 40, y);
  await page.waitForTimeout(650);
  await pointer(page, "pointerup", x + 40, y);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await rowTap(page, "항목 1");
  // 문턱 전에 뗐으니 메뉴가 없어야 한다. 잘못 걸린 타이머가 늦게라도 돌지 않는지 기다려 본다.
  await page.waitForTimeout(650);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("길게 눌러 연 메뉴 항목은 한 번만 실행된다", async ({ page }) => {
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await selectTab(app, "지우기 시험");
  const { row, x, y } = await rowPress(page, "항목 3");
  const before = await app.getByRole("option").count();
  await expect(page.getByRole("menuitem", { name: "지우기" })).toBeVisible();
  await pointer(page, "pointerup", x, y);
  await page.getByRole("menuitem", { name: "지우기" }).click();
  const dialog = page.getByRole("dialog", { name: "지울까요?" });
  await expect(dialog).toHaveCount(1);
  await dialog.getByRole("button", { name: "지우기" }).click();
  await expect(row).toHaveCount(0);
  expect(await app.getByRole("option").count()).toBe(before - 1);
});

test("hover가 없는 손가락 기기에서는 피드 복사 단추가 보인다", async ({ page }) => {
  await page.goto("/?preview=data-views-test");
  expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true);
  const app = page.getByTestId("app-window-data-views-test");
  await selectTab(app, "병기 시험");
  const copy = app.locator(".ks-feed-copy-control").first();
  await expect(copy).toBeAttached();
  await expect.poll(() => copy.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
});

test("입력 칸에서는 길게 눌러도 메뉴를 만들지 않는다", async ({ page }) => {
  await page.goto("/context-menu.html");
  const input = page.getByLabel("글", { exact: true });
  const box = (await input.boundingBox())!;
  await pointer(page, "pointerdown", box.x + 10, box.y + box.height / 2);
  await page.waitForTimeout(650);
  await pointer(page, "pointerup", box.x + 10, box.y + box.height / 2);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("글자 선택이 열린 자리에서는 기기 선택을 그대로 두고 기본 메뉴를 열지 않는다", async ({ page }) => {
  await page.goto("/context-menu.html");
  const reading = page.locator("#reading");
  expect(await reading.evaluate((element) => getComputedStyle(element).userSelect)).toBe("text");
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("reading")!);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const box = (await reading.boundingBox())!;
  const x = box.x + 12;
  const y = box.y + box.height / 2;
  await pointer(page, "pointerdown", x, y);
  await page.waitForTimeout(650);
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("읽는 글을 선택합니다.");
  await pointer(page, "pointerup", x, y);
});
