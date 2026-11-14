import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test.use({ deviceScaleFactor: 2, launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

const output = process.env.KS_DATA_CAPTURE_DIR;
async function capture(page: import("@playwright/test").Page, name: string) {
  if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, `${name}.png`), fullPage: true }); }
}

test("범용 블록의 탭, 입력, 확인과 상태를 조작한다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // 하니스의 1초 지연은 페이지가 늦게 뜨면 시험이 보기 전에 끝난다(카드 #1167). 응답을 시험이 풀 때까지 붙잡는다.
  await page.addInitScript(() => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const gate = { started: false, wait: () => { gate.started = true; return held; }, release: () => release() };
    Object.assign(window, { dataSampleGate: gate });
  });
  await page.goto("/?preview=data-controls");
  const app = page.getByTestId("app-window-data-controls");
  await expect.poll(() => page.evaluate(() => (window as any).dataSampleGate.started)).toBe(true);
  await expect(app.getByRole("status", { name: "불러오는 중" })).toBeVisible();
  await capture(page, "wide-loading");
  await page.evaluate(() => (window as any).dataSampleGate.release());
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

type ToolbarScenario = "split" | "tabsplit" | "variants" | "jizura" | "ktx" | "label";
async function showToolbarScenario(page: import("@playwright/test").Page, width: number, scenario: ToolbarScenario) {
  await page.setViewportSize({ width: width + 40, height: 1000 });
  await page.goto("/?preview=data-controls");
  await page.addStyleTag({ content: `.ks-harness-apps.is-preview .ks-harness-window { width: ${width}px; height: 900px; }` });
  await page.evaluate(async (kind) => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const app = snapshot.shared.app_versions.find((item: any) => item.app_id === "data-controls");
    const state = { title:"", artist:"", route:"", date:"", time:"", query:"", choice:"전체", mode:"전체", range:"전체", format:"전체" };
    const input = (placeholder: string, key = "query", label?: string) => ({ type:"input", ...(placeholder === "앱 찾기" ? { kind:"search" } : {}), placeholder, ...(label ? { label } : {}), value:{ state:key }, on_change:{ set_state:key } });
    const select = (style: string, options = ["전체", "설치됨"], key = "choice") => ({ type:"select", style, options, value:{ state:key }, on_change:{ set_state:key } });
    const button = (label: string, extra = {}) => ({ type:"button", label, on_click:[{ set_state:"choice", value:"전체" }], ...extra });
    const toolbar = (start: any[], end: any[] = []) => ({ type:"toolbar", start, end });
    const text = (value: string, style = "title") => ({ type:"text", value, style });
    const column = (children: any[]) => ({ type:"stack", direction:"column", children });
    const icon = () => button("올리기", { icon:"upload", icon_only:true, variant:"ghost" });
    const jizura = () => toolbar([
      text("곡 정보", "body"), input("곡 제목", "title"), input("아티스트", "artist"),
      select("segmented", ["전체", "가사", "영상"], "mode"), select("dropdown", ["전체", "하나", "둘", "셋", "넷", "다섯", "여섯"], "format"),
      ...["열기", "저장", "AE용 내보내기", "초기화", "이용 안내", "사용법 안내"].map((label) => button(label)),
    ]);
    const ktx = () => toolbar([
      select("segmented", ["전체", "고속"], "mode"), select("segmented", ["전체", "상행", "하행"], "range"),
      input("출발 → 도착", "route"), input("YYYY-MM-DD", "date"), input("HH:MM~HH:MM", "time"),
    ], [button("저장", { variant:"primary" }), button("신규"), button("삭제", { variant:"danger" })]);
    app.definition.state = state;
    app.definition.ui = kind === "split" ? { type:"split", direction:"row", sizes:[18,47,35], children:[
      column([toolbar([text("카테고리")]), text("전체 · 설치됨", "body")]),
      column([toolbar([input("앱 찾기")], [icon()]), text("앱 목록", "body")]),
      column([toolbar([text("kaleidoscope 랜딩 페이지 시안 3판 디렉터 검토본")], [text("제작자", "meta")]), text("앱 설명", "body"), toolbar([], [button("설치", { variant:"primary" })])]),
    ] } : kind === "tabsplit" ? { type:"tabs", tabs:[{ label:"목록", child:{ type:"split", direction:"row", sizes:[50,50], column_below:500, children:[
      column([toolbar([text("카테고리")]), text("전체", "body")]),
      column([toolbar([input("앱 찾기")], [icon()]), text("앱 목록", "body")]),
    ] } }] } : kind === "variants" ? column([
      toolbar([text("카테고리")]), toolbar([input("앱 찾기")]), toolbar([select("dropdown")]),
      toolbar([select("segmented")]), toolbar([button("설치", { variant:"primary" })]), toolbar([icon()]),
      toolbar([input("앱 찾기")], [icon()]), toolbar([text("kaleidoscope 랜딩 페이지 시안 3판 디렉터 검토본")], [select("dropdown")]),
      toolbar([input("앱 찾기"), select("dropdown"), select("segmented")], [button("첫 번째"), button("두 번째"), button("세 번째")]),
      { type:"section", title:"입력", child:text("앱 설명", "body") },
    ]) : kind === "jizura" ? jizura() : kind === "ktx" ? ktx() : toolbar([], [input("찾기", "query", "검색")]);
    app.version += 1;
    const appWindow = snapshot.shared.windows.find((item: any) => item.app_id === "data-controls");
    appWindow.app_version = app.version;
    appWindow.state = { ...state };
    harness.emit({ event:"state.changed", snapshot });
  }, scenario);
  const app = page.getByTestId("app-window-data-controls");
  if (scenario === "split") await expect(app.getByText("카테고리", { exact: true })).toBeVisible();
  if (scenario === "tabsplit") await expect(app.locator(".ks-data-toolbar")).toHaveCount(2);
  if (scenario === "variants") await expect(app.locator(".ks-data-toolbar")).toHaveCount(9);
  if (scenario === "jizura") await expect(app.getByRole("button", { name: "사용법 안내" })).toBeAttached();
  if (scenario === "ktx") await expect(app.getByPlaceholder("HH:MM~HH:MM")).toBeAttached();
  if (scenario === "label") await expect(app.getByLabel("검색")).toBeAttached();
  return app;
}

