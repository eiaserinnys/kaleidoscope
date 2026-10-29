import { expect, test } from "@playwright/test";

const evidence = process.env.KS_ATTACHMENTS_EVIDENCE;
for (const { width, theme } of [{ width: 360, theme: "dark" }, { width: 720, theme: "light" }] as const) {
  test(`첨부와 이미지 붙여넣기 (${width}, ${theme})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/?preview=workspace-pas&pas=ready&send-delay=1500");
    await page.addStyleTag({ content: ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }" });
    const imageData = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 160; canvas.height = 100;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#395d99"; context.fillRect(0, 0, 160, 100);
      context.fillStyle = "#f3c46b"; context.fillRect(20, 20, 120, 60);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const png = Buffer.from(imageData, "base64");
    const chat = page.getByTestId("app-window-workspace-pas");
    const input = chat.getByRole("textbox", { name: "메시지" });
    const picker = chat.locator('input[type="file"]');
    await input.evaluate((element, bytes) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], "clipboard.png", { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, Array.from(png));
    const draftThumb = chat.getByRole("button", { name: "붙여넣은 이미지.png", exact: true });
    await expect(draftThumb.locator("img")).toBeVisible();
    await input.fill("첫 줄\n둘째 줄\n셋째 줄");
    const dimensions = await chat.locator(".ks-agent-chat-input-row").evaluate((row) => {
      const buttons = row.querySelectorAll("button");
      const field = row.querySelector("textarea")!.getBoundingClientRect();
      const attach = buttons[0].getBoundingClientRect();
      const send = buttons[1].getBoundingClientRect();
      return { fieldBottom: field.bottom, attachBottom: attach.bottom, sendBottom: send.bottom, attachHeight: attach.height, sendHeight: send.height, sendRight: send.right, rowRight: row.getBoundingClientRect().right };
    });
    expect(Math.abs(dimensions.attachBottom - dimensions.sendBottom)).toBeLessThanOrEqual(1);
    expect(dimensions.attachHeight).toBe(dimensions.sendHeight);
    expect(dimensions.sendRight).toBeLessThanOrEqual(dimensions.rowRight);
    console.log(`${width} input geometry: ${JSON.stringify(dimensions)}`);
    if (evidence) await page.screenshot({ path: `${evidence}/${width}-${theme}-draft.png` });
    await input.fill("");
    await input.press("Enter");
    await expect(chat.locator(".ks-agent-chat-user.is-pending img")).toBeVisible();
    if (evidence) await page.screenshot({ path: `${evidence}/${width}-${theme}-pending.png` });
    const historyImage = chat.locator(".ks-agent-chat-user:not(.is-pending)").getByRole("button", { name: "붙여넣은 이미지.png" });
    await expect(historyImage.locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);
    await historyImage.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    if (evidence) await page.screenshot({ path: `${evidence}/${width}-${theme}-preview.png` });
    await page.keyboard.press("Escape");
    await expect(historyImage).toBeFocused();

    await picker.setInputFiles([{ name: "메모.txt", mimeType: "text/plain", buffer: Buffer.from("memo") }, { name: "사진.png", mimeType: "image/png", buffer: png }]);
    await expect(chat.getByRole("button", { name: "메모.txt 빼기" })).toBeVisible();
    await expect(chat.getByRole("button", { name: "사진.png 빼기" })).toBeVisible();
    await chat.getByRole("button", { name: "사진.png 빼기" }).click();
    await input.press("Enter");
    await expect(chat.locator(".ks-agent-chat-user:not(.is-pending)").getByRole("button", { name: "메모.txt" })).toBeVisible();
    if (evidence) await page.screenshot({ path: `${evidence}/${width}-${theme}-history.png` });

    await picker.setInputFiles(Array.from({ length: 11 }, (_, i) => ({ name: `긴 이름을 가진 첨부 파일 ${i}.txt`, mimeType: "text/plain", buffer: Buffer.from("x") })));
    await expect(chat.getByRole("alert")).toContainText("첨부는 한 번에 10개까지입니다");
    const boxes = await chat.locator(".ks-agent-attachment-chip").evaluateAll((elements) => elements.filter((e) => e.closest(".ks-agent-attachment-list")).map((e) => ({ top: e.getBoundingClientRect().top, right: e.getBoundingClientRect().right, parentRight: e.parentElement!.getBoundingClientRect().right })));
    expect(new Set(boxes.map((box) => box.top)).size).toBeGreaterThan(1);
    expect(boxes.every((box) => box.right <= box.parentRight + 1)).toBe(true);
    await expect(input).toBeInViewport();
    await expect(chat.getByRole("button", { name: "보내기" })).toBeInViewport();
    if (evidence) await page.screenshot({ path: `${evidence}/${width}-${theme}-limit.png` });
  });
}
