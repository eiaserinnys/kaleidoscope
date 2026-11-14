import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { coreUrl, pathsFor, repoRoot, requiredRuntimeDir } from "./runtime.ts";

// 기본 에이전트 앱을 실제 코어(개발용 다리)와 가짜 ACP 에이전트로 돌려
// 한 연결에 세션 여러 개가 함께 도는 화면을 검사한다.
// 먼저 cargo build --locked -p kaleidoscope-devbridge -p kaleidoscope-acp-test-agent가 필요하다.

const { artifactsDir } = pathsFor(requiredRuntimeDir());
// 화면 사진은 KS_AGENT_PARALLEL_SHOTS가 있으면 거기에, 없으면 runtime의 artifacts에 남긴다.
const shots = process.env.KS_AGENT_PARALLEL_SHOTS ?? path.join(artifactsDir, "agent-parallel");
const fakeAgent = path.join(repoRoot, "target", "debug", process.platform === "win32" ? "kaleidoscope-acp-test-agent.exe" : "kaleidoscope-acp-test-agent");

const AGENTS = [
  { id: "fake-parallel", name: "병렬 가짜", command: fakeAgent, args: [], env: {}, parallel_sessions: true },
  { id: "fake-other", name: "다른 가짜", command: fakeAgent, args: [], env: {}, parallel_sessions: true },
  { id: "fake-single", name: "단일 가짜", command: fakeAgent, args: [], env: {} },
];

type Reply = Record<string, any>;

// Node에서 다리로 바로 부른다. Origin 머리가 없으므로 다리의 출처 제한에 걸리지 않는다.
async function core(request: Record<string, unknown>): Promise<Reply> {
  const response = await fetch(`${coreUrl}/core`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`코어 명령 ${String(request.op)} 실패: ${JSON.stringify(body)}`);
  return body;
}

async function shot(page: Page, name: string) {
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

let agentsWritten = false;

/** 에이전트 창을 열고 에이전트와 작업 폴더를 골라 대화 화면까지 간다. */
async function openAgent(page: Page, agentName: string): Promise<{ app: Locator; windowId: string }> {
  await page.goto(`/?core=${coreUrl}`);
  await expect(page.locator(".ks-taskbar").getByRole("button", { name: "앱 열기" })).toBeVisible();
  const { snapshot } = await core({ op: "state.get" });
  const workspace = snapshot.device.active_workspace_id;
  const desktop = snapshot.device.active_desktop_ids[workspace];
  const opened = await core({ op: "window.open", desktop_id: desktop, app_id: "agent", rect: { x: 24, y: 24, width: 1000, height: 640 } });
  const windowId: string = opened.window.id;
  if (!agentsWritten) {
    const written = await core({ op: "storage.write", window_id: windowId, entry: "agents", content: AGENTS });
    expect(written.op).toBe("storage.write");
    agentsWritten = true;
  }
  // 시험마다 에이전트 창을 하나만 연다.
  const app = page.getByTestId("app-window-agent");
  const choose = app.getByRole("button", { name: agentName, exact: true });
  await expect(choose).toBeVisible({ timeout: 30_000 });
  await choose.click();
  await app.getByRole("button", { name: "폴더 선택", exact: true }).click();
  await allowUntilChat(page, app);
  return { app, windowId };
}

/** 실행 허용은 에이전트마다 처음 한 번만 묻는다. 대화 입력이 보일 때까지 뜨는 허용을 누른다. */
async function allowUntilChat(page: Page, app: Locator) {
  const box = app.getByRole("textbox", { name: "메시지" });
  await expect.poll(async () => {
    if (await box.isVisible()) return true;
    const allow = page.getByRole("dialog").getByRole("button", { name: "허용", exact: true });
    if (await allow.isVisible()) await allow.click();
    return false;
  }, { timeout: 30_000 }).toBe(true);
}

function sessionRow(app: Locator, id: string): Locator {
  return app.locator(`.ks-list [data-row-key="${id}"]`);
}

async function send(app: Locator, text: string) {
  const box = app.getByRole("textbox", { name: "메시지" });
  await box.fill(text);
  await box.press("Enter");
}

const STREAM = Array.from({ length: 80 }, (_, index) => `[${String(index).padStart(2, "0")}]`).join("");
const DRIP = Array.from({ length: 20 }, (_, index) => `[${String(index).padStart(2, "0")}]`).join("");

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
});