async function checkToolbarGeometry(app: import("@playwright/test").Locator) {
  const metrics = await app.locator(".ks-data-toolbar").evaluateAll((bars) => bars.map((bar) => {
    const rect = bar.getBoundingClientRect();
    const style = getComputedStyle(bar);
    const probe = document.createElement("div");
    probe.style.height = "var(--ks-bar-height)";
    bar.append(probe);
    const expected = probe.getBoundingClientRect().height;
    probe.remove();
    const controlHeight = parseFloat(style.getPropertyValue("--ks-control-height"));
    return { x:rect.x, y:rect.y, width:rect.width, height:rect.height, expected, controlHeight, children:Array.from(bar.querySelectorAll(":scope > .ks-data-toolbar-group > .ks-data-toolbar-item")).map((item) => {
      const child = item.getBoundingClientRect(); return { x:child.x, y:child.y, width:child.width, height:child.height };
    }) };
  }));
  for (const bar of metrics) {
    expect(bar.height).toBe(bar.expected);
    for (const child of bar.children) {
      expect(child.height).toBeLessThanOrEqual(bar.controlHeight + 0.5);
      expect(Math.abs(child.y + child.height / 2 - (bar.y + bar.height / 2))).toBeLessThanOrEqual(1);
    }
  }
  return metrics;
}

