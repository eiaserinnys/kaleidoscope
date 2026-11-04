import { expect, type Locator } from "@playwright/test";

export async function selectTab(scope: Locator, name: string) {
  const exactName = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  const tab = scope.locator('[role="tab"]').filter({ hasText: exactName });
  await expect(tab).toBeAttached();
  if (await tab.isVisible()) {
    await tab.click();
  } else {
    await tab.locator("..").getByRole("button", { name: "탭 더 보기" }).click();
    await scope.page().getByRole("menu").getByRole("menuitem", { name, exact: true }).click();
  }
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toBeVisible();
}
