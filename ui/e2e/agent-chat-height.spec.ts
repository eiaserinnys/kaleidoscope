import { expect, test, type Locator, type Page } from "@playwright/test";

type Measurement = { height: number; clientHeight: number; scrollHeight: number; buttonY: number };

async function measure(input: Locator, button: Locator): Promise<Measurement> {
  const dimensions = await input.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  const buttonY = await button.evaluate((element) => element.getBoundingClientRect().y);
  return { ...dimensions, buttonY };
}

async function openChat(page: Page, width: number) {
  // 하니스 바깥 여백을 포함해 PAS 창 자체의 폭을 맞춘다.
  await page.setViewportSize({ width: width + 32, height: 700 });
  await page.goto("/?preview=workspace-pas&pas=ready");
  await page.addStyleTag({ content: `
    .ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; }
    .ks-harness-dev-panel { display: none; }
  ` });
  const window = page.getByTestId("app-window-workspace-pas");
  const input = window.getByRole("textbox", { name: "메시지" });
  const button = window.getByRole("button", { name: "보내기" });
  await expect(input).toBeVisible();
  expect(await window.evaluate((element) => element.getBoundingClientRect().width)).toBe(width);
  return { window, input, button };
}

const lines = (count: number) => Array.from({ length: count }, (_, index) => `줄 ${index + 1}`).join("\n");

for (const width of [560, 360]) {
  test(`${width} 폭에서 입력이 8줄까지 자라고 보내면 한 줄로 돌아간다`, async ({ page }, testInfo) => {
    const { window, input, button } = await openChat(page, width);
    const growth: Measurement[] = [];

    for (let count = 1; count <= 8; count += 1) {
      await input.fill(lines(count));
      const current = await measure(input, button);
      growth.push(current);
      if (count > 1) {
        expect(current.height).toBeGreaterThan(growth[count - 2].height);
        expect(current.scrollHeight).toBe(current.clientHeight);
      }
      expect(current.buttonY).toBe(growth[0].buttonY);
    }
    await window.screenshot({ path: testInfo.outputPath(`${width}-eight-lines.png`) });

    await input.fill(lines(10));
    const capped = await measure(input, button);
    expect(capped.height).toBe(growth[7].height);
    expect(capped.scrollHeight).toBeGreaterThan(capped.clientHeight);
    expect(capped.buttonY).toBe(growth[0].buttonY);

    await input.fill(lines(8));
    await input.press("Enter");
    await expect(input).toHaveValue("");
    await expect(window.getByText(lines(8), { exact: true })).toBeVisible();
    const afterSend = await measure(input, button);
    console.log(JSON.stringify({ width, growth, capped, afterSend }));
    await window.screenshot({ path: testInfo.outputPath(`${width}-after-send.png`) });
    expect(afterSend.height).toBe(growth[0].height);
    expect(afterSend.buttonY).toBe(growth[0].buttonY);
  });

  test(`${width} 폭에서 8줄을 전체 선택해 지우면 한 줄로 돌아간다`, async ({ page }, testInfo) => {
    const { window, input, button } = await openChat(page, width);
    await input.fill(lines(1));
    const oneLine = await measure(input, button);
    await input.fill(lines(8));
    const eightLines = await measure(input, button);
    await input.press("Control+A");
    await input.press("Backspace");
    await expect(input).toHaveValue("");
    const afterClear = await measure(input, button);
    console.log(JSON.stringify({ width, oneLine, eightLines, afterClear }));
    await window.screenshot({ path: testInfo.outputPath(`${width}-after-clear.png`) });
    expect(afterClear.height).toBe(oneLine.height);
    expect(afterClear.buttonY).toBe(oneLine.buttonY);
  });
}
