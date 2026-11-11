import { chromium, expect, test, type Page } from "@playwright/test";

function capturePath() { return process.env.KS_CONVERSATION_CAPTURES ?? test.info().outputPath("captures"); }
async function open(page: Page, mode: string) {
  await page.goto(`/?preview=workspace-pas&conversation=${mode}`);
  await page.addStyleTag({ content: ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }" });
  return page.getByTestId("app-window-workspace-pas");
}
async function capture(page: Page, name: string) {
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.screenshot({ path: `${capturePath()}/${name}-wide.png` });
  await page.setViewportSize({ width: 400, height: 600 });
  await page.screenshot({ path: `${capturePath()}/${name}-narrow.png` });
}

test("기록, 이전 페이지, 지연 발송과 진행문", async ({ page }) => {
  const chat = await open(page, "ready");
  await expect(chat.getByText("기존 기록")).toBeVisible();
  await capture(page, "history");
  await page.evaluate(() => (window as any).conversationHarness.emit({ event: "conversation.update", thread_id: "fake-thread", update: { kind: "text", stream_id: "preview", text: "답변 작성 중" } }));
  await expect(chat.getByText("답변 작성 중")).toBeVisible();
  await capture(page, "stream");
  await page.evaluate(() => (window as any).conversationHarness.emit({ event: "conversation.update", thread_id: "fake-thread", update: { kind: "activity", busy: false, tool: null } }));
  await expect(chat.getByText("이전 기록", { exact: true })).toBeVisible();
  await expect(chat.getByText("더 이전 기록")).toBeVisible();
  const input = chat.getByRole("textbox", { name: "메시지" });
  await input.fill("새 요청");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(chat.locator(".is-pending")).toHaveText("새 요청");
  await expect(chat.getByText("답변을 준비했습니다.")).toBeVisible();
  await expect(chat.getByText("답변답변을 준비했습니다.")).toHaveCount(0);
});

test("모델을 골라 시작", async ({ page }) => {
  const chat = await open(page, "start");
  await capture(page, "start");
  await chat.getByRole("button", { name: "모델" }).click();
  const menu = page.getByRole("menu");
  await expect(chat.getByRole("button", { name: "실행 위치" })).toContainText("eiaserinnys");
  const blockedModel = menu.getByRole("menuitem", { name: /한도 거부 중/ });
  await expect(blockedModel).toBeDisabled();
  await expect(blockedModel).toContainText("풀림");
  await capture(page, "start-menu");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await chat.getByRole("button", { name: "시작" }).click();
  await expect(chat.getByText("시작하는 중")).toBeVisible();
  await expect(chat.getByRole("textbox", { name: "메시지" })).toBeVisible();
});

test("기존 대화 연결 — 시작 판과 대화 머리 네 상태", async ({ page }) => {
  let chat = await open(page, "attach-start");
  await expect(chat.getByRole("button", { name: "시작" })).toBeVisible();
  await expect(chat.getByRole("button", { name: "기존 대화" })).toContainText("선택");
  await capture(page, "attach-start");
  chat = await open(page, "start");
  await expect(chat.getByRole("button", { name: "시작" })).toBeVisible();
  await expect(chat.getByRole("button", { name: "기존 대화" })).toHaveCount(0);
  chat = await open(page, "attach-own");
  await expect(chat.getByRole("button", { name: "기존 대화" })).toContainText("서소영 PAS — 카드 운영 기록 (이 작업)");
  await expect(chat.getByRole("button", { name: "시작" })).toHaveCount(0);
  await expect(chat.getByRole("button", { name: "프로필" })).toHaveCount(0);
  await capture(page, "attach-own");
  chat = await open(page, "ready");
  await expect(chat.getByRole("button", { name: "프로필" })).toBeVisible();
  await expect(chat.getByRole("button", { name: "대화 바꾸기" })).toBeVisible();
  await capture(page, "attach-owned-header");
  chat = await open(page, "attach-attached");
  await expect(chat.getByText("서소영 PAS — 카드 운영 기록 2026년 11월 · Sol")).toBeVisible();
  await expect(chat.getByRole("button", { name: "대화 바꾸기" })).toBeVisible();
  await expect(chat.getByRole("button", { name: "프로필" })).toHaveCount(0);
  await capture(page, "attach-attached-header");
});

test("시작 판은 새 대화와 기존 대화를 제목과 경계로 나누고 단추를 고른 줄 끝에 둔다", async ({ page }) => {
  const chat = await open(page, "attach-start");
  await chat.getByRole("button", { name: "기존 대화" }).click();
  await page.getByRole("menuitem", { name: /서소영 PAS — 카드 운영과 배포 기록/ }).click();
  const sections = chat.locator(".ks-agent-chat-start-section");
  await expect(sections).toHaveCount(2);
  await expect(sections.nth(0).getByRole("heading", { name: "새 대화" })).toBeVisible();
  await expect(sections.nth(1).getByRole("heading", { name: "기존 대화" })).toBeVisible();
  for (const label of ["프로필", "실행 위치", "모델"]) await expect(sections.nth(0).locator(".ks-field-label", { hasText: label })).toBeVisible();
  for (const [width, height] of [[1100, 700], [668, 360], [400, 600], [360, 600]] as const) {
    await page.setViewportSize({ width, height });
    const [panel, first, second, model, start, picker, link] = await Promise.all([
      chat.locator(".ks-agent-chat-start").boundingBox(),
      sections.nth(0).boundingBox(),
      sections.nth(1).boundingBox(),
      chat.getByRole("button", { name: "모델" }).boundingBox(),
      chat.getByRole("button", { name: "시작" }).boundingBox(),
      chat.getByRole("button", { name: "기존 대화" }).boundingBox(),
      chat.getByRole("button", { name: "연결", exact: true }).boundingBox(),
    ]);
    // 시작과 연결은 각 구역 안에서 끝선에 맞춰 선다.
    expect(Math.abs((start!.x + start!.width) - (first!.x + first!.width))).toBeLessThanOrEqual(1);
    expect(Math.abs((link!.x + link!.width) - (second!.x + second!.width))).toBeLessThanOrEqual(1);
    // 시작은 고른 줄의 마지막 줄에 붙거나 바로 아래 줄 끝으로 간다. 홀로 떨어지지 않는다.
    expect(start!.y).toBeGreaterThanOrEqual(model!.y - 1);
    expect(start!.y - (model!.y + model!.height)).toBeLessThanOrEqual(8);
    if (width >= 668) expect(Math.abs((start!.y + start!.height) - (model!.y + model!.height))).toBeLessThanOrEqual(1);
    // 기존 대화 고르기와 연결은 한 줄이다.
    expect(Math.abs(picker!.y - link!.y)).toBeLessThanOrEqual(1);
    expect(picker!.x + picker!.width).toBeLessThanOrEqual(link!.x + 1);
    // 두 구역은 경계선으로 나뉘고 가로로 넘치지 않는다.
    expect(second!.y).toBeGreaterThan(start!.y + start!.height);
    expect(first!.x + first!.width).toBeLessThanOrEqual(panel!.x + panel!.width);
    await page.screenshot({ path: `${capturePath()}/attach-start-sections-${width}.png` });
  }
  expect(await sections.nth(1).evaluate((element) => getComputedStyle(element).borderTopWidth)).not.toBe("0px");
});

test("시작과 연결의 오류는 그 구역 안 단추 줄 아래에 뜬다", async ({ page }) => {
  for (const [width, height] of [[1100, 700], [668, 420], [360, 640]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/?preview=workspace-pas&conversation=attach-start&start-error=1");
    await page.addStyleTag({ content: ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }" });
    const chat = page.getByTestId("app-window-workspace-pas");
    const sections = chat.locator(".ks-agent-chat-start-section");
    await chat.getByRole("button", { name: "기존 대화" }).click();
    await page.getByRole("menuitem", { name: /서소영 PAS — 카드 운영과 배포 기록/ }).click();
    await chat.getByRole("button", { name: "연결", exact: true }).click();
    const attachError = sections.nth(1).getByRole("alert");
    await expect(attachError).toContainText("이미 다른 곳에 연결되어 있습니다");
    const [link, notice] = await Promise.all([chat.getByRole("button", { name: "연결", exact: true }).boundingBox(), attachError.boundingBox()]);
    expect(notice!.y).toBeGreaterThan(link!.y + link!.height);
    await page.screenshot({ path: `${capturePath()}/start-error-attach-${width}.png` });
    await chat.getByRole("button", { name: "시작" }).click();
    const createError = sections.nth(0).getByRole("alert");
    await expect(createError).toContainText("이미 다른 곳에 연결되어 있습니다");
    const [start, createNotice, second] = await Promise.all([chat.getByRole("button", { name: "시작" }).boundingBox(), createError.boundingBox(), sections.nth(1).boundingBox()]);
    expect(createNotice!.y).toBeGreaterThan(start!.y + start!.height);
    expect(second!.y).toBeGreaterThan(createNotice!.y + createNotice!.height);
    await page.screenshot({ path: `${capturePath()}/start-error-both-${width}.png` });
  }
});

test("좁은 창에서도 고른 대화와 연결 단추는 한 줄이다", async ({ page }) => {
  const chat = await open(page, "attach-start");
  await page.setViewportSize({ width: 400, height: 600 });
  await chat.getByRole("button", { name: "기존 대화" }).click();
  await page.getByRole("menuitem", { name: /kaleidoscope · 작업 PAS 연결 설계/ }).click();
  const picker = chat.getByRole("button", { name: "기존 대화" });
  const link = chat.getByRole("button", { name: "연결", exact: true });
  await page.setViewportSize({ width: 1100, height: 700 });
  const wideArrow = (await picker.locator("svg").boundingBox())!.width;
  await page.screenshot({ path: `${capturePath()}/attach-long-wide.png` });
  for (const width of [360, 400]) {
    await page.setViewportSize({ width, height: 600 });
    const [chatBox, pickerBox, linkBox] = await Promise.all([chat.boundingBox(), picker.boundingBox(), link.boundingBox()]);
    expect(Math.abs(pickerBox!.y - linkBox!.y)).toBeLessThanOrEqual(1);
    expect(pickerBox!.x + pickerBox!.width).toBeLessThanOrEqual(linkBox!.x + 1);
    expect(linkBox!.x + linkBox!.width).toBeLessThanOrEqual(chatBox!.x + chatBox!.width);
    expect(await picker.locator(".ks-select-choice-label").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect((await picker.locator("svg").boundingBox())!.width).toBeCloseTo(wideArrow, 1);
    await page.screenshot({ path: `${capturePath()}/attach-long-narrow-${width}.png` });
  }
});

test("연결한 대화 머리는 49px 한 줄과 끝 단추를 지킨다", async ({ page }) => {
  const chat = await open(page, "attach-attached");
  for (const width of [360, 400, 1100]) {
    await page.setViewportSize({ width, height: 600 });
    const [toolbarBox, buttonBox] = await Promise.all([
      chat.locator(".ks-agent-chat-toolbar").boundingBox(),
      chat.getByRole("button", { name: "대화 바꾸기" }).boundingBox(),
    ]);
    expect(Math.abs(toolbarBox!.height - 49)).toBeLessThanOrEqual(1);
    expect(Math.abs(buttonBox!.x + buttonBox!.width - (toolbarBox!.x + toolbarBox!.width - 12))).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${capturePath()}/attach-attached-header-${width}.png` });
  }
});

test("자기 대화는 두 막대에서 제목과 자연 폭 선택기를 지킨다", async ({ page }) => {
  const attached = await open(page, "attach-attached");
  const attachedRight = new Map<number, number>();
  for (const width of [1100, 360, 400]) {
    await page.setViewportSize({ width, height: width === 1100 ? 700 : 600 });
    const button = await attached.getByRole("button", { name: "대화 바꾸기" }).boundingBox();
    attachedRight.set(width, button!.x + button!.width);
  }
  const chat = await open(page, "ready");
  await expect(chat.getByText("기존 기록")).toBeVisible();
  const names = ["프로필", "실행 위치", "모델"];
  const toolbars = chat.locator(".ks-agent-chat-toolbar");
  await expect(toolbars).toHaveCount(2);
  const conversation = toolbars.nth(0);
  const settings = toolbars.nth(1);
  const change = chat.getByRole("button", { name: "대화 바꾸기" });
  await expect(conversation.locator(".ks-agent-chat-change-hint")).toHaveText("작업");
  for (const state of ["normal", "busy", "long"]) {
    await page.setViewportSize({ width: 1100, height: 700 });
    if (state === "busy") {
      await page.evaluate(() => (window as any).conversationHarness.emit({ event: "conversation.update", thread_id: "fake-thread", update: { kind: "activity", busy: true, tool: null } }));
      await expect(change).toBeDisabled();
      await expect(chat.getByText("답변이 끝난 뒤 바꿀 수 있습니다")).toBeVisible();
    }
    if (state === "long") {
      await page.evaluate(() => (window as any).conversationHarness.emit({ event: "conversation.update", thread_id: "fake-thread", update: { kind: "activity", busy: false, tool: null } }));
      await expect(change).toBeEnabled();
      await chat.getByRole("button", { name: "프로필" }).click();
      await page.getByRole("menuitem", { name: "키키" }).click();
      await chat.getByRole("button", { name: "바꾸기", exact: true }).click();
      await expect(chat.getByRole("button", { name: "프로필" })).toContainText("키키");
      await chat.getByRole("button", { name: "실행 위치" }).click();
      await page.getByRole("menuitem", { name: "eias-linegames" }).click();
      await chat.getByRole("button", { name: "바꾸기", exact: true }).click();
      await expect(chat.getByRole("button", { name: "모델" })).toContainText("Argon");
      await page.evaluate(() => (window as any).conversationHarness.emit({ event: "conversation.update", thread_id: "fake-thread", update: { kind: "activity", busy: true, tool: null } }));
      await expect(change).toBeDisabled();
      await expect(chat.getByText("답변이 끝난 뒤 바꿀 수 있습니다")).toBeVisible();
    }
    const arrows = await Promise.all(names.map(async (name) => (await chat.getByRole("button", { name }).locator("svg").boundingBox())!.width));
    for (const width of [1100, 360, 400]) {
      await page.setViewportSize({ width, height: width === 1100 ? 700 : 600 });
      const metrics = await settings.evaluate((element) => {
        const style = getComputedStyle(element);
        const buttons = [...element.querySelectorAll<HTMLButtonElement>(".ks-select-button")];
        const controls = buttons.map((button) => ({ name: button.getAttribute("aria-label"), text: button.textContent, width: button.getBoundingClientRect().width }));
        const hint = element.querySelector<HTMLElement>(".ks-agent-chat-change-hint");
        const group = element.querySelector<HTMLElement>(".ks-data-toolbar-group")!;
        const gaps = parseFloat(getComputedStyle(group).columnGap) * (buttons.length - 1);
        const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        return { innerWidth: element.clientWidth - padding, controls, hintWidth: hint?.getBoundingClientRect().width ?? 0, gaps, scroll: element.scrollWidth - element.clientWidth, height: element.getBoundingClientRect().height };
      });
      const [conversationBox, settingsBox, buttonBox] = await Promise.all([conversation.boundingBox(), settings.boundingBox(), change.boundingBox()]);
      const conversationMetrics = await conversation.evaluate((element) => {
        const style = getComputedStyle(element);
        return { innerWidth: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), scroll: element.scrollWidth - element.clientWidth, height: element.getBoundingClientRect().height };
      });
      console.log(`대화 머리 실측 ${state} ${width}: ${JSON.stringify({ conversation: conversationMetrics, settings: metrics, buttonX: buttonBox!.x, buttonRight: buttonBox!.x + buttonBox!.width, attachedRight: attachedRight.get(width) })}`);
      await page.screenshot({ path: `${capturePath()}/attach-owned-${state}-${width}.png` });
      expect(Math.abs(metrics.height - 49)).toBeLessThanOrEqual(1);
      expect(Math.abs(conversationBox!.height - 49)).toBeLessThanOrEqual(1);
      expect(Math.abs(settingsBox!.y - (conversationBox!.y + conversationBox!.height))).toBeLessThanOrEqual(1);
      expect(buttonBox!.x).toBeGreaterThanOrEqual(conversationBox!.x);
      expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(conversationBox!.x + conversationBox!.width);
      expect(Math.abs(buttonBox!.x + buttonBox!.width - attachedRight.get(width)!)).toBeLessThanOrEqual(1);
      if (state === "long" && width === 400) expect(metrics.scroll).toBe(0);
      if (state === "long" && width === 360) expect(metrics.scroll).toBeGreaterThan(0);
      for (const [index, name] of names.entries()) {
        const picker = chat.getByRole("button", { name });
        expect(await picker.locator(".ks-select-choice-label").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect((await picker.locator("svg").boundingBox())!.width).toBeCloseTo(arrows[index], 1);
      }
      expect(await change.evaluate((element) => element.classList.contains("ks-icon-button"))).toBe(true);
    }
  }
});

test.describe("디렉터 창 크기의 시작 판", () => {
  // 작업 PAS 창 몸통에는 대화 블록만 있고, 디렉터 창 몸통은 636×226이다. 실제 스크롤바와 실제 길이 값으로 본다.
  async function openBody(width: number, height: number, extra = "", pick = true) {
    const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
    const page = await browser.newPage({ baseURL: `http://127.0.0.1:${process.env.KS_E2E_PORT ?? 5173}`, viewport: { width: 900, height: 700 } });
    await page.goto(`/?preview=workspace-pas&conversation=attach-start&names=real&conversation-delay=1500${extra}`);
    await page.addStyleTag({ content: `.ks-harness-dev-panel { display: none; } .ks-harness { height: auto !important; } [data-testid=app-window-workspace-pas] .ks-data-stack-item:not(.is-fill) { display: none; } [data-testid=app-window-workspace-pas] { width: ${width + 2}px !important; height: ${height + 42}px !important; flex: none !important; }` });
    const chat = page.getByTestId("app-window-workspace-pas");
    const panel = chat.locator(".ks-agent-chat-start");
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(Math.abs(box.width - width)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - height)).toBeLessThanOrEqual(1);
    if (pick) {
      await chat.getByRole("button", { name: "기존 대화" }).click();
      await page.getByRole("menuitem", { name: /서소영 영구 세션/ }).click();
    }
    return { browser, page, chat, panel };
  }
  const geometry = (panel: import("@playwright/test").Locator) => panel.evaluate((element) => ({ scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, clientWidth: element.clientWidth }));
  // toBeVisible은 판의 스크롤에 잘린 것을 못 잡는다. 판 상자 안에 있는지 직접 본다.
  async function insidePanel(panel: import("@playwright/test").Locator, target: import("@playwright/test").Locator) {
    const [outer, inner] = await Promise.all([panel.boundingBox(), target.boundingBox()]);
    return Boolean(outer && inner && inner.y >= outer.y - 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5);
  }

  test("시작하는 중과 연결하는 중은 구역 제목 줄에 뜨고 단추와 판을 움직이지 않는다", async () => {
    for (const [width, height] of [[636, 226], [360, 226]] as const) {
      const { browser, page, chat, panel } = await openBody(width, height);
      try {
        const sections = chat.locator(".ks-agent-chat-start-section");
        const start = chat.getByRole("button", { name: "시작" });
        const link = chat.getByRole("button", { name: "연결", exact: true });
        const picker = chat.getByRole("button", { name: "기존 대화" });
        const before = { start: await start.boundingBox(), link: await link.boundingBox(), picker: await picker.boundingBox(), panel: await geometry(panel) };
        if (width === 636) expect(before.panel.scrollHeight).toBeLessThanOrEqual(before.panel.clientHeight);
        await page.screenshot({ path: `${capturePath()}/director-start-${width}.png` });
        await link.click();
        const progress = sections.nth(1).locator(".ks-agent-chat-start-head").getByText("연결하는 중");
        await expect(progress).toBeVisible();
        expect(await insidePanel(panel, progress)).toBe(true);
        expect(await link.boundingBox()).toEqual(before.link);
        expect(await picker.boundingBox()).toEqual(before.picker);
        expect(await start.boundingBox()).toEqual(before.start);
        expect(await geometry(panel)).toEqual(before.panel);
        await page.screenshot({ path: `${capturePath()}/director-attaching-${width}.png` });
      } finally {
        await browser.close();
      }
      const second = await openBody(width, height, "", false);
      try {
        const sections = second.chat.locator(".ks-agent-chat-start-section");
        const start = second.chat.getByRole("button", { name: "시작" });
        const link = second.chat.getByRole("button", { name: "연결", exact: true });
        const before = { start: await start.boundingBox(), link: await link.boundingBox(), panel: await geometry(second.panel) };
        await start.click();
        const progress = sections.nth(0).locator(".ks-agent-chat-start-head").getByText("시작하는 중");
        await expect(progress).toBeVisible();
        expect(await insidePanel(second.panel, progress)).toBe(true);
        await expect(second.chat.getByRole("button", { name: "프로필" })).toBeDisabled();
        await expect(second.chat.getByRole("button", { name: "모델" })).toBeDisabled();
        expect(await start.boundingBox()).toEqual(before.start);
        expect(await link.boundingBox()).toEqual(before.link);
        expect(await geometry(second.panel)).toEqual(before.panel);
        await second.page.screenshot({ path: `${capturePath()}/director-starting-${width}.png` });
      } finally {
        await second.browser.close();
      }
    }
  });

  test("오류 뒤 다시 누르면 진행 글은 판 안에 보이고 옛 알림은 결과가 올 때 바뀐다", async () => {
    for (const [width, height] of [[636, 226], [360, 226], [360, 200]] as const) {
      // 연결이 실패한 뒤 새 대화로 바꿔 시작한다. 알림을 보이려고 판이 내려가 새 대화 제목 줄이 판 위로 빠진 상태다.
      const first = await openBody(width, height, "&start-error=1");
      try {
        const sections = first.chat.locator(".ks-agent-chat-start-section");
        await first.chat.getByRole("button", { name: "연결", exact: true }).click();
        await expect(sections.nth(1).getByRole("alert")).toContainText("CONV_ATTACH_CONFLICT");
        await expect.poll(() => insidePanel(first.panel, sections.nth(1).getByRole("alert"))).toBe(true);
        await first.chat.getByRole("button", { name: "시작" }).click();
        const progress = sections.nth(0).locator(".ks-agent-chat-start-head").getByText("시작하는 중");
        await expect(progress).toBeVisible();
        expect(await insidePanel(first.panel, progress)).toBe(true);
        expect(await insidePanel(first.panel, first.chat.getByRole("button", { name: "시작" }))).toBe(true);
        await first.page.screenshot({ path: `${capturePath()}/director-starting-after-attach-error-${width}x${height}.png` });
        // 시작도 실패하면 연결 알림은 걷히고 시작 알림이 그 구역에 뜬다.
        await expect(sections.nth(0).getByRole("alert")).toContainText("CONV_ATTACH_CONFLICT");
        await expect(sections.nth(1).getByRole("alert")).toHaveCount(0);
      } finally {
        await first.browser.close();
      }
      // 시작이 실패한 뒤 다시 누른다. 옛 알림이 누르는 순간 걷히지 않으니 판의 크기는 그대로다.
      const second = await openBody(width, height, "&start-error=1", false);
      try {
        const sections = second.chat.locator(".ks-agent-chat-start-section");
        const start = second.chat.getByRole("button", { name: "시작" });
        await start.click();
        const alert = sections.nth(0).getByRole("alert");
        await expect(alert).toContainText("CONV_ATTACH_CONFLICT");
        await expect.poll(() => insidePanel(second.panel, alert)).toBe(true);
        await expect(start).toBeEnabled();
        const before = { start: await start.boundingBox(), panel: await geometry(second.panel) };
        await second.page.screenshot({ path: `${capturePath()}/director-start-error-${width}x${height}.png` });
        await start.click();
        const progress = sections.nth(0).locator(".ks-agent-chat-start-head").getByText("시작하는 중");
        await expect(progress).toBeVisible();
        expect(await insidePanel(second.panel, progress)).toBe(true);
        expect(await insidePanel(second.panel, start)).toBe(true);
        await expect(alert).toHaveCount(1);
        const after = await geometry(second.panel);
        expect({ scrollHeight: after.scrollHeight, clientHeight: after.clientHeight, clientWidth: after.clientWidth }).toEqual({ scrollHeight: before.panel.scrollHeight, clientHeight: before.panel.clientHeight, clientWidth: before.panel.clientWidth });
        // 636에서는 제목 줄이 판 안에 있어 판도 단추도 움직이지 않는다. 360에서는 알림을 보이려고 내려간 판이 제목 줄까지만 올라간다.
        if (width === 636) {
          expect(after.scrollTop).toBe(before.panel.scrollTop);
          expect(await start.boundingBox()).toEqual(before.start);
        } else {
          expect(after.scrollTop).toBeLessThan(before.panel.scrollTop);
        }
        await second.page.screenshot({ path: `${capturePath()}/director-start-retry-${width}x${height}.png` });
      } finally {
        await second.browser.close();
      }
    }
  });

  test("시작과 연결의 오류 알림은 판 안에 다 보인다", async () => {
    for (const [width, height] of [[636, 226], [360, 226]] as const) {
      const { browser, page, chat, panel } = await openBody(width, height, "&start-error=1");
      try {
        const sections = chat.locator(".ks-agent-chat-start-section");
        for (const [button, section, name] of [[chat.getByRole("button", { name: "연결", exact: true }), sections.nth(1), "attach"], [chat.getByRole("button", { name: "시작" }), sections.nth(0), "start"]] as const) {
          await button.click();
          const alert = section.getByRole("alert");
          await expect(alert).toContainText("CONV_ATTACH_CONFLICT");
          await expect.poll(async () => {
            const [outer, notice] = await Promise.all([panel.boundingBox(), alert.boundingBox()]);
            return notice!.y >= outer!.y - 0.5 && notice!.y + notice!.height <= outer!.y + outer!.height + 0.5;
          }).toBe(true);
          await page.screenshot({ path: `${capturePath()}/director-error-${name}-${width}.png` });
        }
      } finally {
        await browser.close();
      }
    }
  });
});

test.describe("실제 스크롤바가 있는 대화 머리", () => {
  test("막대 높이와 안내 글은 공간에 맞게 유지된다", async () => {
    const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
    const page = await browser.newPage({ baseURL: `http://127.0.0.1:${process.env.KS_E2E_PORT ?? 5173}` });
    try {
    const chat = await open(page, "ready");
    await expect(chat.getByText("기존 기록")).toBeVisible();
    const settings = chat.locator(".ks-agent-chat-toolbar").nth(1);
    const profile = chat.getByRole("button", { name: "프로필" });
    const place = chat.getByRole("button", { name: "실행 위치" });
    const model = chat.getByRole("button", { name: "모델" });
    await profile.click();
    await page.getByRole("menuitem", { name: "키키" }).click();
    await chat.getByRole("button", { name: "바꾸기", exact: true }).click();
    await expect(profile).toContainText("키키");
    await place.click();
    await page.getByRole("menuitem", { name: "eias-linegames" }).click();
    await chat.getByRole("button", { name: "바꾸기", exact: true }).click();
    await expect(model).toContainText("Argon");
    await page.setViewportSize({ width: 360, height: 600 });
    const dimensions = await settings.evaluate((element) => {
      const toolbar = element as HTMLElement;
      const bounds = toolbar.getBoundingClientRect();
      const button = toolbar.querySelector<HTMLButtonElement>('[aria-label="프로필"]')!.getBoundingClientRect();
      const reference = document.createElement("div");
      reference.className = "ks-data-toolbar";
      reference.style.width = `${bounds.width}px`;
      const group = document.createElement("div");
      group.className = "ks-data-toolbar-group is-start";
      for (const control of toolbar.querySelectorAll(".ks-select-button")) group.appendChild(control.cloneNode(true));
      reference.appendChild(group);
      document.body.appendChild(reference);
      const refBounds = reference.getBoundingClientRect();
      const refButton = reference.querySelector("button")!.getBoundingClientRect();
      const result = {
        height: toolbar.offsetHeight, scrollbar: toolbar.offsetHeight - toolbar.clientHeight - parseFloat(getComputedStyle(toolbar).borderBottomWidth),
        top: button.top - bounds.top, bottom: bounds.bottom - button.bottom,
        reference: { height: reference.offsetHeight, top: refButton.top - refBounds.top, bottom: refBounds.bottom - refButton.bottom },
      };
      reference.remove();
      return result;
    });
    console.log(`실제 스크롤바 막대: ${JSON.stringify(dimensions)}`);
    await page.screenshot({ path: `${capturePath()}/real-scrollbar-long-360.png` });
    expect(dimensions.scrollbar).toBeGreaterThan(0);
    expect(dimensions.height).toBe(49);
    expect(dimensions.top).toBeCloseTo(dimensions.reference.top, 1);
    expect(dimensions.bottom).toBeCloseTo(dimensions.reference.bottom, 1);
    await place.focus();
    await page.keyboard.press("Tab");
    await expect(model).toBeFocused();
    const focus = await settings.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const button = element.querySelector('[aria-label="모델"]')!.getBoundingClientRect();
      return { right: bounds.right - button.right, scrollLeft: element.scrollLeft };
    });
    console.log(`모델 초점: ${JSON.stringify(focus)}`);
    await page.screenshot({ path: `${capturePath()}/real-scrollbar-focus-360.png` });
    expect(focus.right).toBeGreaterThanOrEqual(2);

    await page.evaluate(() => (window as any).conversationHarness.setBusy(true));
    await expect(profile).toBeDisabled();
    for (const width of [360, 370, 400, 510, 1100]) {
      await page.setViewportSize({ width, height: 600 });
      const hint = await settings.locator(".ks-agent-chat-change-hint").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const parent = element.parentElement!.getBoundingClientRect();
        return { width: rect.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, visible: rect.width > 0 && rect.height > 0 && rect.top < parent.bottom && rect.bottom > parent.top, fits: rect.left >= parent.left && rect.right <= parent.right };
      });
      console.log(`안내 글 busy ${width}: ${JSON.stringify(hint)}`);
      expect(!hint.visible || (hint.fits && hint.scrollWidth <= hint.clientWidth && hint.width >= hint.scrollWidth)).toBe(true);
      await page.screenshot({ path: `${capturePath()}/hint-busy-${width}.png` });
    }
    await page.evaluate(() => (window as any).conversationHarness.setBusy(false));
    await expect(profile).toBeEnabled();
    for (const [index, width] of [360, 370, 400, 510, 1100].entries()) {
      await page.setViewportSize({ width, height: 600 });
      await profile.click();
      await page.getByRole("menuitem", { name: index % 2 === 0 ? "서소영" : "키키" }).click();
      await chat.getByRole("button", { name: "바꾸기", exact: true }).click();
      const hint = await settings.locator(".ks-agent-chat-change-hint").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const parent = element.parentElement!.getBoundingClientRect();
        return { width: rect.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, visible: rect.width > 0 && rect.height > 0 && rect.top < parent.bottom && rect.bottom > parent.top, fits: rect.left >= parent.left && rect.right <= parent.right };
      });
      console.log(`안내 글 switching ${width}: ${JSON.stringify(hint)}`);
      expect(!hint.visible || (hint.fits && hint.scrollWidth <= hint.clientWidth && hint.width >= hint.scrollWidth)).toBe(true);
      await page.screenshot({ path: `${capturePath()}/hint-switching-${width}.png` });
      await expect(profile).toBeEnabled();
    }
    } finally {
      await browser.close();
    }
  });
});

