#!/usr/bin/env python3
"""카드 #1137 마크다운 표 칸의 낱말 단위 줄바꿈을 실측한다.

한 칸에 공백 없는 긴 맨 주소가 든 3열 표를 마크다운 편집기(?preview=md-editor)와
마크다운 보기 블록(?preview=storage-document의 문서)에 띄우고 네 가지를 잰다.

- 1180×720에서 주소 칸이 아닌 짧은 낱말 칸(「항목」「상태」「공지」「열림」「문서」「닫힘」)의
  글이 한 줄이다(칸 안 글의 줄 상자 수 1). 편집기와 마크다운 보기 둘 다.
- 1180×720과 360×240 모두에서 .cm-scroller와 .ks-markdown-text에 가로 넘침이 없다
  (scrollWidth <= clientWidth).
- 편집기의 맨 주소는 .ks-live-url span으로, 마크다운 보기의 맨 주소는 <a>로 그려진다
  (설계의 :has 선택자가 주소 칸을 집는 근거).
- 불변 장면: 내 폴더의 Kaleidoscope.md와 Create-plugins-preview.md 표를 같은 두 크기에서
  캡처해 표 폭과 scroller를 기준 폴더(result.json)와 대조한다. --baseline을 주지 않으면
  기록만 한다.

요소를 찾지 못하면 그 장면은 실패다. 찾지 못한 채 통과하는 판정을 두지 않는다.

  python3 scripts/visual-check/check_table_word_wrap.py [--output 산출폴더] [--port 포트] [--baseline 기준폴더]

기본 산출 폴더는 target/visual-check/table-word-wrap-1137이고, 서버는 이 체크아웃의
ui/harness/e2e-server.mjs를 KS_E2E_PORT로 띄운다. 실패가 하나라도 있으면 result.json과
캡처를 남긴 뒤 종료 코드 1로 끝난다.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"
SIZES = ((1180, 720), (360, 240))
TOLERANCE = 1.0

WIDE_URL = "https://example.org/very/long/path/segments/that/keeps/going/and/going/abcdefghijklmnopqrstuvwxyz"
WIDE_TABLE_DOCUMENT = f"""# 긴 주소가 든 표

