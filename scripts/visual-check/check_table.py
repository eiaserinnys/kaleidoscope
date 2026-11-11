#!/usr/bin/env python3
"""표의 칸 상자와 글자 시작선, 칸 고르기의 키보드 초점을 화면에서 확인한다.

툴바 글자, 표 머리 글자, 첫 칸 글자가 같은 세로 시작선에서 시작하는지, 내용 칸 상자의
위아래가 한 행에서 맞는지, 배지가 없는 행에 배지 자리가 남지 않는지, muted 칸의 제목이
덜 띄게 보이는지를 넓은 창과 좁은 창에서 재고 캡처한다. 칸 고르기 표는 방향키를 눌러
초점 표시가 고른 칸 하나에만 있고 Tab이 그 칸에만 머무는지도 함께 잰다. 오른쪽 열이 밀리는
넓은 표는 오른쪽 끝 칸을 고른 뒤 창 폭을 줄여, 스크롤이 그 칸을 다시 보이게 하는지 잰다.

  python3 scripts/visual-check/check_table.py [--output 산출폴더]

기본 산출 폴더는 target/visual-check/table 이다. kaleidoscope-app 스킬의 sandbox를 빌려
현재 체크아웃의 target/debug 바이너리와 app 화면으로 띄우므로, 실행 전에
`cargo build -p kaleidoscope-orchestrator -p kaleidoscope-devbridge`와
`pnpm install --frozen-lockfile`이 끝나 있어야 한다.

판정이 하나라도 어긋나면 result.json과 캡처를 남긴 뒤 종료 코드 1로 끝난다.
"""
import argparse
import importlib.util
import json
import os
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
WIDE = (1280, 800)
NARROW = (520, 760)
# 이 검수 앱이 쓰는 블록은 55판까지다. muted는 58판에 더한 칸 내용 필드이지만 쉘 검증은
# requires.blocks로 칸 값을 거르지 않으므로, 58판 이전 쉘에서도 같은 정의로 「전」 화면을
# 찍을 수 있다(그때 쉘은 muted를 모르고 그냥 제목을 그린다).
REQUIRES_BLOCKS = 55
ROWS_APP = "visual-check-table-rows"
TEXT_APP = "visual-check-table-text"
GRID_APP = "visual-check-table-grid"
GRID_EDGE_APP = "visual-check-table-grid-edges"
GRID_WIDE_APP = "visual-check-table-grid-wide"

