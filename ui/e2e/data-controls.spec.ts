import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const output = process.env.KS_DATA_CAPTURE_DIR;
async function capture(page: import("@playwright/test").Page, name: string) {
  if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, `${name}.png`), fullPage: true }); }
}

test("범용 블록의 탭, 입력, 확인과 상태를 조작한다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?preview=data-controls");
  const app = page.getByTestId("app-window-data-controls");
  await expect(app.getByRole("status", { name: "불러오는 중" })).toBeVisible();
  await capture(page, "wide-loading");
  await expect(app.getByText("데이터를 불러왔습니다")).toBeVisible();
  await expect(app.getByText("데이터를 받지 못했습니다").first()).toBeVisible();
  await capture(page, "wide-ready");

  const tab = app.getByRole("tab", { name: "기본" });
  await tab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(app.getByRole("tab", { name: "다른 탭" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(app.getByText("두 번째 탭")).toBeVisible();
  await app.getByRole("tab", { name: "기본" }).click();

  const multiline = app.getByPlaceholder("여러 줄 입력");
  const before = await multiline.boundingBox();
  await multiline.click();
  await page.keyboard.type("첫 줄");
  await page.keyboard.press("Enter");
  await page.keyboard.type("둘째 줄");
  const after = await multiline.boundingBox();
  expect(after!.height).toBeGreaterThan(before!.height);
  const toolbar = app.locator(".ks-data-toolbar");
  const boxes = await toolbar.locator("input, button").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, centerY: rect.y + rect.height / 2 };
  }));
  expect(Math.max(...boxes.map((box) => box.centerY)) - Math.min(...boxes.map((box) => box.centerY))).toBeLessThanOrEqual(1);
  const edges = await Promise.all([
    toolbar.locator("input").boundingBox(),
    app.getByRole("tab", { name: "기본" }).boundingBox(),
    app.locator(".ks-data-section-header").first().boundingBox(),
  ]);
  expect(Math.max(...edges.map((box) => box!.x)) - Math.min(...edges.map((box) => box!.x))).toBeLessThanOrEqual(1);
  if (output) writeFileSync(join(output, "toolbar-metrics.json"), JSON.stringify(boxes, null, 2));

  const remove = app.getByRole("button", { name: "삭제" });
  await remove.click();
  const dialog = app.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "취소" })).toBeFocused();
  await capture(page, "wide-dialog");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();
  await app.getByRole("button", { name: "실행" }).click();
  await expect(app.getByRole("alert").filter({ hasText: "요청을 처리하지 못했습니다" })).toBeVisible();
  await capture(page, "wide-notice");

  await page.setViewportSize({ width: 700, height: 700 });
  await capture(page, "narrow-notice");
  await app.getByRole("button", { name: "삭제" }).click();
  await capture(page, "narrow-dialog");
});

test("확인 대화상자와 실패한 구역 머리의 조작을 격리한다", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 700 });
  await page.goto("/?preview=data-controls");
  const app = page.getByTestId("app-window-data-controls");
  const failedSection = app.locator(".ks-data-section").filter({ hasText: "데이터를 받지 못했습니다" });
  const header = failedSection.locator(".ks-data-section-header");
  const sectionToggle = header.getByRole("button", { name: "접기" });
  await expect(sectionToggle).toHaveAttribute("aria-expanded", "true");
  await failedSection.getByRole("button", { name: "다시 받기" }).click();
  await expect(sectionToggle).toHaveAttribute("aria-expanded", "true");
  await expect(failedSection.getByText("데이터를 받지 못했습니다")).toBeVisible();
  await capture(page, "section-retry");

  // 머리 전체가 접기 단추다: 제목이 아닌 머리의 빈 곳(상태 단추 왼쪽)을 눌러도 접히고 다시 펴진다.
  const readyHeader = app.locator(".ks-data-section-header").first();
  const readyToggle = readyHeader.locator("button[aria-expanded]");
  const headerBox = (await readyHeader.boundingBox())!;
  const toggleBox = (await readyToggle.boundingBox())!;
  expect(toggleBox.width).toBeGreaterThan(headerBox.width * 0.6);
  const blank = { x: toggleBox.x + toggleBox.width - 8, y: toggleBox.y + toggleBox.height / 2 };
  await expect(readyToggle).toHaveAttribute("aria-expanded", "true");
  await page.mouse.click(blank.x, blank.y);
  await expect(readyToggle).toHaveAttribute("aria-expanded", "false");
  await page.mouse.click(blank.x, blank.y);
  await expect(readyToggle).toHaveAttribute("aria-expanded", "true");

  await app.getByRole("button", { name: "실행" }).click();
  await expect(app.getByRole("alert").filter({ hasText: "요청을 처리하지 못했습니다" })).toBeVisible();
  const opener = app.getByRole("button", { name: "삭제" });
  await opener.click();
  const dialog = app.getByRole("dialog");
  const cancel = dialog.getByRole("button", { name: "취소" });
  const confirm = dialog.getByRole("button", { name: "삭제" });
  await expect(app.locator(".ks-data-window-body")).toHaveAttribute("inert", "");
  await expect(app.locator(".ks-data-window-notice")).toHaveAttribute("inert", "");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(cancel).toBeFocused();
  await capture(page, "dialog-trapped");
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await opener.click();
  await dialog.getByRole("button", { name: "삭제" }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeEnabled();
  await expect(opener).toBeFocused();
  await expect(app.locator(".ks-data-window-body")).not.toHaveAttribute("inert", "");
});

