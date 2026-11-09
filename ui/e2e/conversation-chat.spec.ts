import { expect, test, type Page } from "@playwright/test";

const path = process.env.KS_CONVERSATION_CAPTURES ?? "/tmp/ks-conversation-captures";
async function open(page: Page, mode: string) {
  await page.goto(`/?preview=workspace-pas&conversation=${mode}`);
  await page.addStyleTag({ content: ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }" });
  return page.getByTestId("app-window-workspace-pas");
}
async function capture(page: Page, name: string) {
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.screenshot({ path: `${path}/${name}-wide.png` });
  await page.setViewportSize({ width: 400, height: 600 });
  await page.screenshot({ path: `${path}/${name}-narrow.png` });
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
  await chat.getByRole("button", { name: "모델" }).click();
  await chat.getByRole("button", { name: "시작" }).click();
  await expect(chat.getByText("시작하는 중")).toBeVisible();
  await expect(chat.getByRole("textbox", { name: "메시지" })).toBeVisible();
});

test("기존 대화 연결 — 시작 판과 대화 머리 네 상태", async ({ page }) => {
  let chat = await open(page, "attach-start");
  await expect(chat.getByRole("button", { name: "시작" })).toBeVisible();
  await expect(chat.getByRole("button", { name: "기존 대화" })).toContainText("기존 대화 선택");
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

test("시작 판은 고른 줄과 시작 줄을 묶고 연결 줄을 띄운다", async ({ page }) => {
  const chat = await open(page, "attach-start");
  const row = chat.locator(".ks-agent-chat-toolbar-start");
  await expect(row).toBeVisible();
  expect(await row.evaluate((element) => getComputedStyle(element).borderBottomWidth)).toBe("0px");
  const [pickerBox, startBox, attachBox] = await Promise.all([
    chat.getByRole("button", { name: "프로필" }).boundingBox(),
    chat.getByRole("button", { name: "시작" }).boundingBox(),
    chat.getByRole("button", { name: "기존 대화" }).boundingBox(),
  ]);
  const pickerToStart = startBox!.y - (pickerBox!.y + pickerBox!.height);
  const startToAttach = attachBox!.y - (startBox!.y + startBox!.height);
  expect(pickerToStart).toBeLessThan(startToAttach);
  expect(startToAttach).toBeGreaterThanOrEqual(24);
  await page.screenshot({ path: `${path}/attach-start-gaps.png` });
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
  await page.screenshot({ path: `${path}/attach-long-wide.png` });
  for (const width of [360, 400]) {
    await page.setViewportSize({ width, height: 600 });
    const [chatBox, pickerBox, linkBox] = await Promise.all([chat.boundingBox(), picker.boundingBox(), link.boundingBox()]);
    expect(Math.abs(pickerBox!.y - linkBox!.y)).toBeLessThanOrEqual(1);
    expect(pickerBox!.x + pickerBox!.width).toBeLessThanOrEqual(linkBox!.x + 1);
    expect(linkBox!.x + linkBox!.width).toBeLessThanOrEqual(chatBox!.x + chatBox!.width);
    expect(await picker.locator(".ks-select-choice-label").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect((await picker.locator("svg").boundingBox())!.width).toBeCloseTo(wideArrow, 1);
    await page.screenshot({ path: `${path}/attach-long-narrow-${width}.png` });
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
    await page.screenshot({ path: `${path}/attach-attached-header-${width}.png` });
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
        const buttons = [...element.querySelectorAll<HTMLButtonElement>(":scope > button")];
        const controls = buttons.map((button) => ({ name: button.getAttribute("aria-label"), text: button.textContent, width: button.getBoundingClientRect().width }));
        const hint = element.querySelector<HTMLElement>(".ks-agent-chat-change-hint");
        const gaps = parseFloat(style.columnGap) * (element.children.length - 1);
        const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        return { innerWidth: element.clientWidth - padding, controls, hintWidth: hint?.getBoundingClientRect().width ?? 0, gaps, scroll: element.scrollWidth - element.clientWidth, height: element.getBoundingClientRect().height };
      });
      const [conversationBox, settingsBox, buttonBox] = await Promise.all([conversation.boundingBox(), settings.boundingBox(), change.boundingBox()]);
      const conversationMetrics = await conversation.evaluate((element) => {
        const style = getComputedStyle(element);
        return { innerWidth: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), scroll: element.scrollWidth - element.clientWidth, height: element.getBoundingClientRect().height };
      });
      console.log(`대화 머리 실측 ${state} ${width}: ${JSON.stringify({ conversation: conversationMetrics, settings: metrics, buttonX: buttonBox!.x, buttonRight: buttonBox!.x + buttonBox!.width, attachedRight: attachedRight.get(width) })}`);
      await page.screenshot({ path: `${path}/attach-owned-${state}-${width}.png` });
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
    await page.screenshot({ path: `${path}/${name}.png` });
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
  await page.screenshot({ path: `${path}/short-history-1440.png` });
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