test("연결하는 중에는 시작과 고른 줄을 잠근다", async ({ page }) => {
  for (const [width, height, name] of [[1100, 700, "attach-loading-wide"], [400, 600, "attach-loading-narrow"]] as const) {
    const chat = await open(page, "attach-start");
    await page.setViewportSize({ width, height });
    await chat.getByRole("button", { name: "기존 대화" }).click();
    await page.getByRole("menuitem", { name: /서소영 PAS — 카드 운영과 배포 기록/ }).click();
    await chat.getByRole("button", { name: "연결", exact: true }).click();
    await expect(chat.getByText("연결하는 중")).toBeVisible();
    await expect(chat.getByRole("button", { name: "시작" })).toBeDisabled();
    await expect(chat.getByRole("button", { name: "프로필" })).toBeDisabled();
    await expect(chat.getByRole("button", { name: "모델" })).toBeDisabled();
    await page.screenshot({ path: `${capturePath()}/${name}.png` });
  }
});

test("답변 중에는 두 머리 모두 대화 바꾸기를 잠근다", async ({ page }) => {
  let chat = await open(page, "ready");
  await expect(chat.getByText("기존 기록")).toBeVisible();
  await page.evaluate(() => (window as any).conversationHarness.emit({ event: "conversation.update", thread_id: "fake-thread", update: { kind: "activity", busy: true, tool: null } }));
  await expect(chat.getByRole("button", { name: "대화 바꾸기" })).toBeDisabled();
  await capture(page, "attach-owned-busy");
  chat = await open(page, "attach-attached");
  await expect(chat.getByText("서소영 PAS — 카드 운영 기록 2026년 11월 · Sol")).toBeVisible();
  await page.evaluate(() => (window as any).conversationHarness.emit({ event: "conversation.update", thread_id: "fake-thread", update: { kind: "activity", busy: true, tool: null } }));
  await expect(chat.getByRole("button", { name: "대화 바꾸기" })).toBeDisabled();
  await capture(page, "attach-attached-busy");
});