test("도구막대는 세 폭에서 겹치거나 넘치거나 글자를 줄바꿈하지 않는다", async ({ page }) => {
  const metrics = [];
  for (const width of [400, 700, 1440]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/?preview=data-controls");
    const app = page.getByTestId("app-window-data-controls");
    const toolbar = app.locator(".ks-data-toolbar");
    await expect(toolbar.getByRole("button", { name: "실행" })).toBeVisible();
    const bar = (await toolbar.boundingBox())!;
    const boxes = await toolbar.locator("input, button").evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const text = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      const range = document.createRange();
      if (text) range.selectNodeContents(text);
      return { text: element.textContent?.trim(), x: rect.x, y: rect.y, width: rect.width, height: rect.height, lines: text ? range.getClientRects().length : 0 };
    }));
    for (const [index, box] of boxes.entries()) {
      expect(box.lines).toBeLessThanOrEqual(1);
      expect(box.x).toBeGreaterThanOrEqual(bar.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bar.x + bar.width);
      for (const other of boxes.slice(index + 1)) {
        const overlapX = Math.min(box.x + box.width, other.x + other.width) - Math.max(box.x, other.x);
        const overlapY = Math.min(box.y + box.height, other.y + other.height) - Math.max(box.y, other.y);
        expect(overlapX <= 0 || overlapY <= 0).toBe(true);
      }
    }
    // 좁은 창의 도구막대는 넘치지 않도록 접힌다. 한 줄은 자리가 넉넉한 폭에서만 요구한다.
    if (width >= 700) expect(new Set(boxes.map((box) => box.y)).size).toBe(1);
    metrics.push({ width, boxes });
    await capture(page, `toolbar-${width}`);
  }
  if (output) writeFileSync(join(output, "toolbar-widths.json"), JSON.stringify(metrics, null, 2));
});

test("넘친 목록에서 삭제 확인을 열고 닫아도 창 스크롤이 유지된다", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/?preview=data-controls");
  const shellCss = readFileSync(new URL("../../app/src/shell.css", import.meta.url), "utf8");
  await page.addStyleTag({ content: shellCss.match(/\.ks-window-content\s*\{[^}]*\}/)![0] });
  await page.addStyleTag({ content: `.ks-harness-apps.is-preview .ks-harness-window { width: 520px; height: 560px; }` });
  await page.evaluate(async () => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const app = snapshot.shared.app_versions.find((version: any) => version.app_id === "data-controls");
    const rows = Array.from({ length: 40 }, (_, index) => String(index + 1).padStart(2, "0"));
    app.definition.state = { rows, count: 0 };
    app.definition.ui = { type: "stack", direction: "column", gap: "large", children: [
      { type: "text", value: { expr: "'올린 횟수 ' & $string($state.count)" } },
      { type: "list", items: { expr: "$append([], $map($state.rows, function($r){ {'key': $r, 'title': $r & ' 항목'} }))" }, item_menu: [{
        label: "지우기", danger: true, confirm: { title: "항목 지우기", body: { item: "title" }, ok: "지우기" },
        on_select: [{ set_state: "rows", value: { expr: "$append([], $filter($state.rows, function($r){ $r != $item.key }))" } }],
      }] },
      { type: "button", label: "올리기", variant: "primary", on_click: [{ set_state: "count", value: { expr: "$state.count + 1" } }] },
      { type: "button", label: "되돌리기", on_click: [{ set_state: "rows", value: rows }] },
    ] };
    app.version += 1;
    const appWindow = snapshot.shared.windows.find((item: any) => item.app_id === "data-controls");
    appWindow.app_version = app.version;
    appWindow.state = { rows, count: 0 };
    harness.emit({ event: "state.changed", snapshot });
  });
  const app = page.getByTestId("app-window-data-controls");
  const frame = app.locator(".ks-harness-window-content");
  await frame.evaluate((node) => node.classList.add("ks-window-content"));
  const body = app.locator(".ks-data-window-body");
  await app.getByRole("option", { name: "01 항목", exact: true }).focus();
  for (let index = 0; index < 19; index += 1) await page.keyboard.press("ArrowDown");
  await expect(app.getByRole("option", { name: "20 항목", exact: true })).toBeFocused();
  expect(await body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await app.evaluate((node) => {
    (window as any).__scrollPositions = [node, ...node.querySelectorAll("*")].map((element) => [element, element.scrollTop]);
  });
  const scrollsUnchanged = async () => {
    const changed = await app.evaluate((node) => {
      const previous = new Map<Element, number>((window as any).__scrollPositions);
      return [node, ...node.querySelectorAll("*")].filter((element) => element.scrollTop !== (previous.get(element) ?? 0))
        .map((element) => ({ className: element.className, before: previous.get(element) ?? 0, after: element.scrollTop }));
    });
    expect(changed).toEqual([]);
  };
  const openConfirm = async () => {
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "지우기" }).focus();
    await page.keyboard.press("Enter");
    await expect(app.getByRole("dialog").getByRole("button", { name: "취소" })).toBeFocused();
    await scrollsUnchanged();
  };
  await openConfirm();
  await page.keyboard.press("Enter");
  await expect(app.getByRole("dialog")).toBeHidden();
  await scrollsUnchanged();
  await openConfirm();
  await page.keyboard.press("Tab");
  await expect(app.getByRole("dialog").getByRole("button", { name: "지우기" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(app.getByRole("option", { name: "21 항목", exact: true })).toBeFocused();
  await scrollsUnchanged();
  // 마지막 fill 칸의 접힘은 별도 카드에서 수정한다.
  const lastButton = app.getByRole("button", { name: "되돌리기", exact: true });
  await app.getByRole("option", { name: "40 항목", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(app.getByRole("button", { name: "올리기", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(lastButton).toBeFocused();
  expect(await frame.evaluate((node) => node.scrollTop)).toBe(0);
});