async function checkTabAndScroll(page: import("@playwright/test").Page, bar: import("@playwright/test").Locator) {
  const controls = bar.locator("input:not([disabled]), button:not([disabled])");
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);
  await controls.first().focus();
  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    await expect(control).toBeFocused();
    const visibility = await control.evaluate((node) => {
      const bar = node.closest(".ks-data-toolbar")!;
      const item = node.getBoundingClientRect(), track = bar.getBoundingClientRect();
      return { left:item.left - track.left, right:track.right - item.right };
    });
    expect(visibility.left).toBeGreaterThanOrEqual(-1);
    expect(visibility.right).toBeGreaterThanOrEqual(-1);
    if (i + 1 < count) await page.keyboard.press("Tab");
  }
}

// 페이지를 새로 띄우는 조합마다 시험을 나눈다. 한 시험에 여러 번 띄우기를 묶으면 부하에서 60초 제한을 넘는다(카드 #1167).
for (const width of [1000, 360]) {
  for (const scenario of ["split", "variants", "label"] as const) {
    test(`도구 막대의 모든 조합은 같은 높이와 세로 가운데를 유지한다: ${scenario} ${width}`, async ({ page }) => {
      const app = await showToolbarScenario(page, width, scenario);
      await capture(page, `${scenario}-${width}`);
      const metrics = await checkToolbarGeometry(app);
      if (output) writeFileSync(join(output, `${scenario}-${width}.json`), JSON.stringify(metrics, null, 2));
      if (scenario === "variants" && width === 360) {
        await checkTabAndScroll(page, app.locator(".ks-data-toolbar").nth(7));
        await checkTabAndScroll(page, app.locator(".ks-data-toolbar").last());
        expect(await app.locator(".ks-data-window-body").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      }
    });
  }
}

for (const width of [1000, 800, 360]) {
  for (const scenario of ["jizura", "ktx"] as const) {
    test(`붐비는 도구 막대의 모든 조작을 가로 스크롤과 Tab으로 사용할 수 있다: ${scenario} ${width}`, async ({ page }) => {
      const app = await showToolbarScenario(page, width, scenario);
      const bar = app.locator(".ks-data-toolbar");
      await capture(page, `${scenario}-${width}`);
      const metrics = await checkToolbarGeometry(app);
      if (output) writeFileSync(join(output, `${scenario}-${width}.json`), JSON.stringify(metrics, null, 2));
      if (width === 360) {
        expect(await bar.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
        await bar.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
        await expect(bar.locator("button").last()).toBeInViewport();
        await capture(page, `${scenario}-360-scrolled`);
        await bar.locator("button").last().click();
        await bar.evaluate((node) => { node.scrollLeft = 0; });
      }
      await checkTabAndScroll(page, bar);
      expect(await app.locator(".ks-data-window-body").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      if (width === 360 && scenario === "jizura") {
        await bar.locator(".ks-select-button").click();
        await expect(page.getByRole("menuitem", { name: "여섯" })).toBeVisible();
        await capture(page, "jizura-360-menu");
        await page.keyboard.press("Escape");
      }
    });
  }
}

test("긴 제목은 말줄임되고 끝 조작은 막대에 남는다", async ({ page }) => {
  for (const [width, scenario] of [[1000, "split"], [360, "variants"]] as const) {
    const app = await showToolbarScenario(page, width, scenario);
    const bar = scenario === "split" ? app.locator(".ks-data-toolbar").nth(2) : app.locator(".ks-data-toolbar").nth(7);
    const text = bar.locator(".ks-data-text.is-title");
    await expect(text).toHaveText("kaleidoscope 랜딩 페이지 시안 3판 디렉터 검토본");
    const geometry = await bar.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const title = node.querySelector<HTMLElement>(".ks-data-text.is-title")!;
      const end = node.querySelector<HTMLElement>(".ks-data-toolbar-group.is-end")!.getBoundingClientRect();
      return { clipped: title.scrollWidth > title.clientWidth, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, endLeft: end.left - r.left, endRight: r.right - end.right };
    });
    expect(geometry.clipped).toBe(true);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.endLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.endRight).toBeGreaterThanOrEqual(0);
    await capture(page, `revision-title-${width}`);
  }
});

