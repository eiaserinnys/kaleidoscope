import { expect, test, type Locator, type Page } from "@playwright/test";

// 블록 세트 60의 눈 확인용 시나리오. 확인 상자, 데이터 트리 바로 입력과 끌어 옮기기, 구역 머리 메뉴와
// 이름 바꾸기를 실제 브라우저에서 캡처하고, 확인 상자 크기, 행 높이, 머리 높이, 정렬 좌표를 잰다.
// 구역이 여럿이므로 트리 사이 끌기, 트리 밖 끌기, 빈 구역으로 끌기, 긴 목록 끝 바로 입력의 초점과 스크롤도 함께 본다.
// 접힌 부모 안 바로 입력, 접힌 구역 머리 +, 앱이 받아들이지 않은 구역 이름의 화면도 함께 확인한다.
const APP = "tree-edit-move-1112";
const ROW = (key: string) => `[data-tree-id="item:${key}"]`;
const HIDE_CHROME = `
  body { padding: 0; }
  .ks-harness { display: block; height: 100vh; }
  .ks-harness-header, .ks-harness-dev-panel { display: none; }
  .ks-harness-apps.is-preview { height: 100%; }
`;

type Box = { top: number; left: number; right: number; bottom: number; width: number; height: number };

async function open(page: Page, appId: string, width: number, height: number, theme: "light" | "dark" = "light") {
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize({ width, height });
  await page.goto(`/?preview=${appId}`);
  await page.addStyleTag({ content: HIDE_CHROME });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return page.getByTestId(`app-window-${appId}`);
}

function box(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  });
}

function round(value: number) {
  return +value.toFixed(2);
}

async function capture(locator: Locator | Page, testInfo: { outputPath: (name: string) => string }, name: string) {
  await locator.screenshot({ path: testInfo.outputPath(name) });
}

// 끌기 표시는 브라우저의 실제 끌기 이벤트를 흉내 내 같은 자료 전달자를 이어 쓴다. 좌표를 직접 정해
// 위 1/4, 가운데, 아래 1/4, 행 없는 빈 자리를 각각 만든다.
type DragState = { source: string; dataTransfer: DataTransfer };

async function pageDragStart(page: Page, key: string) {
  await page.evaluate((key) => {
    const source = document.querySelector<HTMLElement>(`[data-tree-id="item:${key}"]`)!;
    const holder = window as unknown as { __ksDrag?: { source: string; dataTransfer: DataTransfer } };
    const dataTransfer = new DataTransfer();
    holder.__ksDrag = { source: key, dataTransfer };
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
  }, key);
}

async function pageDragOver(page: Page, target: string | null, ratio: number) {
  await page.evaluate(({ target, ratio }) => {
    const holder = window as unknown as { __ksDrag?: DragState };
    const dataTransfer = holder.__ksDrag!.dataTransfer;
    const element = target === null
      ? document.querySelector<HTMLElement>(".ks-data-tree")!
      : document.querySelector<HTMLElement>(`[data-tree-id="item:${target}"]`)!;
    const rect = element.getBoundingClientRect();
    const clientY = target === null ? rect.bottom - 2 : rect.top + rect.height * ratio;
    const clientX = rect.left + Math.min(20, rect.width / 2);
    element.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }));
  }, { target, ratio });
}

async function pageDragLeave(page: Page, relatedSelector: string) {
  await page.evaluate((relatedSelector) => {
    const tree = document.querySelector<HTMLElement>(".ks-data-tree")!;
    const relatedTarget = document.querySelector<HTMLElement>(relatedSelector)!;
    tree.dispatchEvent(new DragEvent("dragleave", { bubbles: true, cancelable: true, relatedTarget }));
  }, relatedSelector);
}

async function pageDrop(page: Page, target: string | null, ratio: number) {
  await page.evaluate(({ target, ratio }) => {
    const holder = window as unknown as { __ksDrag?: DragState };
    const dataTransfer = holder.__ksDrag!.dataTransfer;
    const element = target === null
      ? document.querySelector<HTMLElement>(".ks-data-tree")!
      : document.querySelector<HTMLElement>(`[data-tree-id="item:${target}"]`)!;
    const rect = element.getBoundingClientRect();
    const clientY = target === null ? rect.bottom - 2 : rect.top + rect.height * ratio;
    const clientX = rect.left + Math.min(20, rect.width / 2);
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }));
    delete holder.__ksDrag;
  }, { target, ratio });
}

async function pageDragEnd(page: Page) {
  await page.evaluate(() => {
    const holder = window as unknown as { __ksDrag?: DragState };
    const drag = holder.__ksDrag!;
    const source = document.querySelector<HTMLElement>(`[data-tree-id="item:${drag.source}"]`)!;
    source.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: drag.dataTransfer }));
    delete holder.__ksDrag;
  });
}

