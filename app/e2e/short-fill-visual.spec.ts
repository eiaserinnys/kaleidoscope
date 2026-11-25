import { expect, test } from "@playwright/test";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { coreUrl, pathsFor, requiredRuntimeDir } from "./runtime.ts";

// 실제 기본 앱을 두 높이로 열어 채움 칸의 이전·이후 화면과 치수를 남긴다.
const output = process.env.KS_AGENT_PARALLEL_SHOTS ?? path.join(pathsFor(requiredRuntimeDir()).artifactsDir, "short-fill");
const phase = process.env.KS_SHORT_FILL_PHASE ?? "after";
const metricsPath = process.env.KS_SHORT_FILL_METRICS;

async function core(request: Record<string, unknown>) {
  const response = await fetch(`${coreUrl}/core`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
  expect(response.ok, `코어 명령 ${String(request.op)}`).toBe(true);
  return response.json();
}

test.describe.configure({ mode: "serial" });
for (const id of ["store", "profiler", "calculator", "weather"]) {
  for (const size of [{ width: 360, height: 240 }, { width: 620, height: 680 }]) {
    test(`${id} ${size.width}×${size.height} 화면과 채움 칸`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/?core=${coreUrl}`);
      await expect(page.locator(".ks-taskbar").getByRole("button", { name: "앱 열기" })).toBeVisible();
      const { snapshot } = await core({ op: "state.get" });
      const workspace = snapshot.device.active_workspace_id;
      const desktop = snapshot.device.active_desktop_ids[workspace];
      const { window } = await core({ op: "window.open", desktop_id: desktop, app_id: id, rect: { x: 24, y: 24, ...size } });
      const app = page.getByTestId(`app-window-${id}`);
      await expect(app).toBeVisible();
      const allow = page.getByRole("dialog").getByRole("button", { name: "허용", exact: true });
      if (await allow.isVisible()) await allow.click();
      const body = app.locator(".ks-data-window-body");
      await expect(body).toBeVisible();
      const values = await body.evaluate((element) => {
        const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
        const item = (node: Element) => ({ class: node.className, ...rect(node), minHeight: getComputedStyle(node).minHeight, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight });
        return { body: item(element), fills: [...element.querySelectorAll(".ks-data-stack-item.is-fill")].map(item), controls: [...element.querySelectorAll("button, input, textarea, [role=combobox]")].filter((node) => node.getClientRects().length > 0).map(item) };
      });
      const result = { phase, id, size, ...values };
      console.log("짧은 창 비교 " + JSON.stringify(result));
      if (metricsPath) await appendFile(metricsPath, JSON.stringify(result) + "\n");
      await mkdir(output, { recursive: true });
      await app.screenshot({ path: path.join(output, `${phase}-${id}-${size.width}x${size.height}.png`) });
      await core({ op: "window.close", window_id: window.id });
    });
  }
}
