import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
import jsonata from "jsonata";

async function setApp(page: Page, ui: unknown, state: Record<string, unknown> = {}) {
  await page.goto("/?preview=data-controls");
  await page.evaluate(async ({ ui, state }) => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const app = snapshot.shared.app_versions.find((v: any) => v.app_id === "data-controls");
    app.definition.ui = ui; app.definition.state = state; app.version += 1;
    const win = snapshot.shared.windows.find((w: any) => w.app_id === "data-controls");
    win.app_version = app.version; win.state = state;
    harness.emit({ event: "state.changed", snapshot });
  }, { ui, state });
}

const button = (label: string, variant?: string) => ({ type: "button", label, variant, on_click: [] });
const input = (name: string, extra: Record<string, unknown> = {}) => ({ type: "input", placeholder: name, value: { state: name }, on_change: { set_state: name }, ...extra });
const pair = (name: string) => ({ type: "stack", direction: "column", children: [input(`${name}-plain`), input(`${name}-hidden`, { label: `${name}-label`, label_position: "hidden" })] });

test("단추 올림과 누름은 밝고 어두운 화면에서 구분된다", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await setApp(page, { type: "stack", direction: "column", children: [button("기본"), button("고스트", "ghost"), button("위험", "danger"), { ...button("줄", "row"), on_click: { copy_text: "복사할 글" } }, { ...button("아이콘"), icon: "copy", icon_only: true }] });
    const app = page.getByTestId("app-window-data-controls");
    for (const name of ["기본", "고스트", "위험", "줄", "아이콘", "복사 완료"] as const) {
      const el = app.getByRole("button", { name: name === "복사 완료" ? "줄" : name, exact: true });
      if (name === "복사 완료") { await el.click(); await expect(el.locator("..")).toHaveClass(/is-copied/); }
      await page.mouse.move(0, 0);
      const style = () => el.evaluate(node => { const s = getComputedStyle(node); return `${s.backgroundColor}|${s.backgroundImage}`; });
      const idle = await style();
      await el.hover();
      const hover = await style();
      await page.mouse.down();
      const active = await style();
      await page.mouse.up();
      if (name !== "복사 완료") expect.soft(hover, `${theme}/${name}: 올림`).not.toBe(idle);
      expect.soft(active, `${theme}/${name}: 누름`).not.toBe(hover);
    }
  }
});

test("숨긴 이름표 입력은 다섯 배치에서 이름 없는 입력과 폭과 시작선이 같다", async ({ page }) => {
  const contexts = [
    { name: "stack", ui: pair("stack") },
    { name: "section", ui: { type: "section", child: pair("section") } },
    { name: "titled", ui: { type: "section", title: "구역", child: pair("titled") } },
    ...["direct", "direct-titled"].map(name => ({ name, ui: { type: "stack", direction: "column", children: [
      { type: "section", ...(name === "direct-titled" ? { title: "구역" } : {}), child: input(`${name}-plain`) },
      { type: "section", ...(name === "direct-titled" ? { title: "구역" } : {}), child: input(`${name}-hidden`, { label: `${name}-label`, label_position: "hidden" }) },
    ] } })),
    { name: "tab", ui: { type: "tabs", tabs: [{ label: "탭", child: pair("tab") }] } },
    { name: "fill", ui: { type: "stack", direction: "column", fill: [0, 1], children: [input("fill-plain", { multiline: true }), input("fill-hidden", { label: "fill-label", label_position: "hidden", multiline: true })] } },
  ];
  for (const width of [1100, 360]) for (const { name, ui } of contexts) {
    await page.setViewportSize({ width, height: 900 });
    await setApp(page, ui, { [`${name}-plain`]: "", [`${name}-hidden`]: "" });
    const app = page.getByTestId("app-window-data-controls");
    const a = await app.getByPlaceholder(`${name}-plain`).boundingBox();
    const b = await app.getByPlaceholder(`${name}-hidden`).boundingBox();
    expect.soft(Math.abs(a!.x - b!.x), `${width}/${name} 왼쪽`).toBeLessThanOrEqual(1);
    expect.soft(Math.abs(a!.x + a!.width - b!.x - b!.width), `${width}/${name} 오른쪽`).toBeLessThanOrEqual(1);
  }
});

