import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("저장된 설정의 미적용 알림과 다시 시도", async ({ page }) => {
  await page.route("**/src/harness.tsx*", async (route) => {
    const response = await route.fetch();
    let source = await response.text();
    const agent = JSON.stringify({ protocol: "conversation-v1", permission: "provider", base_path: "/api", namespace: "ns", profile: "profile", collection: "collection", model_order: ["model"], selected_model: null, title_template: "제목", initial_instruction_template: "처음", instructions_template: "역할", thread_entry: "thread" });
    const definition = "const settingsDefinition = {";
    const store = "const store = createShellStore(transport);";
    expect(source).toContain(definition);
    expect(source).toContain(store);
    source = source.replace(definition, `${definition} agent: ${agent},`);
    source = source.replace(store, `const originalCall = transport.call.bind(transport);
      transport.call = async (request) => {
        if (request.op === "conversation.apply_status") return {op: request.op, status: "unapplied"};
        if (request.op === "conversation.apply_retry") {
          setTimeout(() => transport.emit({event: "conversation.apply_status", app_id: "settings-preview", status: "applied"}), 0);
          return {op: request.op};
        }
        return originalCall(request);
      };
      ${store}`);
    await route.fulfill({ response, body: source });
  });
  await page.goto("/harness.html?preview=app-settings");
  await page.getByRole("button", { name: "앱 설정", exact: true }).click();
  const notice = page.getByRole("alert").filter({ hasText: "대화에 적용 안 됨" });
  await expect(notice).toBeVisible();
  await mkdir("/home/eias/workspace/.local/tmp/card818-kl", { recursive: true });
  await page.screenshot({ path: "/home/eias/workspace/.local/tmp/card818-kl/settings-wide.png" });
  await page.setViewportSize({ width: 384, height: 900 });
  await expect(notice).toBeVisible();
  await page.screenshot({ path: "/home/eias/workspace/.local/tmp/card818-kl/settings-narrow.png" });
  await notice.getByRole("button", { name: "다시 시도" }).click();
  await expect(notice).toHaveCount(0);
});
