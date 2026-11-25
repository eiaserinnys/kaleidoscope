import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, appendFile } from "node:fs/promises";
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
  { id: "fake-visual", name: "화면 가짜", command: fakeAgent, args: [], env: { TEST_SCENARIO: "parallel_visual" }, parallel_sessions: true },
  { id: "fake-parallel", name: "병렬 가짜", command: fakeAgent, args: [], env: {}, parallel_sessions: true },
  { id: "fake-other", name: "다른 가짜", command: fakeAgent, args: [], env: {}, parallel_sessions: true },
  { id: "fake-single", name: "단일 가짜", command: fakeAgent, args: [], env: {} },
  // 사용자가 추가한 에이전트처럼 parallel_sessions가 없다. 설정의 스위치로 켠다.
  { id: "fake-added", name: "추가 가짜", command: fakeAgent, args: [], env: {} },
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

async function measureMinimum(app: Locator, label: string) {
  const values = await app.evaluate((root) => {
    const body = root.querySelector<HTMLElement>(".ks-data-window-body")!;
    const input = root.querySelector<HTMLElement>(".ks-agent-chat-input-area")!;
    const history = root.querySelector<HTMLElement>(".ks-agent-chat-history")!;
    const header = root.querySelector<HTMLElement>(".ks-agent-chat-input-header")!;
    const message = history.querySelector<HTMLElement>(".ks-agent-chat-assistant .ks-markdown-text")!;
    const rect = (element: Element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
    const ancestors = []; let node: HTMLElement | null = input.parentElement;
    while (node && node !== body) { ancestors.push({ class: node.className, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, rect: rect(node), minHeight: getComputedStyle(node).minHeight }); node = node.parentElement; }
    return { body: { ...rect(body), scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, scrollWidth: body.scrollWidth, clientWidth: body.clientWidth }, input: rect(input), header: rect(header), history: { ...rect(history), scrollHeight: history.scrollHeight, clientHeight: history.clientHeight, lineHeight: parseFloat(getComputedStyle(message).lineHeight) }, ancestors };
  });
  const line = JSON.stringify({ label, ...values });
  console.log("최소 창 측정 " + line);
  if (process.env.KS_AGENT_PARALLEL_METRICS) await appendFile(process.env.KS_AGENT_PARALLEL_METRICS, line + "\n");
  return values;
}

async function measureHeader(app: Locator, label: string) {
  await app.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const values = await app.evaluate((root) => {
    const box = (element: Element | null) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    const textBox = (element: Element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    const texts = Array.from(root.querySelectorAll<HTMLElement>(".ks-agent-chat-input-header .ks-data-text.is-meta"))
      .filter((element) => element.offsetParent).map(textBox).sort((a, b) => a.left - b.left);
    return {
      notice: box(root.querySelector(".ks-agent-chat-input-header .ks-notice")),
      texts,
      attach: box(root.querySelector(".ks-agent-chat-input-row > .ks-icon-button")),
      assistant: textBox(root.querySelector(".ks-agent-chat-assistant .ks-markdown-text")!),
      user: box(root.querySelector(".ks-agent-chat-user")),
    };
  });
  const line = JSON.stringify({ label, ...values });
  console.log("입력 머리 측정 " + line);
  if (process.env.KS_AGENT_PARALLEL_METRICS) await appendFile(process.env.KS_AGENT_PARALLEL_METRICS, line + "\n");
  return values;
}

function assertMinimum(values: Awaited<ReturnType<typeof measureMinimum>>, shortHistory = false) {
  expect(values.body.scrollHeight).toBeLessThanOrEqual(values.body.clientHeight);
  expect(values.body.scrollWidth).toBeLessThanOrEqual(values.body.clientWidth);
  for (const ancestor of values.ancestors.filter((item) => item.class.split(" ").includes("ks-data-stack-item"))) {
    expect(ancestor.scrollHeight, `넘친 쌓기 칸: ${ancestor.class}`).toBeLessThanOrEqual(ancestor.clientHeight);
  }
  expect(values.input.y).toBeGreaterThanOrEqual(values.body.y);
  expect(values.input.bottom).toBeLessThanOrEqual(values.body.bottom);
  if (shortHistory) {
    expect(values.history.height).toBeGreaterThan(0);
    expect(values.history.scrollHeight).toBeGreaterThan(values.history.clientHeight);
  } else {
    expect(values.history.height).toBeGreaterThanOrEqual(values.history.lineHeight);
  }
}

let agentsWritten = false;

/** 에이전트 창을 열고 에이전트와 작업 폴더를 골라 대화 화면까지 간다. */
async function openAgent(page: Page, agentName: string, rect = { x: 24, y: 24, width: 1000, height: 640 }): Promise<{ app: Locator; windowId: string }> {
  await page.goto(`/?core=${coreUrl}`);
  await expect(page.locator(".ks-taskbar").getByRole("button", { name: "앱 열기" })).toBeVisible();
  const { snapshot } = await core({ op: "state.get" });
  const workspace = snapshot.device.active_workspace_id;
  const desktop = snapshot.device.active_desktop_ids[workspace];
  const opened = await core({ op: "window.open", desktop_id: desktop, app_id: "agent", rect });
  const windowId: string = opened.window.id;
  if (!agentsWritten) {
    const current = await core({ op: "storage.get", window_id: windowId, entry: "agents" });
    const written = await core({ op: "storage.write", window_id: windowId, entry: "agents", content: AGENTS, expected_revision: current.result.revision });
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

test.describe.configure({ mode: "default" });

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
  await expect(app.getByRole("textbox", { name: "메시지" })).toBeFocused();
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

for (const size of [{ width: 1000, height: 640, label: "wide" }, { width: 520, height: 480, label: "narrow" }, { width: 360, height: 240, label: "minimum" }]) {
  test(`응답 중 새 세션의 입력 초점 세 번 — ${size.label}`, async ({ page }) => {
    test.setTimeout(120_000);
    const { app } = await openAgent(page, "병렬 가짜", { x: 24, y: 24, width: size.width, height: size.height });
    const message = app.getByRole("textbox", { name: "메시지" });
    for (let index = 0; index < 3; index += 1) {
      await send(app, "stream");
      await expect(app.locator(".ks-agent-chat-assistant").last()).toContainText("[02]");
      await app.getByRole("button", { name: "새 세션", exact: true }).click();
      await expect(message).toBeFocused();
      await page.keyboard.type(`새 대화 ${index}`);
      await expect(message).toHaveValue(`새 대화 ${index}`);
      await shot(page, `focus-new-${size.label}-${index + 1}`);
      if (size.label !== "wide") await app.getByRole("button", { name: "지난 세션", exact: true }).click();
      await expect(page.getByPlaceholder("제목으로 찾기")).toHaveValue("");
      if (size.label !== "wide") {
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog", { name: "이어 갈 세션 고르기" })).toHaveCount(0);
      }
      await message.fill("");
    }
  });
}

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
  await expect(app.getByRole("textbox", { name: "메시지" })).toBeFocused();
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

test("사용자가 추가한 에이전트는 동시 세션이 꺼져 있고 설정 스위치로 켜면 응답 중에도 새 세션을 연다", async ({ page }) => {
  test.setTimeout(120_000);
  const { app } = await openAgent(page, "추가 가짜");
  const newSession = app.getByRole("button", { name: "새 세션", exact: true });
  await send(app, "slow");
  await expect(app.getByRole("button", { name: "멈춤", exact: true })).toBeVisible();
  await expect(newSession).toBeDisabled();
  await app.getByRole("button", { name: "멈춤", exact: true }).click();
  await expect(newSession).toBeEnabled({ timeout: 10_000 });
  await app.getByRole("button", { name: "앱 설정" }).click();
  await expect(app.getByRole("heading", { name: "앱 설정" })).toBeVisible();
  const toggle = app.getByRole("switch", { name: "여러 세션 동시에" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(app.getByText("응답 중에도 다른 세션에서 대화합니다. 에이전트가 지원할 때만 켜세요.", { exact: true })).toBeVisible();
  await shot(page, "e1-settings-parallel-off");
  await toggle.click();
  // 새 값으로 에이전트를 다시 시작한다. 설정 화면은 열린 채로 스위치가 켜진다.
  await expect(app.getByRole("switch", { name: "여러 세션 동시에" })).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
  await shot(page, "e2-settings-parallel-on");
  await app.getByRole("button", { name: "앱으로 돌아가기" }).click();
  await allowUntilChat(page, app);
  const { snapshot } = await core({ op: "state.get" });
  const windowId = snapshot.shared.windows.find((window: any) => window.app_id === "agent").id;
  const stored = await core({ op: "storage.get", window_id: windowId, entry: "agents" });
  const added = stored.result.content.find((agent: any) => agent.id === "fake-added");
  expect(added.parallel_sessions).toBe(true);
  await send(app, "slow");
  await expect(app.getByRole("button", { name: "멈춤", exact: true })).toBeVisible();
  const selected = await app.locator('.ks-list [aria-selected="true"]').getAttribute("data-row-key");
  await expect(newSession).toBeEnabled();
  await newSession.click();
  await expect(sessionRow(app, selected!).locator(".ks-view-badges")).toContainText("응답 중");
  await shot(page, "e3-added-agent-parallel");
});

for (const size of [{ width: 1000, height: 640, label: "wide" }, { width: 520, height: 480, label: "narrow" }, { width: 360, height: 240, label: "minimum" }]) {
  test(`병렬 허용 안내와 상태 줄 화면 — ${size.label}`, async ({ page }) => {
    test.setTimeout(90_000);
    const { app, windowId } = await openAgent(page, "화면 가짜", { x: 24, y: 24, width: size.width, height: size.height });
    const setStatus = async (content: boolean) => {
      const current = await core({ op: "storage.get", window_id: windowId, entry: "status_bar" });
      await core({ op: "storage.write", window_id: windowId, entry: "status_bar", content, expected_revision: current.result.revision });
    };
    await setStatus(false);
    const noNotice: Awaited<ReturnType<typeof measureMinimum>>[] = [];
    await send(app, "fresh-turn");
    await expect(app.getByText("NEW", { exact: true })).toBeVisible();
    if (size.label === "minimum") {
      noNotice.push(await measureMinimum(app, "안내 없음·상태 줄 끔"));
      await shot(page, "visual-minimum-no-notice-status-off");
    }
    await setStatus(true);
    await expect(app.getByText(/20%/).first()).toBeVisible();
    const statusOnly = await measureHeader(app, `${size.label} 상태 줄만`);
    expect(statusOnly.texts[0].left).toBeCloseTo(size.label === "wide" ? 317 : 37, 0);
    if (size.label === "minimum") {
      noNotice.push(await measureMinimum(app, "안내 없음·상태 줄 켬"));
      await shot(page, "visual-minimum-no-notice-status-on");
    }
    await setStatus(false);
    await send(app, "permission");
    await expect(app.locator(".ks-agent-chat-footer").getByText("파일 수정", { exact: true })).toBeVisible();
    await shot(page, `visual-${size.label}-permission-before`);
    await app.getByRole("button", { name: "새 세션", exact: true }).click();
    await expect(app.getByText("다른 세션이 허용을 기다립니다", { exact: true })).toBeVisible();
    await send(app, "fresh-turn");
    await expect(app.getByText("NEW", { exact: true })).toBeVisible();
    await shot(page, `visual-${size.label}-status-off`);
    const off = size.label === "minimum" ? await measureMinimum(app, "상태 줄 끔") : null;
    await setStatus(true);
    await expect(app.getByText(/70%/).first()).toBeVisible();
    const geometry = await measureHeader(app, `${size.label} 안내와 상태 줄`);
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    near(geometry.notice!.left, geometry.texts[0].left);
    near(geometry.notice!.left, geometry.attach!.left);
    near(geometry.notice!.left, geometry.assistant.left);
    near(geometry.notice!.right, geometry.texts.at(-1)!.right);
    near(geometry.notice!.right, geometry.user!.right);
    expect(geometry.texts[0].top - geometry.notice!.bottom).toBeGreaterThanOrEqual(4);
    await shot(page, `visual-${size.label}-status-on`);
    if (size.label === "minimum") {
      const on = await measureMinimum(app, "상태 줄 켬");
      expect(noNotice[0].header.height).toBe(0);
      expect(noNotice[0].history.height).toBe(100);
      for (const values of noNotice) assertMinimum(values);
      assertMinimum(off!);
      assertMinimum(on, true);
      const history = app.locator(".ks-agent-chat-history");
      const scroll = await history.evaluate((element) => { element.scrollTop = 0; element.scrollTop = element.scrollHeight; return element.scrollTop; });
      expect(scroll).toBeGreaterThan(0);
    }
    if (size.label !== "wide") {
      await app.getByRole("button", { name: "지난 세션", exact: true }).click();
      const picker = page.getByRole("dialog", { name: "이어 갈 세션 고르기" });
      await expect(picker).toBeVisible();
      await shot(page, `visual-${size.label}-history`);
      await page.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
      await app.getByRole("button", { name: "앱 설정" }).click();
      await shot(page, `visual-${size.label}-settings`);
      await app.getByRole("button", { name: "앱으로 돌아가기" }).click();
    }
    if (size.label === "wide") {
      await expect(sessionRow(app, "session-1").locator(".ks-view-badges")).toContainText("허용 필요");
      await page.emulateMedia({ colorScheme: "dark" });
      await shot(page, "visual-wide-dark-permission");
      await page.emulateMedia({ colorScheme: "light" });
      await send(app, "stream");
      await expect(app.locator(".ks-agent-chat-assistant").last()).toContainText("[02]");
      await sessionRow(app, "session-1").click({ button: "right" });
      await page.getByRole("menuitem", { name: "삭제" }).click();
      const dialog = page.getByRole("dialog", { name: "세션 삭제" });
      await expect(dialog).toContainText("응답 중이거나 허용을 기다리는 세션은 지금 지울 수 없으며 응답이나 허용이 끝난 뒤 지울 수 있습니다");
      await expect(dialog.getByRole("button", { name: "삭제", exact: true })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeVisible();
      await shot(page, "visual-wide-delete-blocked");
      await dialog.getByRole("button", { name: "닫기" }).click();
      await expect(sessionRow(app, "session-1")).toBeFocused();
      await expect(app.locator(".ks-agent-chat-footer").getByText("파일 수정", { exact: true })).toHaveCount(0);
      await expect(sessionRow(app, "session-1").locator(".ks-view-badges")).toContainText("허용 필요");
      await expect(app.getByText("세션을 지우지 못했습니다", { exact: false })).toHaveCount(0);
      await expect(app.locator(".ks-agent-chat-assistant").last()).toContainText("[05]");
      await sessionRow(app, "session-2").click({ button: "right" });
      await page.getByRole("menuitem", { name: "삭제" }).click();
      await expect(dialog.getByRole("button", { name: "삭제", exact: true })).toHaveCount(0);
      await dialog.getByRole("button", { name: "닫기" }).click();
      await expect(sessionRow(app, "session-2")).toBeFocused();
      await expect(app.locator(".ks-agent-chat-assistant").last()).toContainText(STREAM, { timeout: 20_000 });
      await sessionRow(app, "session-2").click({ button: "right" });
      await page.getByRole("menuitem", { name: "삭제" }).click();
      await page.getByRole("dialog", { name: "세션 삭제" }).getByRole("button", { name: "삭제", exact: true }).click();
      await expect(sessionRow(app, "session-2")).toHaveCount(0);
      await expect(sessionRow(app, "session-3")).toHaveAttribute("aria-selected", "true");
      await expect(app.locator('.ks-list [role="option"]:focus')).toHaveCount(1);
      await page.keyboard.type("x");
      await expect(page.getByPlaceholder("제목으로 찾기")).toHaveValue("");
      await shot(page, "visual-wide-delete-after");
    }
    await app.getByRole("button", { name: "이동", exact: true }).click();
    await expect(app.getByRole("textbox", { name: "메시지" })).toBeFocused();
    await shot(page, `focus-move-${size.label}`);
  });
}