// 좁은 칸의 막대는 입력이 먼저 줄어 끝 조작을 처음 화면에 남긴다. 붐비는 막대(jizura)는 이 경계보다 넓어 지금처럼 가로 스크롤한다.
type NarrowEnd = "text-button" | "select-icon" | "toggle";
const narrowEnds: { end: NarrowEnd; label: string }[] = [
  { end: "text-button", label: "글자 단추" },
  { end: "select-icon", label: "고르기와 아이콘 단추" },
  { end: "toggle", label: "토글" },
];

async function showNarrowToolbarScenario(page: import("@playwright/test").Page, width: number, height: number, end: NarrowEnd) {
  await page.setViewportSize({ width, height });
  await page.goto("/?preview=data-controls");
  await page.evaluate(async (kind) => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const app = snapshot.shared.app_versions.find((item: any) => item.app_id === "data-controls");
    const state = { query: "", status: "all", on: true };
    const endBlocks = kind === "text-button" ? [{ type: "button", label: "다시 받기", on_click: [] }]
      : kind === "select-icon" ? [
        { type: "select", value: { state: "status" }, on_change: { set_state: "status" }, options: [{ value: "all", label: "전체" }, { value: "done", label: "완료" }] },
        { type: "button", label: "다시 받기", icon: "refresh-cw", icon_only: true, variant: "ghost", on_click: [] },
      ]
      : [{ type: "toggle", label: "격자", value: { state: "on" }, on_change: { set_state: "on" } }];
    app.definition.state = state;
    app.definition.ui = { type: "split", direction: "row", sizes: [58, 42], children: [
      { type: "stack", direction: "column", children: [{ type: "text", value: "왼쪽 칸", style: "body" }] },
      { type: "stack", direction: "column", gap: "none", children: [
        { type: "toolbar", start: [{ type: "input", value: { state: "query" }, on_change: { set_state: "query" }, placeholder: "앱 찾기" }], end: endBlocks },
        { type: "text", value: "오른쪽 칸", style: "body" },
      ] },
    ] };
    app.version += 1;
    const appWindow = snapshot.shared.windows.find((item: any) => item.app_id === "data-controls");
    appWindow.app_version = app.version;
    appWindow.state = { ...state };
    harness.emit({ event: "state.changed", snapshot });
  }, end);
  // 창이 화면을 채우게 해 360x600 화면에서 창도 360x600이 되게 한다(시각 검수 스크립트와 같은 꼴).
  await page.addStyleTag({ content: "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }" });
  const app = page.getByTestId("app-window-data-controls");
  await expect(app.getByPlaceholder("앱 찾기")).toBeAttached();
  return app.locator(".ks-data-toolbar").first();
}

test("좁은 칸의 도구 막대는 입력을 줄여 끝 조작을 막대와 화면 안에 남긴다", async ({ page }) => {
  for (const { end, label } of narrowEnds) {
    const bar = await showNarrowToolbarScenario(page, 360, 600, end);
    const narrow = await bar.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const endGroup = node.querySelector<HTMLElement>(":scope > .ks-data-toolbar-group.is-end")!.getBoundingClientRect();
      return {
        scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
        inputWidth: node.querySelector("input")!.getBoundingClientRect().width,
        barRight: rect.right, endRight: endGroup.right, screenRight: window.innerWidth,
      };
    });
    expect(narrow.scrollWidth, `${label} 360: 막대가 가로로 넘치지 않는다`).toBeLessThanOrEqual(narrow.clientWidth + 1);
    expect(narrow.endRight, `${label} 360: 끝 묶음이 막대 안에 있다`).toBeLessThanOrEqual(narrow.barRight + 1);
    expect(narrow.endRight, `${label} 360: 끝 묶음이 화면 안에 있다`).toBeLessThanOrEqual(narrow.screenRight + 1);
    expect(narrow.inputWidth, `${label} 360: 입력은 바닥 32px까지 줄어든다`).toBeGreaterThanOrEqual(32 - 0.5);
    await capture(page, `narrow-toolbar-${end}-360`);

    const wideBar = await showNarrowToolbarScenario(page, 1180, 720, end);
    const wideInputWidth = await wideBar.evaluate((node) => node.querySelector("input")!.getBoundingClientRect().width);
    expect(wideInputWidth, `${label} 1180: 넓은 막대의 입력은 96px 이상이다`).toBeGreaterThanOrEqual(96);
    await capture(page, `narrow-toolbar-${end}-1180`);
  }
});