test.afterEach(async () => {
  // 다음 시험이 새 창, 새 에이전트 프로세스에서 시작하도록 열린 에이전트 창을 닫는다.
  const { snapshot } = await core({ op: "state.get" });
  for (const window of snapshot.shared.windows) {
    if (window.app_id === "agent") await core({ op: "window.close", window_id: window.id });
  }
});

test("응답 중에 새 세션을 열고 두 세션의 응답이 섞이지 않는다", async ({ page }) => {
  test.setTimeout(90_000);
  const { app } = await openAgent(page, "병렬 가짜");
  await send(app, "stream");
  await expect(app.locator(".ks-agent-chat-assistant").last()).toContainText("[02]");
  const newSession = app.getByRole("button", { name: "새 세션", exact: true });
  await expect(newSession).toBeEnabled();
  await newSession.click();
  // A(session-1)는 뒤에서 계속 돌고, 목록 줄에 "응답 중" 배지가 붙는다.
  const rowA = sessionRow(app, "session-1");
  await expect(rowA.locator(".ks-view-badges")).toContainText("응답 중");
  await expect(app.locator(".ks-agent-chat-assistant")).toHaveCount(0);
  await shot(page, "a1-new-session-while-streaming");
  await send(app, "drip");
  await expect(sessionRow(app, "session-2")).toHaveAttribute("aria-selected", "true");
  await expect(app.locator(".ks-agent-chat-assistant").last()).toContainText("[03]");
  await shot(page, "a2-both-responding");
  await expect(app.locator(".ks-agent-chat-assistant").last()).toContainText(DRIP, { timeout: 20_000 });
  // B 화면에는 B의 조각만 있다. A의 [20] 이후 조각이 섞이지 않는다.
  await expect(app.locator(".ks-agent-chat-assistant")).toHaveCount(1);
  expect(await app.locator(".ks-agent-chat-assistant").innerText()).not.toContain("[20]");
  await rowA.click();
  await expect(rowA).toHaveAttribute("aria-selected", "true");
  await expect(app.locator(".ks-agent-chat-assistant").last()).toContainText(STREAM, { timeout: 20_000 });
  const textA = await app.locator(".ks-agent-chat-assistant").allInnerTexts();
  expect(textA.join("").split("[00]").length - 1).toBe(1);
  await expect(rowA.locator(".ks-view-badges")).toHaveCount(0);
  await expect(sessionRow(app, "session-2").locator(".ks-view-badges")).toHaveCount(0);
  await shot(page, "a3-both-finished");
});

test("다른 세션이 허용을 기다리면 배지와 안내가 보이고 이동해 답한다", async ({ page }) => {
  test.setTimeout(90_000);
  const { app } = await openAgent(page, "병렬 가짜");
  await send(app, "fresh-turn");
  await expect(app.getByText("NEW", { exact: true })).toBeVisible();
  const selectedA = await app.locator('.ks-list [aria-selected="true"]').getAttribute("data-row-key");
  expect(selectedA).toBeTruthy();
  await app.getByRole("button", { name: "새 세션", exact: true }).click();
  await expect(app.locator(".ks-agent-chat-assistant")).toHaveCount(0);
  await send(app, "permission");
  await expect(app.locator(".ks-agent-chat-footer").getByText("파일 수정", { exact: true })).toBeVisible();
  const selectedB = await app.locator('.ks-list [aria-selected="true"]').getAttribute("data-row-key");
  expect(selectedB).toBeTruthy();
  expect(selectedB).not.toBe(selectedA);
  await sessionRow(app, selectedA!).click();
  await expect(sessionRow(app, selectedA!)).toHaveAttribute("aria-selected", "true");
  const badgeB = sessionRow(app, selectedB!).locator(".ks-view-badges");
  await expect(badgeB).toContainText("허용 필요");
  const notice = app.getByText("다른 세션이 허용을 기다립니다", { exact: true });
  await expect(notice).toBeVisible();
  await expect(app.locator(".ks-agent-chat-footer").getByText("파일 수정", { exact: true })).toHaveCount(0);
  await shot(page, "b1-waiting-notice");
  await page.setViewportSize({ width: 960, height: 600 });
  await expect(notice).toBeVisible();
  await shot(page, "b2-waiting-notice-960x600");
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.getByRole("button", { name: "이동", exact: true }).click();
  await expect(sessionRow(app, selectedB!)).toHaveAttribute("aria-selected", "true");
  await expect(notice).toHaveCount(0);
  const footer = app.locator(".ks-agent-chat-footer");
  await expect(footer.getByText("파일 수정", { exact: true })).toBeVisible();
  await shot(page, "b3-moved-permission");
  await footer.getByRole("button", { name: "허용", exact: true }).click();
  await expect(app.getByText("선택: yes", { exact: true })).toBeVisible();
  await expect(footer.getByText("파일 수정", { exact: true })).toHaveCount(0);
  await expect(app.getByRole("button", { name: "멈춤", exact: true })).toHaveCount(0);
  await shot(page, "b4-answered");
});

