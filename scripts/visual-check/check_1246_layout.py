#!/usr/bin/env python3
"""카드 #1246 셸 UI 다듬기의 항목 3~9를 1180과 360 폭에서 화면으로 잰다.

항목 3: 분할 칸, 탭 판, 구역, 대화상자 본문에서 차트 틀 아래 끝과 칸 아래 끝의 차이가 12px(±1).
        구역 안에서 차트 틀 아래 끝과 다음 표 위 끝의 차이: 같은 쌓기(간격 없음)와 중첩(쌓기 > [쌓기 > [차트], 표])은
        12px(±1), 중첩 간격 medium은 같은 쌓기 간격 medium과 같음(±1), 조작 줄 꼴(쌓기 medium > [고르기 줄,
        쌓기 > [숨은 갈래, 차트], 표])은 main 화면에서 잰 위아래 값(MAIN_MEASURED)과 같음(±1).
        구역 끝 차트: 탭 판과 창 본문의 쌓기(간격 없음) > [구역(차트), 표]는 차트 틀 아래 끝과 표 위 끝이 12px(±1),
        창 본문 > [구역(차트), 구역(표)]는 둘째 구역 첫 내용 위 끝까지가 main에서 잰 값과 같음(±1),
        [표, 구역(차트)]는 탭 판 아래 끝, 본문 스크롤 내용 끝(끝까지 내렸을 때)까지가 12px(±1).
항목 4: 선, 면적 차트 초점 상태에서 초점 테두리가 plot에 그려지고 x축 첫 글, 끝 글 상자와 겹치지 않음.
항목 5: 한 축의 눈금 글 오른끝 x 차이가 1px 이하(음수 눈금이 있는 축 포함). 눈금 글은 기대한 글 그대로.
항목 6: 값이 없는 계열이 범례와 읽기 줄과 접근성 표에 없고, 남은 계열 색이 원래 index 그대로임.
        쌓지 않은 막대에서 빈 계열이 낀 장면의 막대 폭과 x가 빈 계열을 뺀 장면과 같음(±1px).
항목 7: 360 폭 몫 표 꼴(긴 이름 fill 열 + 「44%」 몫 열 + 값 열)에서 숫자 열 폭 -
        (가장 긴 글 폭 + 칸 좌우 여백 + 정렬표 자리 19px)이 4px 이하이고, 실제 화면의 머리 칸과
        값 칸이 잘리지 않으며 머리가 한 줄이고 표 스크롤 상자와 칸이 가로로 넘치지 않음. 머리 단추를 눌러
        aria-sort가 ascending, descending으로 바뀐 뒤에도 같고 열 폭이 움직이지 않음.
        apps/profiler.json의 좁은 숫자 열과 예제 앱(block-gallery) 표도 실제 정의 그대로 잘리지 않음.
        표마다 열과 행 개수를 기대값(TABLE_COUNTS)으로 단언한다.
항목 8: 360 폭, 알림이 떠 있고 본문을 끝까지 내렸을 때 마지막 블록(글이 그려진, 높이가 있는 칸) 아래 끝이
        알림 위 끝보다 8px 이상 위. 알림을 닫으면 본문 아래 여백이 알림 전과 같아짐. 5초짜리 상태 알림만
        떴을 때는 여백이 늘지 않음.
항목 9: 받는 중 뼈대 높이와 다 받은 뒤 차트 높이 차이가 2px 이하(compact/medium/tall 전부).
        받는 중 측정 전에 뼈대(ks-chart-loading)가 실제로 그려졌는지 확인함.

  python3 scripts/visual-check/check_1246_layout.py --output <산출폴더> [--port 포트]
  python3 scripts/visual-check/check_1246_layout.py --self-test
  python3 scripts/visual-check/check_1246_layout.py --reference --output <산출폴더>   (main 화면에서 MAIN_MEASURED를 다시 잴 때)

중립 미리보기 ?preview=data-controls에 장면 정의를 주입하고, 항목 8만 ?preview=notice-fixture를 쓴다.
서버는 이 체크아웃의 ui/harness/e2e-server.mjs를 KS_E2E_PORT로 띄운다. 판정이 하나라도 어긋나면
result.json과 캡처를 남기고 종료 코드 1로 끝난다. 산출물은 --output 폴더에만 쓴다.
시작할 때마다 판정기 자기 확인(layout_1246_verdicts.self_test)을 돌리고, 심은 위반이 통과하면 종료 코드 2로 끝난다.
장면과 측정 JS는 layout_1246_fixtures.py, 판정은 모두 layout_1246_verdicts.py의 함수가 한다.
--reference는 판정 없이 main과 비교하는 장면만 재서 result.json의 reference에 남긴다. ui 소스를 main으로 둔 체크아웃에서
돌려 MAIN_MEASURED를 갱신한다.
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

import check_chart_series as api
from layout_1246_fixtures import (
    APP_ID, BARS_JS, CONTROL_ROW_STATE, DAYS, EMPTY_SERIES_JS, FOCUS_JS, HEIGHT_JS, ITEM3_JS, NARROW, NOTICE_APP, NOTICE_JS,
    SECTION_END_JS, STACK_GAP_JS, TABLE_JS, TICK_JS, WIDE, control_row_scene, dialog_scene, empty_series_scene, focus_scene,
    loaded_scene, loading_scene, long_body_scene, section_end_scene, section_scene, section_stack_scene, share_table_scene,
    split_scene, tick_scene, two_series_scene)
from layout_1246_verdicts import (
    bar_slot_verdicts, focus_verdict, legend_verdict, notice_closed_verdict, notice_verdict, pane_gap_verdicts,
    section_end_verdicts, self_test, skeleton_verdict, slack, sort_verdict, stack_gap_verdicts, status_notice_verdict,
    table_verdict, tick_verdict, widths_stable_verdict)

# 표마다 (열 개수, 행 개수). 몫 표는 share_table_scene, profiler는 apps/profiler.json 첫 표와 하니스 자료,
# gallery는 block-gallery 「표와 트리」 탭의 첫 표다. 다른 표나 빈 표를 재면 실패한다.
TABLE_COUNTS = {"share": (3, 4), "profiler": (7, 3), "gallery": (4, 4)}
# tick_scene 두 축의 눈금 글(위에서 아래로).
TICK_TEXTS = [["$2.50", "$0.00", "-$2.50"], ["3", "0", "-3"]]
# 항목 3의 구역 > 쌓기 > 차트, 표 장면들. 이름, 장면, 고르기 상태.
STACK_SCENES = (
    ("same-none", lambda: section_stack_scene("none"), None),
    ("nested-none", lambda: section_stack_scene("none", nested=True), None),
    ("same-medium", lambda: section_stack_scene("medium"), None),
    ("nested-medium", lambda: section_stack_scene("medium", nested=True), None),
    ("control", control_row_scene, CONTROL_ROW_STATE),
)
# 항목 3의 구역 끝 차트 장면들. 이름, (자리, 쌓기 칸 차례), 잴 끝(SECTION_END_JS의 target), 개수 기대값.
SECTION_END_SCENES = (
    ("tab-chart-table", ("tab", "chart-table"), "table", {"panels": 1}),
    ("body-chart-table", ("body", "chart-table"), "table", {}),
    ("body-chart-section", ("body", "chart-section"), "section", {"sections": 2}),
    ("tab-table-chart", ("tab", "table-chart"), "panel", {"panels": 1}),
    ("body-table-chart", ("body", "table-chart"), "body", {}),
)
# main 화면에서 같은 장면을 실제로 잰 값(px). ui 소스를 main(MAIN_COMMIT)으로 둔 체크아웃에서 --reference로 쟀다.
# 조작 줄 꼴의 아래(차트 틀 → 표), 위(고르기 줄 → 차트 틀)와 [구역(차트), 구역(표)]의 차트 틀 → 둘째 구역 첫 내용.
MAIN_COMMIT = "88910a237cec93e9a60d99bb99cc563c681a3805"
MAIN_MEASURED = {
    1180: {"control": {"below": 24, "above": 24}, "body-chart-section": {"below": 20}},
    360: {"control": {"below": 24, "above": 24}, "body-chart-section": {"below": 20}},
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


def inject(page, layout, app_id=APP_ID, state=None):
    page.evaluate(
        """async ([layout, state, appId]) => {
          const harness = window.__ksHarness;
          const { snapshot } = await harness.call({ op: 'state.get' });
          const version = snapshot.shared.app_versions.find((v) => v.app_id === appId);
          version.definition.state = state ?? {};
          version.definition.requires = { ...(version.definition.requires ?? {}), blocks: 62 };
          version.definition.ui = layout;
          version.version += 1;
          const win = snapshot.shared.windows.find((w) => w.app_id === appId);
          win.app_version = version.version;
          win.state = state ?? {};
          harness.emit({ event: 'state.changed', snapshot });
        }""",
        [layout, state, app_id],
    )
    page.wait_for_timeout(550)


def open_page(page, port, app_id=APP_ID):
    page.goto(f"http://127.0.0.1:{port}/?preview={app_id}")
    page.wait_for_function(
        f"() => window.__ksHarness && document.querySelector('[data-testid=app-window-{app_id}]')",
        timeout=120000,
    )
    page.add_style_tag(content=api.STYLE)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(450)


def record(result, key, verdicts):
    result["scenes"][key] = {"verdicts": verdicts}
    for verdict, passed in verdicts.items():
        if not passed:
            result["failures"].append(f"{key}: {verdict}")
    print(key, "ok" if all(verdicts.values()) else "FAIL " + ",".join(
        name for name, ok in verdicts.items() if not ok), flush=True)


def capture(output, result, page, name):
    path = output / f"check1246-{name}.png"
    page.screenshot(path=str(path), animations="disabled")
    result["captures"].append(str(path))


def check_item3(page, output, result):
    for name, scene in (("split", split_scene()), ("section", section_scene()), ("dialog", dialog_scene())):
        inject(page, scene)
        for width, height in (WIDE, NARROW):
            page.set_viewport_size({"width": width, "height": height})
            page.wait_for_timeout(450)
            measured = page.evaluate(ITEM3_JS, APP_ID)
            if isinstance(measured, dict) and measured.get("error"):
                raise AssertionError(measured["error"])
            key = f"item3-{name}-{width}"
            record(result, key, pane_gap_verdicts(measured, 2 if name == "split" else 1))
            result["scenes"][key]["measurement"] = measured
            capture(output, result, page, key)
    check_item3_stacks(page, output, result)
    check_item3_section_end(page, output, result)


def measure_item3(page, output, result, scenes, js_args):
    """장면마다 1180, 360 폭에서 재고 캡처한다. js_args(장면 이름)는 측정 JS와 그 인자다."""
    measured = {}
    for name, scene, state in scenes:
        inject(page, scene, state=state)
        for width, height in (WIDE, NARROW):
            page.set_viewport_size({"width": width, "height": height})
            page.wait_for_timeout(450)
            js, arg = js_args(name)
            measured[(name, width)] = page.evaluate(js, arg)
            capture(output, result, page, f"item3-{name}-{width}")
    return measured


def stack_scenes():
    return [(name, scene(), state) for name, scene, state in STACK_SCENES]


def section_end_scenes():
    return [(name, section_end_scene(*shape), None) for name, shape, _, _ in SECTION_END_SCENES]


def section_end_target(name):
    return next(target for scene, _, target, _ in SECTION_END_SCENES if scene == name)


def check_item3_stacks(page, output, result):
    """구역 안 차트 뒤에 표가 이어질 때, 쌓기의 중첩 깊이와 상관없이 차트가 아래 여백을 남기는지."""
    measured = measure_item3(page, output, result, stack_scenes(), lambda name: (STACK_GAP_JS, APP_ID))
    for width, _ in (WIDE, NARROW):
        same_medium = measured[("same-medium", width)]
        main = MAIN_MEASURED[width]["control"]
        verdicts = {
            "same-none": stack_gap_verdicts(measured[("same-none", width)], below=12),
            "nested-none": stack_gap_verdicts(measured[("nested-none", width)], below=12),
            "same-medium": stack_gap_verdicts(same_medium),
            "nested-medium": stack_gap_verdicts(measured[("nested-medium", width)], below=same_medium["below"]),
            "control": stack_gap_verdicts(measured[("control", width)], below=main["below"], above=main["above"], control=True),
        }
        for name, _, _ in STACK_SCENES:
            key = f"item3-{name}-{width}"
            record(result, key, verdicts[name])
            result["scenes"][key]["measurement"] = measured[(name, width)]


def check_item3_section_end(page, output, result):
    """구역 끝 차트: 구역 뒤에 블록이 이어지면 차트가 아래 여백을 남기고, 구역이 칸 바닥에 닿으면 여백은 한 겹이다."""
    measured = measure_item3(page, output, result, section_end_scenes(),
                             lambda name: (SECTION_END_JS, [APP_ID, section_end_target(name)]))
    for width, _ in (WIDE, NARROW):
        for name, _, _, counts in SECTION_END_SCENES:
            expected = MAIN_MEASURED[width][name]["below"] if name in MAIN_MEASURED[width] else 12
            key = f"item3-{name}-{width}"
            record(result, key, section_end_verdicts(measured[(name, width)], expected, **counts))
            result["scenes"][key]["measurement"] = measured[(name, width)]
            result["scenes"][key]["expected_below"] = expected


def measure_reference(page, output, result):
    """판정 없이 main과 비교하는 장면을 잰다. ui 소스를 main으로 둔 체크아웃에서 MAIN_MEASURED를 다시 잴 때 쓴다."""
    stacks = measure_item3(page, output, result, stack_scenes(), lambda name: (STACK_GAP_JS, APP_ID))
    ends = measure_item3(page, output, result, section_end_scenes(),
                         lambda name: (SECTION_END_JS, [APP_ID, section_end_target(name)]))
    reference = {}
    for (name, width), value in {**stacks, **ends}.items():
        reference.setdefault(width, {})[name] = {"below": value["below"], **({"above": value["above"]} if "above" in value else {})}
    result["reference"] = reference
    print(json.dumps(reference, ensure_ascii=False), flush=True)


def focus_chart(page, index):
    page.evaluate("() => document.activeElement instanceof HTMLElement && document.activeElement.blur()")
    for _ in range(120):
        page.keyboard.press("Tab")
        current = page.evaluate("""() => {
          const active = document.activeElement;
          const win = document.querySelector('[data-testid="app-window-data-controls"]');
          return { graph: Boolean(active && active.classList.contains('ks-chart-graph')),
                   index: win ? [...win.querySelectorAll('.ks-chart')].findIndex((chart) => chart.contains(active)) : -1 };
        }""")
        if current["graph"] and current["index"] == index:
            return True
    return False


def check_item4(page, output, result):
    inject(page, focus_scene())
    for width, height in (WIDE, NARROW):
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(400)
        for index, kind in ((0, "line"), (1, "area")):
            reached = focus_chart(page, index)
            page.wait_for_timeout(200)
            measured = page.evaluate(FOCUS_JS)
            key = f"item4-{kind}-{width}"
            record(result, key, focus_verdict(reached, measured, index, DAYS[0], DAYS[3]))
            result["scenes"][key]["measurement"] = measured
            capture(output, result, page, key)


def check_item5(page, output, result):
    inject(page, tick_scene())
    for width, height in (WIDE, NARROW):
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(450)
        measured = page.evaluate(TICK_JS, APP_ID)
        key = f"item5-{width}"
        record(result, key, tick_verdict(measured, TICK_TEXTS))
        result["scenes"][key]["measurement"] = measured
        capture(output, result, page, key)


def check_item6(page, output, result):
    inject(page, empty_series_scene())
    for width, height in (WIDE, NARROW):
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(450)
        measured = page.evaluate(EMPTY_SERIES_JS, APP_ID)
        key = f"item6-{width}"
        record(result, key, legend_verdict(measured, ["계열 가", "계열 다"], "빈 계열", [1, 3]))
        result["scenes"][key]["measurement"] = measured
        capture(output, result, page, key)
    # 쌓지 않은 묶음 막대: 빈 계열이 낀 장면과 빈 계열을 뺀 장면의 막대 자리를 같은 폭에서 비교한다.
    for width, height in (WIDE, NARROW):
        page.set_viewport_size({"width": width, "height": height})
        inject(page, empty_series_scene())
        page.wait_for_timeout(300)
        with_empty = page.evaluate(BARS_JS, APP_ID)
        capture(output, result, page, f"item6-slots-{width}")
        inject(page, two_series_scene())
        page.wait_for_timeout(300)
        without_empty = page.evaluate(BARS_JS, APP_ID)
        capture(output, result, page, f"item6-two-series-{width}")
        key = f"item6-slots-{width}"
        record(result, key, bar_slot_verdicts(with_empty, without_empty, labels=4))
        result["scenes"][key]["measurement"] = {"with_empty": with_empty, "without_empty": without_empty}


def sort_table(page, app_id, label):
    """머리 단추를 찾아 누른다. 찾았는지와 그 머리의 순서를 돌려준다."""
    clicked = page.evaluate(
        """([appId, label]) => {
          const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
          const table = win && win.querySelector('.ks-table-scroll');
          const headers = table ? [...table.querySelectorAll('.ks-table-header > div')] : [];
          const index = headers.findIndex((header) => {
            const button = header.querySelector('button');
            return button && button.textContent.trim() === label;
          });
          if (index < 0) return { found: false, index: null };
          headers[index].querySelector('button').click();
          return { found: true, index };
        }""",
        [app_id, label],
    )
    page.wait_for_timeout(450)
    return clicked


def measure_table(page, output, result, name, app_id, width, label, slack_limit=False, overflow=False):
    expected = TABLE_COUNTS[name]
    page.set_viewport_size({"width": width, "height": 720})
    page.wait_for_timeout(450)
    measured = page.evaluate(TABLE_JS, app_id)
    key = f"item7-{name}-{width}"
    verdicts = table_verdict(measured, expected, slack_limit=slack_limit, overflow=overflow)
    record(result, key, verdicts)
    result["scenes"][key]["measurement"] = measured
    capture(output, result, page, key)
    if measured.get("error"):
        return
    result["scenes"][key]["slacks"] = [round(slack(column), 1) for column in measured["columns"][1:]]
    base_widths = [column["columnWidth"] for column in measured["columns"]]
    for direction in ("ascending", "descending"):
        clicked = sort_table(page, app_id, label)
        sorted_measured = page.evaluate(TABLE_JS, app_id)
        sorted_key = f"{key}-{direction}"
        verdicts = table_verdict(sorted_measured, expected, slack_limit=slack_limit, overflow=overflow)
        verdicts.update(sort_verdict(clicked, sorted_measured, direction))
        verdicts.update(widths_stable_verdict(base_widths, sorted_measured))
        record(result, sorted_key, verdicts)
        result["scenes"][sorted_key]["measurement"] = sorted_measured
        result["scenes"][sorted_key]["clicked"] = clicked
        capture(output, result, page, sorted_key)
    # 다음 폭의 기준 측정이 정렬 없는 상태에서 시작하도록 한 번 더 눌러 정렬을 푼다.
    clicked = sort_table(page, app_id, label)
    reset = page.evaluate(TABLE_JS, app_id)
    record(result, f"{key}-reset", sort_verdict(clicked, reset, "none"))


def check_item7(page, output, result):
    inject(page, share_table_scene())
    for width, height in (WIDE, NARROW):
        measure_table(page, output, result, "share", APP_ID, width, "몫", slack_limit=True, overflow=True)
    # 저장소의 실제 앱 정의를 그대로 띄워 좁은 숫자 열을 잰다.
    for name, app_id, label in (("profiler", "profiler", "대기 P95(ms)"), ("gallery", "block-gallery", "크기")):
        open_page(page, result["port"], app_id)
        if app_id == "block-gallery":
            page.get_by_role("tab", name="표와 트리").click()
            page.wait_for_timeout(600)
        for width, height in (WIDE, NARROW):
            measure_table(page, output, result, name, app_id, width, label)


def check_item8(page, output, result):
    page.set_viewport_size({"width": NARROW[0], "height": NARROW[1]})
    open_page(page, result["port"], NOTICE_APP)
    page.evaluate("() => { const panel = document.querySelector('[data-testid=fake-files-panel]'); if (panel) panel.remove(); }")
    inject(page, long_body_scene(), app_id=NOTICE_APP)
    before = page.evaluate(NOTICE_JS, NOTICE_APP)
    # 5초짜리 상태 알림은 본문을 밀지 않아야 한다. 알림 전과 본문 스크롤 창 높이가 같아야 한다.
    page.evaluate("() => window.noticeFixture.show()")
    page.wait_for_timeout(450)
    status = page.evaluate(NOTICE_JS, NOTICE_APP)
    status_key = "item8-status-360"
    record(result, status_key, status_notice_verdict(before, status))
    result["scenes"][status_key]["measurement"] = status
    capture(output, result, page, status_key)
    page.evaluate("() => window.noticeFixture.alert()")
    page.wait_for_timeout(500)
    opened = page.evaluate(NOTICE_JS, NOTICE_APP)
    key = "item8-360"
    record(result, key, notice_verdict(before, opened))
    result["scenes"][key]["measurement"] = {"before": before, "opened": opened}
    capture(output, result, page, key)
    page.evaluate("""() => { const button = document.querySelector('[data-testid="app-window-notice-fixture"] .ks-notice button[aria-label="닫기"]'); if (button) button.click(); }""")
    page.wait_for_timeout(500)
    closed = page.evaluate(NOTICE_JS, NOTICE_APP)
    record(result, f"{key}-closed", notice_closed_verdict(before, closed))
    result["scenes"][f"{key}-closed"]["measurement"] = closed


def check_item9(page, output, result):
    page.set_viewport_size({"width": WIDE[0], "height": WIDE[1]})
    open_page(page, result["port"], APP_ID)
    loading = {}
    for width, height in (WIDE, NARROW):
        page.set_viewport_size({"width": width, "height": height})
        inject(page, loading_scene())
        page.wait_for_timeout(450)
        loading[width] = page.evaluate(HEIGHT_JS, APP_ID)
        capture(output, result, page, f"item9-loading-{width}")
    loaded = {}
    for width, height in (WIDE, NARROW):
        page.set_viewport_size({"width": width, "height": height})
        inject(page, loaded_scene())
        page.wait_for_timeout(450)
        loaded[width] = page.evaluate(HEIGHT_JS, APP_ID)
        capture(output, result, page, f"item9-loaded-{width}")
    for width in (WIDE[0], NARROW[0]):
        skeleton, chart = loading[width], loaded[width]
        key = f"item9-{width}"
        record(result, key, skeleton_verdict(skeleton, chart))
        result["scenes"][key]["measurement"] = {"loading": skeleton, "loaded": chart}


def main(checker=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output")
    parser.add_argument("--port", type=int, default=5397)
    parser.add_argument("--self-test", action="store_true", help="판정기 자기 확인만 하고 끝낸다")
    parser.add_argument("--reference", action="store_true", help="판정 없이 main과 비교하는 장면만 잰다")
    args = parser.parse_args()
    broken = self_test()
    if broken:
        print("판정기 자기 확인 실패:", *broken, sep="\n  ", flush=True)
        return 2
    print("판정기 자기 확인 통과", flush=True)
    if args.self_test:
        return 0
    if not args.output:
        parser.error("--output이 필요합니다")
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = {"port": args.port, "windows": {"wide": list(WIDE), "narrow": list(NARROW)},
              "scenes": {}, "failures": [], "captures": []}
    with open(output / "server.log", "w") as log:
        server = subprocess.Popen(["node", "./harness/e2e-server.mjs"], cwd=api.ROOT / "ui",
                                  env={**os.environ, "KS_E2E_PORT": str(args.port)},
                                  stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT)
        try:
            wait_server(args.port)
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch()
                context = browser.new_context(locale="ko-KR", viewport={"width": WIDE[0], "height": WIDE[1]})
                page = context.new_page()
                page.add_init_script("window.dataSampleGate = { wait: () => new Promise((resolve) => { window.__releaseSample = resolve; }) };")
                open_page(page, args.port, APP_ID)
                if args.reference:
                    measure_reference(page, output, result)
                elif checker:
                    checker(page, output, result)
                else:
                    check_item3(page, output, result)
                    check_item4(page, output, result)
                    check_item5(page, output, result)
                    check_item6(page, output, result)
                    check_item7(page, output, result)
                    check_item8(page, output, result)
                    check_item9(page, output, result)
                browser.close()
        finally:
            server.stdin.close()
            try:
                server.wait(timeout=20)
            except subprocess.TimeoutExpired:
                server.kill()
    result["ok"] = not result["failures"]
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(result['scenes'])} scenes, {len(result['failures'])} failures", flush=True)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
