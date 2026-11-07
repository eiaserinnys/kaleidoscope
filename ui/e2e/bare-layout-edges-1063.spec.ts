import { expect, test, type Page } from "@playwright/test";

// 카드 #1063: 구역 없는 배치에서 창 몸통에 스크롤바가 생겨도 입력·글·단추·구역의
// 오른쪽 끝은 몸통 테두리 상자 기준 12px에 머문다. 보상이 닿으면 안 되는 부모는
// 스크롤 여부와 관계없이 같은 여백을 쓴다.
const APP_ID = "bare-layout-edges-1063";
const STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }";
// 몸통이 스크롤하지 않는 높이와 스크롤하는 높이.
const TALL = 2000;
const SHORT = 480;

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

type Patch = { ui?: unknown; state?: Record<string, unknown> };

async function open(page: Page, width: number, height: number, patch: Patch = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(`/?preview=${APP_ID}`);
  if (patch.ui !== undefined || patch.state !== undefined) {
    await page.evaluate(async ({ ui, state }) => {
      const harness = (window as any).__ksHarness;
      const { snapshot } = await harness.call({ op: "state.get" });
      const app = snapshot.shared.app_versions.find((v: any) => v.app_id === "bare-layout-edges-1063");
      if (ui !== undefined) app.definition.ui = ui;
      app.definition.state = { ...app.definition.state, ...state };
      app.version += 1;
      const win = snapshot.shared.windows.find((w: any) => w.app_id === "bare-layout-edges-1063");
      win.app_version = app.version;
      win.state = app.definition.state;
      harness.emit({ event: "state.changed", snapshot });
    }, { ui: patch.ui, state: patch.state ?? {} });
  }
  await page.addStyleTag({ content: STYLE });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return page.getByTestId(`app-window-${APP_ID}`);
}

type Probe = { gapRight: number; gapLeft: number; itemPad: [string, string] | null; selfPad: [string, string]; width: number };

// 끝선은 몸통 테두리 상자(테두리 없음) 기준으로 잰다. 구역은 내용 상자 끝을 쓴다.
async function read(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="app-window-bare-layout-edges-1063"]') as HTMLElement;
    const body = root.querySelector(".ks-data-window-body") as HTMLElement;
    const br = body.getBoundingClientRect();
    const num = (value: string) => Number.parseFloat(value) || 0;
    const round = (value: number) => Math.round(value * 10) / 10;
    const probe = (element: Element | null, kind: "box" | "section" = "box") => {
      if (!element) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const right = kind === "section" ? rect.right - num(style.paddingRight) : rect.right;
      const left = kind === "section" ? rect.left + num(style.paddingLeft) : rect.left;
      const item = element.closest(".ks-data-stack-item");
      const itemStyle = item ? getComputedStyle(item) : null;
      return {
        gapRight: round(br.right - right),
        gapLeft: round(left - br.left),
        itemPad: itemStyle ? [itemStyle.paddingLeft, itemStyle.paddingRight] as [string, string] : null,
        selfPad: [style.paddingLeft, style.paddingRight] as [string, string],
        width: round(rect.width),
      };
    };
    const placeholder = (value: string) => body.querySelector(`[placeholder="${value}"]`);
    const button = (value: string) => Array.from(body.querySelectorAll("button")).find((element) => element.textContent?.trim() === value) ?? null;
    const text = (value: string) => Array.from(body.querySelectorAll(".ks-data-text")).find((element) => element.textContent?.includes(value)) ?? null;
    const section = (value: string) => Array.from(body.querySelectorAll(".ks-data-section")).find((element) => element.querySelector(".ks-data-section-title")?.textContent?.trim() === value) ?? null;
    return {
      body: {
        overflow: body.scrollHeight > body.clientHeight + 1,
        gutter: body.offsetWidth - body.clientWidth,
        clientWidth: body.clientWidth,
        scrollWidth: body.scrollWidth,
      },
      // 범위 안: 몸통 끝이 곧 이 요소의 오른쪽 끝이다.
      text: probe(text("몸통 글")),
      directInput: probe(placeholder("직접 입력")),
      rowButton: probe(button("굵게")),
      rowInput: probe(placeholder("메시지")),
      rowSend: probe(button("보내기")),
      nestedInput: probe(placeholder("중첩 입력")),
      deepInput: probe(placeholder("깊은 입력")),
      nestedSection: probe(section("중첩 구역"), "section"),
      nestedSectionInput: probe(placeholder("구역 안 중첩 입력")),
      repeatSection: probe(body.querySelector(".ks-repeat.is-column > .ks-repeat-content > .ks-repeat-item > .ks-data-section"), "section"),
      repeatInput: probe(placeholder("반복 구역 입력")),
      // 계약 부모: 보상이 닿으면 안 된다.
      alignStack: probe(body.querySelector(".ks-data-stack.is-column.align-start")),
      alignButton: probe(button("왼쪽 단추")),
      centerStack: probe(body.querySelector(".ks-data-stack.is-center")),
      centerButton: probe(button("가운데 단추")),
      tabPanel: probe(body.querySelector(".ks-data-tab-panel")),
      tabInput: probe(placeholder("탭 입력")),
      splitPane: probe(body.querySelector(".ks-split-pane")),
      splitInput: probe(placeholder("분할 왼쪽 입력")),
      innerSection: probe(section("안쪽 구역"), "section"),
      innerInput: probe(placeholder("구역 안 구역 입력")),
      rowRepeatItem: probe(body.querySelector(".ks-repeat.is-row .ks-repeat-item .ks-data-stack-item")),
      virtualSection: probe(body.querySelector(".ks-repeat.is-virtual .ks-data-section"), "section"),
    };
  });
}

