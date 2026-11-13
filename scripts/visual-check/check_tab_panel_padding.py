#!/usr/bin/env python3
"""탭 패널의 바닥 여백이 내용에 따라 갈리는지 확인한다(카드 #1235).

PR #560이 탭 패널 바닥 여백 0 규칙에 `> .ks-data-stack.is-column.has-action-tail`을 넣어,
채팅이 없는 결정 줄 꼬리 탭까지 패널 여백(--ks-space-3, 12px)을 잃었다. 탭 안 결정 줄
꼬리는 자기 바닥 여백을 두지 않으므로(ui/src/styles/scroll-end-space.css) 꼬리가 탭 바닥에
붙었다. 이 스크립트는 네 경우를 넓은 폭과 좁은 폭에서 잰다.

- controls: 결정 줄 꼬리(단추)만 있는 탭. 패널이 12px를 맡고 단추 아래가 12px 떠야 한다.
- chat: 채팅을 담은 action-tail 탭. 패널 바닥은 0을 유지한다(입력창이 자기 여백을 갖는다).
- markdown/editor/folder: 채팅도 결정 줄 꼬리도 없는 탭. 패널 바닥은 0이다(불변).

  python3 scripts/visual-check/check_tab_panel_padding.py [--output 산출폴더] [--port 포트]

controls/markdown/editor/folder는 하네스 미리보기 ?preview=bottom-tabs-<종류>를 쓰고,
chat은 ?preview=workspace-pas의 앱 정의 ui를 탭 > action-tail 쌓기(채팅 + 단추)로 바꿔
쓴다. 기본 산출 폴더는 target/visual-check/tab-panel-padding이고, 서버는 이 체크아웃의
ui/harness/e2e-server.mjs를 KS_E2E_PORT로 띄운다.

판정이 하나라도 어긋나면 result.json과 캡처를 남긴 뒤 종료 코드 1로 끝난다.
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
TOLERANCE = 1.0

# 미리보기 앱 창이 화면을 채우게 한다(check_stack_end_space.py와 같은 꼴).
PREVIEW_STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"
# 대화 하네스는 앱 창 높이를 따로 잡는다(ui/e2e/conversation-chat.spec.ts와 같은 꼴).
CHAT_STYLE = ".ks-harness { height: calc(100vh - 2 * var(--ks-space-4)); min-height: 0; } .ks-harness-dev-panel { display: none; }"

# 채팅을 담은 action-tail 탭: 스크롤 안 채팅, 스크롤 밖 단추 꼬리.
CHAT_UI = {
    "type": "tabs",
    "tabs": [{"label": "대화", "child": {
        "type": "stack", "direction": "column", "fill": [0],
        "children": [{"type": "chat"}, {"type": "button", "label": "지우기", "on_click": []}],
    }}],
}

# (이름, 미리보기 앱, 쓰는 스타일, 판정 종류)
SCENES = [
    ("controls", "bottom-tabs-controls", PREVIEW_STYLE, "tail"),
    ("chat", "workspace-pas", CHAT_STYLE, "chat"),
    ("markdown", "bottom-tabs-markdown", PREVIEW_STYLE, "plain"),
    ("editor", "bottom-tabs-editor", PREVIEW_STYLE, "plain"),
    ("folder", "bottom-tabs-folder", PREVIEW_STYLE, "plain"),
]

MEASURE_JS = """(root) => {
  const panel = root.querySelector('.ks-data-tab-panel:not([hidden])');
  if (!panel) return { error: '탭 패널을 찾지 못했습니다' };
  const space = parseFloat(getComputedStyle(panel).getPropertyValue('--ks-space-3'));
  const stack = panel.querySelector(':scope > .ks-data-stack.is-column.has-action-tail');
  const chat = panel.querySelector('.ks-agent-chat');
  const tail = stack ? stack.querySelector(':scope > .ks-data-stack-item:not(.ks-stack-scroll):has(button)') : null;
  const button = tail ? tail.querySelector('button') : null;
  const rect = panel.getBoundingClientRect();
  return {
    paddingBottom: parseFloat(getComputedStyle(panel).paddingBottom),
    space,
    hasStackActionTail: stack !== null,
    hasChat: chat !== null,
    buttonToPanel: button ? rect.bottom - button.getBoundingClientRect().bottom : null,
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


def chat_app_source():
    definition = json.loads((ROOT / "examples/workspace-pas.json").read_text())
    definition["ui"] = CHAT_UI
    return f"export default {json.dumps(definition, ensure_ascii=False)}"


def open_scene(browser, port, name, app, style, width, height):
    page = browser.new_page(viewport={"width": width, "height": height})
    if name == "chat":
        source = chat_app_source()
        page.route(
            lambda url: str(url).split("?")[0].endswith("/examples/workspace-pas.json"),
            lambda route: route.fulfill(status=200, content_type="application/javascript", body=source),
        )
    page.goto(f"http://127.0.0.1:{port}/?preview={app}" + ("&conversation=ready" if name == "chat" else ""))
    page.wait_for_selector(f'[data-testid="app-window-{app}"] .ks-data-tab-panel:not([hidden])', timeout=120000)
    page.add_style_tag(content=style)
    if name == "chat":
        page.locator(f'[data-testid="app-window-{app}"] .ks-agent-chat-history').first.wait_for(state="attached", timeout=120000)
        page.get_by_test_id(f"app-window-{app}").get_by_text("기존 기록").first.wait_for(state="visible", timeout=120000)
        page.wait_for_timeout(300)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(300)
    return page


def judge(kind, measurement):
    checks = {}
    space = measurement.get("space")
    if kind == "tail":
        checks["stack_has_action_tail"] = measurement.get("hasStackActionTail") is True
        checks["no_chat"] = measurement.get("hasChat") is False
        checks["panel_padding"] = abs(measurement.get("paddingBottom", -1) - space) <= TOLERANCE
        checks["button_to_panel"] = measurement.get("buttonToPanel") is not None and abs(measurement["buttonToPanel"] - space) <= TOLERANCE
    elif kind == "chat":
        checks["stack_has_action_tail"] = measurement.get("hasStackActionTail") is True
        checks["has_chat"] = measurement.get("hasChat") is True
        checks["panel_padding_zero"] = measurement.get("paddingBottom") == 0
    else:
        checks["no_chat"] = measurement.get("hasChat") is False
        checks["panel_padding_zero"] = measurement.get("paddingBottom") == 0
    return checks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="target/visual-check/tab-panel-padding")
    parser.add_argument("--port", type=int, default=5397)
    args = parser.parse_args()

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
            browser = playwright.chromium.launch()
            for name, app, style, kind in SCENES:
                for width, height in SIZES:
                    page = open_scene(browser, args.port, name, app, style, width, height)
                    try:
                        key = f"{name}-{width}x{height}"
                        measurement = page.get_by_test_id(f"app-window-{app}").evaluate(MEASURE_JS)
                        page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                        checks = judge(kind, measurement)
                        scenes[key] = {"measurement": measurement, "checks": checks}
                        failed = [check for check, ok in checks.items() if not ok]
                        failures.extend(f"{key}.{check}" for check in failed)
                        print(key, measurement, "FAIL " + ",".join(failed) if failed else "ok")
                    finally:
                        page.close()
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
