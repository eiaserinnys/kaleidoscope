import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

async function setApp(page: Page, confirm: boolean) {
  const dialog = {
    type: "dialog", title: "오래된 항목을 살펴보고 고르는 긴 대화상자 제목", open: { state: "open" },
    on_close: [{ set_state: "open", value: false }],
    ...(confirm ? { close_label: "추가", on_confirm: [{ set_state: "open", value: false }] } : {}),
    child: { type: "input", placeholder: "내용 입력", value: { state: "text" }, on_change: { set_state: "text" } },
  };
  await page.evaluate(async ({ dialog }) => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const app = snapshot.shared.app_versions.find((v: any) => v.app_id === "data-controls");
    const state = { open: false, text: "" };
    app.definition.ui = { type: "stack", direction: "column", children: [
      { type: "button", label: "대화상자 열기", on_click: [{ set_state: "open", value: true }] }, dialog,
    ] };
    app.definition.state = state;
    app.version += 1;
    const win = snapshot.shared.windows.find((w: any) => w.app_id === "data-controls");
    win.app_version = app.version;
    win.state = state;
    harness.emit({ event: "state.changed", snapshot });
  }, { dialog });
}

test("짧은 창은 닫기만 제목에 두고 확인과 취소는 아래에 둔다", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 850 });
  await page.goto("/?preview=data-controls");
  await page.addStyleTag({ content: ".ks-harness-dev-panel { display: none !important; } .ks-harness-apps.is-preview .ks-harness-window { width: 360px; height: 240px; }" });
  const app = page.getByTestId("app-window-data-controls");
  for (const confirm of [false, true]) {
    await setApp(page, confirm);
    for (const [width, height] of [[360, 240], [620, 680]]) {
      await app.evaluate((element, size) => { element.style.width = `${size[0]}px`; element.style.height = `${size[1]}px`; }, [width, height]);
      const opener = app.getByRole("button", { name: "대화상자 열기" });
      await opener.click();
      const dialog = app.getByRole("dialog");
      const input = dialog.getByPlaceholder("내용 입력");
      const action = dialog.getByRole("button", { name: confirm ? "추가" : "닫기" });
      await expect(input).toBeFocused();
      await dialog.screenshot({ path: test.info().outputPath(`${confirm ? "confirm" : "close"}-${width}x${height}.png`) });
      const title = await dialog.locator(".ks-dialog-title").boundingBox();
      const button = await action.boundingBox();
      const actions = dialog.locator(":scope > .ks-dialog-actions");
      if (height === 240 && !confirm) {
        expect.soft(await actions.count(), "짧은 닫기 전용 대화상자의 아래 단추 줄").toBe(0);
        expect.soft(Math.abs(title!.y - button!.y), "닫기와 제목의 세로 위치").toBeLessThan(20);
        expect.soft(title!.x + title!.width, "긴 제목이 닫기와 겹치지 않음").toBeLessThanOrEqual(button!.x + 1);
        expect.soft(await action.evaluate((element) => getComputedStyle(element).whiteSpace), "닫기 글은 한 줄").toBe("nowrap");
      } else {
        await expect(actions).toBeVisible();
        expect.soft(button!.y, "아래 단추의 위치").toBeGreaterThan(title!.y + title!.height);
      }
      await page.keyboard.press("Tab");
      if (confirm) {
        const cancel = dialog.getByRole("button", { name: "취소" });
        await expect(cancel).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(action).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(input).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(cancel).toBeFocused();
      } else {
        await expect(action).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(input).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(action).toBeFocused();
      }
      await page.keyboard.press("Enter");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      await opener.click();
      await expect(input).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
    }
  }
});