test("스크롤바가 있어도 도구 막대의 조작은 같은 세로 중심이다", async ({ page }) => {
  const app = await showToolbarScenario(page, 360, "jizura");
  const bar = app.locator(".ks-data-toolbar");
  const measured = await bar.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const items = [...node.querySelectorAll<HTMLElement>(".ks-data-toolbar-item")].map((item) => {
      const r = item.getBoundingClientRect(); return r.y + r.height / 2;
    });
    return { center:rect.y + (rect.height - parseFloat(style.borderBottomWidth)) / 2, items, scrollbar:rect.height - node.clientHeight - parseFloat(style.borderBottomWidth) };
  });
  expect(measured.scrollbar).toBeGreaterThan(0);
  for (const center of measured.items) expect(Math.abs(center - measured.center)).toBeLessThanOrEqual(1);
  await capture(page, "revision-scrollbar-360");
});

test("Tab 초점은 막대 가장자리에서 테두리 여백을 지킨다", async ({ page }) => {
  const app = await showToolbarScenario(page, 360, "jizura");
  const bar = app.locator(".ks-data-toolbar");
  const last = bar.getByRole("button", { name:"사용법 안내" });
  await bar.locator("input").first().focus();
  for (let i = 0; i < await bar.locator("input, button").count() - 1; i += 1) await page.keyboard.press("Tab");
  await expect(last).toBeFocused();
  const gap = await last.evaluate((node) => {
    const track = node.closest(".ks-data-toolbar")!.getBoundingClientRect();
    return track.right - node.getBoundingClientRect().right;
  });
  expect(gap).toBeGreaterThanOrEqual(4);
  await capture(page, "revision-focus-360");
});

test("가로 넘침이 있는 막대만 세로 휠을 가로 스크롤로 바꾸고 끝에서는 전달한다", async ({ page }) => {
  const app = await showToolbarScenario(page, 360, "jizura");
  const bar = app.locator(".ks-data-toolbar");
  await bar.hover();
  await page.mouse.wheel(0, 160);
  await expect.poll(() => bar.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  const edgeBubbles = await bar.evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
    return node.dispatchEvent(new WheelEvent("wheel", { deltaY:120, bubbles:true, cancelable:true }));
  });
  expect(edgeBubbles).toBe(true);
  await capture(page, "revision-wheel-360");
  const wide = await showToolbarScenario(page, 1000, "label");
  const wideBar = wide.locator(".ks-data-toolbar");
  expect(await wideBar.evaluate((node) => node.dispatchEvent(new WheelEvent("wheel", { deltaY:120, bubbles:true, cancelable:true })))).toBe(true);
});

