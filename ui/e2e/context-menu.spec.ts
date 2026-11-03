import { expect, test } from "@playwright/test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/context-menu.html");
});

for (const [label, original, cut, selection] of [
  ["글", "abcde", "cde", "ab"], ["숫자", "12345", "345", "12"], ["메일", "abcde@example.com", "cde@example.com", "ab"],
]) {
  test(`${label}의 부분 선택 잘라내기와 붙여넣기`, async ({ page }) => {
    const input = page.getByLabel(label, { exact: true });
    await input.focus();
    await page.keyboard.press("Home"); await page.keyboard.press("Shift+ArrowRight"); await page.keyboard.press("Shift+ArrowRight");
    await input.click({ button: "right", position: { x: 8, y: 10 } });
    await page.getByRole("menuitem", { name: "잘라내기" }).click();
    await expect(input).toHaveValue(cut);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(selection);
    await page.keyboard.press("ContextMenu");
    await page.getByRole("menuitem", { name: "붙여넣기" }).click();
    await expect(input).toHaveValue(original);
  });
}

test("키보드로 연 입력 메뉴와 모두 선택", async ({ page }) => {
  const input = page.getByLabel("글", { exact: true });
  await input.focus(); await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "모두 선택" }).click();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("abcde");
  await page.keyboard.press("ContextMenu");
  await page.getByRole("menuitem", { name: "복사" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("abcde");
});

test("실제 블록 입력의 변경이 상태에 반영된다", async ({ page }) => {
  await page.goto("/?preview=shell-selection-test");
  const input = page.getByTestId("app-window-shell-selection-test").locator("textarea");
  await input.fill("abcde");
  await input.focus(); await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowRight"); await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("ContextMenu");
  await page.getByRole("menuitem", { name: "잘라내기" }).click();
  await expect(input).toHaveValue("cde");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("ab");
  await page.keyboard.press("ContextMenu");
  await page.getByRole("menuitem", { name: "붙여넣기" }).click();
  await expect(input).toHaveValue("abcde");
  await input.blur();
  await expect(input).toHaveValue("abcde");
});

