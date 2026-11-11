#!/usr/bin/env python3
"""카드 #1137 마크다운 표 칸의 낱말 단위 줄바꿈을 실측한다.

표를 여러 장면으로 띄운다. 긴 주소가 든 표, 링크도 코드도 없는 긴 문장 칸 표,
링크가 든 설명 칸 표, 코드 표, 긴 영어 낱말 4열 표, 맨 40자 SHA 표, 그리고 기본 문서
Kaleidoscope.md와 Create-plugins-preview.md의 표다. 앞의 여섯은 마크다운 편집기
(?preview=md-editor)와 저장소 문서의 보기(?preview=storage-document) 두 화면에서,
기본 문서 둘은 편집기에서 잰다. 크기는 1180×720, 960×640, 800×600, 360×240이다.

장면마다 표 높이와 칸별 폭·줄 수, is-tight 여부, 가로 넘침을 result.json에 남긴다.
1180×720에서 긴 주소 표와 긴 문장 칸 표의 짧은 칸은 한 줄이어야 하고, 360×240에서
긴 영어 낱말 표와 맨 SHA 표는 is-tight로 물러서 넘치지 않아야 한다. 편집기의 맨 주소는
.ks-live-link span으로 그려져야 한다. 기본 문서 장면은 360×240에서 편집기 가로 넘침과
표 오른쪽 넘침도 판정하고, 칸이 가장 많은 표를 화면에 올린 {장면}-widest-table.png를
한 장 더 찍어 장면에 그 경로를 남긴다(카드 #1170).

--baseline에 수정 전 result.json이 있는 폴더를 주면 장면마다 기준과 대조한다. 표 수나 칸 수가
다르거나 기준에 없던 넘침이 생기면 실패로 적는다. 표 높이가 1px 넘게 늘거나 어느 칸의 줄 수가
는 것은 실패가 아니라 변화로 출력하고 result.json의 장면 changes에 남긴다. 짧은 칸이 낱말 폭을
받으면 표 자동 배치가 긴 칸의 폭을 조금 가져가 긴 칸이 한 줄 늘 수 있고, 2차 화면 검수가 이를
main과 나란히 보고 받아들였다(카드 #1137). 칸 폭 차이는 모두 출력한다.

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
SIZES = ((1180, 720), (960, 640), (800, 600), (360, 240))
TOLERANCE = 1.0

URL = "https://example.org/very/long/path/segments/that/keeps/going/and/going/abcdefghijklmnopqrstuvwxyz"
SHA = "32cd90b8e06a3591092003c29cf3a0280464f39a"
WIDE_TABLE_DOCUMENT = f"""# 긴 주소가 든 표

| 항목 | 주소 | 상태 |
|---|---|---|
| 공지 | {URL} | 열림 |
| 문서 | https://example.org/short | 닫힘 |
"""
PROSE_DOCUMENT = """# 긴 문장 칸만 있는 표

| 항목 | 설명 | 상태 |
|---|---|---|
| 공지 | 이 칸은 링크도 코드도 없이 아주 길게 이어지는 설명 문장으로, 창이 넓어도 한 줄에 다 들어가지 않을 만큼 길게 써서 다른 칸의 폭을 얼마나 가져가는지 봅니다 | 열림 |
| 문서 | 짧은 설명 | 닫힘 |
"""
LINK_PROSE_DOCUMENT = """# 링크가 든 설명 칸

