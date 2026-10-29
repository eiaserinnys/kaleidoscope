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
