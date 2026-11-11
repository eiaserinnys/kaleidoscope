#!/usr/bin/env python3
"""도구 막대 안 실패 표시가 막대 한 줄 안에 서는지 검수한다.

카드 #1139. toolbar의 start에 실패하는 text와 select, end에 단추 하나, toolbar 아래에
같은 원천을 쓰는 실패 블록 하나(막대 밖 불변 대조용)를 놓고 1180×720과 360×240에서 잰다.

  1. toolbar 높이가 --ks-bar-height 그대로이고 위아래로 넘치지 않는다.
  2. toolbar 자손의 아래 끝이 toolbar 아래 끝을 1px 넘게 넘지 않는다.
  3. toolbar 안 실패 표시는 compact(한 줄)로 서고, 긴 문구는 한 줄 말줄임이며 title에 전체 문구가 있다.
  4. 에러코드와 「다시 받기」 단추는 잘리지 않고 보이며, 누르면 data.refresh로 다시 받는다.
  5. toolbar 밖 실패 표시는 compact가 아니고 문구 span 없이 지금 마크업 그대로다.
  6. 좁은 폭에서 toolbar가로 스크롤은 계약대로 허용하되, 세로로는 넘치지 않는다.
  7. 창 폭을 1180에서 360으로 바꿔도 같은 줄이 유지된다(§0 18).
  8. Tab이 toolbar 안 보이는 요소로 새지 않고, Esc로 열리는 것이 없다(§0 15).
  9. 「다시 받기」를 누른 뒤 초점이 어디로 가는지 기록한다(§0 14).

  python3 -P scripts/visual-check/check_toolbar_failure.py [--output 산출폴더] [--port 포트]

중립 미리보기 ?preview=data-views-test에 장면 정의를 주입하고, 실패는 기존 E2E
(ui/e2e/data-state-layout.spec.ts)와 같이 data.update로 실패한 바인딩 값을 넣어 만든다.
기본 산출 폴더는 target/visual-check/toolbar-failure이고, 서버는 이 체크아웃의
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
APP_ID = "data-views-test"
WINDOW_ID = "views-window"
STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"
SIZES = ((1180, 720), (360, 240))
TOLERANCE = 1.0
CODE = "SHELL_DATA_SOURCE_FAILED"
LONG_MESSAGE = "받지 못했습니다. 서버가 응답하지 않아 작업 목록을 불러오지 못했습니다. 네트워크 연결을 확인하고 잠시 뒤 다시 시도하세요. 계속 실패하면 설정에서 연결을 다시 승인하세요."
RETRY = ["sample"]

# toolbar의 start에 실패하는 text와 select, end에 단추 하나. 아래에 같은 원천을 쓰는 실패 블록 하나.
SCENE = {"type": "stack", "direction": "column", "gap": "medium", "children": [
    {"type": "toolbar", "start": [
        {"type": "text", "value": {"expr": "$data.sample.message"}},
        {"type": "select", "value": {"state": "choice"}, "on_change": {"set_state": "choice"}, "options": {"expr": "$data.sample.message"}},
    ], "end": [{"type": "button", "label": "적용", "on_click": []}]},
    {"type": "text", "value": {"expr": "$data.sample.message"}},
]}
STATE = {"choice": ""}
POINTERS = {
    "/ui/children/0/start/0/value": {"status": "failed", "id": CODE, "message": LONG_MESSAGE, "retry": RETRY},
    "/ui/children/0/start/1/options": {"status": "failed", "id": CODE, "message": LONG_MESSAGE, "retry": RETRY},
    "/ui/children/1/value": {"status": "failed", "id": CODE, "message": LONG_MESSAGE, "retry": RETRY},
}

MEASURE_JS = """() => {
  const app = document.querySelector('[data-testid="app-window-data-views-test"]');
  if (!app) return { error: '앱 창을 찾지 못했습니다' };
  const toolbar = app.querySelector('.ks-data-toolbar');
  if (!toolbar) return { error: '도구 막대를 찾지 못했습니다' };
  const rect = (node) => node.getBoundingClientRect();
  const cls = (node) => typeof node.className === 'string' ? node.className : (node.getAttribute('class') || '');
  const bar = rect(toolbar);
  const cs = getComputedStyle(toolbar);
  // --ks-bar-height는 calc() 문자열이라 그대로는 수로 못 읽는다. 같은 토큰을 쓰는 숨은 상자로 계산값을 잰다.
  const probe = document.createElement('div');
  probe.style.cssText = 'position: absolute; visibility: hidden; width: 0; height: var(--ks-bar-height);';
  toolbar.appendChild(probe);
  const barExpected = rect(probe).height;
  probe.remove();
  const descendants = [...toolbar.querySelectorAll('*')].map((node) => ({ cls: cls(node), bottom: rect(node).bottom, height: rect(node).height, width: rect(node).width }));
  // 시작 무리와 종단 무리의 그려진 상자가 겹치면 좁은 폭에서 코드나 단추가 가려진다.
  const groupRects = (selector) => {
    const group = toolbar.querySelector(selector);
    return group ? [rect(group), ...[...group.querySelectorAll('*')].map(rect)] : [];
  };
  const startRects = groupRects(':scope > .ks-data-toolbar-group.is-start');
  const endRects = groupRects(':scope > .ks-data-toolbar-group.is-end');
  const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const messages = [...toolbar.querySelectorAll('.ks-data-state-message')].map((node) => {
    const style = getComputedStyle(node);
    return { text: node.textContent, title: node.getAttribute('title'), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
      whiteSpace: style.whiteSpace, textOverflow: style.textOverflow, overflowX: style.overflowX };
  });
  const ids = [...toolbar.querySelectorAll('.ks-error-id')].map((node) => ({ text: node.textContent, width: rect(node).width, height: rect(node).height, left: rect(node).left, right: rect(node).right, bottom: rect(node).bottom }));
  const buttons = [...toolbar.querySelectorAll('button')].map((node) => ({ text: node.textContent, width: rect(node).width, height: rect(node).height, left: rect(node).left, right: rect(node).right, bottom: rect(node).bottom }));
  const outside = app.querySelector('.ks-data-stack > .ks-data-stack-item:nth-child(2) .ks-data-state');
  const outsideInfo = outside ? {
    compact: outside.classList.contains('ks-data-state-compact'),
    messageSpans: outside.querySelectorAll('.ks-data-state-message').length,
    text: outside.querySelector('.ks-empty-state-text') ? outside.querySelector('.ks-empty-state-text').textContent : null,
    ids: [...outside.querySelectorAll('.ks-error-id')].map((node) => node.textContent),
    iconWidth: outside.querySelector('.ks-empty-state-icon') ? rect(outside.querySelector('.ks-empty-state-icon')).width : 0,
  } : null;
  return {
    bar: { width: bar.width, height: bar.height, left: bar.left, right: bar.right, bottom: bar.bottom, scrollWidth: toolbar.scrollWidth, clientWidth: toolbar.clientWidth, scrollHeight: toolbar.scrollHeight, clientHeight: toolbar.clientHeight,
      barToken: cs.getPropertyValue('--ks-bar-height').trim(), controlToken: cs.getPropertyValue('--ks-control-height').trim(), expected: barExpected },
    maxDescendantBottom: Math.max(bar.top, ...descendants.map((item) => item.bottom)),
    compactCount: toolbar.querySelectorAll('.ks-data-state-compact').length,
    stateCount: toolbar.querySelectorAll('.ks-data-state').length,
    messages, ids, buttons,
    groups: { start: startRects.length, end: endRects.length, overlap: startRects.some((a) => endRects.some((b) => overlap(a, b))) },
    messageSpanCount: app.querySelectorAll('.ks-data-state-message').length,
    outside: outsideInfo,
  };
}"""

FOCUS_JS = """() => {
  const active = document.activeElement;
  if (!active || active === document.body) return { tag: 'BODY', inToolbar: false };
  const rect = active.getBoundingClientRect();
  return {
    tag: active.tagName,
    text: (active.textContent || '').trim(),
    ariaLabel: active.getAttribute('aria-label'),
    inToolbar: Boolean(active.closest('.ks-data-toolbar')),
    width: rect.width, height: rect.height,
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


def open_scene(page, port, width, height):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{port}/?preview={APP_ID}")
    page.wait_for_function("(id) => window.__ksHarness && document.querySelector(`[data-testid=app-window-${id}]`)", arg=APP_ID, timeout=120000)
    page.evaluate("""async ([appId, layout, appState]) => {
      const harness = window.__ksHarness;
      const { snapshot } = await harness.call({ op: 'state.get' });
      const version = snapshot.shared.app_versions.find((v) => v.app_id === appId);
      version.definition.state = appState;
      version.definition.ui = layout;
      version.version += 1;
      const win = snapshot.shared.windows.find((w) => w.app_id === appId);
      win.app_version = version.version;
      win.state = appState;
      harness.emit({ event: 'state.changed', snapshot });
    }""", [APP_ID, SCENE, STATE])
    page.add_style_tag(content=STYLE)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    # 장면 정의로 다시 붙는 동안 샘플 원천(1초 지연)의 응답이 끼어들지 않게 기다린다.
    app = page.get_by_test_id(f"app-window-{APP_ID}")
    app.locator(".ks-data-toolbar .ks-data-toolbar-item.is-text").wait_for(timeout=30000)
    page.wait_for_timeout(1600)
    return app


def emit_failures(page, app):
    page.evaluate("""(payload) => {
      const harness = window.__ksHarness;
      harness.emit({ event: 'data.update', window_id: payload.windowId, view: { sources: {}, values: payload.values } });
    }""", {"windowId": WINDOW_ID, "values": POINTERS})
    app.locator(".ks-data-toolbar .ks-data-state-compact").first.wait_for(timeout=30000)
    page.wait_for_timeout(200)


def measure(page):
    return page.evaluate(MEASURE_JS)


def judge(measurement, viewport_width):
    if measurement.get("error"):
        return {"measured": False}
    bar = measurement["bar"]
    checks = {}
    checks["toolbar_height"] = bar["expected"] > 0 and abs(bar["height"] - bar["expected"]) <= TOLERANCE
    checks["no_vertical_overflow"] = bar["scrollHeight"] <= bar["clientHeight"] + TOLERANCE
    checks["no_descendant_below"] = measurement["maxDescendantBottom"] <= bar["bottom"] + TOLERANCE
    checks["toolbar_items_compact"] = measurement["compactCount"] == 2 and measurement["stateCount"] == 0
    messages = measurement["messages"]
    checks["message_spans"] = len(messages) == 2
    checks["message_keeps_text"] = len(messages) == 2 and all(item["text"] == LONG_MESSAGE for item in messages)
    checks["message_title_full"] = len(messages) == 2 and all(item["title"] == LONG_MESSAGE for item in messages)
    checks["message_nowrap"] = len(messages) == 2 and all(item["whiteSpace"] == "nowrap" for item in messages)
    checks["message_ellipsis"] = len(messages) == 2 and all(item["textOverflow"] == "ellipsis" and item["overflowX"] == "hidden" for item in messages)
    if viewport_width <= 360:
        # 좁은 폭에서는 긴 문구가 잘려야 한다(가로 스크롤이 남더라도 문구 span 자체는 폭 안에서 끊긴다).
        checks["message_clipped_narrow"] = len(messages) == 2 and all(item["scrollWidth"] > item["clientWidth"] for item in messages)
    ids = measurement["ids"]
    checks["error_codes_shown"] = len(ids) == 2 and all(item["text"] == CODE and item["width"] > 0 and item["height"] > 0 and item["bottom"] <= bar["bottom"] + TOLERANCE for item in ids)
    retries = [item for item in measurement["buttons"] if item["text"] == "다시 받기"]
    checks["retry_buttons_shown"] = len(retries) == 2 and all(item["height"] > 0 and item["width"] > 0 and item["bottom"] <= bar["bottom"] + TOLERANCE for item in retries)
    if viewport_width > 360:
        # 넓은 폭에서는 가로 스크롤 없이 코드와 단추가 막대 안에 다 보여야 한다.
        checks["no_horizontal_overflow"] = bar["scrollWidth"] <= bar["clientWidth"] + TOLERANCE
        checks["controls_within_bar"] = all(bar["left"] - TOLERANCE <= item["left"] and item["right"] <= bar["right"] + TOLERANCE for item in ids + retries)
    outside = measurement["outside"]
    checks["outside_not_compact"] = bool(outside) and outside["compact"] is False
    checks["outside_markup_unchanged"] = bool(outside) and outside["messageSpans"] == 0 and outside["ids"] == [CODE] and LONG_MESSAGE in (outside["text"] or "") and outside["iconWidth"] >= 24
    checks["message_spans_only_in_toolbar"] = measurement["messageSpanCount"] == 2
    groups = measurement["groups"]
    checks["groups_not_overlapping"] = groups["start"] > 0 and groups["end"] > 0 and groups["overlap"] is False
    return checks


def run_interactions(page, app, harness_calls_before):
    result = {}
    # §0 15: Tab이 toolbar 안 보이는 요소로 새지 않는다.
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.press("Tab")
    sequence = []
    for _ in range(4):
        sequence.append(page.evaluate(FOCUS_JS))
        page.keyboard.press("Tab")
    result["tab_sequence"] = sequence
    inside = [item for item in sequence if item["inToolbar"]]
    result["tab_stays_visible"] = bool(inside) and all(item["width"] > 0 and item["height"] > 0 for item in inside)
    # §0 15: Esc로 열리는 대화상자가 없다.
    page.keyboard.press("Escape")
    page.wait_for_timeout(100)
    result["escape_opens_nothing"] = page.evaluate("() => document.querySelectorAll('.ks-dialog-overlay').length") == 0 and app.locator(".ks-data-toolbar .ks-data-state-compact").count() == 2
    # 「다시 받기」를 누르면 data.refresh로 다시 받는다.
    app.locator('.ks-data-toolbar button', has_text="다시 받기").first.click()
    page.wait_for_timeout(400)
    calls = page.evaluate("() => window.__ksHarness.getCalls()")
    result["refresh_calls"] = [call for call in calls[harness_calls_before:] if call.get("op") == "data.refresh"]
    result["retry_sends_refresh"] = any(call.get("sources") == RETRY for call in result["refresh_calls"])
    result["focus_after_retry"] = page.evaluate(FOCUS_JS)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="target/visual-check/toolbar-failure")
    parser.add_argument("--port", type=int, default=5408)
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
            page = browser.new_page()
            for width, height in SIZES:
                app = open_scene(page, args.port, width, height)
                emit_failures(page, app)
                key = f"toolbar-failure-{width}x{height}"
                measurement = measure(page)
                page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                outside = app.locator(".ks-data-stack > .ks-data-stack-item").nth(1).locator(".ks-data-state")
                outside.screenshot(path=str(output / f"outside-{width}x{height}.png"), animations="disabled")
                checks = judge(measurement, width)
                scene = {"measurement": measurement, "checks": checks}
                if width == 1180:
                    # §0 18: 실패가 떠 있는 채로 폭을 좁혀도 같은 줄이 유지되는지.
                    page.set_viewport_size({"width": 360, "height": 240})
                    page.wait_for_timeout(300)
                    resized = measure(page)
                    page.screenshot(path=str(output / f"{key}-resized-360x240.png"), animations="disabled")
                    scene["resized"] = {"measurement": resized, "checks": judge(resized, 360)}
                    page.set_viewport_size({"width": width, "height": height})
                    page.wait_for_timeout(300)
                    before = page.evaluate("() => window.__ksHarness.getCalls().length")
                    interactions = run_interactions(page, app, before)
                    scene["interactions"] = interactions
                    for name, ok in (("tab_stays_visible", interactions["tab_stays_visible"]), ("escape_opens_nothing", interactions["escape_opens_nothing"]), ("retry_sends_refresh", interactions["retry_sends_refresh"])):
                        if not ok:
                            checks[name] = False
                scenes[key] = scene
                failed = [check for check, ok in checks.items() if not ok]
                if width == 1180:
                    failed.extend(f"resized.{check}" for check, ok in scene["resized"]["checks"].items() if not ok)
                    failed.extend(name for name, ok in (("tab_stays_visible", interactions["tab_stays_visible"]), ("escape_opens_nothing", interactions["escape_opens_nothing"]), ("retry_sends_refresh", interactions["retry_sends_refresh"])) if not ok)
                failures.extend(f"{key}.{check}" for check in failed)
                print(key, "FAIL " + ",".join(failed) if failed else "ok")
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
