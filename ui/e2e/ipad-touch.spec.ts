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

async function rowCenter(page: Page, name: string) {
  const row = page.getByTestId("app-window-data-views-test").getByRole("option", { name, exact: true });
  await expect(row).toBeVisible();
  const box = (await row.boundingBox())!;
  return { row, x: box.x + Math.min(48, box.width / 3), y: box.y + box.height / 2 };
}

test("행을 길게 누르면 누른 자리에 메뉴가 뜬다", async ({ page }) => {
  await page.goto("/?preview=data-views-test");
  const { x, y } = await rowCenter(page, "항목 1");
  await pointer(page, "pointerdown", x, y);
  await expect(page.getByRole("menuitem", { name: "주소 복사" })).toHaveCount(0);
  await page.waitForTimeout(650);
  await expect(page.getByRole("menuitem", { name: "주소 복사" })).toBeVisible();
  await pointer(page, "pointerup", x, y);
  const menuBox = (await page.getByRole("menu").boundingBox())!;
  expect(Math.abs(menuBox.x - x)).toBeLessThanOrEqual(4);
  expect(Math.abs(menuBox.y - y)).toBeLessThanOrEqual(4);
});

test("10px 넘게 움직이거나 일찍 떼면 메뉴가 뜨지 않는다", async ({ page }) => {
  await page.goto("/?preview=data-views-test");
  const { x, y } = await rowCenter(page, "항목 1");
  await pointer(page, "pointerdown", x, y);
  await pointer(page, "pointermove", x + 40, y);
  await page.waitForTimeout(650);
  await pointer(page, "pointerup", x + 40, y);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await pointer(page, "pointerdown", x, y);
  await page.waitForTimeout(200);
  await pointer(page, "pointerup", x, y);
  await page.waitForTimeout(650);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("길게 눌러 연 메뉴 항목은 한 번만 실행된다", async ({ page }) => {
  await page.goto("/?preview=data-views-test");
  const app = page.getByTestId("app-window-data-views-test");
  await selectTab(app, "지우기 시험");
  const { row, x, y } = await rowCenter(page, "항목 3");
  const before = await app.getByRole("option").count();
  await pointer(page, "pointerdown", x, y);
  await page.waitForTimeout(650);
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