// 항목이 없어 빈 상태만 그린 트리도 같은 트리 뿌리로 끌기 이벤트를 받는다.
async function pageDragOverTree(page: Page, index: number) {
  await page.evaluate((index) => {
    const holder = window as unknown as { __ksDrag?: DragState };
    const dataTransfer = holder.__ksDrag!.dataTransfer;
    const element = document.querySelectorAll<HTMLElement>(".ks-data-tree")[index]!;
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new DragEvent("dragover", {
      bubbles: true, cancelable: true, dataTransfer,
      clientX: rect.left + Math.min(20, rect.width / 2), clientY: rect.bottom - 2,
    }));
  }, index);
}

async function pageDropTree(page: Page, index: number) {
  await page.evaluate((index) => {
    const holder = window as unknown as { __ksDrag?: DragState };
    const dataTransfer = holder.__ksDrag!.dataTransfer;
    const element = document.querySelectorAll<HTMLElement>(".ks-data-tree")[index]!;
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new DragEvent("drop", {
      bubbles: true, cancelable: true, dataTransfer,
      clientX: rect.left + Math.min(20, rect.width / 2), clientY: rect.bottom - 2,
    }));
    delete holder.__ksDrag;
  }, index);
}

// empty_text가 있는 빈 트리의 한 줄. 그 줄이 놓을 자리 표시를 직접 받는다.
async function pageDragOverEmptyLine(page: Page, index: number) {
  await page.evaluate((index) => {
    const holder = window as unknown as { __ksDrag?: DragState };
    const dataTransfer = holder.__ksDrag!.dataTransfer;
    const line = document.querySelectorAll<HTMLElement>(".ks-data-tree")[index]!.querySelector<HTMLElement>(".ks-tree-empty")!;
    const rect = line.getBoundingClientRect();
    line.dispatchEvent(new DragEvent("dragover", {
      bubbles: true, cancelable: true, dataTransfer,
      clientX: rect.left + Math.min(20, rect.width / 2), clientY: rect.top + rect.height / 2,
    }));
  }, index);
}

async function pageDropEmptyLine(page: Page, index: number) {
  await page.evaluate((index) => {
    const holder = window as unknown as { __ksDrag?: DragState };
    const dataTransfer = holder.__ksDrag!.dataTransfer;
    const line = document.querySelectorAll<HTMLElement>(".ks-data-tree")[index]!.querySelector<HTMLElement>(".ks-tree-empty")!;
    const rect = line.getBoundingClientRect();
    line.dispatchEvent(new DragEvent("drop", {
      bubbles: true, cancelable: true, dataTransfer,
      clientX: rect.left + Math.min(20, rect.width / 2), clientY: rect.top + rect.height / 2,
    }));
    delete holder.__ksDrag;
  }, index);
}

async function openSectionMenu(page: Page, app: Locator) {
  await app.locator(".ks-data-section-title").first().click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
}

test("넓은 창 확인 상자: 크기, 둥글기, 세로 가운데, 열 정렬 (밝음)", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");
  const tree = app.locator(".ks-data-tree").first();
  await expect(tree).toBeVisible();

  const unchecked = tree.locator(".ks-tree-check:not(.is-checked)");
  const checked = tree.locator(".ks-tree-check.is-checked");
  await expect(unchecked).toHaveCount(3);
  await expect(checked).toHaveCount(1);

  const geometry = await tree.evaluate((root) => {
    const check = root.querySelector<HTMLElement>(".ks-tree-check:not(.is-checked)")!;
    const style = getComputedStyle(check);
    const checkedBox = root.querySelector<HTMLElement>(".ks-tree-check.is-checked")!;
    const svg = checkedBox.querySelector<SVGSVGElement>("svg");
    const rect = (element: Element) => {
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, width: value.width, height: value.height };
    };
    return {
      size: rect(check),
      radius: Number.parseFloat(style.borderRadius),
      checkedSvg: svg === null ? null : rect(svg),
      checkedSvgCount: checkedBox.querySelectorAll("svg").length,
      uncheckedSvgCount: check.querySelectorAll("svg").length,
    };
  });
  console.log(`확인 상자: ${JSON.stringify(geometry)}`);
  expect(geometry.size.width, "확인 상자 폭").toBeGreaterThan(13);
  expect(geometry.size.width, "확인 상자 폭").toBeLessThan(15);
  expect(Math.abs(geometry.size.width - geometry.size.height), "정사각형").toBeLessThanOrEqual(0.5);
  expect(geometry.radius, "둥근 사각형").toBeGreaterThanOrEqual(2.5);
  expect(geometry.radius, "둥근 사각형").toBeLessThanOrEqual(3.5);
  expect(geometry.uncheckedSvgCount, "빈 상자에는 체크가 없다").toBe(0);
  expect(geometry.checkedSvgCount, "확인된 상자에 체크가 있다").toBe(1);
  expect(geometry.checkedSvg!.width, "체크가 상자 안에 들어간다").toBeLessThanOrEqual(geometry.size.width);

  const alignment = await tree.evaluate((root) => {
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const rootRows = rows.filter((row) => row.getAttribute("aria-level") === "1");
    const centers = rootRows.map((row) => {
      const rowRect = row.getBoundingClientRect();
      const check = row.querySelector<HTMLElement>(".ks-tree-check");
      const name = row.querySelector<HTMLElement>(".ks-tree-name");
      const checkRect = check?.getBoundingClientRect();
      const nameRect = name?.getBoundingClientRect();
      return {
        name: name?.textContent,
        rowCenter: rowRect.top + rowRect.height / 2,
        checkLeft: checkRect?.left ?? null,
        checkCenter: checkRect === undefined ? null : checkRect.top + checkRect.height / 2,
        titleLeft: nameRect?.left ?? null,
      };
    });
    return centers;
  });
  console.log(`행 정렬: ${JSON.stringify(alignment)}`);
  const lefts = alignment.map((row) => row.checkLeft!);
  const titles = alignment.map((row) => row.titleLeft!);
  for (const value of lefts) expect(Math.abs(value - lefts[0]), "확인 상자 왼쪽 선").toBeLessThanOrEqual(1);
  for (const value of titles) expect(Math.abs(value - titles[0]), "제목 왼쪽 선").toBeLessThanOrEqual(1);
  for (const row of alignment) expect(Math.abs(row.checkCenter! - row.rowCenter), "세로 가운데").toBeLessThanOrEqual(1);

  await capture(app, testInfo, "넓은-확인상자-밝음.png");
});

