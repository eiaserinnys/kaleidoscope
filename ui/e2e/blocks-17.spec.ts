import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const output = process.env.KS_BLOCKS_E1_CAPTURE_DIR;
const scenes = [
  { id: "blocks-17-01", label: "01-center" },
  { id: "blocks-17-04", label: "04-error" },
  { id: "blocks-17-05", label: "05-loading" },
  { id: "blocks-17-06", label: "06-folder" },
];

async function capture(page: Page, id: string, mode: string) {
  if (!output) return;
  mkdirSync(output, { recursive: true });
  await page.getByTestId(`app-window-${id}`).screenshot({ path: join(output, `${id}-${mode}.png`) });
}

async function fitSmallWindow(page: Page) {
  await page.setViewportSize({ width: 400, height: 280 });
  await page.addStyleTag({ content: `
    body { padding: 0; }
    .ks-harness { grid-template-rows: minmax(0, 1fr); gap: 0; }
    .ks-harness-header { display: none; }
    .ks-harness-apps.is-preview { display: flex; align-items: center; justify-content: center; }
    .ks-harness-apps.is-preview .ks-harness-window { width: 360px; height: 240px; flex: 0 0 360px; }
  ` });
}

async function assertScene(page: Page, id: string) {
  const app = page.getByTestId(`app-window-${id}`);
  await expect(app.locator(".ks-data-stack.is-center")).toBeVisible();
  if (id === "blocks-17-01") {
    await expect(app.getByRole("button", { name: "Claude Code" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Codex" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Gemini CLI" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Antigravity" })).toBeVisible();
  } else if (id === "blocks-17-04") {
    await expect(app.getByRole("alert")).toContainText("저장소 항목을 읽지 못했습니다");
    await expect(app.getByText("STORAGE_ITEM_READ_DATABASE_FAILED")).toBeVisible();
    await expect(app.getByRole("button", { name: "다시 시도" })).toBeVisible();
  } else if (id === "blocks-17-05") {
    await expect(app.getByRole("status", { name: "불러오는 중" }).locator("i")).toHaveCount(3);
    await expect(app.locator(".ks-notice")).toHaveCount(0);
  } else {
    await expect(app.getByRole("button", { name: "Claude Code" })).toBeVisible();
    await expect(app.getByRole("button", { name: "폴더 선택" })).toBeVisible();
  }
}

test("블록 17의 네 시작 화면을 넓은 창, 최소 창, 다크 모드에서 그린다", async ({ page }) => {
  for (const scene of scenes) {
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?preview=${scene.id}`);
    await assertScene(page, scene.id);
    await capture(page, scene.id, "wide");

    await fitSmallWindow(page);
    const app = page.getByTestId(`app-window-${scene.id}`);
    await assertScene(page, scene.id);
    const box = await app.boundingBox();
    expect(box?.width).toBe(360);
    expect(box?.height).toBe(240);
    await capture(page, scene.id, "narrow");

    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?preview=${scene.id}`);
    await assertScene(page, scene.id);
    await capture(page, scene.id, "wide-dark");
  }
});

test("공용 선택기와 단추의 긴 글은 잘리고 기존 화면의 짧은 글은 그대로 보인다", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.goto("/?preview=blocks-17-ellipsis");
  const app = page.getByTestId("app-window-blocks-17-ellipsis");
  const choice = app.locator(".ks-select-choice-label");
  const buttonLabel = app.locator(".ks-data-button .ks-truncate-label");
  await expect(choice).toContainText("프로젝트-자료-정리-창-말줄임-시험-선택지");
  await expect(buttonLabel).toContainText("긴 프로젝트 작업을 바로 실행하는 아주 긴 단추 이름");
  const afterWidths = await Promise.all([choice, buttonLabel].map((element) => element.evaluate((node) => ({
    width: node.clientWidth,
    scrollWidth: node.scrollWidth,
    overflow: getComputedStyle(node).textOverflow,
    whiteSpace: getComputedStyle(node).whiteSpace,
  }))));
  for (const item of afterWidths) {
    expect(item.scrollWidth).toBeGreaterThan(item.width);
    expect(item.overflow).toBe("ellipsis");
    expect(item.whiteSpace).toBe("nowrap");
  }
  await capture(page, "blocks-17-ellipsis", "after-wide");

  await page.addStyleTag({ content: `
    .ks-truncate-label, .ks-select-choice-label { min-width: initial; overflow: visible; text-overflow: clip; white-space: normal; }
    .ks-select-button { max-width: initial; min-width: initial; }
  ` });
  await capture(page, "blocks-17-ellipsis", "before-wide");

  await page.setViewportSize({ width: 400, height: 280 });
  await page.goto("/?preview=data-controls");
  const existing = page.getByTestId("app-window-data-controls");
  await expect(existing.getByRole("button", { name: "실행" })).toBeVisible();
  await expect(existing.getByRole("button", { name: "삭제" })).toBeVisible();
  await capture(page, "data-controls", "after-narrow");
  await page.addStyleTag({ content: `
    .ks-truncate-label, .ks-select-choice-label { min-width: initial; overflow: visible; text-overflow: clip; white-space: normal; }
    .ks-select-button { max-width: initial; min-width: initial; }
  ` });
  await capture(page, "data-controls", "before-narrow");
});