test("이 작업의 대화를 다시 연결하면 소유한 대화 머리로 돌아온다", async ({ page }) => {
  const chat = await open(page, "attach-own");
  await expect(chat.getByRole("button", { name: "기존 대화" })).toContainText("서소영 PAS — 카드 운영 기록 (이 작업)");
  await chat.getByRole("button", { name: "연결", exact: true }).click();
  await expect(chat.getByRole("button", { name: "프로필" })).toBeVisible();
  await expect(chat.getByRole("button", { name: "대화 바꾸기" })).toBeVisible();
  await expect(chat.locator(".ks-agent-chat-toolbar").first().locator(".ks-agent-chat-change-hint")).toHaveText("서소영 PAS — 카드 운영 기록");
  await capture(page, "attach-own-header");
});

test("프로필과 다른 노드 모델 변경은 확인하고 답변 중에는 잠근다", async ({ page }) => {
  const chat = await open(page, "ready");
  await expect(chat.getByText("기존 기록")).toBeVisible();
  await chat.getByRole("button", { name: "프로필" }).click();
  await page.getByRole("menuitem", { name: "키키" }).click();
  await expect(chat.getByRole("dialog")).toContainText("키키(으)로 바꾸면 새 세션으로 이어집니다. 지난 대화는 요약으로 넘어갑니다.");
  await capture(page, "profile-switch-confirm");
  await chat.getByRole("button", { name: "바꾸기", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).conversationHarness.calls().some((c: any) => c.op === "conversation.switch" && c.profile === "profile-b"))).toBe(true);
  await expect(chat.getByRole("button", { name: "실행 위치" })).toBeEnabled();
  await chat.getByRole("button", { name: "실행 위치" }).click();
  await page.getByRole("menuitem", { name: "eias-linegames" }).click();
  await expect(chat.getByRole("dialog")).toContainText("eias-linegames의 Argon(으)로 바꾸면 새 세션으로 이어집니다. 지난 대화는 요약으로 넘어갑니다.");
  await chat.getByRole("button", { name: "바꾸기", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).conversationHarness.calls().some((c: any) => c.op === "conversation.switch" && c.model === "n1:eias-linegames:argon"))).toBe(true);
  await page.evaluate(() => (window as any).conversationHarness.emit({ event: "conversation.update", thread_id: "fake-thread", update: { kind: "activity", busy: true, tool: null } }));
  await expect(chat.getByRole("button", { name: "프로필" })).toBeDisabled();
  await expect(chat.getByRole("button", { name: "모델" })).toBeDisabled();
  await page.setViewportSize({ width: 1100, height: 700 });
  await expect(chat.getByText("답변이 끝난 뒤 바꿀 수 있습니다")).toBeVisible();
  await capture(page, "selectors-busy");
});