test("넓은 창 확인 상자 (어두움)", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "dark");
  await expect(app.locator(".ks-data-tree").first().locator(".ks-tree-check.is-checked")).toHaveCount(1);
  await capture(app, testInfo, "넓은-확인상자-어두움.png");
});

test("구역 머리 메뉴와 이름 바꾸기: 높이 유지, 초점 복귀, pending 제목 (밝음)", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");
  const header = app.locator(".ks-data-section-header").first();
  const toggle = app.locator(".ks-data-section-toggle").first();
  await expect(header).toBeVisible();
  const before = await box(header);

  await openSectionMenu(page, app);
  await expect(page.getByRole("menuitem", { name: "구역 이름 바꾸기" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "첫 항목 이름 바꾸기" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "제목 복사" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("넓은-구역-메뉴-밝음.png") });

  await page.getByRole("menuitem", { name: "구역 이름 바꾸기" }).click();
  const input = app.getByRole("textbox", { name: "구역 이름" });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("이번 주");
  const selection = await input.evaluate((element) => {
    const field = element as HTMLInputElement;
    return { start: field.selectionStart, end: field.selectionEnd, length: field.value.length };
  });
  expect(selection, "처음 값은 글 전체를 고른 채 연다").toEqual({ start: 0, end: 4, length: 4 });

  const during = await box(header);
  const toggleBox = await box(toggle);
  const inputBox = await box(input);
  console.log(`구역 머리 높이: ${JSON.stringify({ before: round(before.height), during: round(during.height) })}`);
  console.log(`구역 머리 폭: ${JSON.stringify({ toggle: round(toggleBox.width), input: round(inputBox.width) })}`);
  expect(Math.abs(before.height - during.height), "머리 높이는 편집 전후 같다").toBeLessThanOrEqual(1);
  expect(toggleBox.width, "편집 중 접기 단추는 화살표 폭").toBeLessThanOrEqual(32);
  expect(inputBox.width, "글칸이 남은 폭을 쓴다").toBeGreaterThan(toggleBox.width);
  await expect(toggle.locator("input")).toHaveCount(0);
  await expect(app.getByRole("button", { name: "+", exact: true }).first()).toBeVisible();
  await capture(app, testInfo, "넓은-구역-이름-밝음.png");

  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(app.locator(".ks-data-section-title").first()).toHaveText("이번 주");
  await expect(toggle).toBeFocused();

  await openSectionMenu(page, app);
  await page.getByRole("menuitem", { name: "구역 이름 바꾸기" }).click();
  const second = app.getByRole("textbox", { name: "구역 이름" });
  await expect(second).toBeFocused();
  await second.fill("다음 구역");
  await second.press("Enter");
  await expect(second).toHaveCount(0);
  await expect(app.locator(".ks-data-section-title").first()).toHaveText("다음 구역");
  await expect(toggle).toBeFocused();
});

test("구역 이름 글칸 (어두움)", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "dark");
  const header = app.locator(".ks-data-section-header").first();
  const before = await box(header);
  await openSectionMenu(page, app);
  await page.getByRole("menuitem", { name: "구역 이름 바꾸기" }).click();
  const input = app.getByRole("textbox", { name: "구역 이름" });
  await expect(input).toBeFocused();
  const during = await box(header);
  expect(Math.abs(before.height - during.height), "어두움에서도 머리 높이는 같다").toBeLessThanOrEqual(1);
  await capture(app, testInfo, "넓은-구역-이름-어두움.png");
});

