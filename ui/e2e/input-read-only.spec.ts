import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test("읽기 전용 입력은 두 테마에서 글을 선택하고 편집을 다시 켤 수 있다", async ({ page }) => {
  const output = process.env.KS_INPUT_READ_ONLY_CAPTURE_DIR;
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto("/?preview=input-read-only");
    const app = page.getByTestId("app-window-input-read-only");
    const title = app.getByRole("textbox", { name: "제목" });
    const body = app.getByRole("textbox", { name: "내용" });
    await expect(title).toHaveAttribute("readonly", "");
    await expect(body).toHaveAttribute("readonly", "");
    for (const field of [title, body]) {
      const box = await field.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box!.x + 10, box!.y + box!.height / 2);
      await page.mouse.down();
      await page.mouse.move(box!.x + box!.width - 15, box!.y + box!.height / 2, { steps: 8 });
      await page.mouse.up();
      const selected = await field.evaluate((node: HTMLInputElement | HTMLTextAreaElement) => ({
        start: node.selectionStart ?? 0, end: node.selectionEnd ?? 0, userSelect: getComputedStyle(node).userSelect,
      }));
      expect(selected.userSelect).toBe("text");
      expect(selected.end).toBeGreaterThan(selected.start);
    }
    if (output) {
      mkdirSync(output, { recursive: true });
      await app.screenshot({ path: join(output, `input-read-only-${theme}.png`) });
    }
    await app.getByRole("switch", { name: "읽기 전용" }).click();
    await expect(title).not.toHaveAttribute("readonly", "");
    await title.fill("수정된 제목");
    await title.blur();
    await expect(title).toHaveValue("수정된 제목");
  }
});
