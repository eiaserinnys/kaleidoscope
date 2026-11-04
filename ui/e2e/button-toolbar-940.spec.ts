import { expect, test } from "@playwright/test";

test("구역의 숨은 동작과 위아래 도구 막대 구분선", async ({ page }) => {
  await page.goto("/?preview=data-controls");
  await page.evaluate(async () => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const app = snapshot.shared.app_versions.find((version: any) => version.app_id === "data-controls");
    app.definition.state = { show: false };
    app.definition.ui = { type: "stack", direction: "column", children: [
      { type: "when", value: { state: "show" }, child: { type: "text", value: "숨긴 첫 칸" } },
      { type: "toolbar", start: [{ type: "button", label: "위", on_click: { set_state: "show", value: true } }] },
      { type: "section", title: "구역", actions: [
        { type: "button", label: "보임", icon: "image", icon_only: true, on_click: { set_state: "show", value: true } },
        { type: "when", value: { state: "show" }, child: { type: "button", label: "숨김", icon: "x", icon_only: true, on_click: { set_state: "show", value: false } } },
      ], child: { type: "text", value: "내용" } },
      { type: "toolbar", start: [{ type: "button", label: "아래", on_click: { set_state: "show", value: false } }] },
      { type: "when", value: { state: "show" }, child: { type: "text", value: "숨긴 칸" } },
    ] };
    app.version += 1;
    const appWindow = snapshot.shared.windows.find((item: any) => item.app_id === "data-controls");
    appWindow.app_version = app.version;
    appWindow.state = { show: false };
    harness.emit({ event: "state.changed", snapshot });
  });
  const app = page.getByTestId("app-window-data-controls");
  const header = app.locator(".ks-data-section-header");
  const button = header.getByRole("button", { name: "보임" });
  await expect(button).toBeVisible();
  const right = await header.evaluate((node) => node.getBoundingClientRect().right);
  const buttonRight = await button.evaluate((node) => node.getBoundingClientRect().right);
  expect.soft(Math.abs(right - buttonRight)).toBeLessThanOrEqual(1);
  const bars = app.locator(".ks-data-toolbar");
  const edges = await bars.evaluateAll((items) => items.map((item) => {
    const style = getComputedStyle(item);
    return [parseFloat(style.borderTopWidth), parseFloat(style.borderBottomWidth)];
  }));
  expect(edges).toHaveLength(2);
  expect(edges[0][0]).toBe(0);
  expect(edges[0][1]).toBeGreaterThan(0);
  expect.soft(edges[1][0]).toBeGreaterThan(0);
  expect.soft(edges[1][1]).toBe(0);
});

test("새 아이콘 세 종류가 단추에 보인다", async ({ page }) => {
  await page.goto("/?preview=data-controls");
  await page.evaluate(async () => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const app = snapshot.shared.app_versions.find((version: any) => version.app_id === "data-controls");
    app.definition.state = { chosen: "" };
    app.definition.ui = { type: "toolbar", start: ["film", "sticker", "image-play"].map((icon) => ({
      type: "button", label: icon, icon, icon_only: true, on_click: { set_state: "chosen", value: icon },
    })) };
    app.version += 1;
    const appWindow = snapshot.shared.windows.find((item: any) => item.app_id === "data-controls");
    appWindow.app_version = app.version;
    appWindow.state = { chosen: "" };
    harness.emit({ event: "state.changed", snapshot });
  });
  for (const icon of ["film", "sticker", "image-play"]) {
    await expect(page.getByTestId("app-window-data-controls").getByRole("button", { name: icon }).locator(`svg.lucide-${icon}`)).toBeVisible();
  }
});