// 가로 줄의 채움 입력은 오른쪽 끝이 줄 폭을 따라가므로 왼쪽 끝만 잰다.
const IN_SCOPE = ["text", "directInput", "rowButton", "rowSend", "nestedInput", "deepInput", "nestedSection", "nestedSectionInput", "repeatSection", "repeatInput"] as const;
const LEFT_ONLY = ["rowInput"] as const;
const CONTRACT = ["alignStack", "alignButton", "centerStack", "centerButton", "tabPanel", "tabInput", "splitPane", "splitInput", "innerSection", "innerInput", "rowRepeatItem", "virtualSection"] as const;

for (const width of [1100, 480]) {
  test(`몸통 스크롤바가 생겨도 끝선이 12로 같다 ${width}px`, async ({ page }) => {
    await open(page, width, TALL);
    const tall = await read(page);
    expect(tall.body.overflow, "높은 창에서는 몸통이 스크롤하지 않는다").toBe(false);

    await open(page, width, SHORT);
    const short = await read(page);
    expect(short.body.overflow, "낮은 창에서는 몸통이 스크롤한다").toBe(true);
    expect(short.body.gutter, "스크롤바 폭").toBe(8);
    expect(short.body.scrollWidth, "가로 스크롤은 없다").toBe(short.body.clientWidth);

    for (const name of LEFT_ONLY) {
      const before = tall[name] as Probe | null;
      const after = short[name] as Probe | null;
      expect.soft(before, `${name}이 렌더되어야 한다`).not.toBeNull();
      expect.soft(after, `${name}이 렌더되어야 한다`).not.toBeNull();
      expect.soft(after!.gapLeft, `${name} 왼쪽 끝(스크롤)`).toBeCloseTo(12, 0);
      expect.soft(Math.abs(after!.gapLeft - before!.gapLeft), `${name} 왼쪽 끝 이동`).toBeLessThanOrEqual(1);
    }
    for (const name of IN_SCOPE) {
      const before = tall[name] as Probe | null;
      const after = short[name] as Probe | null;
      expect.soft(before, `${name}이 렌더되어야 한다`).not.toBeNull();
      expect.soft(after, `${name}이 렌더되어야 한다`).not.toBeNull();
      expect.soft(after!.gapRight, `${name} 오른쪽 끝(스크롤)`).toBeCloseTo(12, 0);
      expect.soft(before!.gapRight, `${name} 오른쪽 끝(스크롤 없음)`).toBeCloseTo(12, 0);
      expect.soft(Math.abs(after!.gapRight - before!.gapRight), `${name} 오른쪽 끝 이동`).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(after!.gapLeft - before!.gapLeft), `${name} 왼쪽 끝 이동`).toBeLessThanOrEqual(1);
    }
  });

  test(`보상이 닿으면 안 되는 부모는 여백이 그대로다 ${width}px`, async ({ page }) => {
    await open(page, width, TALL);
    const tall = await read(page);
    await open(page, width, SHORT);
    const short = await read(page);
    expect(short.body.overflow).toBe(true);

    for (const name of CONTRACT) {
      const before = tall[name] as Probe | null;
      const after = short[name] as Probe | null;
      expect.soft(before, `${name}이 렌더되어야 한다`).not.toBeNull();
      expect.soft(after, `${name}이 렌더되어야 한다`).not.toBeNull();
      expect.soft(after!.itemPad, `${name} 내용 칸 여백`).toEqual(before!.itemPad);
      expect.soft(after!.selfPad, `${name} 자기 여백`).toEqual(before!.selfPad);
      expect.soft(after!.itemPad?.[1] ?? "", `${name}에 스크롤 보상이 닿지 않는다`).not.toBe("4px");
    }
  });
}