for (const [scenario, width, label] of [["ktx", 360, "저장"], ["jizura", 360, "사용법 안내"], ["ktx", 1000, "저장"]] as const) {
  test(`${scenario} ${width} 막대는 초점 테두리 아래 여백을 보존한다`, async ({ page }) => {
    const app = await showToolbarScenario(page, width, scenario);
    const bar = app.locator(".ks-data-toolbar");
    const control = bar.getByRole("button", { name:label, exact:true });
    await page.keyboard.press("Tab");
    await control.focus();
    const geometry = await control.evaluate((node) => {
      const track = node.closest<HTMLElement>(".ks-data-toolbar")!;
      const r = track.getBoundingClientRect(), c = node.getBoundingClientRect();
      const style = getComputedStyle(node), trackStyle = getComputedStyle(track);
      return { top:c.top-r.top, bottom:c.bottom-r.top,
        outlineBottom:c.bottom-r.top+parseFloat(style.outlineOffset)+parseFloat(style.outlineWidth),
        clipBottom:track.clientTop+track.clientHeight,
        scrollbar:r.height-track.clientHeight-parseFloat(trackStyle.borderBottomWidth) };
    });
    await capture(page, `focus-${scenario}-${width}-full`);
    if (output) await bar.screenshot({ path:join(output, `focus-${scenario}-${width}-detail.png`) });
    expect(geometry.top).toBe(8);
    expect(geometry.bottom).toBe(40);
    expect(geometry.clipBottom).toBeGreaterThanOrEqual(geometry.outlineBottom);
    expect(geometry.scrollbar).toBe(width === 360 ? 4 : 0);
  });
}

test("빈 묶음은 간격을 차지하지 않고 끝 묶음만 있어도 오른쪽을 지킨다", async ({ page }) => {
  await page.setViewportSize({ width:400, height:800 });
  await page.goto("/?preview=market");
  await page.addStyleTag({ content:".ks-harness-apps.is-preview .ks-harness-window { width:360px; height:600px; }" });
  const app = page.getByTestId("app-window-market");
  const bars = app.locator(".ks-data-toolbar");
  await expect(bars).toHaveCount(4);
  await bars.nth(2).scrollIntoViewIfNeeded();
  const rightInset = (bar: import("@playwright/test").Locator) => bar.evaluate((node) => {
    const items = [...node.querySelectorAll(".ks-data-toolbar-item")];
    return node.getBoundingClientRect().right-items.at(-1)!.getBoundingClientRect().right;
  });
  await capture(page, "market-converter-insets-360");
  expect(await rightInset(bars.nth(2))).toBe(12);
  expect(await rightInset(bars.nth(3))).toBe(12);
  const endOnly = await showToolbarScenario(page, 360, "label");
  expect(await rightInset(endOnly.locator(".ks-data-toolbar"))).toBe(12);
});