test("다른 앱 대화상자 두 꼴의 크기와 초점을 잰다", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 850 });
  await page.goto("/?preview=data-controls");
  await page.addStyleTag({ content: ".ks-harness-dev-panel { display: none !important; }" });
  const samples = [
    { name: "folder", title: "폴더", child: { type: "stack", direction: "column", fill: 1, children: [
      { type: "toolbar", start: [{ type: "text", value: "그림 폴더" }], end: [] },
      { type: "list", layout: "grid", items: [{ key: "1", title: "여행 사진" }, { key: "2", title: "그림 모음" }] },
    ] } },
    { name: "feed", title: "피드 추가", confirm: true, child: { type: "stack", direction: "column", gap: "medium", children: [
      { type: "input", label: "피드나 사이트 주소", label_position: "top", placeholder: "https://example.com", value: { state: "url" }, on_change: { set_state: "url" } },
      { type: "input", label: "이름", label_position: "top", placeholder: "피드 이름", value: { state: "name" }, on_change: { set_state: "name" } },
    ] } },
  ];
  const app = page.getByTestId("app-window-data-controls");
  const measurements = [];
  for (const sample of samples) {
    await page.evaluate(async (sample) => {
      const harness = (window as any).__ksHarness;
      const { snapshot } = await harness.call({ op: "state.get" });
      const app = snapshot.shared.app_versions.find((v: any) => v.app_id === "data-controls");
      const state = { open: false, url: "", name: "" };
      const dialog = { type: "dialog", title: sample.title, open: { state: "open" }, child: sample.child,
        on_close: [{ set_state: "open", value: false }],
        ...(sample.confirm ? { close_label: "추가", on_confirm: [{ set_state: "open", value: false }] } : {}) };
      app.definition.ui = { type: "stack", direction: "column", children: [
        { type: "button", label: `${sample.title} 열기`, on_click: [{ set_state: "open", value: true }] }, dialog,
      ] };
      app.definition.state = state; app.version += 1;
      const win = snapshot.shared.windows.find((w: any) => w.app_id === "data-controls");
      win.app_version = app.version; win.state = state;
      harness.emit({ event: "state.changed", snapshot });
    }, sample);
    for (const [width, height] of [[360, 240], [620, 680]]) {
      await app.evaluate((element, size) => { element.style.width = `${size[0]}px`; element.style.height = `${size[1]}px`; }, [width, height]);
      const opener = app.getByRole("button", { name: `${sample.title} 열기` });
      await opener.click();
      const dialog = app.getByRole("dialog", { name: sample.title });
      await expect(dialog).toBeVisible();
      const details = await dialog.evaluate((element) => {
        const rect = (e: Element | null) => e ? { x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y, width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height } : null;
        const focus = document.activeElement as HTMLElement;
        return { frame: rect(element), content: rect(element.querySelector(".ks-dialog-scroll")), title: rect(element.querySelector(".ks-dialog-title")),
          actions: rect(element.querySelector(".ks-dialog-actions")), buttons: [...element.querySelectorAll("button")].map(b => ({ name: b.getAttribute("aria-label") || b.innerText, rect: rect(b) })),
          firstFocus: focus?.getAttribute("aria-label") || focus?.getAttribute("placeholder") || focus?.innerText };
      });
      await app.screenshot({ path: test.info().outputPath(`${sample.name}-${width}x${height}.png`) });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      measurements.push({ sample: sample.name, width, height, ...details, escapeFocus: `${sample.title} 열기` });
    }
  }
  writeFileSync(test.info().outputPath("sample-measurements.json"), JSON.stringify(measurements, null, 2));
});

