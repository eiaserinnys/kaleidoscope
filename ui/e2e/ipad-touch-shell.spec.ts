import { expect, test, type Page } from "@playwright/test";

const appPort = Number(process.env.KS_E2E_APP_PORT ?? Number(process.env.KS_E2E_PORT ?? 5173) + 1);
const appURL = `http://127.0.0.1:${appPort}`;

// 짧은 두 번 누르기를 포인터 사건으로 보낸다. dblclick은 화면 코드가 합성한다.
async function tapTwice(page: Page, x: number, y: number) {
  for (let count = 0; count < 2; count += 1) {
    await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y) ?? document;
      for (const type of ["pointerdown", "pointerup"]) {
        target.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, composed: true,
          clientX: x, clientY: y, pointerId: 9, pointerType: "touch", isPrimary: true,
          button: 0, buttons: type === "pointerdown" ? 1 : 0,
        }));
      }
    }, { x, y });
    await page.waitForTimeout(80);
  }
}

async function titlebarPoint(page: Page) {
  const box = (await page.getByTestId("app-window-calculator").locator(".ks-window-titlebar").boundingBox())!;
  return { x: box.x + 120, y: box.y + box.height / 2 };
}

test("제목줄을 두 번 누르면 창이 최대화되고 다시 두 번 누르면 복원된다", async ({ page }) => {
  await page.goto(`${appURL}/harness.html?window=calculator`);
  const window = page.getByTestId("app-window-calculator");
  await expect(window).toHaveAttribute("data-maximized", "false");
  const first = await titlebarPoint(page);
  await tapTwice(page, first.x, first.y);
  await expect(window).toHaveAttribute("data-maximized", "true");
  const second = await titlebarPoint(page);
  await tapTwice(page, second.x, second.y);
  await expect(window).toHaveAttribute("data-maximized", "false");
});