for (const id of ["reader", "market", "earth", "profiler"]) {
  for (const width of [360, 1000]) {
    test(`기본 앱은 최소 창에서는 두 줄이고 넓은 창에서는 기존 한 줄이다: ${id} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width:width + 40, height:400 });
      await page.goto(`/?preview=${id}`);
      await page.addStyleTag({ content:`.ks-harness-apps.is-preview .ks-harness-window { width:${width}px; height:240px; }` });
      const app = page.getByTestId(`app-window-${id}`);
      const bars = app.locator(".ks-data-toolbar");
      await expect(bars).toHaveCount((id === "market" ? 2 : 1) * (width === 360 ? 2 : 1));
      if (id === "market" && width === 360) await expect(app.getByText("KRW", { exact:true })).toBeVisible();
      const measurements = await bars.evaluateAll((nodes) => nodes.map((node) => ({
        height:node.getBoundingClientRect().height, client:node.clientWidth, scroll:node.scrollWidth,
        clippedTexts:[...node.querySelectorAll<HTMLElement>(".ks-data-text")].filter((text) => text.scrollWidth > text.clientWidth + 1).map((text) => text.textContent),
        items:[...node.querySelectorAll<HTMLElement>(".ks-data-toolbar-item")].map((item) => { const r = item.getBoundingClientRect(), b = node.getBoundingClientRect(); return {left:r.left - b.left, right:b.right - r.right, width:r.width}; }),
      })));
      for (const bar of measurements) {
        expect(bar.height).toBe(49);
        if (width === 360) {
          expect(bar.scroll).toBeLessThanOrEqual(bar.client + 1);
          expect(bar.clippedTexts).toEqual([]);
          for (const item of bar.items) {
            expect(item.left).toBeGreaterThanOrEqual(-1);
            expect(item.right).toBeGreaterThanOrEqual(-1);
          }
        }
      }
      if (output) await app.screenshot({ path:join(output, `revision-${id}-${width}.png`) });
      if (id === "market" && width === 360) {
        await bars.nth(2).scrollIntoViewIfNeeded();
        if (output) await app.screenshot({ path:join(output, "revision-market-converter-360.png") });
      }
    });
  }
}

test("기본 앱은 폭 전환 뒤에도 고른 상태와 입력을 유지한다", async ({ page }) => {
  await page.setViewportSize({ width:400, height:400 });
  await page.goto("/?preview=reader");
  const style = await page.addStyleTag({ content:".ks-harness-apps.is-preview .ks-harness-window { width:360px; height:240px; }" });
  const app = page.getByTestId("app-window-reader");
  const bars = app.locator(".ks-data-toolbar");
  await expect(bars).toHaveCount(2);
  const search = app.getByPlaceholder("검색");
  await search.fill("kaleidoscope");
  await search.blur();
  await expect.poll(async () => page.evaluate(async () => {
    const { snapshot } = await (window as any).__ksHarness.call({ op:"state.get" });
    return snapshot.shared.windows.find((item: any) => item.app_id === "reader").state.search_input;
  })).toBe("kaleidoscope");
  await style.evaluate((node) => { node.textContent = ".ks-harness-apps.is-preview .ks-harness-window { width:1000px; height:240px; }"; });
  await expect(bars).toHaveCount(1);
  await expect(app.getByPlaceholder("검색")).toHaveValue("kaleidoscope");
});

for (const { id, boundary, narrow, wide } of [
  { id:"reader", boundary:558, narrow:2, wide:1 },
  { id:"market", boundary:614, narrow:4, wide:3 },
  { id:"market", boundary:715, narrow:3, wide:2 },
  { id:"earth", boundary:612, narrow:2, wide:1 },
  { id:"profiler", boundary:442, narrow:2, wide:1 },
]) {
  test(`기본 앱의 두 줄 전환은 글꼴 폭 여유를 더한 막대 경계에서 일어난다: ${id} ${boundary}`, async ({ page }) => {
    await page.setViewportSize({ width:1040, height:400 });
    await page.goto(`/?preview=${id}`);
    const style = await page.addStyleTag({ content:`.ks-harness-apps.is-preview .ks-harness-window { width:${boundary + 2}px; height:240px; }` });
    const app = page.getByTestId(`app-window-${id}`);
    await expect(app.locator(".ks-data-window")).toHaveJSProperty("clientWidth", boundary);
    await expect(app.locator(".ks-data-toolbar")).toHaveCount(narrow);
    await style.evaluate((node, width) => { node.textContent = `.ks-harness-apps.is-preview .ks-harness-window { width:${width + 3}px; height:240px; }`; }, boundary);
    await expect(app.locator(".ks-data-window")).toHaveJSProperty("clientWidth", boundary + 1);
    await expect(app.locator(".ks-data-toolbar")).toHaveCount(wide);
  });
}

test("탭 안 분할의 도구 막대는 쌓인 칸과 나란한 칸에서 높이를 유지한다", async ({ page }) => {
  for (const width of [360, 1000]) {
    const app = await showToolbarScenario(page, width, "tabsplit");
    const split = app.locator(".ks-split");
    if (width === 360) await expect(split).toHaveClass(/is-stacked/);
    else await expect(split).not.toHaveClass(/is-stacked/);
    await checkToolbarGeometry(app);
    await capture(page, `revision-tabsplit-${width}`);
  }
});