test("코드 편집기에 붙여넣고 읽는 글의 선택을 복사한다", async ({ page }) => {
  await page.evaluate(() => navigator.clipboard.writeText("새 글"));
  const editor = page.locator(".cm-content");
  await editor.click(); await page.keyboard.press("Control+End");
  await editor.click({ button: "right" });
  await page.getByRole("menuitem", { name: "붙여넣기" }).click();
  await expect(editor).toContainText("편집기 원본새 글");
  const reading = page.locator("#reading");
  await reading.evaluate((element) => { const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
  await reading.click({ button: "right", position: { x: 8, y: 10 } });
  await expect(page.getByRole("menuitem")).toHaveCount(1);
  await page.getByRole("menuitem", { name: "복사" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("읽는 글을 선택합니다.");
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await reading.click({ button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);
});

for (const title of ["HTML 문서", "샌드박스"]) {
  test(`${title}에서 선택한 글 복사`, async ({ page }) => {
    const frame = page.frameLocator(`iframe[title="${title}"]`);
    const paragraph = frame.locator("#frame-text");
    await expect(paragraph).toBeVisible();
    await paragraph.evaluate((element) => { const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
    await paragraph.click({ button: "right" });
    await page.getByRole("menuitem", { name: "복사" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("프레임에서 고를 글입니다.");
  });

  test(`${title} 입력칸에 붙여넣기`, async ({ page }) => {
    await page.evaluate(() => navigator.clipboard.writeText("추가"));
    const input = page.frameLocator(`iframe[title="${title}"]`).locator("#frame-input");
    await input.click(); await page.keyboard.press("End");
    await input.click({ button: "right" });
    await page.getByRole("menuitem", { name: "붙여넣기" }).click();
    await expect(input).toHaveValue("원본추가");
  });
}

test("HTML 고르기 모드에서 인라인 글을 우클릭하면 복사만 보이고 편집은 확정된다", async ({ page }) => {
  const iframe = page.locator('iframe[title="HTML 문서"]');
  await page.evaluate(() => { (window as any).editMessages = []; window.addEventListener("message", (event) => { if (event.data?.type === "ks-html-text-edit") (window as any).editMessages.push(event.data); }); });
  await iframe.evaluate((element: HTMLIFrameElement) => element.contentWindow?.postMessage({ type: "ks-html-mode", mode: "select" }, "*"));
  const text = page.frameLocator('iframe[title="HTML 문서"]').locator("#frame-text");
  await text.dblclick();
  await expect(text).toHaveAttribute("contenteditable", "plaintext-only");
  await text.press("End"); await page.keyboard.insertText("!");
  await text.press("Control+A");
  await text.click({ button: "right", position: { x: 8, y: 10 } });
  await expect(page.getByRole("menuitem")).toHaveCount(1);
  await expect(page.getByRole("menuitem", { name: "복사" })).toBeVisible();
  await expect(text).not.toHaveAttribute("contenteditable", "plaintext-only");
  await page.getByRole("menuitem", { name: "복사" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("프레임에서 고를 글입니다.!");
  await expect.poll(() => page.evaluate(() => (window as any).editMessages.at(-1)?.after)).toBe("프레임에서 고를 글입니다.!");
  await text.dblclick();
  await text.press("End");
  await text.click({ button: "right", position: { x: 8, y: 10 } });
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("CodeMirror 클립보드 대기 중 초점을 옮기면 문서를 바꾸지 않는다", async ({ page }) => {
  const editor = page.locator(".cm-content");
  const input = page.getByLabel("글", { exact: true });
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "readText", { configurable: true, value: () => new Promise<string>((resolve) => { (window as any).finishRead = resolve; }) });
    Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: () => new Promise<void>((resolve) => { (window as any).finishWrite = resolve; }) });
  });
  await editor.click(); await page.keyboard.press("Control+End");
  await editor.click({ button: "right" });
  await page.getByRole("menuitem", { name: "붙여넣기" }).click();
  await input.focus();
  await page.evaluate(() => (window as any).finishRead("추가"));
  await expect(editor).toHaveText("편집기 원본");
  await editor.click(); await page.keyboard.press("Control+A");
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "잘라내기" }).click();
  await input.focus();
  await page.evaluate(() => (window as any).finishWrite());
  await expect(editor).toHaveText("편집기 원본");
});

for (const [name, width, height] of [["wide", 1100, 760], ["narrow", 520, 720]] as const) {
  test(`${name} 메뉴 화면 캡처`, async ({ page }) => {
    const directory = process.env.KS_CONTEXT_CAPTURE_DIR ?? resolve(process.cwd(), "../../../.local/artifacts/context-menu/20261104-0100");
    await page.setViewportSize({ width, height });
    const input = page.getByLabel("글", { exact: true });
    await input.click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    if (directory) { mkdirSync(directory, { recursive: true }); await page.screenshot({ path: join(directory, `${name}-input.png`) }); }
    await page.keyboard.press("Escape");
    const reading = page.locator("#reading");
    await reading.evaluate((element) => { const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
    await reading.click({ button: "right", position: { x: 8, y: 10 } });
    await expect(page.getByRole("menuitem", { name: "복사" })).toBeVisible();
    if (directory) await page.screenshot({ path: join(directory, `${name}-reading.png`) });
    await page.goto("/context-menu.html?title=1");
    await page.locator(".ks-window-titlebar").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "창 닫기" })).toBeVisible();
    if (directory) await page.screenshot({ path: join(directory, `${name}-title.png`) });
  });
}

test("실제 코어의 지연 응답 중 선택 위치와 프레임 입력을 유지한다", async () => {
  test.skip(!process.env.KS_CONTEXT_REAL_CORE, "전용 실제 코어 시험 캐시를 지정해야 합니다");
  test.setTimeout(360_000);
  const fixtures = resolve(process.cwd(), "e2e/fixtures/context-menu");
  const folder = mkdtempSync(join(tmpdir(), "ks-context-menu-"));
  const output = process.env.KS_CONTEXT_CAPTURE_DIR ?? resolve(process.cwd(), "../../../.local/artifacts/context-menu/review-fix-20261104-0200");
  try {
    for (const name of ["a.ts", "b.md"]) cpSync(join(fixtures, name), join(folder, name));
    const script = join(process.env.AGENT_COMMON_FILES_DIR!, "skills/kaleidoscope-app/scripts/sandbox.py");
    const run = spawnSync("python3", [script, "run", "--app", join(fixtures, "app.json"), "--folder", folder, "--scenario", resolve(process.cwd(), "e2e/context-menu-real-core.py"), "--viewport", "1440x900", "--out", output], { encoding: "utf8", timeout: 340_000 });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    const result = JSON.parse(readFileSync(join(output, "result.json"), "utf8"));
    expect(result.scenario_error, JSON.stringify(result)).toBeUndefined();
    expect(result.shell_commit).toBe(process.env.KS_CONTEXT_REAL_CORE);
    expect(JSON.parse(readFileSync(join(output, "context-menu-real-core.json"), "utf8"))).toMatchObject({ paste_immediate: "abcde", cut: "cde", clipboard: "ab", frame: "프레임 입력칸추가" });
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