test("트리 행 이름 바꾸기: 전체 고름, 행 높이, 취소와 확정", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");
  const row = app.locator(ROW("a"));
  await expect(row).toBeVisible();
  const before = await box(row);

  await row.click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();
  const input = app.getByRole("textbox", { name: "항목 이름" });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("설계 정리");
  const selection = await input.evaluate((element) => {
    const field = element as HTMLInputElement;
    return { start: field.selectionStart, end: field.selectionEnd, length: field.value.length };
  });
  expect(selection, "이름은 글 전체를 고른 채 연다").toEqual({ start: 0, end: 5, length: 5 });

  const editRow = app.locator(".ks-file-tree-create-row");
  await expect(editRow).toBeVisible();
  const during = await box(editRow);
  console.log(`트리 행 높이: ${JSON.stringify({ before: round(before.height), during: round(during.height) })}`);
  expect(Math.abs(before.height - during.height), "이름 글칸 행 높이는 행 높이와 같다").toBeLessThanOrEqual(1);
  await capture(app, testInfo, "넓은-트리-이름-밝음.png");

  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(app.getByText("마지막 이름: a: 취소", { exact: true })).toBeVisible();

  await app.locator(ROW("a")).click({ button: "right" });
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();
  const second = app.getByRole("textbox", { name: "항목 이름" });
  await second.fill("설계 정리 v2");
  await second.press("Enter");
  await expect(second).toHaveCount(0);
  await expect(app.getByText("마지막 이름: a: 설계 정리 v2", { exact: true })).toBeVisible();
});

test("끌어 옮기기: before, inside, after, end 표시와 놓은 뒤", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");
  const tree = app.locator(".ks-data-tree").first();
  await expect(tree).toBeVisible();

  await pageDragStart(page, "a");
  await pageDragOver(page, "c", 0.1);
  await expect(app.locator(ROW("c"))).toHaveAttribute("data-drop-position", "before");
  await capture(app, testInfo, "넓은-끌기-before.png");
  await pageDragEnd(page);

  await pageDragStart(page, "a");
  await pageDragOver(page, "b", 0.5);
  await expect(app.locator(ROW("b"))).toHaveAttribute("data-drop-state", "valid");
  await expect(app.locator(ROW("b"))).not.toHaveAttribute("data-drop-position");
  await capture(app, testInfo, "넓은-끌기-inside.png");
  await pageDragEnd(page);

  await pageDragStart(page, "a");
  await pageDragOver(page, "c", 0.9);
  await expect(app.locator(ROW("c"))).toHaveAttribute("data-drop-position", "after");
  await capture(app, testInfo, "넓은-끌기-after.png");
  await pageDragEnd(page);

  await pageDragStart(page, "a");
  await pageDragOver(page, null, 0);
  await expect(tree).toHaveAttribute("data-drop-state", "valid");
  await capture(app, testInfo, "넓은-끌기-end.png");
  await pageDragEnd(page);

  await pageDragStart(page, "b");
  await pageDragOver(page, "b1", 0.5);
  await expect(app.locator(ROW("b1"))).toHaveAttribute("data-drop-state", "invalid");
  await capture(app, testInfo, "넓은-끌기-invalid.png");
  await pageDragEnd(page);

  await pageDragStart(page, "a");
  await pageDragOver(page, "c", 0.9);
  await pageDrop(page, "c", 0.9);
  await expect(app.getByText("마지막 이동: a → c (after)", { exact: true })).toBeVisible();
  await expect(app.locator("[data-drop-state]")).toHaveCount(0);
  await capture(app, testInfo, "넓은-끌기-놓은뒤.png");

  await pageDragStart(page, "a");
  await pageDragOver(page, null, 0);
  await pageDrop(page, null, 0);
  await expect(app.getByText("마지막 이동: a → 끝 (end)", { exact: true })).toBeVisible();
});

test("트리 사이 끌기: 표시는 목표 하나뿐이고 놓으면 그 트리의 자리로 간다", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");

  await pageDragStart(page, "a");
  await pageDragOver(page, "n5", 0.1);
  await expect(app.locator(ROW("n5"))).toHaveAttribute("data-drop-position", "before");
  await expect(app.locator("[data-drop-position]"), "놓을 자리 표시는 하나뿐").toHaveCount(1);
  await expect(app.locator("[data-drop-state]"), "앞 트리의 끝 자리 표시는 사라진다").toHaveCount(0);
  await capture(app, testInfo, "트리-사이-끌기.png");

  await pageDrop(page, "n5", 0.1);
  await expect(app.getByText("마지막 이동: a → n5 (before)", { exact: true })).toBeVisible();
  await expect(app.locator("[data-drop-position]")).toHaveCount(0);
  await expect(app.locator("[data-drop-state]")).toHaveCount(0);
});

test("트리 밖으로 나가면 표시가 사라지고 그 상태로 놓으면 아무 일도 없다", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");

  await pageDragStart(page, "a");
  await pageDragOver(page, "c", 0.9);
  await expect(app.locator(ROW("c"))).toHaveAttribute("data-drop-position", "after");
  await pageDragLeave(page, ".ks-data-text");
  await expect(app.locator("[data-drop-position]"), "트리 밖에서는 표시가 없다").toHaveCount(0);
  await expect(app.locator("[data-drop-state]")).toHaveCount(0);
  await capture(app, testInfo, "트리-밖-표시-없음.png");

  await app.locator(".ks-data-text").first().dispatchEvent("drop");
  await pageDragEnd(page);
  await expect(app.getByText("마지막 이동: 없음", { exact: true })).toBeVisible();
  await expect(app.locator("[data-drop-position]")).toHaveCount(0);
  await expect(app.locator("[data-drop-state]")).toHaveCount(0);
});

