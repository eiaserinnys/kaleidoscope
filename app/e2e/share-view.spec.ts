import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const captureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../.local/tmp/card814/captures");
const capture = async (page: Page, name: string) => { await mkdir(captureDir, { recursive: true }); await page.screenshot({ path: path.join(captureDir, name), animations: "disabled" }); };

type ShareCall = { window_id: string; view: { text: string; visual: boolean } };
async function calls(page: Page): Promise<ShareCall[]> {
  return page.evaluate(() => window.__kaleidoscopeHarness!.getShareCalls());
}

test("같이 보는 편집기의 보이는 줄, 대기 중 갱신과 PAS 칩", async ({ page }) => {
  await page.goto("/harness.html?share=editor");
  const editor = page.getByTestId("app-window-md-editor");
  const pas = page.getByTestId("app-window-workspace-pas");
  await expect(editor.locator(".cm-editor")).toBeVisible();
  await expect(pas.getByRole("button", { name: "같이 보기" })).toHaveCount(0);
  await editor.getByRole("button", { name: "같이 보기", exact: true }).click();
  await expect(editor.getByRole("button", { name: "같이 보기 끄기" })).toHaveAttribute("aria-pressed", "true");
  await expect(editor).toHaveClass(/ks-window-sharing/);
  await expect.poll(async () => (await calls(page)).length).toBeGreaterThan(0);
  const initial = (await calls(page)).at(-1)!.view.text;
  expect(initial).toMatch(/\[파일 README\.md, 1~\d+줄 \/ 전체 120줄\]/);
  expect(initial).toContain("1│ 줄 1");
  await expect(pas.getByText("마크다운 편집기", { exact: true })).toBeVisible();
  const count = (await calls(page)).length;
  await editor.locator(".cm-scroller").evaluate((el) => { el.scrollTop = el.scrollHeight / 2; });
  await pas.getByRole("textbox", { name: "메시지" }).fill("지금 보이는 줄");
  await pas.getByRole("textbox", { name: "메시지" }).press("Enter");
  await expect.poll(async () => (await calls(page)).length).toBeGreaterThan(count);
  expect((await calls(page)).at(-1)!.view.text).not.toContain("1│ 줄 1\n");
  const ops = await page.evaluate(() => window.__kaleidoscopeHarness!.getCalls().map((call) => call.op));
  expect(ops.lastIndexOf("share.view")).toBeLessThan(ops.lastIndexOf("agent.send"));
  await pas.getByRole("button", { name: "마크다운 편집기 같이 보기 끄기" }).click();
  await expect(editor).not.toHaveClass(/ks-window-sharing/);
  await expect(pas.getByRole("button", { name: "마크다운 편집기 같이 보기 끄기" })).toHaveCount(0);
  const stopped = (await calls(page)).length;
  await editor.locator(".cm-scroller").evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(1000);
  expect((await calls(page)).length).toBe(stopped);
});

test("표와 목록의 화면 안 항목만 옮긴다", async ({ page }) => {
  for (const kind of ["table", "list"]) {
    await page.goto(`/harness.html?share=${kind}`);
    const frame = page.getByTestId(`app-window-share-${kind}`);
    await expect(frame.getByText("항목 1", { exact: true })).toBeVisible();
    await frame.getByRole("button", { name: "같이 보기", exact: true }).click();
    await expect.poll(async () => (await calls(page)).length).toBeGreaterThan(0);
    const view = (await calls(page)).at(-1)!.view.text;
    expect(view).toMatch(new RegExp(`\\[${kind === "table" ? "표, 전체 80줄" : "목록, 전체 80개"} 중 1~\\d+번째\\]`));
    expect(view).toContain("항목 1");
    expect(view).not.toContain("항목 80");
    expect(view).toContain("› ");
    if (kind === "table") expect(view).toContain("이름 | 값");
    const before = (await calls(page)).length;
    await frame.locator(kind === "table" ? '[role="table"]' : '[role="listbox"]').evaluate((el) => { el.scrollTop = el.scrollHeight / 2; });
    await expect.poll(async () => (await calls(page)).length).toBeGreaterThan(before);
    expect((await calls(page)).at(-1)!.view.text).not.toContain("항목 1\n");
  }
});

