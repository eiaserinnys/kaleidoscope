import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

test("실제 키보드 입력을 지연 단계 표본으로 보내고 프로파일러 첫 탭을 그린다", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?preview=workspace-pas&conversation=ready");
  const chat = page.getByTestId("app-window-workspace-pas");
  const input = chat.getByRole("textbox", { name: "메시지" });
  await expect(input).toBeVisible();
  await expect(input).toHaveAttribute("spellcheck", "false");
  await expect(input).toHaveAttribute("autocomplete", "off");
  await expect(input).toHaveAttribute("autocorrect", "off");
  await expect(input).toHaveAttribute("autocapitalize", "off");

  await input.evaluate((element) => element.addEventListener("input", () => {
    const until = performance.now() + 60;
    while (performance.now() < until) { /* E2E load: make a real keyboard event observable at the 16 ms threshold. */ }
  }, { once: true }));
  await input.focus();
  await page.keyboard.type("한글 입력");

  await expect.poll(async () => page.evaluate(() => (window as any).conversationHarness.calls()
    .some((call: any) => call.op === "profiler.report" && call.inputs?.some((sample: any) => sample.target === "textarea" && ["keydown", "beforeinput", "input", "compositionupdate"].includes(sample.event)))), { timeout: 8_000 }).toBe(true);
  const sample = await page.evaluate(() => {
    const reports = (window as any).conversationHarness.calls().filter((call: any) => call.op === "profiler.report");
    return reports.flatMap((call: any) => call.inputs ?? []).find((item: any) => ["keydown", "beforeinput", "input", "compositionupdate"].includes(item.event));
  });
  expect(sample).toMatchObject({ target: "textarea", app_id: "workspace-pas" });
  for (const phase of [sample.wait_ms, sample.processing_ms, sample.paint_ms]) {
    expect(Number.isFinite(phase)).toBe(true);
    expect(phase).toBeGreaterThanOrEqual(0);
  }

  await page.goto("/?preview=profiler");
  await expect(page.getByRole("tab", { name: "입력 지연" })).toHaveAttribute("aria-selected", "true");
  const screenshotPath = process.env.KS_PROFILER_SCREENSHOT ?? testInfo.outputPath("profiler-input-latency.png");
  await mkdir(dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
});