| 항목 | 주소 | 상태 |
|---|---|---|
| 공지 | {WIDE_URL} | 열림 |
| 문서 | https://example.org/short | 닫힘 |
"""

MD_MEASURE_JS = """() => {
  const app = document.querySelector('[data-testid=app-window-md-editor]');
  if (!app) return { error: '마크다운 편집기 창을 찾지 못했습니다' };
  const scroller = app.querySelector('.cm-scroller');
  const table = app.querySelector('.ks-live-table');
  if (!scroller) return { error: '편집기 스크롤 영역을 찾지 못했습니다' };
  if (!table) return { error: '편집기의 표를 찾지 못했습니다', scroller: { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth } };
  const round = (value) => Math.round(value * 100) / 100;
  // 칸 안 글의 줄 상자 수. 서로 다른 줄의 위 끝이 몇 개인지 센다.
  const lineCount = (cell) => {
    const range = document.createRange();
    range.selectNodeContents(cell);
    const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
    return tops.size;
  };
  const cells = [...table.querySelectorAll('th, td')].map((cell) => ({
    text: cell.textContent,
    lines: lineCount(cell),
    width: round(cell.getBoundingClientRect().width),
    urlSpan: Boolean(cell.querySelector('.ks-live-url')),
  }));
  const tableRect = table.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  return {
    scroller: { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth },
    table: { width: round(tableRect.width), overflowRight: round(tableRect.right - (scrollerRect.left + scroller.clientWidth)) },
    cells,
  };
}"""

MD_TABLES_JS = """() => {
  const app = document.querySelector('[data-testid=app-window-md-editor]');
  if (!app) return { error: '마크다운 편집기 창을 찾지 못했습니다' };
  const scroller = app.querySelector('.cm-scroller');
  if (!scroller) return { error: '편집기 스크롤 영역을 찾지 못했습니다' };
  const round = (value) => Math.round(value * 100) / 100;
  const tables = [...app.querySelectorAll('.ks-live-table')].map((table) => {
    const rows = [...table.querySelectorAll('tr')];
    return {
      width: round(table.getBoundingClientRect().width),
      columns: rows.length ? [...rows[0].children].map((cell) => round(cell.getBoundingClientRect().width)) : [],
      rows: rows.length,
    };
  });
  return { tables, scroller: { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth } };
}"""

VIEW_MEASURE_JS = """() => {
  const app = document.querySelector('[data-testid=app-window-storage-document]');
  if (!app) return { error: '저장소 문서 창을 찾지 못했습니다' };
  const root = app.querySelector('.ks-markdown-text');
  if (!root) return { error: '마크다운 보기 글 상자를 찾지 못했습니다' };
  const table = root.querySelector('table');
  if (!table) return { error: '마크다운 보기 표를 찾지 못했습니다', text: root.textContent.slice(0, 200) };
  const round = (value) => Math.round(value * 100) / 100;
  const lineCount = (cell) => {
    const range = document.createRange();
    range.selectNodeContents(cell);
    const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
    return tops.size;
  };
  const cells = [...table.querySelectorAll('th, td')].map((cell) => ({
    text: cell.textContent,
    lines: lineCount(cell),
    width: round(cell.getBoundingClientRect().width),
    anchors: cell.querySelectorAll('a').length,
    codes: cell.querySelectorAll('code').length,
  }));
  const tableRect = table.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  return {
    table: { width: round(tableRect.width), overflowRight: round(tableRect.right - rootRect.right) },
    root: { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth },
    urlAnchors: cells.filter((cell) => cell.anchors > 0).length,
    cells,
  };
}"""


def wait_server(port):
    deadline = time.time() + 240
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}", timeout=5)
            return
        except Exception:
            time.sleep(2)
    raise SystemExit("하네스 서버가 뜨지 않았습니다")


def open_document(page, port, name, width, height, text=None):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{port}/?preview=md-editor")
    page.wait_for_function(
        "() => window.__ksHarness && document.querySelector('[data-testid=app-window-md-editor]')",
        timeout=120000,
    )
    page.evaluate(
        """async ({ file, text }) => {
          const harness = window.__ksHarness;
          await harness.call({ op: 'files.pick_folder', window_id: 'editor-window', permission: 'docs' });
          if (text !== null) await harness.call({ op: 'files.write', window_id: 'editor-window', permission: 'docs', path: file, text });
          const { snapshot } = await harness.call({ op: 'state.get' });
          const win = snapshot.shared.windows.find((w) => w.app_id === 'md-editor');
          win.state = { ...win.state, source: 1, current_file: file };
          harness.emit({ event: 'state.changed', snapshot });
        }""",
        {"file": name, "text": text},
    )
    page.wait_for_function("() => document.querySelector('[data-testid=app-window-md-editor] .cm-content')", timeout=120000)
    page.add_style_tag(content=STYLE)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(400)


def open_view_document(page, port, text, width, height):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{port}/?preview=storage-document")
    page.wait_for_function(
        "() => window.__ksHarness && document.querySelector('[data-testid=app-window-storage-document]')",
        timeout=120000,
    )
    page.evaluate(
        """async (text) => {
          const harness = window.__ksHarness;
          const got = await harness.call({ op: 'storage.get', window_id: 'storage-window', entry: 'memo' });
          await harness.call({ op: 'storage.write', window_id: 'storage-window', entry: 'memo', content: text, expected_revision: got.result.revision });
        }""",
        text,
    )
    page.add_style_tag(content=STYLE)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(400)


def scan_tables(page):
    """편집기를 끝까지 내리며 만난 표를 모아 칸 폭을 기록한다."""
    page.evaluate("() => { const scroller = document.querySelector('[data-testid=app-window-md-editor] .cm-scroller'); if (scroller) scroller.scrollTop = 0; }")
    page.wait_for_timeout(200)
    seen = []
    for _ in range(120):
        measurement = page.evaluate(MD_TABLES_JS)
        if measurement.get("error"):
            return measurement
        seen.append(measurement)
        at_end = page.evaluate(
            "() => { const scroller = document.querySelector('[data-testid=app-window-md-editor] .cm-scroller');"
            " if (!scroller) return true; const before = scroller.scrollTop; scroller.scrollTop = before + 160;"
            " return scroller.scrollTop === before; }"
        )
        if at_end:
            break
        page.wait_for_timeout(120)
    final = page.evaluate(MD_TABLES_JS)
    if not final.get("error"):
        seen.append(final)
    tables = []
    for item in seen:
        for table in item.get("tables", []):
            if table not in tables:
                tables.append(table)
    return {"tables": tables, "scroller": final.get("scroller")}


def judge_document(measurement, width):
    if measurement.get("error"):
        return {"element_present": False}
    cells = measurement.get("cells", [])
    short_cells = [cell for cell in cells if cell["text"] and not cell["text"].startswith("http")]
    url_cells = [cell for cell in cells if cell["urlSpan"]]
    checks = {
        "element_present": True,
        "url_span_present": len(url_cells) == 2,
        "short_cells_present": len(short_cells) >= 6,
        "scroller_no_overflow": measurement["scroller"]["scrollWidth"] <= measurement["scroller"]["clientWidth"],
    }
    if width == 1180:
        checks["short_cells_one_line"] = bool(short_cells) and all(cell["lines"] == 1 for cell in short_cells)
    return checks


def judge_view(measurement, width):
    if measurement.get("error"):
        return {"element_present": False}
    cells = measurement.get("cells", [])
    short_cells = [cell for cell in cells if cell["text"] and not cell["text"].startswith("http")]
    checks = {
        "element_present": True,
        "url_anchors_present": measurement.get("urlAnchors", 0) >= 1,
        "short_cells_present": len(short_cells) >= 6,
        "root_no_overflow": measurement["root"]["scrollWidth"] <= measurement["root"]["clientWidth"],
    }
    if width == 1180:
        checks["short_cells_one_line"] = bool(short_cells) and all(cell["lines"] == 1 for cell in short_cells)
    return checks


def compare_invariant(measurement, baseline):
    """불변 장면의 표 폭·행/칸 수·scroller가 기준 폴더와 같은지 본다.

    칸 폭은 재지 않는다. 주소나 코드가 든 칸의 내용 폭을 20em으로 제한하는 것이 이번 설계라,
    그런 칸이 있는 표는 칸 사이 폭 배분이 바뀌는 것이 정상이다.
    """
    if measurement.get("error"):
        return {"matches_baseline": False}, "요소를 찾지 못함"
    base = baseline.get("measurement", {})
    if base.get("error"):
        return {"matches_baseline": False}, "기준 폴더에 측정값이 없음"
    problems = []
    before_tables = base.get("tables", [])
    tables = measurement.get("tables", [])
    if len(tables) != len(before_tables):
        problems.append(f"표 수 {len(tables)} != {len(before_tables)}")
    for index, (table, before) in enumerate(zip(tables, before_tables)):
        if table.get("rows") != before.get("rows"):
            problems.append(f"표 {index} 행 수 {table.get('rows')} != {before.get('rows')}")
        if len(table.get("columns", [])) != len(before.get("columns", [])):
            problems.append(f"표 {index} 칸 수 {len(table.get('columns', []))} != {len(before.get('columns', []))}")
        if abs(table.get("width", 0) - before.get("width", 0)) > TOLERANCE:
            problems.append(f"표 {index} 폭 {table.get('width')} != {before.get('width')}")
    before_scroller = base.get("scroller") or {}
    scroller = measurement.get("scroller") or {}
    for key in ("scrollWidth", "clientWidth"):
        if abs(scroller.get(key, 0) - before_scroller.get(key, 0)) > TOLERANCE:
            problems.append(f"scroller {key} {scroller.get(key)} != {before_scroller.get(key)}")
    return {"matches_baseline": not problems}, "; ".join(problems)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="target/visual-check/table-word-wrap-1137")
    parser.add_argument("--port", type=int, default=5395)
    parser.add_argument("--baseline", help="수정 전 result.json이 있는 폴더. 주면 불변 장면을 대조한다")
    args = parser.parse_args()

    baseline = None
    if args.baseline:
        baseline_path = Path(args.baseline) / "result.json"
        baseline = json.loads(baseline_path.read_text())["scenes"]

    output = Path(args.output)
    if not output.is_absolute():
        output = ROOT / output
    output.mkdir(parents=True, exist_ok=True)

    server = subprocess.Popen(
        ["node", "./harness/e2e-server.mjs"],
        cwd=ROOT / "ui",
        env={**os.environ, "KS_E2E_PORT": str(args.port)},
        stdin=subprocess.PIPE,
        stdout=open(output / "server.log", "w"),
        stderr=subprocess.STDOUT,
    )
    scenes = {}
    failures = []
    try:
        wait_server(args.port)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(ignore_default_args=["--hide-scrollbars"])
            page = browser.new_page()
            for width, height in SIZES:
                # 긴 주소가 든 표. 짧은 낱말 칸의 줄 수와 편집기 가로 넘침을 판정한다.
                open_document(page, args.port, "wide-table.md", width, height, WIDE_TABLE_DOCUMENT)
                page.locator(".ks-live-table").first.wait_for(state="visible", timeout=30000)
                key = f"wide-url-{width}x{height}"
                measurement = page.evaluate(MD_MEASURE_JS)
                checks = judge_document(measurement, width)
                page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                scenes[key] = {"measurement": measurement, "checks": checks}
                failed = [check for check, ok in checks.items() if not ok]
                failures.extend(f"{key}.{check}" for check in failed)
                print(key, "FAIL " + ",".join(failed) if failed else "ok")

                # 마크다운 보기의 같은 표. 줄 수와 넘침을 기록한다.
                open_view_document(page, args.port, WIDE_TABLE_DOCUMENT, width, height)
                page.locator(".ks-markdown-text table").first.wait_for(state="visible", timeout=30000)
                view_key = f"wide-url-view-{width}x{height}"
                view = page.evaluate(VIEW_MEASURE_JS)
                view_checks = judge_view(view, width)
                page.screenshot(path=str(output / f"{view_key}.png"), animations="disabled")
                scenes[view_key] = {"measurement": view, "checks": view_checks}
                failed = [check for check, ok in view_checks.items() if not ok]
                failures.extend(f"{view_key}.{check}" for check in failed)
                print(view_key, "FAIL " + ",".join(failed) if failed else "ok",
                      {cell["text"][:20]: (cell["lines"], cell.get("anchors")) for cell in view.get("cells", [])})

            # 불변: 기본 문서의 표. 기준 폴더가 있으면 표 폭과 scroller가 같은지 대조한다.
            for name in ("Kaleidoscope.md", "Create-plugins-preview.md"):
                for width, height in SIZES:
                    open_document(page, args.port, name, width, height)
                    key = f"md-table-{name.replace('.md', '')}-{width}x{height}"
                    measurement = scan_tables(page)
                    checks = {"table_present": not measurement.get("error") and bool(measurement.get("tables"))}
                    detail = ""
                    if baseline is not None:
                        base_scene = baseline.get(key)
                        if base_scene is None:
                            checks["matches_baseline"] = False
                            detail = "기준 폴더에 장면 없음"
                        else:
                            extra, detail = compare_invariant(measurement, base_scene)
                            checks.update(extra)
                    page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                    scenes[key] = {"measurement": measurement, "checks": checks}
                    failed = [check for check, ok in checks.items() if not ok]
                    failures.extend(f"{key}.{check}" for check in failed)
                    if failed:
                        print(key, "FAIL " + ",".join(failed), detail)
                    else:
                        print(key, "ok", measurement["tables"], detail)
            browser.close()
    finally:
        server.stdin.close()
        try:
            server.wait(timeout=20)
        except subprocess.TimeoutExpired:
            server.kill()

    result = {"ok": not failures, "failures": failures, "scenes": scenes}
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print("RESULT", "ok" if not failures else f"{len(failures)} failures", output / "result.json")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