MEASURE_JS = """(args) => {
  const win = document.querySelector(`[data-testid="app-window-${args.appId}"]`);
  if (!win) return { error: "창을 찾지 못했습니다" };
  const round = (value) => Math.round(value * 100) / 100;
  const winRect = win.getBoundingClientRect();
  const relX = (x) => round(x - winRect.left);
  const relY = (y) => round(y - winRect.top);
  const glyphX = (element) => {
    if (!element) return null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = range.getClientRects();
      if (rects.length) return relX(rects[0].left);
    }
    return relX(element.getBoundingClientRect().left);
  };
  // 토큰과 실제 계산 값을 같은 형식으로 비교하려고 캔버스로 정규화한다.
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const norm = (color) => {
    if (!color) return null;
    context.fillStyle = "#000";
    context.fillStyle = color;
    return String(context.fillStyle);
  };
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.append(probe);
  const token = (name) => {
    probe.style.color = "";
    probe.style.color = `var(${name})`;
    return norm(getComputedStyle(probe).color);
  };
  const tokens = { hover: token("--ks-color-hover"), solid: token("--ks-color-surface-solid") };
  probe.remove();
  const toolbar = win.querySelector(".ks-data-toolbar .ks-data-text");
  const headers = [...win.querySelectorAll('.ks-table-header > [role="columnheader"]')].map((header) => ({
    x: glyphX(header.querySelector("button") ?? header),
  }));
  const rows = [...win.querySelectorAll(".ks-row.ks-table-row")].map((row) => {
    const boxes = [];
    const titles = [];
    const cells = [];
    [...row.children].forEach((cell, index) => {
      if (!cell.classList.contains("ks-table-cell")) return;
      const cellRect = cell.getBoundingClientRect();
      const info = {
        cell: index,
        hasContent: false,
        selected: cell.getAttribute("aria-selected") === "true",
        left: relX(cellRect.left), right: relX(cellRect.right),
        top: relY(cellRect.top), bottom: relY(cellRect.bottom),
      };
      const box = cell.querySelector(".ks-table-content");
      if (box) {
        const rect = box.getBoundingClientRect();
        info.hasContent = true;
        info.boxLeft = relX(rect.left);
        info.boxRight = relX(rect.right);
        info.boxTop = relY(rect.top);
        info.boxBottom = relY(rect.bottom);
        info.hasColor = box.classList.contains("has-color");
        info.muted = box.classList.contains("is-muted");
        info.boxBackground = norm(getComputedStyle(box).backgroundColor);
        info.badges = [...box.querySelectorAll(".ks-badge")].map((badge) => norm(getComputedStyle(badge).backgroundColor));
        boxes.push({ cell: index, left: relX(rect.left), right: relX(rect.right), top: relY(rect.top), bottom: relY(rect.bottom), height: round(rect.height) });
        const title = box.querySelector(".ks-table-content-title");
        if (title) {
          const titleStyle = getComputedStyle(title);
          info.titleColor = titleStyle.color;
          info.titleWeight = titleStyle.fontWeight;
          titles.push({ cell: index, x: glyphX(title), weight: titleStyle.fontWeight, color: titleStyle.color });
        }
      }
      cells.push(info);
    });
    const style = getComputedStyle(row);
    const rect = row.getBoundingClientRect();
    return {
      key: row.getAttribute("data-row-key") ?? row.getAttribute("data-index"),
      glyphX: glyphX(row.querySelector(".ks-table-cell")),
      rowHeight: round(rect.height),
      paddingTop: parseFloat(style.paddingTop),
      paddingBottom: parseFloat(style.paddingBottom),
      borderTop: parseFloat(style.borderTopWidth),
      borderBottom: parseFloat(style.borderBottomWidth),
      boxes,
      titles,
      cells,
      hasBadge: Boolean(row.querySelector(".ks-badge")),
    };
  });
  return {
    toolbarX: glyphX(toolbar),
    headerX: headers.length ? headers[0].x : null,
    firstCellX: rows.length ? rows[0].glyphX : null,
    windowWidth: round(winRect.width),
    tokens,
    headers,
    rows,
  };
}"""

SELECT_MEASURE_JS = """(args) => {
  const win = document.querySelector(`[data-testid="app-window-${args.appId}"]`);
  if (!win) return { error: "창을 찾지 못했습니다" };
  const round = (value) => Math.round(value * 100) / 100;
  const winRect = win.getBoundingClientRect();
  const relX = (x) => round(x - winRect.left);
  const relY = (y) => round(y - winRect.top);
  const row = win.querySelector(".ks-grid-row");
  const cell = row ? [...row.children].filter((child) => child.classList.contains("ks-grid-cell"))[args.index] : null;
  if (!cell) return { error: `칸을 찾지 못했습니다: ${args.index}` };
  const box = cell.querySelector(".ks-table-content");
  if (!box) return { error: `내용 상자를 찾지 못했습니다: ${args.index}` };
  const cellRect = cell.getBoundingClientRect();
  const boxRect = box.getBoundingClientRect();
  return {
    index: args.index,
    selected: cell.getAttribute("aria-selected") === "true",
    cell: { left: relX(cellRect.left), right: relX(cellRect.right), top: relY(cellRect.top), bottom: relY(cellRect.bottom) },
    box: { left: relX(boxRect.left), right: relX(boxRect.right), top: relY(boxRect.top), bottom: relY(boxRect.bottom) },
  };
}"""


