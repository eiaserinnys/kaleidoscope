import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const captures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../.local/tmp/card818-kl-followup");

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
        if (request.op === "conversation.apply_retry") return {op: request.op};
        return originalCall(request);
      };
      window.__ksApplyStatus = (status) => transport.emit({event: "conversation.apply_status", app_id: "settings-preview", status});
      ${store}`);
    await route.fulfill({ response, body: source });
  });
  await page.goto("/harness.html?preview=app-settings");
  await page.getByRole("button", { name: "앱 설정", exact: true }).click();
  const notice = page.getByRole("alert").filter({ hasText: "대화에 적용 안 됨" });
  await expect(notice).toBeVisible();
  await mkdir(captures, { recursive: true });
  const capture = async (state: string) => {
    for (const [label, width] of [["wide", 1440], ["narrow", 384]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: path.join(captures, `${state}-${label}.png`), animations: "disabled" });
    }
  };
  await capture("unapplied");
  const retry = notice.getByRole("button", { name: "다시 시도" });
  const heading = page.getByRole("heading", { name: "앱 설정" });
  await retry.click();
  await expect(notice).toBeVisible();
  await expect(retry).toBeDisabled();
  await expect(page.getByRole("status", { name: "적용 중" })).toBeVisible();
  await expect(heading).toBeFocused();
  await capture("pending");
  await page.evaluate(() => (window as any).__ksApplyStatus("unapplied"));
  await expect(retry).toBeEnabled();
  await expect(retry).toBeFocused();
  await capture("failed");
  await retry.click();
  await expect(retry).toBeDisabled();
  await page.evaluate(() => (window as any).__ksApplyStatus("applied"));
  await expect(notice).toHaveCount(0);
  await expect(heading).toBeFocused();
  await capture("success");
});
