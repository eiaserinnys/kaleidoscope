import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

test("같은 줄 위험 단추의 기존 상태를 관찰한다", async ({ page }) => {
  test.skip(!process.env.KS_1051_OBSERVE);
  await setApp(page, { type: "stack", direction: "row", children: [button("기본"), button("위험", "danger")] });
  const target = page.getByTestId("app-window-data-controls").getByRole("button", { name: "위험", exact: true });
  const style = () => target.evaluate(node => { const s = getComputedStyle(node); return `${s.backgroundColor}|${s.backgroundImage}`; });
  await page.mouse.move(0, 0);
  const idle = await style();
  await target.hover();
  const hover = await style();
  await page.mouse.down();
  const active = await style();
  await page.mouse.up();
  console.log(JSON.stringify({ idle, hover, active }));
});