test("다른 트리 위에서 Escape로 끄면 모든 놓을 자리 표시가 사라진다", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");

  await pageDragStart(page, "a");
  await pageDragOver(page, "n6", 0.5);
  await expect(app.locator(ROW("n6"))).toHaveAttribute("data-drop-state", "valid");
  await page.keyboard.press("Escape");
  await expect(app.locator("[data-drop-state]")).toHaveCount(0);
  await expect(app.locator("[data-drop-position]")).toHaveCount(0);
  await capture(app, testInfo, "Escape-취소.png");
  await pageDragEnd(page);
  await expect(app.locator("[data-drop-state]")).toHaveCount(0);
  await expect(app.getByText("마지막 이동: 없음", { exact: true })).toBeVisible();
});

test("긴 목록 끝: +로 더한 항목은 Enter 뒤 스크롤을 지키고 그 행이 초점을 받으며 Escape는 +로 돌아온다", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");
  const body = app.locator(".ks-data-window-body");
  const plus = app.getByRole("button", { name: "+", exact: true }).nth(1);

  await plus.scrollIntoViewIfNeeded();
  await plus.click();
  const input = app.getByRole("textbox", { name: "항목 이름" });
  await expect(input).toBeFocused();
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(plus, "취소하면 연 자리인 + 단추로 돌아온다").toBeFocused();

  await plus.click();
  const typed = app.getByRole("textbox", { name: "항목 이름" });
  await expect(typed).toBeFocused();
  await typed.fill("끝에 더한 항목");
  const before = await body.evaluate((element) => element.scrollTop);
  expect(before, "긴 목록 끝으로 스크롤된 상태").toBeGreaterThan(0);
  await typed.press("Enter");
  await expect(typed).toHaveCount(0);
  const after = await body.evaluate((element) => element.scrollTop);
  console.log(`긴 목록 스크롤: ${JSON.stringify({ before: round(before), after: round(after) })}`);
  expect(Math.abs(after - before), "Enter 뒤 스크롤이 튀지 않는다").toBeLessThanOrEqual(1);
  const added = app.locator('[data-tree-id="item:new-g2"]');
  await expect(added).toHaveText(/끝에 더한 항목/);
  await expect(added, "확정한 새 행이 초점을 받는다").toBeFocused();
  await expect(app.locator(ROW("a")), "창 첫 행으로 돌아가지 않는다").not.toBeFocused();
  await capture(app, testInfo, "긴-목록-Enter.png");
});

test("끌기 선 3배 확대: 곧은 --ks-focus-width 선", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ deviceScaleFactor: 3, viewport: { width: 1182, height: 800 } });
  const page = await context.newPage();
  const app = await open(page, APP, 1182, 800, "light");
  await pageDragStart(page, "a");
  await pageDragOver(page, "c", 0.9);
  await expect(app.locator(ROW("c"))).toHaveAttribute("data-drop-position", "after");
  await app.locator(ROW("c")).screenshot({ path: testInfo.outputPath("끌기-선-3배-아래.png") });
  await pageDragOver(page, "c", 0.1);
  await expect(app.locator(ROW("c"))).toHaveAttribute("data-drop-position", "before");
  await app.locator(ROW("c")).screenshot({ path: testInfo.outputPath("끌기-선-3배-위.png") });
  await pageDragEnd(page);
  await context.close();
});

test("좁은 창: 확인 상자와 구역 이름 글칸", async ({ page }, testInfo) => {
  const app = await open(page, APP, 560, 800, "light");
  await expect(app.locator(".ks-data-tree").first()).toBeVisible();
  await capture(app, testInfo, "좁은-확인상자-밝음.png");

  const header = app.locator(".ks-data-section-header").first();
  const before = await box(header);
  await openSectionMenu(page, app);
  await page.getByRole("menuitem", { name: "구역 이름 바꾸기" }).click();
  const input = app.getByRole("textbox", { name: "구역 이름" });
  await expect(input).toBeFocused();
  const during = await box(header);
  expect(Math.abs(before.height - during.height), "좁은 창에서도 머리 높이는 같다").toBeLessThanOrEqual(1);
  const overflow = await app.locator(".ks-data-section").first().evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow, "가로로 넘치지 않는다").toBeLessThanOrEqual(1);
  await capture(app, testInfo, "좁은-구역-이름-밝음.png");
});