test("뒤에서 응답 중일 때 에이전트를 바꾸면 먼저 묻는다", async ({ page }) => {
  test.setTimeout(90_000);
  const { app } = await openAgent(page, "병렬 가짜");
  await send(app, "slow");
  await expect(app.getByRole("button", { name: "멈춤", exact: true })).toBeVisible();
  const selectedA = await app.locator('.ks-list [aria-selected="true"]').getAttribute("data-row-key");
  await app.getByRole("button", { name: "새 세션", exact: true }).click();
  await expect(sessionRow(app, selectedA!).locator(".ks-view-badges")).toContainText("응답 중");
  await app.getByRole("button", { name: "앱 설정" }).click();
  await expect(app.getByRole("heading", { name: "앱 설정" })).toBeVisible();
  const select = app.getByRole("button", { name: "에이전트", exact: true });
  await expect(select).toBeEnabled();
  await shot(page, "c1-settings");
  await select.click();
  await page.getByRole("menuitem", { name: "다른 가짜" }).click();
  const dialog = page.getByRole("dialog", { name: "에이전트 바꾸기" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("응답 중인 세션 1개가 멈춥니다. 바꿀까요?");
  await shot(page, "c2-change-dialog");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(select).toContainText("병렬 가짜");
  await app.getByRole("button", { name: "앱으로 돌아가기" }).click();
  await expect(sessionRow(app, selectedA!).locator(".ks-view-badges")).toContainText("응답 중");
  await expect(app.locator(".ks-window-title")).toHaveText("병렬 가짜");
  await shot(page, "c3-cancelled");
  await app.getByRole("button", { name: "앱 설정" }).click();
  await app.getByRole("button", { name: "에이전트", exact: true }).click();
  await page.getByRole("menuitem", { name: "다른 가짜" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "바꾸기", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // 바꾼 에이전트는 처음 실행이라 실행 허용을 다시 묻고, 새 세션 대화로 돌아온다.
  await allowUntilChat(page, app);
  await expect(app.locator(".ks-window-title")).toHaveText("다른 가짜");
  await shot(page, "c4-changed");
});

test("동시 세션을 끈 에이전트는 응답 중에 세션 목록이 잠긴다", async ({ page }) => {
  test.setTimeout(90_000);
  const { app } = await openAgent(page, "단일 가짜");
  await send(app, "fresh-turn");
  await expect(app.getByText("NEW", { exact: true })).toBeVisible();
  const newSession = app.getByRole("button", { name: "새 세션", exact: true });
  await newSession.click();
  await expect(app.locator(".ks-agent-chat-assistant")).toHaveCount(0);
  await send(app, "stream");
  await expect(app.locator(".ks-agent-chat-assistant").last()).toContainText("[02]");
  await expect(newSession).toBeDisabled();
  const rows = app.locator(".ks-list [data-row-key]");
  await expect(rows.first()).toBeVisible();
  for (const row of await rows.all()) await expect(row).toHaveAttribute("aria-disabled", "true");
  await shot(page, "d1-single-locked");
  await app.getByRole("button", { name: "멈춤", exact: true }).click();
  await expect(newSession).toBeEnabled({ timeout: 10_000 });
});
