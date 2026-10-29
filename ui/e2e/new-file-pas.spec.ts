import { expect, test } from "@playwright/test";

test("creates a markdown file, keeps read-only controls hidden, and cancels without writing", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByTestId("app-window-md-editor");
  const viewer = page.getByTestId("app-window-md-viewer");
  await editor.getByRole("button", { name: "문서 폴더 고르기" }).click();
  await viewer.getByRole("button", { name: "읽을 폴더 고르기" }).click();
  await expect(editor.getByRole("button", { name: "새 파일" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "새 파일" })).toHaveCount(0);

  await editor.getByRole("button", { name: "새 파일" }).click();
  const fileName = editor.getByRole("textbox", { name: "새 파일 이름" });
  await fileName.fill("회의 메모");
  await fileName.press("Enter");
  const createdFile = editor.getByRole("button", { name: "회의 메모.md" });
  await expect(createdFile).toHaveAttribute("aria-current", "page");
  const content = editor.locator(".cm-content");
  await expect(content).toBeVisible();
  await content.click();
  await page.keyboard.type("새 문서 내용");
  const filePanel = page.getByTestId("fake-files-panel");
  await filePanel.locator("summary").click();
  await expect(filePanel).toContainText("회의 메모.md\n새 문서 내용", { timeout: 5_000 });

  await editor.getByRole("button", { name: "새 파일" }).click();
  const duplicateName = editor.getByRole("textbox", { name: "새 파일 이름" });
  await duplicateName.fill("회의 메모.md");
  await duplicateName.press("Enter");
  await expect(editor.getByRole("alert")).toContainText("같은 이름의 파일이 있습니다");
  await expect(editor.getByRole("textbox", { name: "새 파일 이름" })).toHaveValue("회의 메모.md");

  await editor.getByRole("textbox", { name: "새 파일 이름" }).press("Escape");
  await expect(editor.getByRole("textbox", { name: "새 파일 이름" })).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "회의 메모.md" })).toHaveCount(1);
  await editor.getByRole("button", { name: "새 파일" }).click();
  const cancelledName = editor.getByRole("textbox", { name: "새 파일 이름" });
  await cancelledName.fill("취소");
  await cancelledName.press("Escape");
  await expect(editor.getByRole("button", { name: "취소.md" })).toHaveCount(0);
});

test("matches the new-file input row height to a file row", async ({ page }) => {
  await page.goto("/?preview=md-editor");
  const editor = page.getByTestId("app-window-md-editor");
  await editor.getByRole("button", { name: "문서 폴더 고르기" }).click();
  const fileRow = editor.getByRole("button", { name: "README.md" });
  await expect(fileRow).toBeVisible();
  await editor.getByRole("button", { name: "새 파일" }).click();
  const createRow = editor.locator(".ks-file-tree-create-row");
  await expect(createRow).toBeVisible();

  const [createHeight, fileHeight] = await Promise.all([
    createRow.evaluate((element) => element.getBoundingClientRect().height),
    fileRow.evaluate((element) => element.getBoundingClientRect().height),
  ]);
  expect(Math.abs(createHeight - fileHeight)).toBeLessThanOrEqual(1);
});