test("브라우저에서 긴 보이는 글을 UTF-8 한도와 줄 경계로 자른다", async ({ page }) => {
  await page.goto("/harness.html?share=list");
  const result = await page.evaluate(() => {
    const root = document.createElement("div");
    root.style.cssText = "position:fixed;left:0;top:0;width:700px;height:500px;overflow:hidden;background:white;font:1px/1px monospace;z-index:9999";
    for (let i = 0; i < 400; i++) {
      const line = document.createElement("div");
      line.textContent = `${i + 1} ${"가".repeat(50)}`;
      root.append(line);
    }
    document.body.append(root);
    const view = window.__kaleidoscopeHarness!.describeVisible(root);
    root.remove();
    return { ...view, bytes: new TextEncoder().encode(view.text).length };
  });
  expect(result.bytes).toBeLessThanOrEqual(16384);
  expect(result.text).toMatch(/\n…\(아래는 길어서 뺐습니다\)$/);
  expect(result.text).toContain("1 가가가");
});

test("웹 화면과 다른 데스크톱, 밝고 어두운 화면", async ({ page }) => {
  await page.goto("/harness.html?share=web");
  const frame = page.getByTestId("app-window-web-browser");
  await expect(page.getByTestId("fake-webview-web-browser-window")).toBeVisible();
  await capture(page, "share-light-wide-before.png");
  await page.setViewportSize({ width: 960, height: 600 });
  await capture(page, "share-light-narrow-before.png");
  await page.emulateMedia({ colorScheme: "dark" });
  await capture(page, "share-dark-narrow-before.png");
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await frame.getByRole("button", { name: "같이 보기", exact: true }).click();
  await expect.poll(async () => (await calls(page)).at(-1)?.view.text).toContain("[웹 화면: 가짜 페이지, https://www.google.com/]");
  expect((await calls(page)).at(-1)!.view.visual).toBe(true);
  await page.mouse.move(1000, 800);
  await expect(frame.getByRole("button", { name: "같이 보기 끄기" })).toHaveCSS("background-image", "none");
  await capture(page, "share-light-wide.png");
  await page.setViewportSize({ width: 960, height: 600 });
  await capture(page, "share-light-narrow.png");
  const narrowMetrics = await measureTitle(frame);
  await page.emulateMedia({ colorScheme: "dark" });
  await capture(page, "share-dark-narrow.png");
  await page.getByTestId("app-window-workspace-pas").locator(".ks-window-titlebar").click({ position: { x: 600, y: 16 } });
  await capture(page, "share-dark-narrow-pas.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  await capture(page, "share-dark-wide.png");
  const wideMetrics = await measureTitle(frame);
  for (const metrics of [narrowMetrics, wideMetrics]) {
    expect(metrics.buttons).toHaveLength(2);
    expect(Math.abs(metrics.buttons[0].centerDelta)).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.buttons[1].centerDelta)).toBeLessThanOrEqual(1);
    expect(metrics.buttons[0].width).toBe(metrics.buttons[1].width);
    expect(metrics.buttons[0].height).toBe(metrics.buttons[1].height);
  }
  await writeFile(path.join(captureDir, "metrics.json"), JSON.stringify({ wide: wideMetrics, narrow: narrowMetrics }, null, 2));
  await page.setViewportSize({ width: 960, height: 600 });
  const before = (await calls(page)).length;
  await page.getByRole("button", { name: "두 번째 화면" }).click();
  await page.waitForTimeout(1000);
  expect((await calls(page)).slice(before).every((call) => call.view.text.length > 0)).toBe(true);
});

async function measureTitle(frame: Locator) {
  return frame.locator(".ks-window-titlebar").evaluate((bar) => {
    const title = bar.getBoundingClientRect();
    const buttons = Array.from(bar.querySelectorAll("button"), (button) => {
      const rect = button.getBoundingClientRect();
      return { name: button.getAttribute("aria-label"), x: rect.x, y: rect.y, width: rect.width, height: rect.height, centerDelta: (rect.top + rect.bottom - title.top - title.bottom) / 2 };
    });
    return { title: { x: title.x, y: title.y, width: title.width, height: title.height }, buttons };
  });
}
