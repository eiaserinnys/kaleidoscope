import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const output = process.env.KS_BLOCKS_E1_CAPTURE_DIR;
const reviewOutput = process.env.KS_BLOCKS_E1_REVIEW_CAPTURE_DIR;
const scenes = [
  { id: "blocks-18-01", label: "01-center" },
  { id: "blocks-18-04", label: "04-error" },
  { id: "blocks-18-05", label: "05-loading" },
  { id: "blocks-18-06", label: "06-folder" },
];

async function capture(page: Page, id: string, mode: string) {
  if (!output) return;
  mkdirSync(output, { recursive: true });
  await page.getByTestId(`app-window-${id}`).screenshot({ path: join(output, `${id}-${mode}.png`) });
}

async function captureReview(page: Page, selector: string, name: string) {
  if (!reviewOutput) return;
  mkdirSync(reviewOutput, { recursive: true });
  await page.locator(selector).screenshot({ path: join(reviewOutput, `${name}.png`) });
}

async function openReviewPage(browser: Browser, url: string) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(url);
  await hideHarnessDevPanel(page);
  return { context, page };
}

async function hideHarnessDevPanel(page: Page) {
  await page.addStyleTag({ content: ".ks-harness-dev-panel { display: none !important; }" });
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
  if (id === "blocks-18-01") {
    const buttons = app.locator(".ks-data-button");
    await expect(buttons).toHaveCount(4);
    for (let index = 0; index < 4; index += 1) await expect(buttons.nth(index)).toBeVisible();
  } else if (id === "blocks-18-04") {
    await expect(app.getByRole("alert")).toContainText("저장 항목 agents: 값을 읽기 위한 서버 저장소 작업을 시작하지 못했습니다.");
    await expect(app.getByText("STORAGE_ITEM_READ_DATABASE_FAILED")).toBeVisible();
    await expect(app.getByRole("button", { name: "다시 시도" })).toBeVisible();
  } else if (id === "blocks-18-05") {
    await expect(app.getByRole("status", { name: "불러오는 중" }).locator("i")).toHaveCount(3);
    await expect(app.locator(".ks-notice")).toHaveCount(0);
  } else {
    await expect(app.locator(".ks-data-button")).toHaveCount(2);
    await expect(app.getByRole("button", { name: "폴더 선택" })).toBeVisible();
  }
}