test("자동 입력은 지정한 네 줄과 기본 여덟 줄에서 스크롤한다", async ({ page }) => {
  await setApp(page, { type: "stack", direction: "column", children: [input("four", { multiline: true, max_rows: 4 }), input("default", { multiline: true }), input("fixed", { multiline: true, rows: 3, max_rows: 4 })] }, { four: "", default: "", fixed: "" });
  const app = page.getByTestId("app-window-data-controls");
  for (const [name, limit] of [["four", 4], ["default", 8]] as const) {
    const field = app.getByPlaceholder(name);
    await field.click();
    for (let i = 0; i < limit; i++) { if (i) await page.keyboard.press("Enter"); await page.keyboard.type("line"); }
    const height = (await field.boundingBox())!.height;
    expect.soft(await field.evaluate(el => el.scrollHeight - el.clientHeight), `${name} 한도 안`).toBeLessThanOrEqual(1);
    await page.keyboard.press("Enter"); await page.keyboard.type("overflow");
    await expect.poll(() => field.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
    expect.soft(Math.abs((await field.boundingBox())!.height - height), `${name} 높이`).toBeLessThanOrEqual(1);
  }
  const fixed = app.getByPlaceholder("fixed");
  const height = (await fixed.boundingBox())!.height;
  await fixed.click(); await page.keyboard.type("one"); await page.keyboard.press("Enter"); await page.keyboard.type("two");
  expect((await fixed.boundingBox())!.height).toBe(height);
});

test("검수용 전후 화면을 기록한다", async ({ page }) => {
  test.skip(!process.env.KS_1051_CAPTURE_DIR);
  const directory = process.env.KS_1051_CAPTURE_DIR!;
  const phase = process.env.KS_1051_CAPTURE_PHASE!;
  mkdirSync(directory, { recursive: true });
  const sample = JSON.parse(readFileSync(process.env.KS_1051_SAMPLE!, "utf8"));
  // 가짜 코어는 button.label의 식을 계산하지 않으므로 실제 정의의 식을 같은 상태로 계산해 넣는다.
  for (const row of sample.ui.child.children[1].children) {
    row.label = await jsonata(row.label.expr).evaluate({}, { state: { text: "Kaleidoscope 2026" } });
  }
  for (const [name, width] of [["wide", 1100], ["narrow", 360]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await setApp(page, sample.ui, { text: "Kaleidoscope 2026" });
    const app = page.getByTestId("app-window-data-controls");
    await expect(app.getByPlaceholder("영문 입력")).toBeVisible();
    await page.waitForTimeout(1000);
    await app.screenshot({ path: join(directory, `${phase}-deco-${name}.png`) });
    await page.goto("/?preview=html-report");
    const other = page.getByTestId("app-window-html-report");
    await expect(other.getByRole("button", { name: "고르기" })).toBeVisible();
    await other.screenshot({ path: join(directory, `${phase}-other-${name}.png`) });
  }
});

// 단추 상태 색은 그라디언트와 바탕색이 겹친 결과라 계산값 대신 실제 그려진 화면의 픽셀로 잰다.
async function pixel(page: Page, el: ReturnType<Page["locator"]>) {
  const png = await el.screenshot();
  return page.evaluate(async (b64: string) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const canvas = document.createElement("canvas"); canvas.width = img.width; canvas.height = img.height;
    const g = canvas.getContext("2d")!; g.drawImage(img, 0, 0);
    const d = g.getImageData(Math.max(3, Math.round(img.width * 0.06)), Math.round(img.height / 2), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, png.toString("base64"));
}
const gap = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
async function states(page: Page, el: ReturnType<Page["locator"]>) {
  await page.mouse.move(0, 0);
  const idle = await pixel(page, el);
  await el.hover();
  const hover = await pixel(page, el);
  await page.mouse.down();
  const active = await pixel(page, el);
  await page.mouse.up();
  await page.mouse.move(0, 0);
  return { idle, hover, active, up: gap(idle, hover), press: gap(hover, active) };
}
const STEP = 8; // 다른 단추의 올림과 누름 보폭은 11~16이다

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: 함께 놓인 위험 단추와 강조, 확정 단추는 올림과 누름이 보인다`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    const app = page.getByTestId("app-window-data-controls");
    const check = async (name: string, el: ReturnType<Page["locator"]>, needUp = true) => {
      const r = await states(page, el);
      console.log(`${theme}/${name}: 올림 ${r.up} 누름 ${r.press}`);
      if (needUp) expect.soft(r.up, `${theme}/${name}: 올림 ${JSON.stringify(r)}`).toBeGreaterThanOrEqual(3);
      expect.soft(r.press, `${theme}/${name}: 누름 ${JSON.stringify(r)}`).toBeGreaterThanOrEqual(STEP);
    };
    await setApp(page, { type: "stack", direction: "row", children: [button("기본"), button("위험", "danger")] });
    await check("가로 쌓기 위험", app.getByRole("button", { name: "위험", exact: true }));
    await setApp(page, { type: "toolbar", start: [button("기본"), button("위험", "danger")] });
    await check("도구 막대 위험", app.getByRole("button", { name: "위험", exact: true }));
    await setApp(page, { type: "stack", direction: "column", children: [button("강조", "primary")] });
    await check("강조", app.getByRole("button", { name: "강조", exact: true }), false);
    await setApp(page, { type: "button_grid", columns: 2, buttons: [{ key: "a", label: "기본" }, { key: "d", label: "위험", variant: "danger" }, { key: "g", label: "고스트", variant: "ghost" }, { key: "p", label: "강조", variant: "primary" }], on_press: [] });
    for (const name of ["기본", "위험", "고스트", "강조"]) await check(`키패드 ${name}`, app.getByRole("button", { name, exact: true }), name !== "강조");
    await setApp(page, { type: "dialog", title: "확인", open: true, on_close: [], on_confirm: [], danger: true, child: { type: "text", value: "지울까요?" } });
    await check("위험 확정", page.locator(".ks-dialog-confirm .ks-button"), false);
    await setApp(page, { type: "dialog", title: "확인", open: true, on_close: [], on_confirm: [], child: { type: "text", value: "저장할까요?" } });
    await check("확정", page.locator(".ks-dialog-confirm .ks-button"), false);
  });
}

test("가로 쌓기의 채우는 숨긴 이름표 입력은 어느 배치에서도 이름 없는 입력과 같고 가로 스크롤이 없다", async ({ page }) => {
  const row = (n: string, extra: Record<string, unknown> = {}) => ({ type: "stack", direction: "row", fill: 0, children: [input(`${n}-field`, extra), button("보내기")] });
  const pairOf = () => ({ type: "stack", direction: "column", children: [row("plain"), row("hid", { label: "hid-label", label_position: "hidden" })] });
  const layouts: Array<[string, unknown]> = [
    ["구역 없음", pairOf()],
    ["제목 없는 구역", { type: "section", child: pairOf() }],
    ["제목 있는 구역", { type: "section", title: "구역", child: pairOf() }],
    ["대화상자", { type: "dialog", title: "대화", open: true, on_close: [], child: pairOf() }],
  ];
  for (const width of [1100, 360]) for (const [name, ui] of layouts) {
    await page.setViewportSize({ width, height: 900 });
    await setApp(page, ui, { "plain-field": "", "hid-field": "" });
    const root = name === "대화상자" ? page.locator(".ks-dialog") : page.getByTestId("app-window-data-controls");
    const a = await root.getByPlaceholder("plain-field").boundingBox();
    const b = await root.getByPlaceholder("hid-field").boundingBox();
    expect.soft(Math.abs(a!.x - b!.x), `${width}/${name} 왼쪽`).toBeLessThanOrEqual(1);
    expect.soft(Math.abs(a!.x + a!.width - b!.x - b!.width), `${width}/${name} 오른쪽`).toBeLessThanOrEqual(1);
    const body = page.getByTestId("app-window-data-controls").locator(".ks-data-window-body");
    expect.soft(await body.evaluate(el => el.scrollWidth - el.clientWidth), `${width}/${name} 가로 스크롤`).toBeLessThanOrEqual(0);
  }
});

test("max_rows는 채우는 칸과 대화상자에서도 지켜진다", async ({ page }) => {
  const long = Array.from({ length: 30 }, (_, i) => `line${i}`).join("\n");
  const cases: Array<[string, unknown]> = [
    ["fillAutoInner", { type: "section", title: "구역", child: { type: "stack", direction: "column", children: [{ type: "stack", direction: "column", fill: 0, children: [input("t", { multiline: true, max_rows: 4 })] }, button("아래")] } }],
    ["fillDialog", { type: "dialog", title: "대화", open: true, on_close: [], child: { type: "stack", direction: "column", fill: 0, children: [input("t", { multiline: true, max_rows: 4 })] } }],
    ["fillDefault", { type: "dialog", title: "대화", open: true, on_close: [], child: { type: "stack", direction: "column", fill: 0, children: [input("t", { multiline: true })] } }],
  ];
  for (const [name, ui] of cases) {
    await setApp(page, ui, { t: "" });
    const field = page.getByPlaceholder("t");
    await field.fill(long);
    await expect.poll(() => field.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
    const lines = await field.evaluate(el => { const s = getComputedStyle(el); return (el.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom)) / parseFloat(s.lineHeight); });
    const limit = name === "fillDefault" ? 8 : 4;
    expect.soft(lines, `${name}: 보이는 줄 수`).toBeLessThanOrEqual(limit + 0.5);
    expect.soft(lines, `${name}: 보이는 줄 수 하한`).toBeGreaterThan(limit - 1);
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: 쉘 작업표시줄과 창 닫기 단추의 누름은 올림과 구분된다`, async ({ page }) => {
    // 시험 틀에는 쉘 창틀이 없어 app/src/shell.css와 같은 마크업을 주입해 같은 규칙으로 잰다.
    await page.emulateMedia({ colorScheme: theme });
    await setApp(page, { type: "text", value: "본문" });
    await page.addStyleTag({ content: readFileSync(join(__dirname, "../../app/src/shell.css"), "utf8") });
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "ks-1051-shell";
      host.style.cssText = "position:fixed;left:20px;top:20px;display:flex;gap:20px;padding:12px;background:var(--ks-color-surface-solid)";
      host.innerHTML = `<div class="ks-window-title-actions"><button class="ks-icon-button" aria-label="최소화">–</button><button class="ks-icon-button" aria-label="창 닫기" style="width:64px">×</button></div><button class="ks-icon-button is-taskbar" aria-label="작업표시줄 단추" style="width:64px"></button>`;
      document.body.appendChild(host);
    });
    for (const name of ["창 닫기", "작업표시줄 단추"]) {
      const r = await states(page, page.locator("#ks-1051-shell").getByRole("button", { name }));
      console.log(`${theme}/${name}: 올림 ${r.up} 누름 ${r.press}`);
      expect.soft(r.up, `${name} 올림 ${JSON.stringify(r)}`).toBeGreaterThanOrEqual(3);
      expect.soft(r.press, `${name} 누름 ${JSON.stringify(r)}`).toBeGreaterThanOrEqual(STEP);
    }
  });
}