test("폴더 트리의 새 항목, 하위 항목, 이름 바꾸기 글칸 행", async ({ page }, testInfo) => {
  const app = await open(page, "md-editor", 1182, 800, "light");
  await app.getByRole("tab", { name: "내 폴더" }).click();
  await app.getByRole("button", { name: "문서 폴더 고르기" }).click();
  const readme = app.getByRole("treeitem", { name: "README.md" });
  await expect(readme).toBeVisible();

  await app.getByRole("button", { name: "새 파일" }).click();
  const rootCreate = app.locator(".ks-file-tree-create-row");
  await expect(rootCreate).toBeVisible();
  const [rootCreateBox, readmeBox] = await Promise.all([box(rootCreate), box(readme)]);
  console.log(`새 항목 행: ${JSON.stringify({ create: round(rootCreateBox.height), file: round(readmeBox.height) })}`);
  expect(Math.abs(rootCreateBox.height - readmeBox.height), "새 항목 글칸 행 높이는 파일 행과 같다").toBeLessThanOrEqual(1);
  await capture(app, testInfo, "넓은-새항목-밝음.png");
  await rootCreate.getByRole("textbox", { name: "새 파일 이름" }).press("Escape");

  const notes = app.getByRole("treeitem", { name: "notes" });
  await notes.click();
  const meeting = app.getByRole("treeitem", { name: "meeting.md" });
  await expect(meeting).toBeVisible();
  await notes.click({ button: "right" });
  await page.getByRole("menuitem", { name: "새 파일" }).click();
  const childCreate = app.locator(".ks-file-tree-create-row");
  await expect(childCreate).toBeVisible();
  const [childCreateBox, meetingBox] = await Promise.all([box(childCreate), box(meeting)]);
  console.log(`하위 항목 행: ${JSON.stringify({ create: round(childCreateBox.left), file: round(meetingBox.left) })}`);
  expect(Math.abs(childCreateBox.left - meetingBox.left), "하위 항목 글칸 행이 하위 파일 행과 같은 들여쓰기").toBeLessThanOrEqual(1);
  await capture(app, testInfo, "넓은-하위항목-밝음.png");
  await childCreate.getByRole("textbox", { name: "새 파일 이름" }).press("Escape");

  await readme.click({ button: "right" });
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();
  const rename = app.getByRole("textbox", { name: "이름 바꾸기" });
  await expect(rename).toBeFocused();
  const selection = await rename.evaluate((element) => {
    const field = element as HTMLInputElement;
    return { value: field.value, start: field.selectionStart, end: field.selectionEnd };
  });
  console.log(`이름 바꾸기 선택: ${JSON.stringify(selection)}`);
  expect(selection.value, "확장자 앞까지 고른다").toBe("README.md");
  expect(selection.start, "확장자 앞까지 고른다").toBe(0);
  expect(selection.end, "확장자 앞까지 고른다").toBe("README.md".length - ".md".length);
  await capture(app, testInfo, "넓은-이름바꾸기-밝음.png");
});

test("접힌 부모의 하위 항목 추가: 부모가 펼쳐지고 새 글칸이 보인다", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");
  const parent = app.locator(ROW("b"));
  await expect(parent).toHaveAttribute("aria-expanded", "true");
  await parent.locator(".ks-tree-chevron-trigger").click();
  await expect(parent).toHaveAttribute("aria-expanded", "false");
  await expect(app.locator(ROW("b1")), "부모가 접혀 자식이 보이지 않는다").toHaveCount(0);

  await parent.click({ button: "right" });
  await page.getByRole("menuitem", { name: "하위 항목 추가" }).click();
  const input = app.getByRole("textbox", { name: "항목 이름" });
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await expect(app.locator(ROW("b"))).toHaveAttribute("aria-expanded", "true");
  await expect(app.locator(ROW("b1")), "펼쳐서 기존 자식도 보인다").toBeVisible();
  await capture(app, testInfo, "접힌-부모-하위추가.png");
});

test("접힌 구역의 머리 +: 구역을 먼저 펼치고 새 글칸이 보인다", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");
  const section = app.locator(".ks-data-section").first();
  const toggle = section.locator(".ks-data-section-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(section.locator(".ks-data-tree"), "접힌 구역 안은 그리지 않는다").toHaveCount(0);

  await section.getByRole("button", { name: "+", exact: true }).click();
  const input = section.getByRole("textbox", { name: "항목 이름" });
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await capture(app, testInfo, "접힌-구역-더하기.png");
});

test("앱이 받아들이지 않은 구역 이름은 머리에 남지 않는다", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");
  // 편집 중에는 머리에 제목 글이 사라지므로 구역 자리로 잡고, 그 전에 이름을 확인한다.
  const section = app.locator(".ks-data-section").nth(3);
  const header = section.locator(".ks-data-section-header");
  await expect(header.locator(".ks-data-section-title")).toHaveText("고정 구역");
  await header.locator(".ks-data-section-title").click({ button: "right" });
  await page.getByRole("menuitem", { name: "구역 이름 바꾸기" }).click();
  const input = section.getByRole("textbox", { name: "구역 이름" });
  await expect(input).toBeFocused();
  await input.fill("바뀐 이름");
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(header.locator(".ks-data-section-title"), "거절되면 원래 이름이 남는다").toHaveText("고정 구역");
  await expect(app.getByText("바뀐 이름", { exact: true })).toHaveCount(0);
  await capture(app, testInfo, "구역-이름-거절.png");
});

