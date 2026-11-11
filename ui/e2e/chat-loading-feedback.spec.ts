import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("잠긴 입력과 기록 칸의 실패·로그인 상태를 표시한다", async ({ page }) => {
  const phase = process.env.KS_CHAT_EVIDENCE ?? "after";
  const capture = test.info().outputPath("captures");
  await mkdir(capture, { recursive: true });
  const results: Array<{ state: string; width: number; inputOpacity: string; buttonOpacity: string; historyCenter?: number; stateCenter?: number }> = [];
  for (const mode of ["loading", "failed", "login"]) {
    for (const width of [1100, 360]) {
      await page.setViewportSize({ width, height: 820 });
      const query = mode === "loading" ? "" : `&chat_state=${mode}`;
      await page.goto(`/?preview=client-chat-test${query}`);
      await page.addStyleTag({ content: ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }" });
      const app = page.getByTestId("app-window-client-chat");
      const input = app.getByRole("textbox", { name: "메시지" });
      if (mode === "loading") {
        await expect(app.getByText("파일을 살펴봐 줘")).toBeVisible();
        await input.fill("남길 초안");
        await app.screenshot({ path: `${capture}/20261105-${phase}-${width}-ready.png` });
        await page.evaluate(() => (window as unknown as { clientChatHarness: { setLoading: (value: boolean) => void } }).clientChatHarness.setLoading(true));
        await expect(app.getByLabel("불러오는 중")).toBeVisible();
      } else {
        await expect(app.getByText(mode === "failed" ? "대화 상태를 받지 못했습니다" : "로그인이 필요합니다")).toBeVisible();
      }
      await expect(input).toBeDisabled();
      const measurement = await app.evaluate((element) => {
        const input = element.querySelector<HTMLTextAreaElement>(".ks-agent-chat-input")!;
        const button = element.querySelector<HTMLElement>('[aria-label="파일 첨부"]')!;
        const history = element.querySelector<HTMLElement>(".ks-agent-chat-history")!.getBoundingClientRect();
        const state = element.querySelector<HTMLElement>(".ks-data-state > .ks-empty-state")?.getBoundingClientRect();
        return {
          inputOpacity: getComputedStyle(input).opacity,
          buttonOpacity: getComputedStyle(button).opacity,
          historyCenter: (history.top + history.bottom) / 2,
          stateCenter: state ? (state.top + state.bottom) / 2 : undefined,
        };
      });
      results.push({ state: mode, width, ...measurement });
      await app.screenshot({ path: `${capture}/20261105-${phase}-${width}-${mode}.png` });
    }
  }
  await writeFile(`${capture}/20261105-${phase}-bounds.json`, JSON.stringify(results, null, 2));
  for (const result of results) {
    expect(result.inputOpacity, `${result.state} ${result.width} 입력 비활성 모양`).toBe(result.buttonOpacity);
    if (result.state !== "loading") expect(Math.abs(result.historyCenter! - result.stateCenter!), `${result.state} ${result.width} 가운데`).toBeLessThanOrEqual(1);
  }
});