| 이름 | 설명 | 비고 |
|---|---|---|
| 첫째 | 이 칸은 [안내 문서](https://example.org/guide)를 따라 설정을 바꾸고 창을 다시 열어 바뀐 값을 확인하는 긴 설명입니다 | 이 칸은 링크 없이 비슷한 길이로 이어지는 설명 문장이며 창 폭에 맞춰 줄바꿈됩니다 |
| 둘째 | 짧은 설명 | 없음 |
"""
CODE_DOCUMENT = """# 코드가 든 표

Agent B supports two ways to add custom skills, agents, and hooks:

| Approach | Skill names | Best for |
| :--- | :--- | :--- |
| **Standalone** (`.agent/` directory) | `/hello` | Personal workflows, project-specific customizations, quick experiments |
| **Plugins** (directories with a `.agent-plugin/plugin.json`) | `/plugin-name:hello` | Sharing with teammates, distributing to community, versioned releases, reusable across projects |
"""
EN_WORDS_DOCUMENT = """| Configuration | Responsibilities | Implementation | Documentation |
|---|---|---|---|
| Initialization | Synchronization | Internationalization | Troubleshooting |
"""
PLAIN_SHA_DOCUMENT = f"""| PR | 커밋 | 상태 |
|---|---|---|
| 544 | {SHA} | 머지 |
"""
DOCUMENTS = {
    "wide-url": (WIDE_TABLE_DOCUMENT, "긴 주소가 든 표"),
    "prose-only": (PROSE_DOCUMENT, "긴 문장 칸만 있는 표"),
    "link-prose": (LINK_PROSE_DOCUMENT, "링크가 든 설명 칸"),
    "code": (CODE_DOCUMENT, "코드가 든 표"),
    "en-words": (EN_WORDS_DOCUMENT, "Configuration"),
    "plain-sha": (PLAIN_SHA_DOCUMENT, "커밋"),
}
INVARIANT_DOCUMENTS = {
    "Kaleidoscope": ("Kaleidoscope.md", "kaleidoscope 작업 메모"),
    "Create-plugins-preview": ("Create-plugins-preview.md", "Create plugins"),
}

EDITOR_TABLES_JS = """() => {
  const app = document.querySelector('[data-testid=app-window-md-editor]');
  if (!app) return { error: '마크다운 편집기 창을 찾지 못했습니다' };
  const scroller = app.querySelector('.cm-scroller');
  if (!scroller) return { error: '편집기 스크롤 영역을 찾지 못했습니다' };
  const round = (value) => Math.round(value * 10) / 10;
  const lineCount = (cell) => {
    const range = document.createRange();
    range.selectNodeContents(cell);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  };
  const scrollerRect = scroller.getBoundingClientRect();
  const origin = scrollerRect.top - scroller.scrollTop;
  return {
    container: { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth },
    tables: [...app.querySelectorAll('.ks-live-table')].map((table) => {
      const rect = table.getBoundingClientRect();
      return {
        offset: Math.round(rect.top - origin),
        width: round(rect.width),
        height: round(rect.height),
        overflowRight: round(rect.right - (scrollerRect.left + scroller.clientWidth)),
        isTight: table.parentElement?.classList.contains('is-tight') ?? false,
        wrapped: table.parentElement?.classList.contains('ks-table-fit') ?? false,
        cells: [...table.querySelectorAll('th, td')].map((cell) => ({
          text: (cell.textContent || '').slice(0, 40),
          lines: lineCount(cell),
          width: round(cell.getBoundingClientRect().width),
          links: cell.querySelectorAll('.ks-live-link').length,
          anchors: cell.querySelectorAll('a').length,
          codes: cell.querySelectorAll('code').length,
        })),
      };
    }),
  };
}"""

VIEW_TABLES_JS = """() => {
  const app = document.querySelector('[data-testid=app-window-storage-document]');
  if (!app) return { error: '저장소 문서 창을 찾지 못했습니다' };
  const root = app.querySelector('.ks-markdown-text');
  if (!root) return { error: '마크다운 보기 글 상자를 찾지 못했습니다' };
  const round = (value) => Math.round(value * 10) / 10;
  const lineCount = (cell) => {
    const range = document.createRange();
    range.selectNodeContents(cell);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  };
  const rootRect = root.getBoundingClientRect();
  return {
    container: { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth },
    tables: [...root.querySelectorAll('table')].map((table) => {
      const rect = table.getBoundingClientRect();
      return {
        width: round(rect.width),
        height: round(rect.height),
        overflowRight: round(rect.right - (rootRect.left + root.clientWidth)),
        isTight: table.parentElement?.classList.contains('is-tight') ?? false,
        wrapped: table.parentElement?.classList.contains('ks-table-fit') ?? false,
        cells: [...table.querySelectorAll('th, td')].map((cell) => ({
          text: (cell.textContent || '').slice(0, 40),
          lines: lineCount(cell),
          width: round(cell.getBoundingClientRect().width),
          links: cell.querySelectorAll('.ks-live-link').length,
          anchors: cell.querySelectorAll('a').length,
          codes: cell.querySelectorAll('code').length,
        })),
      };
    }),
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


def open_document(page, port, name, width, height, text=None, marker=None):
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
    if marker is not None:
        page.wait_for_function(
            "(marker) => (document.querySelector('[data-testid=app-window-md-editor] .cm-content')?.textContent || '').includes(marker)",
            arg=marker,
            timeout=120000,
        )
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


def scan_editor_tables(page):
    """편집기를 끝까지 내리며 만난 표를 문서 위치 순서로 모은다."""
    page.evaluate("() => { const scroller = document.querySelector('[data-testid=app-window-md-editor] .cm-scroller'); if (scroller) scroller.scrollTop = 0; }")
    page.wait_for_timeout(200)
    collected = {}
    container = None
    for _ in range(200):
        measurement = page.evaluate(EDITOR_TABLES_JS)
        if measurement.get("error"):
            return measurement
        container = measurement["container"]
        for table in measurement["tables"]:
            collected.setdefault(table["offset"], table)
        at_end = page.evaluate(
            "() => { const scroller = document.querySelector('[data-testid=app-window-md-editor] .cm-scroller');"
            " if (!scroller) return true; const before = scroller.scrollTop; scroller.scrollTop = before + 160;"
            " return scroller.scrollTop === before; }"
        )
        if at_end:
            break
        page.wait_for_timeout(120)
    return {"container": container, "tables": [collected[offset] for offset in sorted(collected)]}


def is_short(cell):
    text = (cell.get("text") or "").strip()
    return bool(text) and len(text) <= 10 and not text.startswith("http")


def judge_scene(scene, name, kind, width):
    checks = {"element_present": bool(scene.get("tables"))}
    if not checks["element_present"]:
        return checks
    checks["container_no_overflow"] = scene["container"]["scrollWidth"] <= scene["container"]["clientWidth"]
    checks["table_no_overflow"] = all(table["overflowRight"] <= TOLERANCE for table in scene["tables"])
    cells = [cell for table in scene["tables"] for cell in table["cells"]]
    if width == 1180 and name in ("wide-url", "prose-only"):
        short_cells = [cell for cell in cells if is_short(cell)]
        checks["short_cells_present"] = len(short_cells) >= 6
        checks["short_cells_one_line"] = bool(short_cells) and all(cell["lines"] == 1 for cell in short_cells)
    if name == "wide-url":
        if kind == "editor":
            checks["bare_urls_are_links"] = sum(cell["links"] > 0 for cell in cells) == 2
        else:
            checks["bare_urls_are_links"] = any(cell["anchors"] > 0 for cell in cells)
    if width == 360 and name in ("en-words", "plain-sha"):
        checks["tight_fallback"] = all(table["isTight"] for table in scene["tables"])
    return checks


def compare_scene(scene, base):
    """기준 폴더의 같은 장면과 대조한다. 구조 차이와 새 넘침은 problems, 높이와 줄 수 증가는 changes,
    칸 폭 차이는 width_changes로 돌려준다."""
    width_changes = []
    changes = []
    if base is None:
        return ["기준 폴더에 장면 없음"], changes, width_changes
    # result.json의 장면은 {kind, document, size, measurement, checks}이므로 실측치는 measurement 아래에 있다.
    base = base.get("measurement") or {}
    before_tables = base.get("tables", [])
    tables = scene.get("tables", [])
    problems = []
    if len(tables) != len(before_tables):
        problems.append(f"표 수 {len(tables)} != {len(before_tables)}")
    for index, (table, before) in enumerate(zip(tables, before_tables)):
        if table["height"] > before["height"] + TOLERANCE:
            changes.append(f"표 {index} 높이 {before['height']} -> {table['height']}")
        if len(table["cells"]) != len(before["cells"]):
            problems.append(f"표 {index} 칸 수 {len(table['cells'])} != {len(before['cells'])}")
        for cell_index, (cell, before_cell) in enumerate(zip(table["cells"], before["cells"])):
            if cell["lines"] > before_cell["lines"]:
                changes.append(f"표 {index} 칸 {cell_index} 「{cell['text'][:16]}」 줄 수 {before_cell['lines']} -> {cell['lines']}")
            delta = round(cell["width"] - before_cell["width"], 1)
            if abs(delta) >= 0.1:
                width_changes.append(f"표 {index} 칸 {cell_index} 「{cell['text'][:12]}」 폭 {before_cell['width']} -> {cell['width']} ({delta:+})")
    before_container = base.get("container") or {}
    after_overflows = scene["container"]["scrollWidth"] > scene["container"]["clientWidth"]
    before_overflows = before_container.get("scrollWidth", 0) > before_container.get("clientWidth", 0)
    if after_overflows and not before_overflows:
        problems.append(f"넘침 {scene['container']} (기준 {before_container})")
    return problems, changes, width_changes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="target/visual-check/table-word-wrap-1137")
    parser.add_argument("--port", type=int, default=5395)
    parser.add_argument("--baseline", help="수정 전 result.json이 있는 폴더. 주면 장면마다 표 높이와 칸 줄 수를 대조한다")
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

            def measure_and_capture(key, name, kind, width, height, file, text=None, marker=None, wait_table=True, widest_table=False):
                # 장면마다 새 페이지를 연다. 한 페이지로 수십 장면을 넘기면 렌더러가 죽어 다음 장면이 뜨지 않는다.
                page = browser.new_page()
                try:
                    if kind == "editor":
                        open_document(page, args.port, file, width, height, text, marker)
                        # 긴 문서의 표는 처음 화면 밖에 있어 붙지 않는다. scan_editor_tables가 내리며 찾는 장면은 기다리지 않는다.
                        if wait_table:
                            page.locator("[data-testid=app-window-md-editor] .ks-live-table").first.wait_for(state="attached", timeout=30000)
                        measurement = scan_editor_tables(page)
                    else:
                        open_view_document(page, args.port, text, width, height)
                        page.locator("[data-testid=app-window-storage-document] .ks-markdown-text table").first.wait_for(state="visible", timeout=30000)
                        measurement = page.evaluate(VIEW_TABLES_JS)
                    page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                    if widest_table and measurement.get("tables"):
                        # 표가 화면 밖이라 기존 캡처에 없을 수 있다. 칸이 가장 많은 표의 문서 위치로 내려 한 장 더 찍는다.
                        widest = max(measurement["tables"], key=lambda table: len(table["cells"]))
                        page.evaluate(
                            "(top) => { const scroller = document.querySelector('[data-testid=app-window-md-editor] .cm-scroller'); if (scroller) scroller.scrollTop = top; }",
                            widest["offset"],
                        )
                        page.wait_for_function(
                            "({ cells }) => {"
                            " const scroller = document.querySelector('[data-testid=app-window-md-editor] .cm-scroller');"
                            " if (!scroller) return false;"
                            " const box = scroller.getBoundingClientRect();"
                            " return [...scroller.querySelectorAll('.ks-live-table')].some((table) => {"
                            "  const rect = table.getBoundingClientRect();"
                            "  return table.querySelectorAll('th, td').length === cells && rect.top >= box.top - 1 && rect.top < box.bottom;"
                            " });"
                            "}",
                            arg={"cells": len(widest["cells"])},
                            timeout=30000,
                        )
                        capture = output / f"{key}-widest-table.png"
                        page.screenshot(path=str(capture), animations="disabled")
                        measurement["widest_table_capture"] = str(capture)
                    return measurement
                finally:
                    page.close()

            for width, height in SIZES:
                for name, (text, marker) in DOCUMENTS.items():
                    for kind in ("editor", "view"):
                        key = f"{name}-{kind}-{width}x{height}"
                        measurement = measure_and_capture(key, name, kind, width, height, f"{name}.md", text, marker)
                        checks = judge_scene(measurement, name, kind, width)
                        detail = ""
                        changes = []
                        if baseline is not None:
                            if measurement.get("error"):
                                checks["matches_baseline"] = False
                                detail = "요소를 찾지 못함"
                            else:
                                problems, changes, width_changes = compare_scene(measurement, baseline.get(key))
                                checks["matches_baseline"] = not problems
                                detail = "; ".join(problems + [f"변화 {change}" for change in changes])
                                for change in width_changes:
                                    print("  폭 변화", key, change)
                        scenes[key] = {
                            "kind": kind,
                            "document": name,
                            "size": f"{width}x{height}",
                            "measurement": measurement,
                            "checks": checks,
                            "changes": changes,
                        }
                        failed = [check for check, ok in checks.items() if not ok]
                        failures.extend(f"{key}.{check}" for check in failed)
                        if failed:
                            print(key, "FAIL " + ",".join(failed), detail)
                        else:
                            print(key, "ok", detail)
                for name, (file, marker) in INVARIANT_DOCUMENTS.items():
                    key = f"{name}-editor-{width}x{height}"
                    measurement = measure_and_capture(key, name, "editor", width, height, file, marker=marker, wait_table=False, widest_table=True)
                    checks = judge_scene(measurement, name, "editor", width) if width == 360 else {"table_present": bool(measurement.get("tables"))}
                    detail = ""
                    changes = []
                    if baseline is not None:
                        if measurement.get("error") or not measurement.get("tables"):
                            checks["matches_baseline"] = False
                            detail = "요소를 찾지 못함"
                        else:
                            problems, changes, width_changes = compare_scene(measurement, baseline.get(key))
                            checks["matches_baseline"] = not problems
                            detail = "; ".join(problems + [f"변화 {change}" for change in changes])
                            for change in width_changes:
                                print("  폭 변화", key, change)
                    scenes[key] = {
                        "kind": "editor",
                        "document": name,
                        "size": f"{width}x{height}",
                        "measurement": measurement,
                        "checks": checks,
                        "changes": changes,
                    }
                    failed = [check for check, ok in checks.items() if not ok]
                    failures.extend(f"{key}.{check}" for check in failed)
                    if failed:
                        print(key, "FAIL " + ",".join(failed), detail)
                    else:
                        print(key, "ok", detail)
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