KEYBOARD_MEASURE_JS = """(args) => {
  const win = document.querySelector(`[data-testid="app-window-${args.appId}"]`);
  if (!win) return { error: "창을 찾지 못했습니다" };
  const grid = win.querySelector('[role="grid"]');
  if (!grid) return { error: "격자를 찾지 못했습니다" };
  const cells = [...grid.querySelectorAll('[role="gridcell"]')];
  const indexOf = (cell) => cells.indexOf(cell);
  const active = document.activeElement;
  return {
    cells: cells.length,
    focusedIndex: cells.filter((cell) => cell.hasAttribute("data-keyboard-focus")).map(indexOf),
    selectedIndex: cells.filter((cell) => cell.getAttribute("aria-selected") === "true").map(indexOf),
    tabStops: cells.filter((cell) => cell.getAttribute("tabindex") === "0").map(indexOf),
    activeIndex: active && active.getAttribute("role") === "gridcell" ? indexOf(active) : -1,
  };
}"""

SELECTED_VISIBLE_JS = """(args) => {
  const win = document.querySelector(`[data-testid="app-window-${args.appId}"]`);
  if (!win) return { error: "창을 찾지 못했습니다" };
  const grid = win.querySelector('[role="grid"]');
  if (!grid) return { error: "격자를 찾지 못했습니다" };
  const round = (value) => Math.round(value * 100) / 100;
  const cells = [...grid.querySelectorAll('[role="gridcell"]')];
  const chosen = cells.filter((cell) => cell.getAttribute("aria-selected") === "true");
  if (chosen.length !== 1) return { error: `고른 칸이 ${chosen.length}개입니다` };
  const rect = chosen[0].getBoundingClientRect();
  const bounds = grid.getBoundingClientRect();
  const viewRight = bounds.left + grid.clientLeft + grid.clientWidth;
  return {
    index: cells.indexOf(chosen[0]),
    label: chosen[0].getAttribute("aria-label"),
    scrollLeft: round(grid.scrollLeft),
    windowWidth: round(bounds.width),
    viewWidth: round(grid.clientWidth),
    left: round(rect.left - bounds.left),
    right: round(rect.right - bounds.left),
    // 고른 칸의 양 끝이 보이는 영역 안에 있는지만 본다(가장 가까운 쪽으로만 옮기는지 판정).
    visible: rect.left >= bounds.left - 1 && rect.right <= viewRight + 1,
  };
}"""


def toolbar(label):
    return {"type": "toolbar", "start": [{"type": "text", "style": "meta", "value": label}]}


def app_definition(app_id, name, table, state=None):
    definition = {
        "id": app_id,
        "name": name,
        "requires": {"blocks": REQUIRES_BLOCKS},
        "ui": {"type": "stack", "direction": "column", "gap": "none",
               "children": [toolbar(name), table]},
    }
    if state is not None:
        definition["state"] = state
    return definition


def content_rows():
    return [
        {"key": "1", "name": "첫째",
         "info": {"title": "창 관리", "subtitle": "떠 있는 창과 고정 창", "color": "#2f7d4f",
                  "badges": [{"text": "완료"}]},
         "note": {"title": "한 줄 메모"}},
        {"key": "2", "name": "둘째",
         "info": {"title": "메뉴 구성"},
         "note": {"title": "두 줄짜리 칸", "subtitle": "부제가 길면 둘째 줄까지 보인다"}},
        {"key": "3", "name": "셋째",
         "info": {"title": "자료 없음", "muted": True},
         "note": {"title": "목록 묶음", "badges": [{"text": "진행", "color": "#315da8"}, {"text": "검토"}]}},
        {"key": "4", "name": "넷째",
         "info": {"title": "한 줄"},
         "note": {"title": "여러 줄", "subtitle": "본문이 두 줄 넘게 들어가면 줄 수 제한과 말줄임을 함께 확인한다"}},
        {"key": "5", "name": "다섯째",
         "info": {"title": "한 줄"},
         "note": {"title": "다른 한 줄"}},
        {"key": "6", "name": "여섯째",
         "info": {"title": "색 칸 흐림", "color": "#2f7d4f", "muted": True},
         "note": {"title": "한 줄"}},
        {"key": "7", "name": "일곱째",
         "info": {"title": "색 칸 보통", "color": "#2f7d4f"},
         "note": {"title": "한 줄"}},
    ]