test("대화상자 안 입력에는 보상이 닿지 않는다", async ({ page }) => {
  const readDialog = async (height: number) => {
    await open(page, 480, height, { state: { dlg: true } });
    await expect(page.locator(".ks-dialog")).toBeVisible();
    return page.evaluate(() => {
      const root = document.querySelector('[data-testid="app-window-bare-layout-edges-1063"]') as HTMLElement;
      const dialog = root.querySelector(".ks-dialog") as HTMLElement;
      const input = dialog.querySelector('[placeholder="대화상자 입력"]') as HTMLElement;
      const item = input.closest(".ks-data-stack-item") as HTMLElement;
      const dialogStyle = getComputedStyle(dialog);
      const itemStyle = getComputedStyle(item);
      return {
        inBody: Boolean(dialog.closest(".ks-data-window-body")),
        dialogPad: [dialogStyle.paddingLeft, dialogStyle.paddingRight],
        itemPad: [itemStyle.paddingLeft, itemStyle.paddingRight],
        inputGap: Math.round((dialog.getBoundingClientRect().right - input.getBoundingClientRect().right) * 10) / 10,
      };
    });
  };
  const tall = await readDialog(TALL);
  const short = await readDialog(SHORT);
  expect(tall.inBody, "대화상자는 몸통 밖에 그려진다").toBe(false);
  expect(short.dialogPad).toEqual(tall.dialogPad);
  expect(short.itemPad).toEqual(tall.itemPad);
  expect(short.inputGap).toBe(tall.inputGap);
});

const input = (placeholder: string) => ({ type: "input", placeholder, value: { state: placeholder }, on_change: { set_state: placeholder } });
const fillers = (count: number) => Array.from({ length: count }, (_, index) => ({ type: "text", value: `채움 글 ${index + 1}: 창 폭이 좁아지면 이 글은 여러 줄로 접히며 높이가 늘어난다. 몸통이 스크롤하는 상태를 만들기 위한 글이다.` }));