test("빈 구역 트리로 끌어 놓으면 놓을 자리 하나를 보이고 끝으로 옮긴다", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");
  const trees = app.locator(".ks-data-tree");
  await expect(trees).toHaveCount(7);
  const emptyTree = trees.nth(2);
  await expect(emptyTree.getByText("없음")).toBeVisible();
  await emptyTree.scrollIntoViewIfNeeded();

  await pageDragStart(page, "a");
  await pageDragOverTree(page, 2);
  await expect(emptyTree).toHaveAttribute("data-drop-state", "valid");
  await expect(app.locator("[data-drop-state]"), "놓을 자리 표시는 한 곳뿐").toHaveCount(1);
  await capture(app, testInfo, "빈-구역-끌기-중.png");

  await pageDropTree(page, 2);
  const lastMove = app.getByText("마지막 이동: a → 끝 (end)", { exact: true });
  await expect(lastMove).toBeVisible();
  await expect(emptyTree).not.toHaveAttribute("data-drop-state");
  await lastMove.scrollIntoViewIfNeeded();
  await capture(app, testInfo, "빈-구역-놓은뒤.png");
});

// empty_text가 있는 빈 트리의 한 줄을 같은 트리 모양(확인 열 없음)의 뿌리 행과 견준다.
async function emptyLineMetrics(referenceRow: Locator, line: Locator, hasText: boolean) {
  const [rowBox, lineBox, titleBox] = await Promise.all([box(referenceRow), box(line), box(referenceRow.locator(".ks-tree-name"))]);
  if (!hasText) return { rowBox, lineBox, titleBox, lineTextBox: null, meta: null };
  const lineTextBox = await box(line.locator(".ks-view-meta"));
  const meta = await line.locator(".ks-view-meta").evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--ks-color-muted)";
    probe.style.fontSize = "var(--ks-type-meta)";
    document.body.append(probe);
    const style = getComputedStyle(element);
    const expected = getComputedStyle(probe);
    const result = { fontSize: style.fontSize, color: style.color, tokenFontSize: expected.fontSize, tokenColor: expected.color };
    probe.remove();
    return result;
  });
  return { rowBox, lineBox, titleBox, lineTextBox, meta };
}

test("empty_text 빈 트리: 한 줄 높이, 아이콘 없음, 제목 시작선과 메타 글자 (넓은 밝음)", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");
  const trees = app.locator(".ks-data-tree");
  await expect(trees).toHaveCount(7);
  const reference = trees.nth(4);
  const blank = trees.nth(5);
  const texted = trees.nth(6);
  const blankLine = blank.locator(".ks-tree-empty");
  const textLine = texted.locator(".ks-tree-empty");
  await blankLine.scrollIntoViewIfNeeded();
  await expect(blankLine).toBeVisible();
  await expect(textLine).toBeVisible();
  await expect(textLine).toHaveText("아직 항목이 없습니다");

  const referenceRow = reference.locator(ROW("r1"));
  const blankMetrics = await emptyLineMetrics(referenceRow, blankLine, false);
  const textMetrics = await emptyLineMetrics(referenceRow, textLine, true);
  console.log(`빈 자리 한 줄: ${JSON.stringify({
    row: round(blankMetrics.rowBox.height), blank: round(blankMetrics.lineBox.height), text: round(textMetrics.lineBox.height),
    rowTitleLeft: round(blankMetrics.titleBox.left), lineTextLeft: round(textMetrics.lineTextBox!.left), meta: textMetrics.meta,
  })}`);
  expect(Math.abs(blankMetrics.lineBox.height - blankMetrics.rowBox.height), "글 없는 한 줄 높이는 트리 행과 같다").toBeLessThanOrEqual(1);
  expect(Math.abs(textMetrics.lineBox.height - textMetrics.rowBox.height), "글 있는 한 줄 높이는 트리 행과 같다").toBeLessThanOrEqual(1);
  expect(Math.abs(textMetrics.lineTextBox!.left - textMetrics.titleBox.left), "글 시작선은 뿌리 행 제목 시작선과 같다").toBeLessThanOrEqual(1);
  expect(textMetrics.meta!.fontSize, "메타 글자 토큰").toBe(textMetrics.meta!.tokenFontSize);
  expect(textMetrics.meta!.color, "메타 색 토큰").toBe(textMetrics.meta!.tokenColor);
  expect(await blankLine.locator("svg").count(), "글 없는 한 줄에 아이콘이 없다").toBe(0);
  expect(await textLine.locator("svg").count(), "글 있는 한 줄에 아이콘이 없다").toBe(0);
  expect(await blankLine.locator(".ks-file-tree-icon").count(), "확인 열 없이 표식 한 열").toBe(1);
  await capture(app, testInfo, "빈-자리-글-넓은-밝음.png");
});

test("empty_text 빈 트리 (넓은 어두움, 좁은 360 밝음과 어두움)", async ({ page }, testInfo) => {
  const wide = await open(page, APP, 1182, 800, "dark");
  const wideLine = wide.locator(".ks-data-tree").nth(6).locator(".ks-tree-empty");
  await wideLine.scrollIntoViewIfNeeded();
  await expect(wideLine).toHaveText("아직 항목이 없습니다");
  await capture(wide, testInfo, "빈-자리-글-넓은-어두움.png");

  const narrow = await open(page, APP, 360, 800, "light");
  const narrowTrees = narrow.locator(".ks-data-tree");
  await expect(narrowTrees).toHaveCount(7);
  const narrowBlank = narrowTrees.nth(5).locator(".ks-tree-empty");
  const narrowText = narrowTrees.nth(6).locator(".ks-tree-empty");
  await narrowText.scrollIntoViewIfNeeded();
  await expect(narrowBlank).toBeVisible();
  const overflow = await narrow.locator(".ks-data-section").nth(6).evaluate((element) => element.scrollWidth - element.clientWidth);
  console.log(`좁은 360 빈 자리: ${JSON.stringify({ overflow, blank: round((await narrowBlank.boundingBox())!.height), text: round((await narrowText.boundingBox())!.height) })}`);
  expect(overflow, "좁은 창에서 가로로 넘치지 않는다").toBeLessThanOrEqual(1);
  await capture(narrow, testInfo, "빈-자리-글-좁은-360-밝음.png");

  await page.emulateMedia({ colorScheme: "dark" });
  await capture(narrow, testInfo, "빈-자리-글-좁은-360-어두움.png");
});