def content_columns():
    return [
        {"field": "name", "label": "이름"},
        {"field": "info", "label": "설명", "format": "content", "max_lines": 2},
        {"field": "note", "label": "메모", "format": "content", "max_lines": 2},
    ]


def scenes():
    rows = app_definition(ROWS_APP, "표 검수 · 내용 행",
                          {"type": "table", "columns": content_columns(), "rows": content_rows()})
    text = app_definition(TEXT_APP, "표 검수 · 글 열", {
        "type": "table",
        "columns": [
            {"field": "name", "label": "이름"},
            {"field": "count", "label": "개수", "format": "number", "width": "narrow"},
            {"field": "updated", "label": "고친 때", "format": "date", "width": "medium"},
        ],
        "rows": [
            {"key": "1", "name": "첫째", "count": 12, "updated": "2026-11-01T09:00:00Z"},
            {"key": "2", "name": "둘째", "count": 340, "updated": "2026-11-03T18:20:00Z"},
            {"key": "3", "name": "셋째", "count": 5, "updated": "2026-11-07T11:45:00Z"},
        ],
    })
    grid = app_definition(GRID_APP, "표 검수 · 칸 선택", {
        "type": "table",
        "selection": "cell",
        "row_header": "name",
        "selected": {"state": "cell"},
        "on_select": {"set_state": "cell"},
        "columns": content_columns(),
        "rows": content_rows()[:3],
    }, state={"cell": None})
    # 행 머리 없이 첫 열부터 내용 칸인 격자: 첫 칸 제목과 머리 글자가 같은 선에서 시작하는지 본다.
    grid_edges = app_definition(GRID_EDGE_APP, "표 검수 · 첫 열 내용", {
        "type": "table",
        "selection": "cell",
        "selected": {"state": "cell"},
        "on_select": {"set_state": "cell"},
        "columns": [
            {"field": "info", "label": "설명", "format": "content", "max_lines": 2},
            {"field": "note", "label": "메모", "format": "content", "max_lines": 2},
        ],
        "rows": content_rows()[:3],
    }, state={"cell": None})
    # 오른쪽 열이 좁은 창에서 표 밖으로 밀리는 표: 창 폭이 줄 때 고른 칸이 다시 보이는지 잰다.
    wide_grid = app_definition(GRID_WIDE_APP, "표 검수 · 넓은 표", {
        "type": "table",
        "selection": "cell",
        "selected": {"state": "cell"},
        "on_select": {"set_state": "cell"},
        "columns": [{"field": "name", "label": "이름"}] + [
            {"field": f"c{index}", "label": f"열 {index}", "width": "narrow"} for index in range(1, 10)],
        "rows": [
            {"key": "1", "name": "첫째", **{f"c{index}": f"값 {index}" for index in range(1, 10)}},
            {"key": "2", "name": "둘째", **{f"c{index}": f"값 {index}" for index in range(1, 10)}},
        ],
    }, state={"cell": None})
    return [
        {"app_id": ROWS_APP, "kind": "rows", "definition": rows},
        {"app_id": TEXT_APP, "kind": "text", "definition": text},
        {"app_id": GRID_APP, "kind": "grid", "definition": grid},
        {"app_id": GRID_EDGE_APP, "kind": "grid-edge", "definition": grid_edges},
        {"app_id": GRID_WIDE_APP, "kind": "grid-wide", "definition": wide_grid},
    ]