test("블록 18의 네 시작 화면을 넓은 창, 최소 창, 다크 모드에서 그린다", async ({ page }) => {
  for (const scene of scenes) {
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?preview=${scene.id}`);
    await hideHarnessDevPanel(page);
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
    await hideHarnessDevPanel(page);
    await assertScene(page, scene.id);
    await capture(page, scene.id, "wide-dark");
  }
});

test("공용 선택기와 단추의 긴 글은 잘리고 기존 화면의 짧은 글은 그대로 보인다", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.goto("/?preview=blocks-18-ellipsis");
  await hideHarnessDevPanel(page);
  const app = page.getByTestId("app-window-blocks-18-ellipsis");
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
  await capture(page, "blocks-18-ellipsis", "after-wide");

  await page.addStyleTag({ content: `
    .ks-truncate-label, .ks-select-choice-label { min-width: initial; overflow: visible; text-overflow: clip; white-space: normal; }
    .ks-select-button { max-width: initial; min-width: initial; }
  ` });
  await capture(page, "blocks-18-ellipsis", "before-wide");

  await page.setViewportSize({ width: 400, height: 280 });
  await page.goto("/?preview=data-controls");
  await hideHarnessDevPanel(page);
  const existing = page.getByTestId("app-window-data-controls");
  await expect(existing.getByRole("button", { name: "실행" })).toBeVisible();
  await expect(existing.getByRole("button", { name: "삭제" })).toBeVisible();
  await capture(page, "data-controls", "after-narrow");
  await page.addStyleTag({ content: ".ks-truncate-label, .ks-select-choice-label { display: contents !important; overflow: visible !important; }" });
  await capture(page, "data-controls", "before-narrow");
});

test("말줄임 라벨은 단추의 줄 높이를 물려받고 버튼·고르기 높이는 유지한다", async ({ browser }) => {
  const { context, page } = await openReviewPage(browser, "/?preview=blocks-18-truncate-glyphs");
  try {
    const app = page.getByTestId("app-window-blocks-18-truncate-glyphs");
    const selectors = [".ks-data-button .ks-truncate-label", ".ks-select-choice-label"];
    const metrics = await Promise.all(selectors.map((selector) => app.locator(selector).evaluate((node) => {
      const control = node.closest("button");
      return {
        lineHeight: getComputedStyle(node).lineHeight,
        controlLineHeight: control ? getComputedStyle(control).lineHeight : null,
        controlHeight: control ? getComputedStyle(control).height : null,
        tokenControlHeight: getComputedStyle(document.documentElement).getPropertyValue("--ks-control-height").trim(),
      };
    })));
    for (const metric of metrics) {
      expect(metric.lineHeight).toBe(metric.controlLineHeight);
      expect(metric.controlHeight).toBe(metric.tokenControlHeight);
    }
    await captureReview(page, '[data-testid="app-window-blocks-18-truncate-glyphs"] .ks-data-button > button', "truncate-button-descenders-actual-2x");
    await captureReview(page, '[data-testid="app-window-blocks-18-truncate-glyphs"] .ks-select-button', "truncate-select-opus-actual-2x");
    await page.addStyleTag({ content: ".ks-truncate-label, .ks-select-choice-label { display: contents !important; overflow: visible !important; }" });
    await captureReview(page, '[data-testid="app-window-blocks-18-truncate-glyphs"] .ks-data-button > button', "truncate-button-descenders-bare-text-2x");
    await captureReview(page, '[data-testid="app-window-blocks-18-truncate-glyphs"] .ks-select-button', "truncate-select-opus-bare-text-2x");

    await page.goto("/?preview=workspace-pas&conversation=start");
    await hideHarnessDevPanel(page);
    const chat = page.getByTestId("app-window-workspace-pas");
    const place = chat.getByRole("button", { name: "실행 위치" });
    await expect(place).toContainText("eiaserinnys");
    await captureReview(page, '[data-testid="app-window-workspace-pas"] .ks-agent-chat-toolbar [aria-label="실행 위치"]', "pas-node-select-actual-2x");
    await page.addStyleTag({ content: ".ks-select-choice-label { display: contents !important; overflow: visible !important; }" });
    await captureReview(page, '[data-testid="app-window-workspace-pas"] .ks-agent-chat-toolbar [aria-label="실행 위치"]', "pas-node-select-bare-text-2x");
  } finally {
    await context.close();
  }
});

test("여러 동작이 있는 오류 안내는 글 폭을 지키고 단추를 아래로 감싼다", async ({ browser }) => {
  const { context, page } = await openReviewPage(browser, "/?preview=blocks-18-04-multiple-actions");
  try {
    const app = page.getByTestId("app-window-blocks-18-04-multiple-actions");
    const assertWrapped = async () => {
      const message = await app.locator(".ks-notice-message").boundingBox();
      const actions = await app.locator(".ks-notice-actions").boundingBox();
      expect(message).not.toBeNull();
      expect(actions).not.toBeNull();
      expect(actions!.y).toBeGreaterThanOrEqual(message!.y + message!.height);
    };
    await expect(app.getByRole("alert")).toContainText("AGENT_PROCESS_SPAWN_NOT_FOUND");
    await assertWrapped();
    await captureReview(page, '[data-testid="app-window-blocks-18-04-multiple-actions"]', "notice-multiple-actions-wide-2x");

    await fitSmallWindow(page);
    const box = await app.boundingBox();
    expect(box?.width).toBe(360);
    expect(box?.height).toBe(240);
    await assertWrapped();
    await captureReview(page, '[data-testid="app-window-blocks-18-04-multiple-actions"]', "notice-multiple-actions-narrow-2x");
  } finally {
    await context.close();
  }
});

test("여러 동작이 있는 notice에서 가짜 코어가 두 동작을 처리한다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?preview=blocks-18-04-multiple-actions");
  await hideHarnessDevPanel(page);
  const app = page.getByTestId("app-window-blocks-18-04-multiple-actions");
  const message = app.locator(".ks-notice").first().locator(".ks-notice-message");
  await app.getByRole("button", { name: "다시 시도" }).click();
  await expect(message).toContainText("다시 시도 요청을 보냈습니다.");
  await app.getByRole("button", { name: "설치 안내 열기" }).click();
  await expect(message).toContainText("설치 안내를 열었습니다.");
  await expect(page.getByText("명령을 처리할 수 없습니다.")).toHaveCount(0);
});

test("에이전트 오류 알림의 기존 단추 배치를 보존한다", async ({ browser }) => {
  const { context, page } = await openReviewPage(browser, "/?preview=agent&agent-phase=failed");
  try {
    const app = page.getByTestId("app-window-agent");
    const notice = app.getByRole("alert");
    await expect(notice).toBeVisible();
    const message = await notice.locator(".ks-notice-message").boundingBox();
    const actions = await notice.locator(".ks-notice-actions").boundingBox();
    expect(message).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(actions!.x).toBeGreaterThanOrEqual(message!.x + message!.width);
    expect(Math.abs(actions!.y + actions!.height / 2 - (message!.y + message!.height / 2))).toBeLessThanOrEqual(1);
    await captureReview(page, '[data-testid="app-window-agent"]', "agent-error-notice-single-action-2x");
  } finally {
    await context.close();
  }
});
