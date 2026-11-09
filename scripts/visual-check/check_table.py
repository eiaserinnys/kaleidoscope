#!/usr/bin/env python3
"""표의 칸 상자와 글자 시작선을 화면에서 확인한다.

툴바 글자, 표 머리 글자, 첫 칸 글자가 같은 세로 시작선에서 시작하는지, 내용 칸 상자의
위아래가 한 행에서 맞는지, 배지가 없는 행에 배지 자리가 남지 않는지, muted 칸의 제목이
덜 띄게 보이는지를 넓은 창과 좁은 창에서 재고 캡처한다.

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
  const toolbar = win.querySelector(".ks-data-toolbar .ks-data-text");
  const headers = [...win.querySelectorAll('.ks-table-header > [role="columnheader"]')].map((header) => ({
    x: glyphX(header.querySelector("button") ?? header),
  }));
  const rows = [...win.querySelectorAll(".ks-row.ks-table-row")].map((row) => {
    const boxes = [];
    const titles = [];
    [...row.children].forEach((cell, index) => {
      if (!cell.classList.contains("ks-table-cell")) return;
      const box = cell.querySelector(".ks-table-content");
      if (!box) return;
      const rect = box.getBoundingClientRect();
      boxes.push({ cell: index, top: relY(rect.top), bottom: relY(rect.bottom), height: round(rect.height) });
      const title = box.querySelector(".ks-table-content-title");
      if (!title) return;
      const style = getComputedStyle(title);
      titles.push({ cell: index, x: glyphX(title), weight: style.fontWeight, color: style.color });
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
      hasBadge: Boolean(row.querySelector(".ks-badge")),
    };
  });
  return {
    toolbarX: glyphX(toolbar),
    headerX: headers.length ? headers[0].x : null,
    firstCellX: rows.length ? rows[0].glyphX : null,
    headers,
    rows,
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
    return [
        {"app_id": ROWS_APP, "kind": "rows", "definition": rows},
        {"app_id": TEXT_APP, "kind": "text", "definition": text},
        {"app_id": GRID_APP, "kind": "grid", "definition": grid},
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
    verdicts = {
        "text_start_line": within_one(
            [coordinates["toolbarX"], coordinates["headerX"], coordinates["firstCellX"]]),
    }
    titles = rows[0]["titles"] if rows else []
    if kind in ("rows", "grid"):
        # 내용 칸의 제목은 같은 열의 머리 글자와 같은 시작선에서 시작해야 한다.
        verdicts["content_text_aligned_with_header"] = bool(titles) and all(
            title["cell"] < len(headers) and headers[title["cell"]]["x"] is not None
            and abs(headers[title["cell"]]["x"] - title["x"]) <= 1
            for title in titles)
    boxed = [row for row in rows if len(row["boxes"]) >= 2]
    if kind in ("rows", "grid") and boxed:
        row = boxed[0]
        verdicts["cell_boxes_aligned"] = (
            within_one([box["top"] for box in row["boxes"]])
            and within_one([box["bottom"] for box in row["boxes"]]))
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
    return verdicts


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
                        entry["widths"][name] = {"coordinates": coordinates, "verdicts": verdicts}
                        capture(page, output, f"{app_id}-{name}.png", result["captures"])
                        for verdict, passed in verdicts.items():
                            if not passed:
                                result["failures"].append(f"{app_id}/{name}: {verdict}")
                    result["scenes"][app_id] = entry
                    closed = sb.core({"op": "window.close", "window_id": window_id})
                    if "error" in closed:
                        raise AssertionError(closed["error"])
                    wait_until(lambda: not sb.window_of(app_id), 10, f"{app_id} 창이 닫히지 않았습니다")
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
