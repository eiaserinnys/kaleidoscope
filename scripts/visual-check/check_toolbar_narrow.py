#!/usr/bin/env python3
"""좁은 칸에 놓인 도구 막대가 끝 조작을 막대와 화면 안에 남기는지 잰다(카드 #1329).

데이터 블록의 도구 막대(.ks-data-toolbar)는 입력의 최소 폭이 96px이고 끝 묶음은 줄지 않아,
column_below 없이 가로 분할한 좁은 칸에서는 끝 단추가 막대의 가로 스크롤 뒤로 밀렸다.
이 스크립트는 막대를 쓰는 자리와 좁은 칸을 겪는 앱을 네 폭에서 그려 다음을 남긴다.

- card-board, block-gallery, pages(비공개 리포의 앱 정의, --pages-app): 앱 창의 모든 막대.
  막대 폭, scrollWidth, clientWidth, 입력 폭, 끝 묶음 오른쪽을 재고, 끝 묶음이 막대나 화면
  밖이거나 막대가 가로로 넘치면 0이 아닌 코드로 끝난다.
- 붐비는 막대(jizura 장면): 360폭에서 지금처럼 가로 스크롤하는지 확인한다(경계 280px의 전제).
- 창 크기 바꾸기: block-gallery 창을 연 채 1180 -> 360 -> 1180으로 바꿔 같은 판정을 다시 한다.
- 대화 막대(?preview=workspace-pas)와 앱 설정 머리(app 하네스): 넓은 폭과 360폭의 전후
  캡처를 비교하려고 같은 수치를 남긴다(판정 없음).

  python3 -P scripts/visual-check/check_toolbar_narrow.py [--output 산출폴더] [--port 47562] [--pages-app 경로]

서버는 이 체크아웃의 ui/harness/e2e-server.mjs와 app의 vite(harness.html)를 KS_E2E_PORT/--port로
차례로 띄운다(동시에 띄우지 않는다). 기본 산출 폴더는 target/visual-check/toolbar-narrow다.
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
SIZES = ((1180, 720), (768, 720), (480, 720), (360, 600))
DEFAULT_PAGES_APP = Path("/home/eias/workspace/.projects/kaleidoscope-private-apps/apps/pages/app.json")
# 미리보기 앱 창이 화면을 채우게 한다(check_tab_panel_padding.py와 같은 꼴).
PREVIEW_STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"
CHAT_STYLE = ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }"

MEASURE_JS = """(root) => {
  const round = (value) => Math.round(value * 10) / 10;
  return [...root.querySelectorAll('.ks-data-toolbar, .ks-agent-chat-toolbar')].map((bar, index) => {
    const rect = bar.getBoundingClientRect();
    const input = bar.querySelector('input');
    const end = bar.querySelector(':scope > .ks-data-toolbar-group.is-end');
    const endRect = end ? end.getBoundingClientRect() : null;
    return {
      index,
      className: bar.className,
      width: round(rect.width),
      scrollWidth: bar.scrollWidth,
      clientWidth: bar.clientWidth,
      inputWidth: input ? round(input.getBoundingClientRect().width) : null,
      endRight: endRect ? round(endRect.right) : null,
      barRight: round(rect.right),
      screenRight: window.innerWidth,
      endInsideBar: endRect ? endRect.right <= rect.right + 1 : null,
      endInsideScreen: endRect ? endRect.right <= window.innerWidth + 1 : null,
      overflows: bar.scrollWidth > bar.clientWidth + 1,
    };
  });
}"""

APP_SCENES = ("card-board", "block-gallery", "pages")

# jizura의 붐비는 막대: 글자, 입력 둘, 고르기 둘, 단추 여섯이 한 줄에 선다.
JIZURA_TOOLBAR_SCENE = {
    "type": "stack", "direction": "column", "gap": "none", "children": [
        {
            "type": "toolbar",
            "start": [
                {"type": "text", "value": "곡 정보", "style": "body"},
                {"type": "input", "placeholder": "곡 제목", "value": {"state": "title"}, "on_change": {"set_state": "title"}},
                {"type": "input", "placeholder": "아티스트", "value": {"state": "artist"}, "on_change": {"set_state": "artist"}},
                {"type": "select", "style": "segmented", "options": ["전체", "가사", "영상"], "value": {"state": "mode"}, "on_change": {"set_state": "mode"}},
                {"type": "select", "style": "dropdown", "options": ["전체", "하나", "둘", "셋", "넷", "다섯", "여섯"], "value": {"state": "format"}, "on_change": {"set_state": "format"}},
                *[{"type": "button", "label": label, "on_click": []} for label in ("열기", "저장", "AE용 내보내기", "초기화", "이용 안내", "사용법 안내")],
            ],
        },
        {"type": "text", "value": "곡 목록", "style": "body"},
    ],
}


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


def measure(page, root_selector):
    return page.eval_on_selector(root_selector, MEASURE_JS)


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
    page.wait_for_selector('[data-testid="app-window-data-controls"] .ks-data-toolbar', timeout=120000)
    settle(page)


def open_data(browser, port, ui, state, width, height):
    page = browser.new_page(viewport={"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{port}/?preview=data-controls")
    page.wait_for_function("() => window.__ksHarness !== undefined", timeout=120000)
    inject_ui(page, ui, state)
    return page


def open_chat(browser, port, width, height):
    page = browser.new_page(viewport={"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{port}/?preview=workspace-pas&conversation=ready", wait_until="load")
    page.add_style_tag(content=CHAT_STYLE)
    chat = page.get_by_test_id("app-window-workspace-pas")
    chat.get_by_role("log", name="대화 기록").wait_for(timeout=120000)
    chat.get_by_role("textbox", name="메시지").wait_for(timeout=120000)
    settle(page)
    return page


def open_settings(browser, port, width, height):
    page = browser.new_page(viewport={"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{port}/harness.html?preview=app-settings&fill-window", wait_until="load")
    button = page.get_by_role("button", name="앱 설정", exact=True)
    button.wait_for(timeout=120000)
    button.click()
    page.get_by_role("heading", name="앱 설정", exact=True).wait_for(timeout=120000)
    settle(page)
    return page


def judge_apps(measurements):
    """세 앱의 모든 막대에서 끝 묶음이 막대와 화면 안에 있고 가로로 넘치지 않아야 한다."""
    checks = {"bars": len(measurements)}
    if not measurements:
        checks["measured"] = False
        return checks
    checks["measured"] = True
    checks["no_horizontal_overflow"] = all(not item["overflows"] for item in measurements)
    checks["end_inside_bar"] = all(item["endInsideBar"] is not False for item in measurements)
    checks["end_inside_screen"] = all(item["endInsideScreen"] is not False for item in measurements)
    return checks


def record(result, output, key, page, root_selector):
    measurements = measure(page, root_selector)
    page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
    result["scenes"][key] = measurements
    print(key, json.dumps(measurements, ensure_ascii=False), flush=True)
    return measurements


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, default=ROOT / "target/visual-check/toolbar-narrow")
    parser.add_argument("--port", type=int, default=47562)
    parser.add_argument("--pages-app", type=Path, default=DEFAULT_PAGES_APP)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    definitions = {
        "card-board": json.loads((ROOT / "examples/card-board.json").read_text()),
        "block-gallery": json.loads((ROOT / "examples/block-gallery.json").read_text()),
        "pages": json.loads(args.pages_app.read_text()),
    }
    result = {"port": args.port, "pages_app": str(args.pages_app), "scenes": {}, "judged": {}, "failures": []}
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
                for name in APP_SCENES:
                    definition = definitions[name]
                    page = open_data(browser, args.port, definition.get("ui"), definition.get("state") or {}, width, height)
                    try:
                        measurements = record(result, output, f"{name}-{size}", page, '[data-testid="app-window-data-controls"]')
                        checks = judge_apps(measurements)
                        result["judged"][f"{name}-{size}"] = checks
                        for check, ok in checks.items():
                            if ok is False:
                                result["failures"].append(f"{name}-{size}.{check}")
                    finally:
                        page.close()
                page = open_data(browser, args.port, JIZURA_TOOLBAR_SCENE, {"title": "", "artist": "", "mode": "전체", "format": "전체"}, width, height)
                try:
                    measurements = record(result, output, f"busy-toolbar-{size}", page, '[data-testid="app-window-data-controls"]')
                    if width == 360:
                        # 붐비는 막대는 이 경계(280px)보다 넓어 지금처럼 가로 스크롤한다.
                        keeps_scroll = bool(measurements) and measurements[0]["scrollWidth"] > measurements[0]["clientWidth"]
                        result["judged"][f"busy-toolbar-{size}.keeps_horizontal_scroll"] = keeps_scroll
                        if not keeps_scroll:
                            result["failures"].append(f"busy-toolbar-{size}.keeps_horizontal_scroll")
                finally:
                    page.close()
                page = open_chat(browser, args.port, width, height)
                try:
                    record(result, output, f"conversation-toolbar-{size}", page, '[data-testid="app-window-workspace-pas"]')
                finally:
                    page.close()
            # 창을 연 채 넓은 폭과 좁은 폭을 오가도 질의가 그 폭의 모양으로 다시 선다(ui-design §0 18번).
            definition = definitions["block-gallery"]
            page = open_data(browser, args.port, definition.get("ui"), definition.get("state") or {}, 1180, 720)
            try:
                for key, (width, height) in (
                    ("block-gallery-resize-1180x720", (1180, 720)),
                    ("block-gallery-resize-360x600", (360, 600)),
                    ("block-gallery-resize-back-1180x720", (1180, 720)),
                ):
                    page.set_viewport_size({"width": width, "height": height})
                    settle(page)
                    checks = judge_apps(record(result, output, key, page, '[data-testid="app-window-data-controls"]'))
                    result["judged"][key] = checks
                    for check, ok in checks.items():
                        if ok is False:
                            result["failures"].append(f"{key}.{check}")
            finally:
                page.close()
            stop_server(ui_server, ui_log)
            ui_server = ui_log = None

            app_server, app_log = start_server(
                ["node", "./node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(args.port), "--strictPort"],
                ROOT / "app", args.port, "/harness.html", output / "app-server.log", {},
            )
            for width, height in SIZES:
                size = f"{width}x{height}"
                page = open_settings(browser, args.port, width, height)
                try:
                    record(result, output, f"app-settings-{size}", page, ".ks-app-settings")
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