test("몸통 직속 정렬 쌓기와 가운데 쌓기는 보상이 닿지 않는다", async ({ page }) => {
  const layouts = {
    align: {
      type: "stack", direction: "column", gap: "small", children: [...fillers(16), {
        type: "stack", direction: "column", gap: "small", align: "start", children: [
          { type: "text", value: "정렬 조상" },
          { type: "button", label: "왼쪽 단추", on_click: { copy_text: "왼쪽 단추" } },
        ],
      }],
    },
    center: {
      type: "stack", direction: "column", gap: "small", children: [...fillers(16), {
        type: "stack", direction: "column", gap: "small", place: "center", children: [
          { type: "text", value: "가운데 자리 글" },
          { type: "button", label: "가운데 단추", on_click: { copy_text: "가운데 단추" } },
        ],
      }],
    },
  };
  for (const [name, ui] of Object.entries(layouts)) {
    const readStack = async (height: number) => {
      await open(page, 480, height, { ui });
      return page.evaluate(() => {
        const root = document.querySelector('[data-testid="app-window-bare-layout-edges-1063"]') as HTMLElement;
        const body = root.querySelector(".ks-data-window-body") as HTMLElement;
        const stack = (body.querySelector(".ks-data-stack.align-start") ?? body.querySelector(".ks-data-stack.is-center")) as HTMLElement;
        const button = Array.from(body.querySelectorAll("button")).find((element) => element.textContent?.trim() === "왼쪽 단추" || element.textContent?.trim() === "가운데 단추") as HTMLElement;
        const item = button.closest(".ks-data-stack-item") as HTMLElement;
        return {
          overflow: body.scrollHeight > body.clientHeight + 1,
          stackPad: [getComputedStyle(stack).paddingLeft, getComputedStyle(stack).paddingRight],
          itemPad: [getComputedStyle(item).paddingLeft, getComputedStyle(item).paddingRight],
          itemClass: item.className,
        };
      });
    };
    const tall = await readStack(TALL);
    const short = await readStack(SHORT);
    expect(tall.overflow, `${name} 높은 창`).toBe(false);
    expect(short.overflow, `${name} 낮은 창`).toBe(true);
    expect(short.stackPad, `${name} 쌓기 여백`).toEqual(tall.stackPad);
    expect(short.itemPad, `${name} 내용 칸 여백`).toEqual(tall.itemPad);
    expect(short.itemPad[1], `${name}에 스크롤 보상이 닿지 않는다`).not.toBe("4px");
  }
});

test("몸통 직속 구역은 스크롤바가 생기면 자기 여백을 줄여 끝선을 지킨다", async ({ page }) => {
  const ui = { type: "section", title: "몸통 구역", child: { type: "stack", direction: "column", gap: "small", children: [...fillers(8), input("몸통 구역 입력")] } };
  const readSection = async (height: number) => {
    await open(page, 480, height, { ui });
    return page.evaluate(() => {
      const root = document.querySelector('[data-testid="app-window-bare-layout-edges-1063"]') as HTMLElement;
      const body = root.querySelector(".ks-data-window-body") as HTMLElement;
      const section = body.querySelector(".ks-data-section") as HTMLElement;
      const br = body.getBoundingClientRect();
      const rect = section.getBoundingClientRect();
      const style = getComputedStyle(section);
      const contentRight = rect.right - (Number.parseFloat(style.paddingRight) || 0);
      return {
        overflow: body.scrollHeight > body.clientHeight + 1,
        gutter: body.offsetWidth - body.clientWidth,
        padRight: style.paddingRight,
        gapRight: Math.round((br.right - contentRight) * 10) / 10,
        inBody: Boolean(section.parentElement?.classList.contains("ks-data-window-body")),
      };
    });
  };
  const tall = await readSection(TALL);
  const short = await readSection(SHORT);
  expect(tall.inBody, "구역이 몸통 직속이어야 한다").toBe(true);
  expect(tall.overflow).toBe(false);
  expect(short.overflow).toBe(true);
  expect(tall.gapRight).toBeCloseTo(12, 0);
  expect(short.gapRight).toBeCloseTo(12, 0);
});
