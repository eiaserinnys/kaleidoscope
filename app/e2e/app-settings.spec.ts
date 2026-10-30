import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const captures = "/home/eias/workspace/.local/tmp/card818/ku1/captures";
test.beforeEach(async ({ page }) => {
  await page.goto("/harness.html?preview=app-settings");
  await page.getByRole("button", { name: "앱 설정", exact: true }).click();
  await expect(page.getByRole("heading", { name: "앱 설정" })).toBeFocused();
  await expect(page.getByLabel("에이전트", { exact: true })).toHaveValue("seosoyoung");
});

test("설정 저장, 원격 충돌과 복구, 검사 거부, 기본값", async ({ page }) => {
  await mkdir(captures, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.screenshot({ path: `${captures}/default-wide.png` });
  await page.setViewportSize({ width: 384, height: 900 });
  await page.screenshot({ path: `${captures}/default-narrow.png` });
  await page.setViewportSize({ width: 1440, height: 1080 });
  const agent = page.getByLabel("에이전트", { exact: true });
  await agent.fill("내 초안");
  await page.getByRole("button", { name: "외부 변경" }).click();
  await page.waitForTimeout(1400);
  await expect(agent).toHaveValue("내 초안");
  await agent.press("Enter");
  await expect(page.getByText("저장 중")).toBeVisible();
  await page.screenshot({ path: `${captures}/saving-wide.png` });
  await page.setViewportSize({ width: 384, height: 900 });
  await page.screenshot({ path: `${captures}/saving-narrow.png` });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await expect(page.getByText("다른 곳에서 바뀌었습니다")).toBeVisible();
  await page.screenshot({ path: `${captures}/conflict-wide.png` });
  await page.setViewportSize({ width: 384, height: 900 });
  await page.screenshot({ path: `${captures}/conflict-narrow.png` });
  await page.getByRole("button", { name: "덮어쓰기" }).click();
  await expect(page.getByText("다른 곳에서 바뀌었습니다")).toHaveCount(0);
  await expect(agent).toHaveValue("내 초안");
  await expect(page.getByText("저장됨")).toBeVisible();
  await page.screenshot({ path: `${captures}/saved-narrow.png` });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.screenshot({ path: `${captures}/saved-wide.png` });
  await page.setViewportSize({ width: 384, height: 900 });
  await agent.fill("");
  await agent.press("Enter");
  await expect(page.getByText("값을 입력해 주세요")).toBeVisible();
  await expect(agent).toHaveAttribute("aria-invalid", "true");
  await page.screenshot({ path: `${captures}/error-narrow.png` });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.screenshot({ path: `${captures}/error-wide.png` });
  await page.setViewportSize({ width: 384, height: 900 });
  await agent.fill("복구");
  await agent.press("Enter");
  await expect(page.getByText("값을 입력해 주세요")).toHaveCount(0);
  await page.getByRole("button", { name: "에이전트 기본값으로 되돌리기" }).click();
  await expect(agent).toHaveValue("seosoyoung");
  await page.screenshot({ path: `${captures}/reset-narrow.png` });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.screenshot({ path: `${captures}/reset-wide.png` });
});

test("선택지와 순서, 마크다운, 창 전환의 포커스", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await expect(page.getByRole("button", { name: "1 argon" })).toContainText("Argon");
  await page.getByRole("button", { name: "argon 아래로" }).click();
  await expect(page.getByRole("button", { name: "1 opus" })).toBeVisible();
  await page.getByRole("button", { name: "처음 지시", exact: false }).click();
  await expect(page.locator(".ks-settings-document .cm-content").first()).toBeVisible();
  await page.screenshot({ path: `${captures}/md-wide.png` });
  await page.setViewportSize({ width: 384, height: 900 });
  await page.screenshot({ path: `${captures}/md-narrow.png` });
  await page.getByRole("button", { name: "앱으로 돌아가기" }).click();
  await expect(page.getByText("앱 본문")).toBeVisible();
  await expect(page.getByRole("button", { name: "앱 설정", exact: true })).toBeFocused();
});

