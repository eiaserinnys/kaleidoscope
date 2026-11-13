#!/usr/bin/env python3
"""탭 패널의 바닥 여백이 내용에 따라 갈리는지 확인한다(카드 #1235).

PR #560이 탭 패널 바닥 여백 0 규칙에 `> .ks-data-stack.is-column.has-action-tail`을 넣어,
채팅이 없는 결정 줄 꼬리 탭까지 패널 여백(--ks-space-3, 12px)을 잃었다. 탭 안 결정 줄
꼬리는 자기 바닥 여백을 두지 않으므로(ui/src/styles/scroll-end-space.css) 꼬리가 탭 바닥에
붙었다. 이 스크립트는 다음 갈래를 넓은 폭과 좁은 폭에서 잰다.

- tab-list-button: 단추 꼬리 탭. 패널이 12px를 맡고 단추 아래가 12px 떠야 한다.
- tab-list-toolbar: 도구 막대 꼬리 탭. 패널 바닥은 0이고, 같은 꼬리를 창 본문에 둔
  body-list-toolbar와 꼬리 아래 거리가 같아야 한다(도구 막대가 자기 여백을 갖는다).
- body-list-button / body-list-toolbar: 같은 꼬리를 창 본문에 둔 기준 배치.
- comment-tab: 소울스트림 카드 앱 「커멘트」 탭 꼴(분할 오른쪽 칸 탭 > 피드 + 입력·보내기
  도구 막대 꼬리). 패널 바닥 0, 입력 아래는 도구 막대 자기 여백만 남아야 한다.
- chat-no-tail: 꼬리 없이 채팅으로 끝나는 탭. 패널 바닥 0(입력창이 자기 여백을 갖는다).
- chat-button: 채팅과 단추 꼬리 탭. 패널이 12px를 맡고 단추 아래가 창 테두리까지 12px다.
- chat-toolbar: 채팅과 도구 막대 꼬리 탭. 패널 바닥 0.
- controls / markdown / editor / folder: 하네스 미리보기 ?preview=bottom-tabs-<종류>.
  controls는 단추 꼬리 12px, 나머지는 패널 0(불변)이다.

  python3 scripts/visual-check/check_tab_panel_padding.py [--output 산출폴더] [--port 포트]

단추 꼬리·도구 막대 꼬리·커멘트 탭은 data-controls 미리보기의 앱 정의 ui를 바꿔 그리고,
채팅 장면은 ?preview=workspace-pas의 앱 정의 ui를 바꿔 대화 하네스와 함께 쓴다. 기본 산출
폴더는 target/visual-check/tab-panel-padding이고, 서버는 이 체크아웃의 ui/harness/e2e-server.mjs를
KS_E2E_PORT로 띄운다. 판정이 하나라도 어긋나면 result.json과 캡처를 남긴 뒤 종료 코드 1로 끝난다.
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

ITEMS = [{"key": str(i), "title": f"항목 {i}"} for i in range(30)]
LIST = {"type": "list", "items": ITEMS}
TOOLBAR = {"type": "toolbar", "start": [{"type": "text", "value": "받은 항목"}]}
BUTTON = {"type": "button", "label": "저장", "on_click": []}
COMMENT_ENTRIES = [{"key": str(i), "name": "사용자" if i % 2 else "에이전트", "meta": f"11-13 14:{i:02d}", "body": f"커멘트 본문 {i}"} for i in range(14)]
COMMENT_TOOLBAR = {"type": "toolbar",
                   "start": [{"type": "input", "value": {"state": "value"}, "on_change": [], "kind": "text", "multiline": False, "placeholder": "커멘트 쓰기"}],
                   "end": [{"type": "button", "label": "보내기", "icon": "send", "icon_only": False, "variant": "primary", "on_click": []}]}
COMMENT_FEED = {"type": "feed", "entries": COMMENT_ENTRIES, "grouped": False, "format": "markdown", "follow": True, "columns": False, "copy": True, "collapsible": False}
COMMENT_TAB = {"type": "stack", "direction": "column", "gap": "none", "fill": 0, "children": [COMMENT_FEED, COMMENT_TOOLBAR]}
COMMENT_UI = {"type": "split", "direction": "row", "children": [
    {"type": "list", "items": [{"key": str(i), "title": f"카드 {i}"} for i in range(30)]},
    {"type": "tabs", "tabs": [{"label": "요약", "child": {"type": "text", "value": "요약"}}, {"label": "커멘트", "child": COMMENT_TAB}]},
]}


def tab(child):
    return {"type": "tabs", "tabs": [{"label": "내용", "child": child}]}


def col(*children):
    return {"type": "stack", "direction": "column", "fill": [0], "children": list(children)}


# (이름, 앱 정의 ui, 판정 종류, 커멘트 탭 클릭 여부)
DATA_SCENES = [
    ("tab-list-button", tab(col(LIST, BUTTON)), "tab-button", False),
    ("tab-list-toolbar", tab(col(LIST, TOOLBAR)), "tab-toolbar", False),
    ("body-list-button", col(LIST, BUTTON), "body-button", False),
    ("body-list-toolbar", col(LIST, TOOLBAR), "body-toolbar", False),
    ("comment-tab", COMMENT_UI, "comment-tab", True),
    ("body-comment-toolbar", col(COMMENT_FEED, COMMENT_TOOLBAR), "body-toolbar", False),
]

CHAT_SCENES = [
    ("chat-no-tail", {"type": "tabs", "tabs": [{"label": "대화", "child": {"type": "chat"}}]}, "chat-no-tail"),
    ("chat-button", {"type": "tabs", "tabs": [{"label": "대화", "child": col({"type": "chat"}, BUTTON)}]}, "chat-button"),
    ("chat-toolbar", {"type": "tabs", "tabs": [{"label": "대화", "child": col({"type": "chat"}, TOOLBAR)}]}, "chat-toolbar"),
]

# (이름, 미리보기 앱, 판정 종류)
FIXTURE_SCENES = [
    ("controls", "bottom-tabs-controls", "controls"),
    ("markdown", "bottom-tabs-markdown", "plain"),
    ("editor", "bottom-tabs-editor", "plain"),
    ("folder", "bottom-tabs-folder", "plain"),
]

MEASURE_JS = """(root) => {
  const panel = root.querySelector('.ks-data-tab-panel:not([hidden])');
  const body = root.querySelector('.ks-data-window-body');
  const frame = root.getBoundingClientRect();
  const scope = panel || body || root;
  const stack = scope.querySelector('.ks-data-stack.is-column.has-action-tail');
  const tailItems = stack ? [...stack.children].filter(el => !el.classList.contains('ks-stack-scroll') && el.childElementCount > 0) : [];
  const tailItem = tailItems.length ? tailItems[tailItems.length - 1] : null;
  const toolbar = tailItem ? tailItem.querySelector('.ks-data-toolbar') : null;
  const button = tailItem ? tailItem.querySelector('button') : null;
  const target = toolbar || button;
  const t = target ? target.getBoundingClientRect() : null;
  const pb = panel ? panel.getBoundingClientRect() : null;
  const bb = body ? body.getBoundingClientRect() : null;
  const input = toolbar ? toolbar.querySelector('input') : null;
  const ib = input ? input.getBoundingClientRect() : null;
  const tb = toolbar ? toolbar.getBoundingClientRect() : null;
  const panelStyle = panel ? getComputedStyle(panel) : null;
  return {
    space: parseFloat((panelStyle || getComputedStyle(scope)).getPropertyValue('--ks-space-3')),
    panelPaddingBottom: panelStyle ? parseFloat(panelStyle.paddingBottom) : null,
    hasStackActionTail: stack !== null,
    hasChat: panel ? panel.querySelector('.ks-agent-chat') !== null : false,
    tailKind: target ? (toolbar ? 'toolbar' : 'button') : null,
    tailToPanel: t && pb ? pb.bottom - t.bottom : null,
    tailToBody: t && bb ? bb.bottom - t.bottom : null,
    tailToFrame: t ? frame.bottom - t.bottom : null,
    toolbarPaddingBottom: toolbar ? parseFloat(getComputedStyle(toolbar).paddingBottom) : null,
    inputToPanel: ib && pb ? pb.bottom - ib.bottom : null,
    inputToBody: ib && bb ? bb.bottom - ib.bottom : null,
    panelBottomToBodyBottom: pb && bb ? bb.bottom - pb.bottom : null,
    bodyBottomToFrameBottom: bb ? frame.bottom - bb.bottom : null,
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


def close(left, right):
    return left is not None and right is not None and abs(left - right) <= TOLERANCE


def judge(kind, m):
    checks = {}
    space = m.get("space")
    if kind == "tab-button":
        checks["stack_has_action_tail"] = m.get("hasStackActionTail") is True
        checks["no_chat"] = m.get("hasChat") is False
        checks["tail_kind"] = m.get("tailKind") == "button"
        checks["panel_padding"] = close(m.get("panelPaddingBottom"), space)
        checks["tail_to_panel"] = close(m.get("tailToPanel"), space)
    elif kind == "tab-toolbar":
        checks["stack_has_action_tail"] = m.get("hasStackActionTail") is True
        checks["no_chat"] = m.get("hasChat") is False
        checks["tail_kind"] = m.get("tailKind") == "toolbar"
        checks["panel_padding_zero"] = close(m.get("panelPaddingBottom"), 0)
        checks["tail_to_panel_zero"] = close(m.get("tailToPanel"), 0)
        checks["toolbar_has_own_padding"] = m.get("toolbarPaddingBottom") is not None and m["toolbarPaddingBottom"] >= 0
    elif kind == "body-button":
        checks["tail_kind"] = m.get("tailKind") == "button"
        checks["tail_to_body"] = close(m.get("tailToBody"), space)
    elif kind == "body-toolbar":
        checks["tail_kind"] = m.get("tailKind") == "toolbar"
        checks["tail_to_body_zero"] = close(m.get("tailToBody"), 0)
    elif kind == "comment-tab":
        checks["tail_kind"] = m.get("tailKind") == "toolbar"
        checks["panel_padding_zero"] = close(m.get("panelPaddingBottom"), 0)
        checks["tail_to_panel_zero"] = close(m.get("tailToPanel"), 0)
        checks["input_present"] = m.get("inputToPanel") is not None
    elif kind == "chat-no-tail":
        checks["has_chat"] = m.get("hasChat") is True
        checks["no_action_tail"] = m.get("hasStackActionTail") is False
        checks["panel_padding_zero"] = close(m.get("panelPaddingBottom"), 0)
    elif kind == "chat-button":
        checks["has_chat"] = m.get("hasChat") is True
        checks["stack_has_action_tail"] = m.get("hasStackActionTail") is True
        checks["tail_kind"] = m.get("tailKind") == "button"
        checks["panel_padding"] = close(m.get("panelPaddingBottom"), space)
        checks["tail_to_panel"] = close(m.get("tailToPanel"), space)
        # 창 테두리까지는 패널 여백 + 패널 아래 몸통 틈 + 몸통 아래 테두리 두께다.
        expected_frame = space + (m.get("panelBottomToBodyBottom") or 0) + (m.get("bodyBottomToFrameBottom") or 0)
        checks["tail_to_frame"] = close(m.get("tailToFrame"), expected_frame)
    elif kind == "chat-toolbar":
        checks["has_chat"] = m.get("hasChat") is True
        checks["stack_has_action_tail"] = m.get("hasStackActionTail") is True
        checks["tail_kind"] = m.get("tailKind") == "toolbar"
        checks["panel_padding_zero"] = close(m.get("panelPaddingBottom"), 0)
        checks["tail_to_panel_zero"] = close(m.get("tailToPanel"), 0)
    elif kind == "controls":
        checks["no_chat"] = m.get("hasChat") is False
        checks["tail_kind"] = m.get("tailKind") == "button"
        checks["panel_padding"] = close(m.get("panelPaddingBottom"), space)
        checks["tail_to_panel"] = close(m.get("tailToPanel"), space)
    else:
        checks["no_chat"] = m.get("hasChat") is False
        checks["panel_padding_zero"] = close(m.get("panelPaddingBottom"), 0)
    return checks


def inject_data(port, page, layout):
    page.goto(f"http://127.0.0.1:{port}/?preview=data-controls")
    page.wait_for_function("() => window.__ksHarness !== undefined", timeout=120000)
    page.evaluate("""async (layout) => {
      const harness = window.__ksHarness;
      const { snapshot } = await harness.call({ op: "state.get" });
      const version = snapshot.shared.app_versions.find(v => v.app_id === "data-controls");
      version.definition.state = { value: "", on: true, dialogOpen: false };
      version.definition.ui = layout;
      version.version += 1;
      const win = snapshot.shared.windows.find(w => w.app_id === "data-controls");
      win.app_version = version.version;
      win.state = { value: "", on: true, dialogOpen: false };
      harness.emit({ event: "state.changed", snapshot });
    }""", layout)
    page.add_style_tag(content=PREVIEW_STYLE)


def open_data(browser, port, layout, width, height, comment):
    page = browser.new_page(viewport={"width": width, "height": height})
    inject_data(port, page, layout)
    app = page.get_by_test_id("app-window-data-controls")
    if comment:
        tab_button = app.get_by_role("tab", name="커멘트")
        if tab_button.count():
            tab_button.first.click()
        else:
            app.get_by_text("커멘트", exact=True).first.click()
        page.wait_for_selector('[data-testid="app-window-data-controls"] .ks-data-tab-panel:not([hidden]) .ks-data-toolbar', timeout=120000)
    else:
        page.wait_for_selector('[data-testid="app-window-data-controls"] .ks-data-stack.is-column', timeout=120000)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(400)
    return page, app


def chat_source(ui):
    definition = json.loads((ROOT / "examples/workspace-pas.json").read_text())
    definition["ui"] = ui
    return f"export default {json.dumps(definition, ensure_ascii=False)}"


def open_chat(browser, port, ui, width, height):
    page = browser.new_page(viewport={"width": width, "height": height})
    source = chat_source(ui)
    page.route(
        lambda url: str(url).split("?")[0].endswith("/examples/workspace-pas.json"),
        lambda route: route.fulfill(status=200, content_type="application/javascript", body=source),
    )
    page.goto(f"http://127.0.0.1:{port}/?preview=workspace-pas&conversation=ready")
    page.wait_for_selector('[data-testid="app-window-workspace-pas"] .ks-data-tab-panel:not([hidden])', timeout=120000)
    page.add_style_tag(content=CHAT_STYLE)
    page.locator('[data-testid="app-window-workspace-pas"] .ks-agent-chat-history').first.wait_for(state="attached", timeout=120000)
    page.get_by_test_id("app-window-workspace-pas").get_by_text("기존 기록").first.wait_for(state="visible", timeout=120000)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(300)
    return page, page.get_by_test_id("app-window-workspace-pas")


def open_fixture(browser, port, app, width, height):
    page = browser.new_page(viewport={"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{port}/?preview={app}")
    page.wait_for_selector(f'[data-testid="app-window-{app}"] .ks-data-tab-panel:not([hidden])', timeout=120000)
    page.add_style_tag(content=PREVIEW_STYLE)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(300)
    return page, page.get_by_test_id(f"app-window-{app}")


def record(output, key, page, app, kind, scenes, failures):
    measurement = app.evaluate(MEASURE_JS)
    page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
    checks = judge(kind, measurement)
    scenes[key] = {"measurement": measurement, "checks": checks}
    failed = [check for check, ok in checks.items() if not ok]
    failures.extend(f"{key}.{check}" for check in failed)
    print(key, measurement, "FAIL " + ",".join(failed) if failed else "ok", flush=True)


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
            for width, height in SIZES:
                size = f"{width}x{height}"
                for name, layout, kind, comment in DATA_SCENES:
                    page, app = open_data(browser, args.port, layout, width, height, comment)
                    try:
                        record(output, f"{name}-{size}", page, app, kind, scenes, failures)
                    finally:
                        page.close()
                for name, ui, kind in CHAT_SCENES:
                    page, app = open_chat(browser, args.port, ui, width, height)
                    try:
                        record(output, f"{name}-{size}", page, app, kind, scenes, failures)
                    finally:
                        page.close()
                for name, app_id, kind in FIXTURE_SCENES:
                    page, app = open_fixture(browser, args.port, app_id, width, height)
                    try:
                        record(output, f"{name}-{size}", page, app, kind, scenes, failures)
                    finally:
                        page.close()
                # 같은 꼬리를 창 본문에 둔 기준 배치와 꼬리 아래 거리를 나란히 잰다.
                for tail in ("button", "toolbar"):
                    tab_key, body_key = f"tab-list-{tail}-{size}", f"body-list-{tail}-{size}"
                    tab_value = scenes[tab_key]["measurement"]["tailToPanel"]
                    body_value = scenes[body_key]["measurement"]["tailToBody"]
                    ok = close(tab_value, body_value)
                    scenes[tab_key]["checks"][f"matches_body_{tail}"] = ok
                    if not ok:
                        failures.append(f"{tab_key}.matches_body_{tail}")
                    print(f"{tab_key}.matches_body_{tail}", tab_value, body_value, "ok" if ok else "FAIL", flush=True)
                # 커멘트 탭의 입력 아래 틈도 같은 도구 막대를 창 본문에 둔 배치와 같아야 한다.
                comment_key, body_comment_key = f"comment-tab-{size}", f"body-comment-toolbar-{size}"
                tab_value = scenes[comment_key]["measurement"]["inputToPanel"]
                body_value = scenes[body_comment_key]["measurement"]["inputToBody"]
                ok = close(tab_value, body_value)
                scenes[comment_key]["checks"]["input_matches_body_toolbar"] = ok
                if not ok:
                    failures.append(f"{comment_key}.input_matches_body_toolbar")
                print(f"{comment_key}.input_matches_body_toolbar", tab_value, body_value, "ok" if ok else "FAIL", flush=True)
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
