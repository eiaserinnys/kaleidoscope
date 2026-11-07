import { expect, test, type Page } from "@playwright/test";
import { coreUrl } from "./runtime.ts";

const activeCanvas = ".ks-desktop-canvas:not([hidden])";

function icon(page: Page, appId: string) {
  return page.locator(`${activeCanvas} [data-desktop-shortcut-id$="/${appId}"]`);
}

async function switchDesktop(page: Page, name: string) {
  const tab = page.getByRole("button", { name });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-pressed", "true");
}

async function addFromPalette(page: Page, name: string) {
  await page.locator(".ks-taskbar").getByRole("button", { name: "앱 열기" }).click();
  const dialog = page.getByRole("dialog", { name: "앱 열기" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name, exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "바탕화면에 추가" }).click();
  await expect(dialog).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await page.goto(`/?core=${coreUrl}`);
  await expect(page.locator(".ks-taskbar").getByRole("button", { name: "앱 열기" })).toBeVisible();
});

test("바탕화면 아이콘을 데스크톱별로 추가하고 끌어 옮기고 지운다", async ({ page }) => {
  test.setTimeout(120_000);

  // 1번 데스크톱: 팔레트 우클릭으로 두 앱을 올린다.
  await addFromPalette(page, "마크다운 편집기");
  await expect(icon(page, "md-editor")).toBeVisible();
  await addFromPalette(page, "계산기");
  await expect(icon(page, "calculator")).toBeVisible();
  await expect(icon(page, "calculator")).toHaveAttribute("data-column", "1");

  // 2번 데스크톱: 다른 앱만 올린다. 데스크톱마다 아이콘 집합이 다르다.
  await page.getByRole("button", { name: "데스크톱 추가" }).click();
  await expect(page.getByRole("button", { name: "데스크톱 2" })).toHaveAttribute("aria-pressed", "true");
  await addFromPalette(page, "날씨");
  await expect(icon(page, "weather")).toBeVisible();
  await expect(icon(page, "md-editor")).toHaveCount(0);

  await switchDesktop(page, "데스크톱 1");
  await expect(icon(page, "md-editor")).toBeVisible();
  await expect(icon(page, "calculator")).toBeVisible();
  await expect(icon(page, "weather")).toHaveCount(0);

  // 0열 0행 아이콘을 왼쪽 위로 끌어도 바탕 영역 경계에서 잘리지 않는다.
  const layer = page.locator(`${activeCanvas} .ks-desktop-icons`);
  const firstIcon = icon(page, "md-editor");
  const layerBox = await layer.boundingBox();
  const firstTile = await firstIcon.boundingBox();
  if (!layerBox || !firstTile) throw new Error("바탕화면 아이콘 층을 찾지 못했습니다");
  const startX = firstTile.x + firstTile.width / 2;
  const startY = firstTile.y + firstTile.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 120, startY - 120, { steps: 12 });
  await expect(firstIcon).toHaveCSS("transform", /matrix/);
  const dragging = await firstIcon.boundingBox();
  if (!dragging) throw new Error("끌고 있는 아이콘을 찾지 못했습니다");
  // 끌기 중인 타일과 선택 표시가 바탕 영역 밖으로 나가 잘리지 않는다.
  expect(dragging.x).toBeGreaterThanOrEqual(layerBox.x - 0.5);
  expect(dragging.y).toBeGreaterThanOrEqual(layerBox.y - 0.5);
  expect(dragging.x + dragging.width).toBeLessThanOrEqual(layerBox.x + layerBox.width + 0.5);
  expect(dragging.y + dragging.height).toBeLessThanOrEqual(layerBox.y + layerBox.height + 0.5);
  // 클리핑 경계는 격자 시작선(12, 60)이 아니라 상단 바 아래끝과 화면 왼쪽 끝이다.
  expect(dragging.x).toBeLessThanOrEqual(layerBox.x + 1);
  expect(dragging.y).toBeLessThanOrEqual(layerBox.y + 1);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(firstIcon).toHaveAttribute("data-column", "0");
  await expect(firstIcon).toHaveAttribute("data-row", "0");

  // 끌어서 3열 2행으로 옮긴다. 놓은 뒤 코어 응답이 저장 좌표를 확정한다.
  const editor = icon(page, "md-editor");
  const grid = page.locator(`${activeCanvas} .ks-desktop-icon-grid`);
  const tile = await editor.boundingBox();
  const bounds = await grid.boundingBox();
  if (!tile || !bounds) throw new Error("바탕화면 아이콘 격자를 찾지 못했습니다");
  const gap = await grid.evaluate((element) => Number.parseFloat(getComputedStyle(element).rowGap) || 0);
  const targetX = bounds.x + 2 * (tile.width + gap) + tile.width / 2;
  const targetY = bounds.y + 1 * (tile.height + gap) + tile.height / 2;
  await page.mouse.move(tile.x + tile.width / 2, tile.y + tile.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 12 });
  await page.mouse.up();
  await expect(editor).toHaveAttribute("data-column", "2");
  await expect(editor).toHaveAttribute("data-row", "1");

  // 셸을 다시 열어도 저장된 좌표가 그대로 보인다.
  await page.reload();
  await expect(page.locator(".ks-taskbar").getByRole("button", { name: "앱 열기" })).toBeVisible();
  await switchDesktop(page, "데스크톱 1");
  await expect(icon(page, "md-editor")).toHaveAttribute("data-column", "2");
  await expect(icon(page, "md-editor")).toHaveAttribute("data-row", "1");

  // 키보드: 방향키로 옮겨 다니고 Enter로 한 번만 연다.
  const calculator = icon(page, "calculator");
  await calculator.focus();
  await page.keyboard.press("ArrowRight");
  await expect(icon(page, "md-editor")).toBeFocused();
  await page.keyboard.press("Enter");
  const editorWindow = page.getByTestId("app-window-md-editor");
  await expect(editorWindow).toHaveCount(1);
  // 창이 아이콘을 덮으므로 닫은 뒤 바탕화면 아이콘을 조작한다.
  await editorWindow.getByRole("button", { name: "창 닫기" }).click();
  await expect(editorWindow).toHaveCount(0);

  // 우클릭 메뉴로 바탕화면에서만 뺀다. 앱 자체는 팔레트에 남는다.
  await icon(page, "md-editor").click({ button: "right" });
  await page.getByRole("menuitem", { name: "바탕화면에서 빼기" }).click();
  await expect(icon(page, "md-editor")).toHaveCount(0);
  await page.locator(".ks-taskbar").getByRole("button", { name: "앱 열기" }).click();
  const dialog = page.getByRole("dialog", { name: "앱 열기" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "마크다운 편집기", exact: true })).toBeVisible();
});
