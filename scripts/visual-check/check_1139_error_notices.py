#!/usr/bin/env python3
"""카드 #1139 알림 문구의 실화면 검수.

  1. 고르기 묶음에서 고른 값의 이름이 다른 묶음에도 있을 때만 값 옆에 묶음 이름이 보이는지.
     - 같은 이름이 다른 묶음에 없으면 값만 보인다(가까운 곳의 부산).
     - 다른 묶음에도 같은 이름이 있으면 어느 묶음인지 밝힌다(먼 곳의 서울).
     - 탭 안의 고르기에서도 겹칠 때 밝힌 묶음 이름이 보인다(탭 패널은 이름표 접미사만 숨긴다).

  2. 파일 드롭 거절 알림에서 형식이 다섯 이상이면 넷만 나열하고 전체 개수를 밝히는지.
     - 이 하네스 미리보기에는 클라이언트 런타임과 드롭 경로가 없어 실제 드롭 알림을 띄울 수 없다.
       이 항목은 단위 시험(ui/src/__tests__/client-runtime-files.test.ts,
       "거절 안내는 형식이 다섯 이상이면 넷만 나열하고 전체 개수를 밝힌다")이 잰다.

  3. 세라피엘 PR #574 반려 장면(카드 #1139 보완).
     - long-inline-tab: 탭 안에서 긴 묶음 이름과 긴 값이 겹칠 때 좁은 폭(360×240)과 창 크기 바꾸기에서도
       고른 값이 폭 0으로 밀리지 않고 묶음 이름보다 좁지 않은지.
     - long-label-top: 이름표 위(top) 배치의 좁은 폭에서 같은 판정.
     - long-inline-tab-sweep, long-label-top-sweep: 1180에서 연 창을 760부터 360까지 줄여 가며, 묶음 이름이
       조금이라도 보이는 동안 고른 값이 한 글자도 잘리지 않는지(값 상자 폭 >= 값 글 폭).
     - toolbar-duplicate: 도구 막대 안에서 값, 묶음 이름, 펼침 표시 사이 간격이 단추 gap과 같은지.
     - segmented-groups: 분할 모양에서 두 묶음의 같은 이름(서울)이 접근 이름과 묶음 이름 표시로 구분되는지.

  python3 -P scripts/visual-check/check_1139_error_notices.py [--output 산출폴더] [--port 포트]

중립 미리보기 ?preview=data-views-test에 장면 정의를 주입하고 1180×720과 360×240에서 잰다.
실제 개인 앱 정의는 쓰지 않는다. 기본 산출 폴더는 target/visual-check/card1139이고,
서버는 이 체크아웃의 ui/harness/e2e-server.mjs를 KS_E2E_PORT로 띄운다.

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
STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"
SIZES = ((1180, 720), (360, 240))

# 같은 이름(서울)이 두 묶음에 있고, 부산은 한 묶음에만 있다.
PLACE_OPTIONS = [
    {"name": "가까운 곳", "options": [{"value": "seoul", "label": "서울"}, {"value": "busan", "label": "부산"}]},
    {"name": "먼 곳", "options": [{"value": "tokyo", "label": "도쿄"}, {"value": "seoul-far", "label": "서울"}]},
]
select_groups = {
    "type": "stack", "direction": "column", "gap": "medium", "children": [
        {"type": "select", "label": "장소", "label_position": "top", "value": {"state": "choice"}, "on_change": {"set_state": "choice"}, "options": PLACE_OPTIONS},
        {"type": "text", "value": "고른 곳"},
    ],
}

# (이름, 화면 정의, 고른 값, 보여야 하는 값 이름, 보이면 안 되는 묶음, 보여야 하는 묶음, 탭 안인지)
tab_select_groups = {"type": "tabs", "tabs": [{"label": "설정", "child": select_groups}]}
SCENES = [
    ("select-group-unique", select_groups, "busan", "부산", "가까운 곳", None, False),
    ("select-group-duplicated", select_groups, "seoul-far", "서울", "가까운 곳", "먼 곳", False),
    ("select-group-in-tab", tab_select_groups, "seoul-far", "서울", "가까운 곳", "먼 곳", True),
]

SELECT_JS = """(el) => {
  const button = el.querySelector('.ks-select-button');
  if (!button) return { error: '고르기 단추를 찾지 못했습니다' };
  return {
    text: button.textContent,
    choice: button.querySelector('.ks-select-choice-label') ? button.querySelector('.ks-select-choice-label').textContent : null,
    groupLabels: [...button.querySelectorAll('.ks-select-group-label, .ks-select-context-label')].map((node) => ({ text: node.textContent, visible: node.checkVisibility() })),
    inTabPanel: button.closest('.ks-data-tab-panel') !== null,
  };
}"""

# 반려 1, 3: 고른 값과 묶음 이름의 폭과 간격을 잰다.
SELECT_WIDTH_JS = """(el) => {
  const button = el.querySelector('.ks-select-button');
  if (!button) return { error: '고르기 단추를 찾지 못했습니다' };
  const rect = (node) => { if (!node) return null; const box = node.getBoundingClientRect(); return { left: box.left, right: box.right }; };
  const choice = button.querySelector('.ks-select-choice-label');
  const context = button.querySelector('.ks-select-context-label');
  const chevron = button.querySelector(':scope > svg');
  const textWidth = (node) => { if (!node) return null; const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect().width; };
  return {
    choiceBoxWidth: choice ? choice.getBoundingClientRect().width : null,
    choiceTextWidth: textWidth(choice),
    contextBoxWidth: context ? context.getBoundingClientRect().width : null,
    contextTextWidth: textWidth(context),
    choiceText: choice ? choice.textContent : null,
    contextText: context ? context.textContent : null,
    choiceClientWidth: choice ? choice.clientWidth : null,
    contextClientWidth: context ? context.clientWidth : null,
    choice: rect(choice), context: rect(context), chevron: rect(chevron),
    gap: parseFloat(getComputedStyle(button).columnGap),
    docOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}"""

# 반려 2: 분할 고르기 선택지 단추의 접근 이름과 묶음 이름 표시를 잰다.
SEGMENTED_JS = """(el) => {
  const group = el.querySelector('.ks-data-segmented');
  if (!group) return { error: '분할 고르기를 찾지 못했습니다' };
  return {
    docOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    buttons: [...group.querySelectorAll(':scope > .ks-button')].map((button) => ({
      label: button.querySelector('.ks-truncate-label') ? button.querySelector('.ks-truncate-label').textContent : null,
      aria: button.getAttribute('aria-label'),
      name: button.getAttribute('aria-label') || button.textContent,
      contexts: [...button.querySelectorAll('.ks-select-context-label')].map((node) => node.textContent),
      contextGap: button.querySelector('.ks-truncate-label') && button.querySelector('.ks-select-context-label') ? button.querySelector('.ks-select-context-label').getBoundingClientRect().left - button.querySelector('.ks-truncate-label').getBoundingClientRect().right : null,
      pressed: button.getAttribute('aria-pressed'),
    })),
  };
}"""

LONG_GROUPS = [
    {"name": "eias-linegames-wsl", "options": [{"value": "a-opus", "label": "Claude Opus 5.5 (1M 문맥)"}, {"value": "a-argon", "label": "Argon"}]},
    {"name": "eiaserinnys", "options": [{"value": "b-opus", "label": "Claude Opus 5.5 (1M 문맥)"}, {"value": "b-sol", "label": "Sol"}]},
]
LONG_LABEL = "Claude Opus 5.5 (1M 문맥)"
LONG_GROUP = "eias-linegames-wsl"


def select_block(options, label="모델", label_position=None, style=None):
    block = {"type": "select", "label": label, "value": {"state": "choice"}, "on_change": {"set_state": "choice"}, "options": options}
    if label_position:
        block["label_position"] = label_position
    if style:
        block["style"] = style
    return block


long_inline_tab = {"type": "tabs", "tabs": [{"label": "설정", "child": {"type": "stack", "direction": "column", "gap": "medium", "children": [select_block(LONG_GROUPS), {"type": "text", "value": "아래 글"}]}}]}
long_label_top = {"type": "stack", "direction": "column", "gap": "medium", "children": [select_block(LONG_GROUPS, label_position="top"), {"type": "text", "value": "아래 글"}]}
toolbar_duplicate = {"type": "stack", "direction": "column", "gap": "medium", "children": [
    {"type": "toolbar", "start": [select_block(PLACE_OPTIONS, label="장소"), {"type": "button", "label": "적용", "on_click": {"set_state": "value", "value": "x"}}]},
    {"type": "text", "value": "아래 글"}]}
segmented_groups = {"type": "stack", "direction": "column", "gap": "medium", "children": [select_block(PLACE_OPTIONS, label="장소", label_position="top", style="segmented"), {"type": "text", "value": "아래 글"}]}


SUBPIXEL = 0.01
# 반려 r2: 창을 줄여 가며 묶음 이름이 반쯤 줄어드는 중간 폭까지 잰다.
SWEEP_WIDTHS = (760, 700, 640, 600, 560, 520, 480, 440, 420, 400, 380, 360)


def judge_value_room(measurement, value, group_name):
    if measurement.get("error"):
        return {"measured": False}
    return {
        "value_shown": measurement["choiceText"] == value,
        "group_shown": measurement["contextText"] == group_name,
        "choice_has_room": measurement["choiceClientWidth"] > 0,
        "group_not_wider_than_choice": measurement["choiceClientWidth"] >= measurement["contextClientWidth"],
        # 반려 r2: 묶음 이름이 조금이라도 보이는 동안 고른 값은 한 글자도 잘리지 않는다.
        "choice_whole_while_group_visible": measurement["contextBoxWidth"] <= 0 or measurement["choiceBoxWidth"] >= measurement["choiceTextWidth"] - SUBPIXEL,
        "no_doc_overflow": measurement["docOverflowX"] is False,
    }


def judge_gaps(measurement, value, group_name):
    if measurement.get("error"):
        return {"measured": False}
    gap = measurement["gap"]
    return {
        "value_shown": measurement["choiceText"] == value,
        "group_shown": measurement["contextText"] == group_name,
        "before_gap_matches": abs((measurement["context"]["left"] - measurement["choice"]["right"]) - gap) <= 1,
        "after_gap_matches": abs((measurement["chevron"]["left"] - measurement["context"]["right"]) - gap) <= 1,
        # 내용 폭 단추는 값과 묶음 이름을 다 담는 폭으로 선다.
        "choice_whole": measurement["choiceBoxWidth"] >= measurement["choiceTextWidth"] - SUBPIXEL,
        "group_whole": measurement["contextBoxWidth"] >= measurement["contextTextWidth"] - SUBPIXEL,
    }


def judge_segmented(measurement):
    if measurement.get("error"):
        return {"measured": False}
    buttons = measurement["buttons"]
    seoul = [index for index, button in enumerate(buttons) if button["label"] == "서울"]
    with_context = [index for index, button in enumerate(buttons) if button["contexts"]]
    names = [button["name"] for button in buttons]
    pressed = [button for button in buttons if button["pressed"] == "true"]
    return {
        "two_seoul_buttons": len(seoul) == 2,
        "seoul_names_differ": len(seoul) == 2 and names[seoul[0]] != names[seoul[1]],
        "context_on_seoul_only": seoul == with_context and all(len(buttons[index]["contexts"]) == 1 for index in seoul),
        "far_seoul_selected": len(pressed) == 1 and pressed[0]["contexts"] == ["먼 곳"],
        "no_doc_overflow": measurement["docOverflowX"] is False,
        "context_gap_space_2": all(buttons[index]["contextGap"] is not None and abs(buttons[index]["contextGap"] - 8) < 0.5 for index in seoul),
    }


def wait_server(port):
    deadline = time.time() + 240
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}", timeout=5)
            return
        except Exception:
            time.sleep(2)
    raise SystemExit("하네스 서버가 뜨지 않았습니다")


def open_scene(page, port, ui, width, height, state):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{port}/?preview={APP_ID}")
    page.wait_for_function(
        "(id) => window.__ksHarness && document.querySelector(`[data-testid=app-window-${id}]`)",
        arg=APP_ID,
        timeout=120000,
    )
    page.evaluate(
        """async ([appId, layout, appState]) => {
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
        }""",
        [APP_ID, ui, state],
    )
    page.add_style_tag(content=STYLE)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(300)
    return page.get_by_test_id(f"app-window-{APP_ID}")


def judge(measurement, value, hidden_group, shown_group, in_tab):
    if measurement.get("error"):
        return {"measured": False}
    labels = measurement["groupLabels"]
    texts = [label["text"] for label in labels]
    checks = {
        "value_shown": measurement["choice"] == value,
        "shown_group_only_when_duplicated": (texts == []) if shown_group is None else (texts == [shown_group]),
        "hidden_group_absent": hidden_group not in texts,
    }
    if shown_group is not None:
        checks["shown_group_visible"] = all(label["visible"] for label in labels)
    if in_tab:
        checks["inside_tab_panel"] = measurement["inTabPanel"]
    return checks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="target/visual-check/card1139")
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
            page = browser.new_page()
            for name, layout, choice, value, hidden_group, shown_group, in_tab in SCENES:
                for width, height in SIZES:
                    state = {"value": "", "choice": choice, "selected": None, "tab": 0}
                    app = open_scene(page, args.port, layout, width, height, state)
                    key = f"{name}-{width}x{height}"
                    app.locator(".ks-select-button").wait_for()
                    measurement = app.evaluate(SELECT_JS)
                    page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                    checks = judge(measurement, value, hidden_group, shown_group, in_tab)
                    scenes[key] = {"measurement": measurement, "checks": checks}
                    failed = [check for check, ok in checks.items() if not ok]
                    failures.extend(f"{key}.{check}" for check in failed)
                    print(key, "FAIL " + ",".join(failed) if failed else "ok")

            def open_app(layout, choice, width, height, selector):
                state = {"value": "", "choice": choice, "selected": None, "tab": 0}
                app = open_scene(page, args.port, layout, width, height, state)
                app.locator(selector).first.wait_for()
                return app

            def record(key, measurement, judge_fn):
                page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                checks = judge_fn(measurement)
                scenes[key] = {"measurement": measurement, "checks": checks}
                failed = [check for check, ok in checks.items() if not ok]
                failures.extend(f"{key}.{check}" for check in failed)
                print(key, "FAIL " + ",".join(failed) if failed else "ok")

            for width, height in SIZES:
                app = open_app(long_inline_tab, "a-opus", width, height, ".ks-select-button")
                record(f"long-inline-tab-{width}x{height}", app.evaluate(SELECT_WIDTH_JS), lambda m: judge_value_room(m, LONG_LABEL, LONG_GROUP))
            app = open_app(long_inline_tab, "a-opus", 1180, 720, ".ks-select-button")
            page.set_viewport_size({"width": 360, "height": 240})
            page.wait_for_timeout(400)
            record("long-inline-tab-resize-1180-to-360", app.evaluate(SELECT_WIDTH_JS), lambda m: judge_value_room(m, LONG_LABEL, LONG_GROUP))

            app = open_app(long_label_top, "a-opus", 360, 240, ".ks-select-button")
            record("long-label-top-360x240", app.evaluate(SELECT_WIDTH_JS), lambda m: judge_value_room(m, LONG_LABEL, LONG_GROUP))

            for name, layout in (("long-inline-tab", long_inline_tab), ("long-label-top", long_label_top)):
                app = open_app(layout, "a-opus", 1180, 720, ".ks-select-button")
                for width in SWEEP_WIDTHS:
                    page.set_viewport_size({"width": width, "height": 240 if width == 360 else 720})
                    page.wait_for_timeout(250)
                    record(f"{name}-sweep-w{width}", app.evaluate(SELECT_WIDTH_JS), lambda m: judge_value_room(m, LONG_LABEL, LONG_GROUP))

            for width, height in SIZES:
                app = open_app(toolbar_duplicate, "seoul-far", width, height, ".ks-select-button")
                record(f"toolbar-duplicate-{width}x{height}", app.evaluate(SELECT_WIDTH_JS), lambda m: judge_gaps(m, "서울", "먼 곳"))

            for width, height in SIZES:
                app = open_app(segmented_groups, "seoul-far", width, height, ".ks-data-segmented")
                record(f"segmented-groups-{width}x{height}", app.evaluate(SEGMENTED_JS), judge_segmented)
            browser.close()
    finally:
        server.stdin.close()
        try:
            server.wait(timeout=20)
        except subprocess.TimeoutExpired:
            server.kill()

    result = {
        "ok": not failures,
        "failures": failures,
        "notes": {
            "file_drop_notice": "하네스 미리보기에 클라이언트 드롭 경로가 없어 ui/src/__tests__/client-runtime-files.test.ts 단위 시험이 잰다.",
        },
        "scenes": scenes,
    }
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("RESULT", "ok" if not failures else f"{len(failures)} failures", output / "result.json")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