test("별도 견본의 토글, nullable boolean, 숫자 enum", async ({ page }) => {
  await page.goto("/harness.html?preview=app-settings&app=sample");
  await page.getByRole("button", { name: "앱 설정", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.screenshot({ path: `${captures}/sample-wide.png` });
  await page.setViewportSize({ width: 384, height: 900 });
  await page.screenshot({ path: `${captures}/sample-narrow.png` });
  const toggle = page.getByRole("switch", { name: "알림" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "보기", exact: true }).click();
  await page.getByRole("menuitem", { name: "격자" }).click();
  await expect(page.getByRole("button", { name: "보기", exact: true })).toContainText("격자");
  const count = page.getByRole("textbox", { name: "표시 개수" });
  await count.fill("25");
  await count.press("Enter");
  await expect(count).toHaveValue("25");
  const local = page.locator("section.ks-settings-group").filter({ has: page.getByRole("heading", { name: "이 작업" }) });
  const nullable = local.getByRole("button", { name: "알림", exact: true });
  await expect(nullable).toContainText("지정 안 함");
  await nullable.click();
  await page.screenshot({ path: `${captures}/sample-boolean-options-narrow.png` });
  await page.getByRole("menuitem", { name: "켬", exact: true }).click();
  await expect(nullable).toContainText("켬");
  await local.getByRole("button", { name: "표시 개수", exact: true }).click();
  await page.screenshot({ path: `${captures}/sample-number-options-narrow.png` });
  await page.getByRole("menuitem", { name: "50", exact: true }).click();
  await expect(local.getByRole("button", { name: "표시 개수", exact: true })).toContainText("50");
});

test("설정이 없는 범위는 구역을 그리지 않는다", async ({ page }) => {
  await page.goto("/harness.html?preview=app-settings&app=empty-group");
  await page.getByRole("button", { name: "앱 설정", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1080 });
  await expect(page.getByRole("heading", { name: "모든 작업" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "이 작업" })).toHaveCount(0);
  await page.screenshot({ path: `${captures}/empty-group-wide.png` });
  await page.setViewportSize({ width: 384, height: 900 });
  await page.screenshot({ path: `${captures}/empty-group-narrow.png` });
});

test("통신 실패 뒤 재시도와 Escape 편집 취소", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  const agent = page.getByLabel("에이전트", { exact: true });
  await agent.fill("서버 실패 초안");
  await page.getByRole("button", { name: "통신 실패" }).click();
  await agent.press("Enter");
  await expect(page.getByText("연결할 수 없습니다")).toBeVisible();
  await page.screenshot({ path: `${captures}/network-wide.png` });
  await page.setViewportSize({ width: 384, height: 900 });
  await page.screenshot({ path: `${captures}/network-narrow.png` });
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByText("연결할 수 없습니다")).toHaveCount(0);
  await agent.fill("취소할 내용");
  await agent.press("Escape");
  await expect(agent).toHaveValue("서버 실패 초안");
  await agent.press("Escape");
  await expect(page.getByText("앱 본문")).toBeVisible();
});

test("같이 보기 중 설정과 웹 표면을 가리고 돌아오면 복원", async ({ page }) => {
  await page.goto("/harness.html?preview=app-settings&settings-web=1");
  await expect(page.getByTestId("fake-webview-settings-window")).toBeVisible();
  await page.getByRole("button", { name: "같이 보기", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__kaleidoscopeHarness!.getShareCalls().length)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "앱 설정", exact: true }).click();
  await expect(page.getByTestId("fake-webview-settings-window")).toHaveCount(0);
  const before = await page.evaluate(() => window.__kaleidoscopeHarness!.getShareCalls().length);
  await page.getByLabel("에이전트", { exact: true }).fill("공유하지 않는 초안");
  await page.waitForTimeout(1100);
  expect(await page.evaluate(() => window.__kaleidoscopeHarness!.getShareCalls().length)).toBe(before);
  expect(await page.evaluate(() => window.__kaleidoscopeHarness!.getCalls().filter((r) => r.op === "web.detach").length)).toBe(0);
  await page.getByRole("button", { name: "앱으로 돌아가기" }).click();
  await expect(page.getByTestId("fake-webview-settings-window")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__kaleidoscopeHarness!.getShareCalls().length)).toBeGreaterThan(before);
});