def load_sandbox():
    common = os.environ.get("AGENT_COMMON_FILES_DIR")
    if not common:
        sys.exit("AGENT_COMMON_FILES_DIR가 없습니다. kaleidoscope-app 스킬이 설치된 노드에서 실행하세요.")
    path = Path(common) / "skills/kaleidoscope-app/scripts/sandbox.py"
    spec = importlib.util.spec_from_file_location("kaleidoscope_sandbox", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def wait_until(fn, seconds, message):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError(message)


def set_rect(sb, window_id, width, height):
    result = sb.core({"op": "window.set_rect", "window_id": window_id,
                      "rect": {"x": 20, "y": 20, "width": width, "height": height}})
    if "error" in result:
        raise AssertionError(result["error"])


def capture(page, output, name, captures):
    path = output / name
    page.screenshot(path=str(path))
    print(f"capture {path}", flush=True)
    captures.append(str(path))
    return str(path)


def within_one(values):
    return all(isinstance(value, (int, float)) for value in values) and max(values) - min(values) <= 1


def scene_verdicts(kind, coordinates):
    rows = coordinates["rows"]
    headers = coordinates["headers"]
    tokens = coordinates.get("tokens") or {}
    verdicts = {
        "text_start_line": within_one(
            [coordinates["toolbarX"], coordinates["headerX"], coordinates["firstCellX"]]),
    }
    titles = rows[0]["titles"] if rows else []
    if kind in ("rows", "grid", "grid-edge"):
        # 내용 칸의 제목은 같은 열의 머리 글자와 같은 시작선에서 시작해야 한다.
        verdicts["content_text_aligned_with_header"] = bool(titles) and all(
            title["cell"] < len(headers) and headers[title["cell"]]["x"] is not None
            and abs(headers[title["cell"]]["x"] - title["x"]) <= 1
            for title in titles)
    boxed = [row for row in rows if len(row["boxes"]) >= 2]
    if kind in ("rows", "grid", "grid-edge") and boxed:
        row = boxed[0]
        verdicts["cell_boxes_aligned"] = (
            within_one([box["top"] for box in row["boxes"]])
            and within_one([box["bottom"] for box in row["boxes"]]))
    if kind in ("grid", "grid-edge"):
        # 고른 링, hover, 초점 점선은 칸 테두리(::after inset:0)를 따라가므로 칸과 상자 경계가 같아야 한다.
        content_cells = [cell for row in rows for cell in row.get("cells", []) if cell["hasContent"]]
        verdicts["content_box_matches_cell"] = bool(content_cells) and all(
            all(abs(cell[key] - cell[box_key]) <= 1 for key, box_key in
                (("left", "boxLeft"), ("right", "boxRight"), ("top", "boxTop"), ("bottom", "boxBottom")))
            for cell in content_cells)
    if kind == "rows":
        badge_free = [row for row in rows if row["boxes"] and not row["hasBadge"]]
        verdicts["no_reserved_badge_slot"] = bool(badge_free) and all(
            abs(row["rowHeight"] - max(box["height"] for box in row["boxes"])
                - row["paddingTop"] - row["paddingBottom"]
                - row["borderTop"] - row["borderBottom"]) <= 1
            for row in badge_free)
        by_key = {row["key"]: row for row in rows}
        muted, normal = by_key.get("3"), by_key.get("2")
        muted_title = muted["titles"][0] if muted and muted["titles"] else None
        normal_title = normal["titles"][0] if normal and normal["titles"] else None
        verdicts["muted_title_deemphasized"] = bool(
            muted_title and normal_title and muted_title["weight"] == "400"
            and muted_title["weight"] != normal_title["weight"]
            and muted_title["color"] != normal_title["color"])
        # 색 칸: muted는 굵기만 낮추고 대비색(--ks-table-on)은 그대로 둔다.
        colored = [cell for row in rows for cell in row.get("cells", []) if cell["hasContent"] and cell.get("hasColor")]
        muted_colored = [cell for cell in colored if cell.get("muted")]
        plain_colored = [cell for cell in colored if not cell.get("muted")]
        muted_pairs = [(muted, plain) for muted in muted_colored for plain in plain_colored
                       if plain["boxBackground"] == muted["boxBackground"]]
        verdicts["muted_color_cell_keeps_contrast"] = bool(muted_pairs) and all(
            muted["titleWeight"] == "400" and muted["titleColor"] == plain["titleColor"]
            for muted, plain in muted_pairs)
        # 색 없는 상자 배지는 쉘 기본(hover 바탕), 색 칸 배지는 지금처럼 surface-solid.
        colorless_badges = [badge for row in rows for cell in row.get("cells", [])
                            if cell["hasContent"] and not cell.get("hasColor") for badge in cell.get("badges", [])]
        verdicts["colorless_box_badge_shell_default"] = bool(colorless_badges) and any(
            badge == tokens.get("hover") and badge != tokens.get("solid") for badge in colorless_badges)
        color_badges = [badge for row in rows for cell in row.get("cells", [])
                        if cell["hasContent"] and cell.get("hasColor") for badge in cell.get("badges", [])]
        verdicts["color_box_badge_solid"] = bool(color_badges) and all(
            badge == tokens.get("solid") for badge in color_badges)
    return verdicts


def edge_right_gap(coordinates):
    width = coordinates.get("windowWidth")
    boxes = [box for row in coordinates["rows"] for box in row.get("boxes", [])]
    if width is None or not boxes:
        return None
    return round(width - max(box["right"] for box in boxes), 2)


def selection_ring_verdict(selection):
    if selection.get("error"):
        return False
    for label in ("first", "last"):
        item = selection.get(label)
        if not item or item.get("error") or not item.get("selected"):
            return False
        if not all(abs(item["cell"][key] - item["box"][key]) <= 1
                   for key in ("left", "right", "top", "bottom")):
            return False
    return True


def measure_selection(page, application, app_id, output, name, result):
    row = application.locator(".ks-grid-row").first
    cells = row.locator(".ks-grid-cell:has(.ks-table-content)")
    count = cells.count()
    if not count:
        return {"error": "내용 칸이 없습니다"}
    selection = {}
    for label, index in (("first", 0), ("last", count - 1)):
        cells.nth(index).click()
        page.wait_for_function(
            """([appId, index]) => {
              const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
              const row = win && win.querySelector(".ks-grid-row");
              const cell = row && [...row.children].filter((child) => child.classList.contains("ks-grid-cell"))[index];
              return cell ? cell.getAttribute("aria-selected") === "true" : false;
            }""", arg=[app_id, index])
        selection[label] = page.evaluate(SELECT_MEASURE_JS, {"appId": app_id, "index": index})
        if label == "last":
            capture(page, output, f"{app_id}-{name}-last-selected.png", result["captures"])
    return selection


def press_and_wait(page, app_id, key, previous):
    # 키를 누른 뒤 고른 칸이 바뀔 때까지 기다린다. 끝 칸에 닿아 안 바뀌면 그대로 돌려 판정에서 걸린다.
    page.keyboard.press(key)
    deadline = time.monotonic() + 10
    state = {}
    while time.monotonic() < deadline:
        state = page.evaluate(KEYBOARD_MEASURE_JS, {"appId": app_id})
        if state.get("error"):
            return state
        if state.get("selectedIndex") and state["selectedIndex"] != previous:
            return state
        time.sleep(0.1)
    return state


def measure_keyboard(page, application, app_id, output, name, result):
    # 방향키가 초점과 선택을 함께 옮기는지, 초점 표시와 Tab 정지점이 고른 칸 하나에만 붙는지 잰다.
    application.locator('[role="gridcell"][tabindex="0"]').first.focus()
    start = page.evaluate(KEYBOARD_MEASURE_JS, {"appId": app_id})
    left = press_and_wait(page, app_id, "ArrowLeft", start.get("selectedIndex"))
    capture(page, output, f"{app_id}-{name}-arrow-selected.png", result["captures"])
    down = press_and_wait(page, app_id, "ArrowDown", left.get("selectedIndex"))
    return {"start": start, "left": left, "down": down}


def keyboard_verdicts(keyboard):
    if keyboard.get("error"):
        return {"keyboard_state": False}
    start = keyboard.get("start") or {}
    left = keyboard.get("left") or {}
    down = keyboard.get("down") or {}

    def together(state, ring=True):
        selected = state.get("selectedIndex") or []
        return (len(selected) == 1 and state.get("activeIndex") == selected[0]
                and (not ring or state.get("focusedIndex") == selected))

    return {
        # 누른 칸에 초점이 남고(ui-design 0절 14번), 방향키 뒤에도 초점 표시가 고른 칸 하나뿐이다.
        # 누름 뒤에는 키보드 점선을 그리지 않으므로(마우스 :focus-visible) 고른 칸과 초점만 본다.
        "clicked_cell_keeps_focus": together(start, ring=False),
        "arrow_moves_focus_and_selection": together(left) and together(down)
        and start.get("selectedIndex") != left.get("selectedIndex")
        and left.get("selectedIndex") != down.get("selectedIndex"),
        # Tab 정지점은 격자 안에서 고른 칸 하나다.
        "single_tab_stop": bool(down.get("tabStops")) and down.get("tabStops") == down.get("selectedIndex"),
    }


def measure_resize(page, sb, application, app_id, window_id, output, result):
    # 넓은 창에서 오른쪽 끝 칸을 고른 뒤 표 폭을 줄여, 스크롤이 그 칸을 다시 보이게 하는지 잰다.
    set_rect(sb, window_id, *WIDE)
    page.wait_for_timeout(600)
    cells = application.locator(".ks-grid-row").first.locator('[role="gridcell"]')
    index = cells.count() - 1
    if index < 0:
        return {"error": "격자 칸이 없습니다"}
    cells.nth(index).click()
    page.wait_for_function(
        """([appId, index]) => {
          const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
          const row = win && win.querySelector(".ks-grid-row");
          const cell = row && [...row.querySelectorAll('[role="gridcell"]')][index];
          return cell ? cell.getAttribute("aria-selected") === "true" : false;
        }""", arg=[app_id, index])
    before = page.evaluate(SELECTED_VISIBLE_JS, {"appId": app_id})
    set_rect(sb, window_id, *NARROW)
    page.wait_for_timeout(1000)
    after = page.evaluate(SELECTED_VISIBLE_JS, {"appId": app_id})
    capture(page, output, f"{app_id}-narrow-after-shrink.png", result["captures"])
    return {
        "before": before,
        "after": after,
        "verdicts": {
            "chosen_cell_visible_before_shrink": bool(before.get("visible")),
            # 폭이 줄어 밖으로 밀린 뒤에는 스크롤이 움직여 그 칸이 다시 보여야 한다.
            "chosen_cell_visible_after_shrink": bool(after.get("visible")) and (after.get("scrollLeft") or 0) > 0,
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "target/visual-check/table")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    sandbox = load_sandbox()
    warm = sandbox.warm_file
    sandbox.warm_file = lambda path: warm(path) if Path(path).exists() else None
    address, ui_lock = sandbox.acquire_ui_address()
    result = {"windows": {"wide": list(WIDE), "narrow": list(NARROW)}, "scenes": {}, "captures": [], "failures": []}
    with ui_lock, tempfile.TemporaryDirectory(prefix="ks-table-visual-") as directory:
        sb = sandbox.Sandbox(ROOT, output, Path(directory) / "folder", address)
        spawn = sb._spawn

        def local_spawn(name, command, **env):
            if name in ("server", "bridge"):
                command[0] = str(ROOT / "target/debug" / Path(command[0]).name)
            return spawn(name, command, **env)

        sb._spawn = local_spawn
        browser = None
        try:
            sb.start()
            with sync_playwright() as playwright:
                browser = sb.open_page(playwright, (1440, 900))
                page = sb.page
                for scene in scenes():
                    report = sb.upload_and_open(scene["definition"])
                    if not report.get("upload_ok") or not report.get("window_id"):
                        raise AssertionError(f"앱을 열지 못했습니다: {report}")
                    app_id = scene["app_id"]
                    application = sb.window(app_id)
                    application.wait_for(state="visible", timeout=60000)
                    application.locator(".ks-table-header").first.wait_for(state="visible", timeout=20000)
                    window_id = report["window_id"]
                    entry = {"kind": scene["kind"], "widths": {}}
                    for name, size in (("wide", WIDE), ("narrow", NARROW)):
                        set_rect(sb, window_id, *size)
                        page.wait_for_timeout(600)
                        coordinates = page.evaluate(MEASURE_JS, {"appId": app_id})
                        if "error" in coordinates:
                            raise AssertionError(coordinates["error"])
                        verdicts = scene_verdicts(scene["kind"], coordinates)
                        capture(page, output, f"{app_id}-{name}.png", result["captures"])
                        selection = {}
                        keyboard = {}
                        if scene["kind"] in ("grid", "grid-edge"):
                            selection = measure_selection(page, application, app_id, output, name, result)
                            verdicts["selected_ring_matches_box"] = selection_ring_verdict(selection)
                            keyboard = measure_keyboard(page, application, app_id, output, name, result)
                            verdicts.update(keyboard_verdicts(keyboard))
                        entry["widths"][name] = {
                            "coordinates": coordinates,
                            "edgeRightGap": edge_right_gap(coordinates),
                            "selection": selection,
                            "keyboard": keyboard,
                            "verdicts": verdicts,
                        }
                        for verdict, passed in verdicts.items():
                            if not passed:
                                result["failures"].append(f"{app_id}/{name}: {verdict}")
                    if scene["kind"] == "grid-wide":
                        entry["resize"] = measure_resize(page, sb, application, app_id, window_id, output, result)
                        for verdict, passed in entry["resize"].get("verdicts", {}).items():
                            if not passed:
                                result["failures"].append(f"{app_id}/resize: {verdict}")
                        if entry["resize"].get("error"):
                            result["failures"].append(f"{app_id}/resize: {entry['resize']['error']}")
                    result["scenes"][app_id] = entry
                    closed = sb.core({"op": "window.close", "window_id": window_id})
                    if "error" in closed:
                        raise AssertionError(closed["error"])
                    wait_until(lambda: not sb.window_of(app_id), 10, f"{app_id} 창이 닫히지 않았습니다")
                # 격자 마지막 상자의 오른쪽 끝은 줄 표와 같은 거리에서 끝난다.
                for name in ("wide", "narrow"):
                    base = result["scenes"].get(ROWS_APP, {}).get("widths", {}).get(name, {}).get("edgeRightGap")
                    for app_id in (GRID_APP, GRID_EDGE_APP):
                        target = result["scenes"].get(app_id, {}).get("widths", {}).get(name)
                        if target is None:
                            continue
                        gap = target.get("edgeRightGap")
                        passed = base is not None and gap is not None and abs(base - gap) <= 1
                        target["verdicts"]["right_edge_matches_rows"] = passed
                        if not passed:
                            result["failures"].append(f"{app_id}/{name}: right_edge_matches_rows")
                console = list(sb.console)
                result["console"] = console[-10:]
        finally:
            if browser is not None:
                try:
                    browser.close()
                except Exception:  # noqa: BLE001 - 이미 닫힌 화면은 정리만 건너뛴다
                    pass
            sb.stop()

    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["failures"]:
        print(f"판정 실패 {len(result['failures'])}건", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
