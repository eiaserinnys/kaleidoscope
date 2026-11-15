#!/usr/bin/env python3
"""카드 #1364의 쉘 수리 세 건을 하니스에서 잰다.

1. card-board를 고른 카드 없이 띄우면 오른쪽 상세 칸 어디에도 "null" 글이 없고 「카드를 고르세요」가
   칸 가운데에 보인다. 고른 카드를 넣은 상태에서는 상세 칸 도구 막대가 그려진다.
2. block-gallery 「배치」 탭의 메모 입력을 좁은 칸에서 긴 안내 문구와 긴 값으로 그렸을 때 입력과
   안내 문구의 계산된 text-overflow가 ellipsis다. 도구 막대 입력도 그대로 ellipsis다.
3. 넓은 폭(1180x720)과 좁은 폭(360x600)에서 각 장면을 캡처하고, app 하니스의 앱 설정 화면
   (공용 .ks-text-input을 쓰는 쉘 화면)도 함께 캡처한다.

  python3 -P scripts/visual-check/check_1364_shell_fixes.py [--output 산출폴더] [--port 47573]

서버는 check_toolbar_narrow.py와 같은 ui/harness/e2e-server.mjs와 app의 vite(harness.html)를
차례로 띄운다(동시에 띄우지 않는다). 기본 산출 폴더는 target/visual-check/shell-fixes다.
판정이 하나라도 실패하면 1로 끝난다.
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
SIZES = ((1180, 720), (360, 600))
# 미리보기 앱 창이 화면을 채우게 한다(check_toolbar_narrow.py와 같은 꼴).
PREVIEW_STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"
ROOT_SELECTOR = '[data-testid="app-window-data-controls"]'
# block-gallery 탭 「배치」의 자리(0부터: 목록, 표와 트리, 흐름과 글, 입력, 코드, 미디어, 채움, 배치).
GALLERY_LAYOUT_TAB = 7
LONG_PLACEHOLDER = "메모를 길게 적는 안내 문구입니다. 칸보다 길면 끝이 말줄임으로 잘려야 합니다"
LONG_VALUE = "메모 값을 아주 길게 적어 입력 칸 폭을 넘기게 하는 문장입니다. 이 값은 칸 안에서 말줄임으로 끝나야 합니다"
CENTER_TOLERANCE = 2


def wait_server(port, path, seconds=120):
    url = f"http://127.0.0.1:{port}{path}"
    end = time.time() + seconds
    while time.time() < end:
        try:
            with urllib.request.urlopen(url, timeout=3):
                return
        except Exception:
            time.sleep(0.3)
    raise RuntimeError(f"server did not start: {url}")


def start_server(command, cwd, port, path, log_path, env):
    log = open(log_path, "w")
    process = subprocess.Popen(command, cwd=cwd, env={**os.environ, **env}, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT)
    try:
        wait_server(port, path)
    except Exception:
        process.terminate()
        log.close()
        raise
    return process, log


def stop_server(process, log):
    if process is None:
        return
    try:
        if process.stdin:
            process.stdin.close()
    except Exception:
        pass
    process.terminate()
    try:
        process.wait(timeout=20)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=20)
    log.close()


def settle(page):
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(350)


def inject_ui(page, ui, state):
    page.evaluate("""async ([layout, nextState]) => {
      const harness = window.__ksHarness;
      const { snapshot } = await harness.call({ op: "state.get" });
      const version = snapshot.shared.app_versions.find(v => v.app_id === "data-controls");
      version.definition.state = nextState;
      version.definition.ui = layout;
      version.version += 1;
      const win = snapshot.shared.windows.find(w => w.app_id === "data-controls");
      win.app_version = version.version;
      win.state = nextState;
      harness.emit({ event: "state.changed", snapshot });
    }""", [ui, state])
    page.add_style_tag(content=PREVIEW_STYLE)
    page.wait_for_selector(f"{ROOT_SELECTOR} .ks-data-window-body", timeout=120000)
    settle(page)


def open_app(browser, port, ui, state, width, height):
    page = browser.new_page(viewport={"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{port}/?preview=data-controls")
    page.wait_for_function("() => window.__ksHarness !== undefined", timeout=120000)
    inject_ui(page, ui, state)
    return page


CARD_BOARD_JS = """(root) => {
  const round = (value) => Math.round(value * 10) / 10;
  const panes = [...root.querySelectorAll('.ks-split-pane')];
  const detail = panes.length >= 2 ? panes[1] : null;
  const text = detail ? detail.querySelector('.ks-data-text') : null;
  const bar = detail ? detail.querySelector('.ks-data-toolbar') : null;
  const toolbarInput = root.querySelector('.ks-data-toolbar input');
  const rect = text ? text.getBoundingClientRect() : null;
  const paneRect = detail ? detail.getBoundingClientRect() : null;
  const center = detail ? detail.querySelector('.ks-data-stack.is-center') : null;
  const centerRect = center ? center.getBoundingClientRect() : null;
  const centerStyle = center ? getComputedStyle(center) : null;
  const itemRect = text && text.parentElement ? text.parentElement.getBoundingClientRect() : null;
  // 가운데 판정은 안내 글을 담은 가운데 쌓기의 안쪽 칸(여백 제외) 기준이다. 좁은 폭에서 분할이 세로로
  // 서면 상세 칸이 내용 높이만큼이라 칸 전체에는 남는 자리가 없다(칸 테두리·여백 9px이 위에 붙는다).
  const contentBox = centerRect && centerStyle ? {
    left: centerRect.left + parseFloat(centerStyle.borderLeftWidth) + parseFloat(centerStyle.paddingLeft),
    right: centerRect.right - parseFloat(centerStyle.borderRightWidth) - parseFloat(centerStyle.paddingRight),
    top: centerRect.top + parseFloat(centerStyle.borderTopWidth) + parseFloat(centerStyle.paddingTop),
    bottom: centerRect.bottom - parseFloat(centerStyle.borderBottomWidth) - parseFloat(centerStyle.paddingBottom),
  } : null;
  return {
    centerBox: centerRect ? { top: round(centerRect.top), height: round(centerRect.height) } : null,
    centerPadding: centerStyle ? [centerStyle.paddingTop, centerStyle.paddingBottom, centerStyle.justifyContent] : null,
    itemBox: itemRect ? { top: round(itemRect.top), height: round(itemRect.height) } : null,
    textBox: rect ? { top: round(rect.top), height: round(rect.height) } : null,
    paneBox: paneRect ? { top: round(paneRect.top), height: round(paneRect.height) } : null,
    hintContentDX: rect && contentBox ? round((rect.left + rect.width / 2) - (contentBox.left + contentBox.right) / 2) : null,
    hintContentDY: rect && contentBox ? round((rect.top + rect.height / 2) - (contentBox.top + contentBox.bottom) / 2) : null,
    paneCount: panes.length,
    detailText: detail ? detail.innerText : "",
    detailRawText: detail ? detail.textContent : "",
    hintFound: text !== null && text.textContent.trim() === "카드를 고르세요",
    hintVisible: text !== null && text.getClientRects().length > 0,
    hintDX: rect && paneRect ? round((rect.left + rect.width / 2) - (paneRect.left + paneRect.width / 2)) : null,
    hintDY: rect && paneRect ? round((rect.top + rect.height / 2) - (paneRect.top + paneRect.height / 2)) : null,
    detailToolbar: bar !== null,
    toolbarInputTextOverflow: toolbarInput ? getComputedStyle(toolbarInput).textOverflow : null,
    toolbarInputPlaceholderTextOverflow: toolbarInput ? getComputedStyle(toolbarInput, '::placeholder').textOverflow : null,
  };
}"""

GALLERY_JS = """(input) => {
  const style = getComputedStyle(input);
  const rect = input.getBoundingClientRect();
  return {
    found: true,
    value: input.value,
    valueTextOverflow: style.textOverflow,
    placeholderTextOverflow: getComputedStyle(input, '::placeholder').textOverflow,
    valueOverflows: input.scrollWidth > input.clientWidth + 1,
    box: { left: Math.round(rect.left * 10) / 10, width: Math.round(rect.width * 10) / 10 },
  };
}"""

SETTINGS_JS = """(root) => {
  const input = root.querySelector('input.ks-text-input');
  if (!input) return null;
  return { textOverflow: getComputedStyle(input).textOverflow, placeholderTextOverflow: getComputedStyle(input, '::placeholder').textOverflow };
}"""


def find_input(node, section_title):
    """앱 정의에서 이름이 section_title인 구역의 입력을 찾는다."""
    if isinstance(node, dict):
        if node.get("type") == "section" and node.get("title") == section_title:
            child = node.get("child") or {}
            if child.get("type") == "input":
                return child
        for value in node.values():
            hit = find_input(value, section_title)
            if hit is not None:
                return hit
    elif isinstance(node, list):
        for item in node:
            hit = find_input(item, section_title)
            if hit is not None:
                return hit
    return None


def judge_card_board(result, key, measured, selected):
    checks = {
        "paneCount": measured["paneCount"] >= 2,
        "no_null_text": "null" not in measured["detailRawText"] and "null" not in measured["detailText"] and "undefined" not in measured["detailRawText"],
        "toolbar_input_ellipsis": measured["toolbarInputTextOverflow"] == "ellipsis" and measured["toolbarInputPlaceholderTextOverflow"] == "ellipsis",
    }
    if selected:
        checks["detail_toolbar"] = measured["detailToolbar"] is True
    else:
        checks["hint_found"] = measured["hintFound"] is True and measured["hintVisible"] is True
        checks["hint_centered"] = (measured["hintContentDX"] is not None and measured["hintContentDY"] is not None
                                   and abs(measured["hintContentDX"]) <= CENTER_TOLERANCE and abs(measured["hintContentDY"]) <= CENTER_TOLERANCE)
        checks["no_detail_toolbar"] = measured["detailToolbar"] is False
    result["judged"][key] = checks
    for check, ok in checks.items():
        if ok is False:
            result["failures"].append(f"{key}.{check}")


def judge_gallery(result, key, measured, typed):
    checks = {
        "input_found": measured.get("found") is True,
        "value_ellipsis": measured.get("valueTextOverflow") == "ellipsis",
    }
    if typed:
        # 값이 있으면 안내 문구는 그려지지 않아 ::placeholder 계산값이 기본값(clip)이다. 값만 본다.
        checks["value_overflows"] = measured.get("valueOverflows") is True
        checks["value_typed"] = measured.get("value") == LONG_VALUE
    else:
        checks["placeholder_ellipsis"] = measured.get("placeholderTextOverflow") == "ellipsis"
    result["judged"][key] = checks
    for check, ok in checks.items():
        if ok is False:
            result["failures"].append(f"{key}.{check}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, default=ROOT / "target/visual-check/shell-fixes")
    parser.add_argument("--port", type=int, default=47573)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    card_board = json.loads((ROOT / "examples/card-board.json").read_text())
    gallery = json.loads((ROOT / "examples/block-gallery.json").read_text())
    memo_input = find_input(gallery.get("ui"), "메모")
    if memo_input is None:
        raise SystemExit("block-gallery에서 「메모」 구역의 입력을 찾지 못했습니다")
    memo_input["placeholder"] = LONG_PLACEHOLDER

    result = {"port": args.port, "scenes": {}, "judged": {}, "failures": []}
    browser = None
    ui_server = ui_log = app_server = app_log = None
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            ui_server, ui_log = start_server(
                ["node", "./harness/e2e-server.mjs"], ROOT / "ui", args.port, "/?preview=data-controls",
                output / "ui-server.log", {"KS_E2E_PORT": str(args.port)},
            )
            for width, height in SIZES:
                size = f"{width}x{height}"
                # (a) 고른 카드가 없는 card-board: 상세 칸은 안내 한 줄만 보인다.
                page = open_app(browser, args.port, card_board["ui"], {"card": None, "query": "", "status": "all"}, width, height)
                try:
                    key = f"card-board-empty-{size}"
                    measured = page.eval_on_selector(ROOT_SELECTOR, CARD_BOARD_JS)
                    page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                    result["scenes"][key] = measured
                    print(key, json.dumps(measured, ensure_ascii=False), flush=True)
                    judge_card_board(result, key, measured, selected=False)
                finally:
                    page.close()
                # (a) 고른 카드가 있는 card-board: 상세 칸 도구 막대가 지금처럼 그려진다.
                page = open_app(browser, args.port, card_board["ui"], {"card": "card-1", "query": "", "status": "all"}, width, height)
                try:
                    key = f"card-board-selected-{size}"
                    measured = page.eval_on_selector(ROOT_SELECTOR, CARD_BOARD_JS)
                    page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                    result["scenes"][key] = measured
                    print(key, json.dumps(measured, ensure_ascii=False), flush=True)
                    judge_card_board(result, key, measured, selected=True)
                finally:
                    page.close()
                # (b) block-gallery 「배치」 탭 메모 입력: 긴 안내 문구와 긴 값이 말줄임으로 끝난다.
                page = open_app(browser, args.port, gallery["ui"], {**(gallery.get("state") or {}), "memo": "", "tab": GALLERY_LAYOUT_TAB}, width, height)
                try:
                    memo = page.get_by_placeholder("메모를 길게")
                    memo.wait_for(timeout=120000)
                    key = f"gallery-memo-empty-{size}"
                    measured = memo.evaluate(GALLERY_JS)
                    page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                    result["scenes"][key] = measured
                    print(key, json.dumps(measured, ensure_ascii=False), flush=True)
                    judge_gallery(result, key, measured, typed=False)
                    memo.fill(LONG_VALUE)
                    settle(page)
                    key = f"gallery-memo-typed-{size}"
                    measured = memo.evaluate(GALLERY_JS)
                    page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                    result["scenes"][key] = measured
                    print(key, json.dumps(measured, ensure_ascii=False), flush=True)
                    judge_gallery(result, key, measured, typed=True)
                finally:
                    page.close()
            stop_server(ui_server, ui_log)
            ui_server = ui_log = None

            # (c) 공용 .ks-text-input을 쓰는 쉘 화면(앱 설정)도 같은 폭에서 캡처하고 계산된 말줄임을 남긴다.
            app_server, app_log = start_server(
                ["node", "./node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(args.port), "--strictPort"],
                ROOT / "app", args.port, "/harness.html", output / "app-server.log", {},
            )
            for width, height in SIZES:
                size = f"{width}x{height}"
                page = browser.new_page(viewport={"width": width, "height": height})
                try:
                    page.goto(f"http://127.0.0.1:{args.port}/harness.html?preview=app-settings&fill-window", wait_until="load")
                    button = page.get_by_role("button", name="앱 설정", exact=True)
                    button.wait_for(timeout=120000)
                    button.click()
                    page.get_by_role("heading", name="앱 설정", exact=True).wait_for(timeout=120000)
                    settle(page)
                    key = f"app-settings-{size}"
                    measured = page.eval_on_selector(".ks-app-settings", SETTINGS_JS)
                    page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                    result["scenes"][key] = measured
                    print(key, json.dumps(measured, ensure_ascii=False), flush=True)
                    if measured is not None:
                        result["judged"][key] = {"shell_input_ellipsis": measured["textOverflow"] == "ellipsis"}
                        if not result["judged"][key]["shell_input_ellipsis"]:
                            result["failures"].append(f"{key}.shell_input_ellipsis")
                finally:
                    page.close()
            stop_server(app_server, app_log)
            app_server = app_log = None
            browser.close()
            browser = None
    finally:
        if browser is not None:
            browser.close()
        stop_server(ui_server, ui_log)
        stop_server(app_server, app_log)

    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("RESULT", output / "result.json", flush=True)
    if result["failures"]:
        print("FAIL", ",".join(result["failures"]), flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