test("empty_text 한 줄 위로 끌면 그 줄에 놓을 자리 표시가 서고 놓으면 끝으로 간다", async ({ page }, testInfo) => {
  const app = await open(page, APP, 1182, 800, "light");
  const blankTree = app.locator(".ks-data-tree").nth(5);
  const line = blankTree.locator(".ks-tree-empty");
  await line.scrollIntoViewIfNeeded();

  await pageDragStart(page, "a");
  await pageDragOverEmptyLine(page, 5);
  await expect(line).toHaveAttribute("data-drop-state", "valid");
  await expect(blankTree, "트리 뿌리는 표시를 받지 않는다").not.toHaveAttribute("data-drop-state");
  await expect(app.locator("[data-drop-state]"), "놓을 자리 표시는 한 곳뿐").toHaveCount(1);
  await capture(app, testInfo, "빈-자리-한줄-끌기-중.png");

  await pageDropEmptyLine(page, 5);
  await expect(app.getByText("마지막 이동: a → 끝 (end)", { exact: true })).toBeVisible();
  await expect(app.locator("[data-drop-state]"), "끌기가 끝나면 표시가 없다").toHaveCount(0);
  await capture(app, testInfo, "빈-자리-한줄-놓은뒤.png");
});

test("펼친 부모 행 이름 바꾸기: 화살표가 펼침을 따르고 자식이 그대로 보인다", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ deviceScaleFactor: 3, viewport: { width: 1182, height: 800 } });
  const page = await context.newPage();
  const app = await open(page, APP, 1182, 800, "light");
  const parent = app.locator(ROW("b"));
  await expect(parent).toHaveAttribute("aria-expanded", "true");
  await parent.click({ button: "right" });
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();
  const editRow = app.locator(".ks-file-tree-create-row");
  await expect(editRow.locator(".ks-chevron")).toHaveClass(/is-expanded/);
  await expect(app.locator(ROW("b1")), "자식은 그대로 보인다").toBeVisible();
  console.log(`펼친 부모 편집 화살표: ${JSON.stringify({ className: await editRow.locator(".ks-chevron").getAttribute("class"), childVisible: true })}`);
  await editRow.screenshot({ path: testInfo.outputPath("펼친-부모-이름-화살표-3배.png") });
  await app.getByRole("textbox", { name: "항목 이름" }).press("Escape");
  await expect(editRow).toHaveCount(0);

  await parent.locator(".ks-tree-chevron-trigger").click();
  await expect(parent).toHaveAttribute("aria-expanded", "false");
  await parent.click({ button: "right" });
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();
  const collapsedRow = app.locator(".ks-file-tree-create-row");
  await expect(collapsedRow.locator(".ks-chevron")).not.toHaveClass(/is-expanded/);
  console.log(`접힌 부모 편집 화살표: ${JSON.stringify({ className: await collapsedRow.locator(".ks-chevron").getAttribute("class"), childVisible: false })}`);
  await collapsedRow.screenshot({ path: testInfo.outputPath("접힌-부모-이름-화살표-3배.png") });
  await context.close();
});

test("구역 이름 확정으로 구역이 다시 만들어져도 같은 자리 구역 접기 단추가 초점을 받는다", async ({ page }, testInfo) => {
  const app = await open(page, "tree-name-key-1112", 1182, 800, "light");
  const second = app.locator(".ks-data-section").nth(1);
  await expect(second.locator(".ks-data-section-title")).toHaveText("다음 주");
  await second.locator(".ks-data-section-title").click({ button: "right" });
  await page.getByRole("menuitem", { name: "구역 이름 바꾸기" }).click();
  const input = second.getByRole("textbox", { name: "구역 이름" });
  await expect(input).toBeFocused();
  await input.fill("새 이름");
  await input.press("Enter");
  const renamed = app.locator('.ks-repeat-item[data-repeat-key="새 이름"] .ks-data-section-toggle');
  await expect(renamed).toBeFocused();
  const active = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return { className: element?.className ?? "", text: element?.textContent?.trim() ?? "" };
  });
  console.log(`구역 이름 확정 뒤 초점: ${JSON.stringify(active)}`);
  expect(active.className).toContain("ks-data-section-toggle");
  expect(active.text).toContain("새 이름");
  await capture(app, testInfo, "이름-key-구역-확정-초점.png");
});
