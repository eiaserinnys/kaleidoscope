import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

function captureDir() { return test.info().outputPath("captures"); }

test.beforeEach(async ({ context }) => { await context.grantPermissions(["clipboard-read", "clipboard-write"]); });

test("링크와 코드 펜스는 원문을 복사하고 대화 안에서 안쪽 메뉴가 이긴다", async ({ page }) => {
  await page.goto("/context-menu.html?content=1");
  const link = page.getByRole("link", { name: "링크" });
  await link.click({ button: "right" });
  await expect(page.getByRole("menuitem")).toHaveCount(2);
  await expect(page.getByRole("menuitem", { name: "메시지 복사" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "링크 주소 복사" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://example.com/path");
  const pre = page.locator("pre");
  await pre.focus(); await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menuitem", { name: "메시지 복사" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "코드 복사" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("첫 줄\n둘째 줄\n");
  const message = page.locator(".ks-agent-chat-assistant");
  await message.focus(); await page.keyboard.press("ContextMenu");
  await page.getByRole("menuitem", { name: "메시지 복사" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("[링크](https://example.com/path)\n\n```text\n첫 줄\n둘째 줄\n```");
});

test("첨부 그림을 PNG로 복사하고 기존 크게 보기를 연다", async ({ page }) => {
  await page.goto("/context-menu.html?content=1");
  const image = page.getByRole("button", { name: "그림.png" });
  await expect(image.locator("img")).toBeVisible();
  await image.click({ button: "right" });
  await expect(page.getByRole("menuitem")).toHaveText(["크게 보기", "이미지 복사"]);
  await page.getByRole("menuitem", { name: "이미지 복사" }).click();
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types))).toContain("image/png");
  await image.focus(); await page.keyboard.press("ContextMenu");
  await page.getByRole("menuitem", { name: "크게 보기" }).click();
  await expect(page.getByRole("dialog", { name: "그림.png" })).toBeVisible();
});

test("실제 이미지 블록과 읽기 전용 코드 블록의 메뉴", async ({ page }) => {
  await page.goto("/?preview=block-gallery&long-log");
  await page.getByRole("tab", { name: "코드" }).click();
  const code = page.getByRole("textbox", { name: "코드 보기" });
  await code.focus(); await page.keyboard.press("ContextMenu");
  await page.getByRole("menuitem", { name: "코드 복사" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("줄 19999");
  await page.getByRole("tab", { name: "미디어" }).click();
  await page.getByText("landscape.png").click();
  const image = page.locator(".ks-image-view .ks-image-frame img");
  await expect(image).toBeVisible();
  await image.click({ button: "right" });
  await page.getByRole("menuitem", { name: "이미지 복사" }).click();
  expect(await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types))).toContain("image/png");
});

for (const [label, width] of [["wide", 1100], ["narrow", 520]] as const) {
  test(`${label} 링크·코드·이미지·말 메뉴 캡처`, async ({ page }) => {
    mkdirSync(captureDir(), { recursive: true });
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/context-menu.html?content=1");
    for (const [name, selector] of [["link", "a"], ["code", "pre"], ["image", ".ks-agent-attachment-image"], ["message", ".ks-agent-chat-assistant"]] as const) {
      const target = page.locator(selector).first();
      if (name === "message") { await target.focus(); await page.keyboard.press("ContextMenu"); }
      else await target.click({ button: "right", position: { x: 4, y: 4 } });
      await expect(page.getByRole("menu")).toBeVisible();
      await page.screenshot({ path: `${captureDir()}/${label}-${name}.png` });
      await page.keyboard.press("Escape");
    }
  });
}
