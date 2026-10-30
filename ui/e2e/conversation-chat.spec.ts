import { expect, test, type Page } from "@playwright/test";

const path = process.env.KS_CONVERSATION_CAPTURES ?? "/tmp/ks-conversation-captures";
async function open(page: Page, mode: string) {
  await page.goto(`/?preview=workspace-pas&conversation=${mode}`);
  await page.addStyleTag({ content: ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }" });
  return page.getByTestId("app-window-workspace-pas");
}
async function capture(page: Page, name: string) {
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.screenshot({ path: `${path}/${name}-wide.png` });
  await page.setViewportSize({ width: 400, height: 600 });
  await page.screenshot({ path: `${path}/${name}-narrow.png` });
}

test("기록, 이전 페이지, 지연 발송과 진행문", async ({ page }) => {
  const chat = await open(page, "ready");
  await expect(chat.getByText("기존 기록")).toBeVisible();
  await capture(page, "history");
  await page.evaluate(() => (window as any).conversationHarness.emit({ event: "conversation.update", thread_id: "fake-thread", update: { kind: "text", stream_id: "preview", text: "답변 작성 중" } }));
  await expect(chat.getByText("답변 작성 중")).toBeVisible();
  await capture(page, "stream");
  await page.evaluate(() => (window as any).conversationHarness.emit({ event: "conversation.update", thread_id: "fake-thread", update: { kind: "activity", busy: false, tool: null } }));
  await expect(chat.getByText("이전 기록")).toBeVisible();
  await expect(chat.getByText("더 이전 기록")).toBeVisible();
  const input = chat.getByRole("textbox", { name: "메시지" });
  await input.fill("새 요청");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(chat.locator(".is-pending")).toHaveText("새 요청");
  await expect(chat.getByText("답변을 준비했습니다.")).toBeVisible();
  await expect(chat.getByText("답변답변을 준비했습니다.")).toHaveCount(0);
});

test("모델을 골라 시작", async ({ page }) => {
  const chat = await open(page, "start");
  await expect(chat.getByRole("button", { name: "Sol · 사용 불가" })).toBeDisabled();
  await capture(page, "start");
  await chat.getByRole("button", { name: "시작" }).click();
  await expect(chat.getByText("시작하는 중")).toBeVisible();
  await expect(chat.getByRole("textbox", { name: "메시지" })).toBeVisible();
});

test("짧은 기록은 스크롤 없이 이전 페이지를 모두 읽는다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const chat = await open(page, "ready");
  await expect(chat.getByText("더 이전 기록")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).conversationHarness.calls().filter((c: any) => c.op === "conversation.history").length)).toBe(2);
  const history = chat.getByRole("log");
  expect(await history.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
  await page.screenshot({ path: `${path}/short-history-1440.png` });
});

test("로그인 뒤 기록으로 복귀", async ({ page }) => {
  const chat = await open(page, "login");
  await expect(chat.getByText("로그인이 필요합니다")).toBeVisible();
  await capture(page, "login");
  await chat.getByRole("button", { name: "로그인" }).click();
  await expect(chat.getByText("기존 기록")).toBeVisible();
  await expect(chat.getByRole("textbox", { name: "메시지" })).toBeFocused();
});

test("로그인 뒤 시작 판의 첫 조작에 포커스를 둔다", async ({ page }) => {
  const chat = await open(page, "login-start");
  await chat.getByRole("button", { name: "로그인" }).click();
  await expect(chat.getByRole("button", { name: "Argon" })).toBeFocused();
});

test("묶음 충돌은 시작이나 입력을 보이지 않는다", async ({ page }) => {
  const chat = await open(page, "conflict");
  await expect(chat.getByRole("alert")).toContainText("저장된 대화와 제공자의 대화가 다릅니다");
  await capture(page, "conflict");
  await expect(chat.getByRole("button", { name: "시작" })).toHaveCount(0);
  await expect(chat.getByRole("textbox", { name: "메시지" })).toHaveCount(0);
});

test("미접수 초안과 첨부를 같은 ID로 보낸다", async ({ page }) => {
  const chat = await open(page, "draft");
  const input = chat.getByRole("textbox", { name: "메시지" });
  await expect(input).toHaveValue("복원된 초안");
  await expect(chat.getByText("메모.txt")).toBeVisible();
  await capture(page, "draft");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as any).conversationHarness.calls().find((c: any) => c.op === "conversation.send")?.request_id)).toBe("draft-id");
});

test("스트림 인증 오류 뒤 로그인하여 복귀", async ({ page }) => {
  const chat = await open(page, "ready");
  await expect(chat.getByText("기존 기록")).toBeVisible();
  await page.evaluate(() => (window as any).conversationHarness.emit({ event: "conversation.error", thread_id: "fake-thread", code: "login_required" }));
  await expect(chat.getByText("로그인이 필요합니다")).toBeVisible();
  await capture(page, "stream-error");
  await chat.getByRole("button", { name: "로그인" }).click();
  await expect(chat.getByText("기존 기록")).toBeVisible();
});

test("첨부를 보내고 제공자 경로로 파일을 연다", async ({ page }) => {
  const chat = await open(page, "ready");
  await expect(chat.getByText("기존 기록")).toBeVisible();
  await chat.locator('input[type="file"]').setInputFiles({ name: "메모.txt", mimeType: "text/plain", buffer: Buffer.from("내용") });
  await chat.getByRole("button", { name: "보내기" }).click();
  await expect(chat.locator(".ks-agent-chat-user:not(.is-pending)").getByRole("button", { name: "메모.txt" })).toBeVisible();
  await chat.locator(".ks-agent-chat-user:not(.is-pending)").getByRole("button", { name: "메모.txt" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).conversationHarness.calls().some((c: any) => c.op === "conversation.attachment_open" && c.attachment_id === "0"))).toBe(true);
});