test("앱 본문과 설정의 같은 문서는 초안과 세션을 공유한다", async ({ page }) => {
  await page.goto("/harness.html?preview=app-settings&settings-document=1");
  const body = page.locator(".ks-data-window-body .cm-content");
  await expect(body).toBeVisible();
  await body.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(" 공유 초안");
  const detached = await page.evaluate(() => window.__kaleidoscopeHarness!.getCalls().filter((request) => request.op === "data.detach").length);
  await page.getByRole("button", { name: "앱 설정", exact: true }).click();
  await expect(body).toBeHidden();
  await page.getByRole("button", { name: "처음 지시", exact: false }).click();
  const settingsEditor = page.locator(".ks-settings-document .cm-content").first();
  await expect(settingsEditor).toContainText("공유 초안");
  await expect(settingsEditor).toBeFocused();
  await page.keyboard.insertText(" 이어 쓰기");
  await page.getByRole("button", { name: "앱으로 돌아가기" }).click();
  await expect(body).toBeVisible();
  await expect(body).toContainText("이어 쓰기");
  expect(await page.evaluate(() => window.__kaleidoscopeHarness!.getCalls().filter((request) => request.op === "data.detach").length)).toBe(detached);
});

test("reset 중 같은 선택을 다시 확정하면 화면과 마지막 저장이 일치한다", async ({ page }) => {
  await page.goto("/harness.html?preview=app-settings&app=sample&reset-review=1");
  await page.getByRole("button", { name: "앱 설정", exact: true }).click();
  const select = page.getByRole("button", { name: "보기", exact: true });
  await expect(select).toContainText("격자");
  await page.getByRole("button", { name: "보기 기본값으로 되돌리기" }).click();
  await expect(page.getByText("저장 중")).toBeVisible();
  await select.click();
  await page.getByRole("menuitem", { name: "격자" }).click();
  await expect.poll(() => page.evaluate(() => window.__kaleidoscopeHarness!.getCalls().filter((request) => request.op === "storage.write" && request.entry === "view").length)).toBe(1);
  await expect(page.getByText("저장됨")).toBeVisible();
  await expect(select).toContainText("격자");
  const writes = await page.evaluate(() => window.__kaleidoscopeHarness!.getCalls().filter((request) => request.op === "storage.write" && request.entry === "view"));
  expect(writes[0]).toMatchObject({ op: "storage.write", content: "격자", expected_revision: null });
});

for (const viewport of [{ width: 1440, height: 1080, name: "wide" }, { width: 384, height: 900, name: "narrow" }]) {
  test(`모델 순서 시작선과 메뉴 Escape (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const rows = page.locator(".ks-settings-list-row .ks-settings-list-input .ks-button");
    await expect(rows).toHaveCount(3);
    const positions = await rows.evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().left));
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${captures}/review-models-${viewport.name}.png` });
    const opener = page.getByRole("button", { name: "1 argon" });
    await opener.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "앱 설정" })).toBeVisible();
    await expect(opener).toBeFocused();
    await page.screenshot({ path: `${captures}/review-menu-escape-${viewport.name}.png` });
  });

  test(`Markdown의 소비되지 않은 Escape가 설정을 닫는다 (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.getByRole("button", { name: "처음 지시", exact: false }).click();
    const editor = page.locator(".ks-settings-document .cm-content").first();
    await expect(editor).toBeFocused();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "앱 설정" })).toBeVisible();
    await expect(editor).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByText("앱 본문")).toBeVisible();
    await expect(page.getByRole("button", { name: "앱 설정", exact: true })).toBeFocused();
    await page.screenshot({ path: `${captures}/review-md-escape-${viewport.name}.png` });
  });
}