test("고르기는 창 높이가 바뀌어도 찾기를 고정하고 목록만 스크롤한다", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 850 });
  await page.goto("/?preview=data-controls");
  await page.addStyleTag({ content: ".ks-harness-dev-panel { display: none !important; }" });
  await page.evaluate(async () => {
    const harness = (window as any).__ksHarness;
    const { snapshot } = await harness.call({ op: "state.get" });
    const app = snapshot.shared.app_versions.find((v: any) => v.app_id === "data-controls");
    const list = { type: "list", items: Array.from({ length: 14 }, (_, i) => ({ key: String(i), title: `세션 ${i + 1}` })) };
    const ui = { type: "dialog", title: "세션 고르기", open: true, on_close: [], child: {
      type: "stack", direction: "column", fill: 1, children: [
        { type: "when", value: false, child: { type: "text", value: "오류" } },
        { type: "when", value: true, child: { type: "stack", direction: "column", gap: "small", fill: [1, 2, 3], children: [
          { type: "input", kind: "search", placeholder: "제목으로 찾기", value: { state: "query" }, on_change: { set_state: "query" } },
          { type: "when", value: false, child: { type: "text", value: "일치 없음" } },
          { type: "when", value: false, child: list },
          { type: "when", value: true, child: list },
        ] } },
      ],
    } };
    app.definition.ui = ui; app.definition.state = { query: "" }; app.version += 1;
    const win = snapshot.shared.windows.find((w: any) => w.app_id === "data-controls");
    win.app_version = app.version; win.state = { query: "" };
    harness.emit({ event: "state.changed", snapshot });
  });
  const app = page.getByTestId("app-window-data-controls");
  const dialog = app.getByRole("dialog", { name: "세션 고르기" });
  const measurements = [];
  for (const [width, height] of [[360, 240], ...[360, 480, 620].flatMap(w => Array.from({ length: 19 }, (_, i) => [w, 300 + i * 10]))]) {
    await app.evaluate((element, size) => { element.style.width = `${size[0]}px`; element.style.height = `${size[1]}px`; }, [width, height]);
    await page.waitForTimeout(80);
    const measurement = await dialog.evaluate((element) => {
      const outer = element.querySelector<HTMLElement>(".ks-dialog-scroll")!;
      const input = element.querySelector<HTMLElement>("input")!;
      const list = element.querySelector<HTMLElement>(".ks-list")!;
      const o = outer.getBoundingClientRect(), s = input.getBoundingClientRect(), l = list.getBoundingClientRect();
      const scrolls = [...element.querySelectorAll<HTMLElement>("*")].filter(e => /^(auto|scroll)$/.test(getComputedStyle(e).overflowY) && e.clientHeight > 0 && e.scrollHeight > e.clientHeight + 1);
      const fullRows = [...list.querySelectorAll<HTMLElement>('[role="option"]')].filter(row => { const r = row.getBoundingClientRect(); return r.top >= l.top - .5 && r.bottom <= l.bottom + .5 && r.bottom <= o.bottom + .5; }).length;
      return { scrollers: scrolls.map(e => e.className), searchVisible: s.top >= o.top - .5 && s.bottom <= o.bottom + .5, listInside: l.top >= o.top - .5 && l.bottom <= o.bottom + .5, fullRows, listHeight: l.height };
    });
    measurements.push({ width, height, ...measurement });
    expect.soft(measurement.scrollers, `${width}×${height} 스크롤 주인`).toEqual([expect.stringContaining("ks-list")]);
    expect.soft(measurement.searchVisible && measurement.listInside, `${width}×${height} 고정과 경계`).toBe(true);
    if (height === 240) {
      expect.soft(measurement.fullRows, "최소 창에 온전히 보이는 행").toBeGreaterThanOrEqual(2);
      await app.screenshot({ path: test.info().outputPath("picker-360x240.png") });
      const last = dialog.getByRole("option", { name: "세션 14", exact: true });
      await dialog.locator(".ks-list").evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await expect(last).toBeVisible();
      const visible = await last.evaluate((element) => { const r = element.getBoundingClientRect(), l = element.closest(".ks-list")!.getBoundingClientRect(); return r.top >= l.top - .5 && r.bottom <= l.bottom + .5; });
      expect.soft(visible, "마지막 행").toBe(true);
    }
    if (width === 620 && height === 400) await app.screenshot({ path: test.info().outputPath("picker-620x400.png") });
  }
  writeFileSync(test.info().outputPath("picker-heights.json"), JSON.stringify(measurements, null, 2));
});