test("짧은 기록은 스크롤 없이 이전 페이지를 모두 읽는다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const chat = await open(page, "ready");
  await expect(chat.getByText("더 이전 기록")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).conversationHarness.calls().filter((c: any) => c.op === "conversation.history").length)).toBe(2);
  const history = chat.getByRole("log");
  expect(await history.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
  await page.screenshot({ path: `${capturePath()}/short-history-1440.png` });
});

test("로그인 뒤 기록으로 복귀", async ({ page }) => {
  const chat = await open(page, "login");
  await expect(chat.getByText("로그인이 필요합니다")).toBeVisible();
  await capture(page, "login");
  await chat.getByRole("button", { name: "로그인" }).click();
  await expect(chat.getByText("기존 기록")).toBeVisible();
  await expect(chat.getByRole("textbox", { name: "메시지" })).toBeFocused();
});

test("로그인 뒤 시작 판의 첫 조작에 포커스를 둔다", async ({ page }) => {
  const chat = await open(page, "login-start");
  await chat.getByRole("button", { name: "로그인" }).click();
  await expect(chat.getByRole("button", { name: "프로필" })).toBeFocused();
});

test("묶음 충돌은 시작이나 입력을 보이지 않는다", async ({ page }) => {
  const chat = await open(page, "conflict");
  await expect(chat.getByRole("alert")).toContainText("대화 연결이 충돌합니다");
  await capture(page, "conflict");
  await expect(chat.getByRole("button", { name: "시작" })).toHaveCount(0);
  await expect(chat.getByRole("textbox", { name: "메시지" })).toHaveCount(0);
});