test("검수용 보완 화면을 기록한다", async ({ page }) => {
  test.skip(!process.env.KS_1051_STATES_DIR);
  const dir = process.env.KS_1051_STATES_DIR!;
  mkdirSync(dir, { recursive: true });
  const app = page.getByTestId("app-window-data-controls");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    const targets: Array<[string, unknown, string]> = [
      ["row-danger", { type: "stack", direction: "row", children: [button("기본"), button("위험", "danger")] }, "위험"],
      ["emphasis", { type: "stack", direction: "row", children: [button("강조", "primary")] }, "강조"],
      ["keypad-danger", { type: "button_grid", columns: 2, buttons: [{ key: "a", label: "기본" }, { key: "d", label: "위험", variant: "danger" }], on_press: [] }, "위험"],
      ["confirm-danger", { type: "dialog", title: "확인", open: true, on_close: [], on_confirm: [], danger: true, child: { type: "text", value: "지울까요?" } }, ""],
    ];
    for (const [name, ui, label] of targets) {
      await setApp(page, ui);
      const el = name === "confirm-danger" ? page.locator(".ks-dialog-confirm .ks-button") : app.getByRole("button", { name: label, exact: true });
      const box = async (state: string) => { await el.screenshot({ path: join(dir, `${theme}-${name}-${state}.png`) }); };
      await page.mouse.move(0, 0); await box("idle");
      await el.hover(); await box("hover");
      await page.mouse.down(); await box("active"); await page.mouse.up();
    }
    for (const width of [1100, 360]) {
      await page.setViewportSize({ width, height: 700 });
      const row = (n: string, extra: Record<string, unknown> = {}) => ({ type: "stack", direction: "row", fill: 0, children: [input(`${n}-field`, extra), button("보내기")] });
      await setApp(page, { type: "stack", direction: "column", children: [row("plain"), row("hid", { label: "hid-label", label_position: "hidden" })] }, { "plain-field": "", "hid-field": "" });
      await page.screenshot({ path: join(dir, `${theme}-row-hidden-${width}.png`) });
    }
    await page.setViewportSize({ width: 1100, height: 720 });
  }
});
