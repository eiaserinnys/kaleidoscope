import { expect, test, type Locator, type Page } from "@playwright/test";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { coreUrl, pathsFor, repoRoot, requiredRuntimeDir } from "./runtime.ts";

const output = process.env.KS_AGENT_PARALLEL_SHOTS ?? path.join(pathsFor(requiredRuntimeDir()).artifactsDir, "agent-operations");
const operations = process.env.KS_AGENT_PARALLEL_OPERATIONS;
const binary = path.join(repoRoot, "target", "debug", process.platform === "win32" ? "kaleidoscope-acp-test-agent.exe" : "kaleidoscope-acp-test-agent");
const agents = [
  { id: "fake-visual", name: "화면 가짜", command: binary, args: [], env: { TEST_SCENARIO: "parallel_visual" }, parallel_sessions: true },
  { id: "fake-other", name: "다른 가짜", command: binary, args: [], env: { TEST_SCENARIO: "parallel_visual" }, parallel_sessions: true },
];

async function core(request: Record<string, unknown>): Promise<any> {
  const response = await fetch(`${coreUrl}/core`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
  expect(response.ok, `코어 명령 ${String(request.op)}`).toBe(true);
  return response.json();
}
async function record(name: string, values: unknown) {
  const line = JSON.stringify({ name, values });
  console.log("조작 측정 " + line);
  if (operations) await appendFile(operations, line + "\n");
}
async function shot(page: Page, name: string) {
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, `operation-${name}.png`) });
}
async function focus(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { tag: el?.tagName ?? "", role: el?.getAttribute("role"), label: el?.getAttribute("aria-label"), placeholder: el?.getAttribute("placeholder"), text: (el?.innerText ?? "").trim().slice(0, 80) };
  });
}
async function openAgent(page: Page, width = 520, height = 480): Promise<{ app: Locator; windowId: string }> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?core=${coreUrl}`);
  await expect(page.locator(".ks-taskbar").getByRole("button", { name: "앱 열기" })).toBeVisible();
  const { snapshot } = await core({ op: "state.get" });
  const workspace = snapshot.device.active_workspace_id;
  const desktop = snapshot.device.active_desktop_ids[workspace];
  const { window } = await core({ op: "window.open", desktop_id: desktop, app_id: "agent", rect: { x: 24, y: 24, width, height } });
  const current = await core({ op: "storage.get", window_id: window.id, entry: "agents" });
  await core({ op: "storage.write", window_id: window.id, entry: "agents", content: agents, expected_revision: current.result.revision });
  const app = page.getByTestId("app-window-agent");
  await app.getByRole("button", { name: "화면 가짜", exact: true }).click();
  await app.getByRole("button", { name: "폴더 선택", exact: true }).click();
  const box = app.getByRole("textbox", { name: "메시지" });
  await expect.poll(async () => {
    if (await box.isVisible()) return true;
    const allow = page.getByRole("dialog").getByRole("button", { name: "허용", exact: true });
    if (await allow.isVisible()) await allow.click();
    return false;
  }, { timeout: 30_000 }).toBe(true);
  return { app, windowId: window.id };
}
async function send(app: Locator, text: string) {
  const box = app.getByRole("textbox", { name: "메시지" });
  await box.fill(text);
  await box.press("Enter");
}
async function observeDialog(page: Page, title: string, open: () => Promise<void>, opener?: Locator, windowId?: string) {
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  await open();
  await expect(dialog).toBeVisible();
  const first = await focus(page);
  await shot(page, `dialog-${title}`);
  await page.keyboard.press("Tab");
  const tab = await focus(page);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const enterOpen = await dialog.isVisible();
  const afterEnter = await focus(page);
  const enterReturnedToOpener = opener ? await opener.evaluate((element) => element === document.activeElement) : null;
  if (!enterOpen) { await open(); await expect(dialog).toBeVisible(); }
  const beforeEscape = await focus(page);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const escapeOpen = await dialog.isVisible();
  const afterEscape = await focus(page);
  const escapeReturnedToOpener = opener ? await opener.evaluate((element) => element === document.activeElement) : null;
  await record(title, { first, tab, enter: enterOpen ? "열림 유지" : "닫힘", afterEnter, enterReturnedToOpener, beforeEscape, escape: escapeOpen ? "열림 유지" : "닫힘", afterEscape, escapeReturnedToOpener });
  if (escapeOpen) await dialog.getByRole("button", { name: "취소", exact: true }).click();
  expect(escapeOpen, `${title}: Esc로 닫혀야 한다`).toBe(false);
  if (opener) {
    expect(enterOpen, `${title}: Enter로 닫혀야 한다`).toBe(false);
    expect(enterReturnedToOpener, `${title}: Enter 뒤 연 요소로 초점 복귀`).toBe(true);
    expect(escapeReturnedToOpener, `${title}: Esc 뒤 연 요소로 초점 복귀`).toBe(true);
  }
  if (windowId) {
    await open();
    await expect(dialog).toBeVisible();
    await core({ op: "window.set_rect", window_id: windowId, rect: { x: 24, y: 24, width: 360, height: 240 } });
    await expect.poll(async () => (await page.getByTestId("app-window-agent").boundingBox())?.height).toBe(240);
    await shot(page, "dialog-minimum-confirm");
    await core({ op: "window.set_rect", window_id: windowId, rect: { x: 24, y: 24, width: 1000, height: 640 } });
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    await expect(dialog).toBeHidden();
    if (opener) await expect(opener).toBeFocused();
    await record("최소 창 확인 닫기", { afterClose: await focus(page) });
  }
}

test.afterEach(async () => {
  const { snapshot } = await core({ op: "state.get" });
  for (const window of snapshot.shared.windows) if (window.app_id === "agent") await core({ op: "window.close", window_id: window.id });
});

test("지난 세션 고르기와 삭제의 키보드와 초점", async ({ page }) => {
  test.setTimeout(90_000);
  const { app } = await openAgent(page);
  await send(app, "fresh-turn");
  await expect(app.getByText("NEW", { exact: true })).toBeVisible();
  const picker = page.getByRole("dialog", { name: "이어 갈 세션 고르기", exact: true });
  const openPicker = async () => { if (!(await picker.isVisible())) await app.getByRole("button", { name: "지난 세션", exact: true }).click(); };
  await observeDialog(page, "이어 갈 세션 고르기", openPicker);
  const openDelete = async () => {
    await openPicker();
    const row = picker.locator(".ks-list [data-row-key]").first();
    await expect(row).toBeVisible();
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "삭제", exact: true }).click();
  };
  await observeDialog(page, "세션 삭제", openDelete);
  if (await picker.isVisible()) await page.keyboard.press("Escape");
});

for (const kind of ["agent", "folder", "parallel"] as const) {
  test(`${kind} 바꾸기 확인 창의 키보드와 초점`, async ({ page }) => {
    test.setTimeout(90_000);
    const { app, windowId } = await openAgent(page, 1000, 640);
    await send(app, "slow");
    await expect(app.getByRole("button", { name: "멈춤", exact: true })).toBeVisible();
    await app.getByRole("button", { name: "새 세션", exact: true }).click();
    await app.getByRole("button", { name: "앱 설정" }).click();
    await expect(app.getByRole("heading", { name: "앱 설정" })).toBeVisible();
    const title = kind === "agent" ? "에이전트 바꾸기" : kind === "folder" ? "작업 폴더 바꾸기" : "여러 세션 동시에 바꾸기";
    const open = async () => {
      if (kind === "agent") {
        await app.getByRole("button", { name: "에이전트", exact: true }).click();
        await page.getByRole("menuitem", { name: "다른 가짜", exact: true }).click();
      } else if (kind === "folder") await app.getByRole("button", { name: "docs", exact: true }).click();
      else await app.getByRole("switch", { name: "여러 세션 동시에" }).click();
    };
    const opener = kind === "agent" ? app.getByRole("button", { name: "에이전트", exact: true })
      : kind === "folder" ? app.getByRole("button", { name: "docs", exact: true })
      : app.getByRole("switch", { name: "여러 세션 동시에" });
    await observeDialog(page, title, open, opener, kind === "folder" ? windowId : undefined);
    await expect(app.getByRole("heading", { name: "앱 설정" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(app.getByRole("heading", { name: "앱 설정" })).toBeHidden();
  });
}

test("창 크기를 바꿀 때 대화 입력과 스크롤, 응답 오류를 확인한다", async ({ page }) => {
  test.setTimeout(120_000);
  const { app, windowId } = await openAgent(page, 1000, 640);
  for (let index = 1; index <= 3; index += 1) {
    await send(app, `${"긴 기록 ".repeat(180)} fresh-turn`);
    await expect(app.getByText("NEW", { exact: true })).toHaveCount(index);
  }
  const history = app.getByRole("log", { name: "대화 기록" });
  await history.evaluate((element) => { element.scrollTop = 10; });
  const before = await history.evaluate((element) => ({ top: element.scrollTop, height: element.clientHeight, scroll: element.scrollHeight }));
  expect(before.scroll).toBeGreaterThan(before.height);
  expect(before.top).toBeGreaterThan(0);
  const box = app.getByRole("textbox", { name: "메시지" });
  await box.fill("크기를 바꾸어도 남는 입력");
  await core({ op: "window.set_rect", window_id: windowId, rect: { x: 24, y: 24, width: 520, height: 480 } });
  await expect.poll(async () => (await app.boundingBox())?.width).toBe(520);
  const after = await app.getByRole("log", { name: "대화 기록" }).evaluate((element) => ({ top: element.scrollTop, height: element.clientHeight, scroll: element.scrollHeight }));
  const draft = await app.getByRole("textbox", { name: "메시지" }).inputValue();
  await shot(page, "resized-draft-scroll");
  await record("창 크기 변경", { before, after, draft });
  expect(draft).toBe("크기를 바꾸어도 남는 입력");
  await send(app, "fail-turn");
  await expect(app.getByText(/turn failed/).first()).toBeVisible();
  await shot(page, "prompt-error");
  await send(app, "fresh-turn");
  await expect(app.getByText("NEW", { exact: true }).last()).toBeVisible();
  await record("응답 오류", { error: "turn failed", retry: "NEW" });
});