test("미접수 초안과 첨부를 같은 ID로 보낸다", async ({ page }) => {
  const chat = await open(page, "draft");
  const input = chat.getByRole("textbox", { name: "메시지" });
  await expect(input).toHaveValue("복원된 초안");
  await expect(chat.getByText("메모.txt")).toBeVisible();
  await capture(page, "draft");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as any).conversationHarness.calls().find((c: any) => c.op === "conversation.send")?.request_id)).toBe("draft-id");
});

test("스트림 인증 오류 뒤 로그인하여 복귀", async ({ page }) => {
  const chat = await open(page, "ready");
  await expect(chat.getByText("기존 기록")).toBeVisible();
  await page.evaluate(() => (window as any).conversationHarness.emit({ event: "conversation.error", thread_id: "fake-thread", error: { id: "CONV_STREAM_LOGIN_REQUIRED", code: "login_required", message: "대화 제공자에 다시 로그인해야 합니다.", details: [] } }));
  await expect(chat.getByText("로그인이 필요합니다")).toBeVisible();
  await capture(page, "stream-error");
  await chat.getByRole("button", { name: "로그인" }).click();
  await expect(chat.getByText("기존 기록")).toBeVisible();
});

test("첨부를 보내고 제공자 경로로 파일을 연다", async ({ page }) => {
  const chat = await open(page, "ready");
  await expect(chat.getByText("기존 기록")).toBeVisible();
  await chat.locator('input[type="file"]').setInputFiles({ name: "메모.txt", mimeType: "text/plain", buffer: Buffer.from("내용") });
  await chat.getByRole("button", { name: "보내기" }).click();
  await expect(chat.locator(".ks-agent-chat-user:not(.is-pending)").getByRole("button", { name: "메모.txt" })).toBeVisible();
  await chat.locator(".ks-agent-chat-user:not(.is-pending)").getByRole("button", { name: "메모.txt" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).conversationHarness.calls().some((c: any) => c.op === "conversation.attachment_open" && c.attachment_id === "0"))).toBe(true);
});