test("keeps the pending message and thinking indicator inside history when sending from the top", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 360 });
  await page.goto("/?preview=workspace-pas&pas=ready&send-delay=1500");
  await page.addStyleTag({ content: `
    .ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; }
    .ks-harness-dev-panel { display: none; }
  ` });
  const chat = page.getByTestId("app-window-workspace-pas");
  const history = chat.getByRole("log", { name: "대화 기록" });
  const input = chat.getByRole("textbox", { name: "메시지" });
  const longMessage = Array.from({ length: 16 }, (_, index) => `기록 줄 ${index + 1}`).join("\n");

  await input.fill(longMessage);
  await input.press("Enter");
  await expect(input).toHaveValue("", { timeout: 200 });
  await expect(history.getByText(longMessage, { exact: true })).toBeVisible();
  await expect.poll(() => history.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
  await expect(chat.locator(".ks-agent-chat-working")).toHaveCount(0, { timeout: 10_000 });

  await history.hover();
  await page.mouse.wheel(0, -2000);
  await expect.poll(() => history.evaluate((element) => element.scrollTop)).toBe(0);
  await input.fill("위쪽에서 보낸 요청");
  await input.press("Enter");
  const pending = chat.locator(".ks-agent-chat-user.is-pending");
  const thinking = chat.getByText("생각 중입니다…");
  await expect(input).toHaveValue("", { timeout: 200 });
  await expect(pending).toHaveText("위쪽에서 보낸 요청", { timeout: 200 });
  await expect(thinking).toBeVisible({ timeout: 200 });

  const bounds = await history.evaluate((element) => {
    const historyRect = element.getBoundingClientRect();
    const pendingRect = element.querySelector(".ks-agent-chat-user.is-pending")!.getBoundingClientRect();
    const thinkingRect = element.querySelector(".ks-agent-chat-working")!.getBoundingClientRect();
    return {
      scrollTop: element.scrollTop,
      history: { top: historyRect.top, bottom: historyRect.bottom },
      pending: { top: pendingRect.top, bottom: pendingRect.bottom },
      thinking: { top: thinkingRect.top, bottom: thinkingRect.bottom },
    };
  });
  expect(bounds.scrollTop).toBeGreaterThan(0);
  for (const rect of [bounds.pending, bounds.thinking]) {
    expect(rect.top).toBeGreaterThanOrEqual(bounds.history.top);
    expect(rect.bottom).toBeLessThanOrEqual(bounds.history.bottom);
  }
});

test("pending message keeps the light-theme muted text color at full opacity", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/?preview=workspace-pas&pas=ready&send-delay=1500");
  const chat = page.getByTestId("app-window-workspace-pas");
  const input = chat.getByRole("textbox", { name: "메시지" });
  await input.fill("대비 확인");
  await input.press("Enter");

  const pending = chat.locator(".ks-agent-chat-user.is-pending");
  await expect(pending).toBeVisible();
  const style = await pending.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--ks-color-muted)";
    document.body.append(probe);
    const muted = getComputedStyle(probe).color;
    probe.remove();
    const computed = getComputedStyle(element);
    return { opacity: computed.opacity, color: computed.color, muted };
  });
  expect(style.opacity).toBe("1");
  expect(style.color).toBe(style.muted);
});

test("shows pending text and thinking immediately while sending a delayed PAS message", async ({ page }) => {
  await page.goto("/?preview=workspace-pas&pas=ready&send-delay=1500");
  const chat = page.getByTestId("app-window-workspace-pas");
  const input = chat.getByRole("textbox", { name: "메시지" });
  await input.fill("지연 요청");
  await input.press("Enter");

  await expect(input).toHaveValue("", { timeout: 200 });
  await expect(chat.locator(".ks-agent-chat-user.is-pending")).toHaveText("지연 요청");
  await expect(chat.getByText("생각 중입니다…")).toBeVisible();
  await expect(chat.getByText("지연 요청", { exact: true })).toHaveCount(1, { timeout: 10_000 });
});

test("restores a failed delayed PAS message and displays the error", async ({ page }) => {
  await page.goto("/?preview=workspace-pas&pas=send-error&send-delay=1500");
  const chat = page.getByTestId("app-window-workspace-pas");
  const input = chat.getByRole("textbox", { name: "메시지" });
  await input.fill("전달 실패");
  await input.press("Enter");

  await expect(input).toHaveValue("", { timeout: 200 });
  await expect(chat.getByRole("alert")).toContainText("메시지를 보내지 못했습니다", { timeout: 10_000 });
  await expect(input).toHaveValue("전달 실패");
  await expect(chat.locator(".ks-agent-chat-user.is-pending")).toHaveCount(0);
});
