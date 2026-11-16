#!/usr/bin/env python3
"""카드 #1340 셸 화면 결함 넷을 1180과 360 폭에서 화면으로 잰다.

항목 1: 기본 채움 칸(마지막 자식)이 넘칠 때 높이 0으로 접히지 않는지. 글·목록 채움 칸은
        「내용 높이와 --ks-pane-min-size(160px) 가운데 작은 값」 이상을 받고, 차트를 담은 채움 칸은
        160 상한 없이 차트 내용 높이 전체를 받는다(스크롤 주인을 끝까지 내리면 차트가 다 보이고
        채움 칸 안은 굴러가지 않는다). 차트 장면은 1180×720, 360×720, 쉘 최소 창 384×317에서 잰다.
항목 2: 간격 있는 쌓기 안에서 차트와 이웃 블록 사이 간격이 그 쌓기의 gap 한 값인지(아래와 위).
        gap none은 지금처럼 12px다.
항목 3: 선, 면적, 막대 차트(한 계열과 두 계열)에 초점을 주고 첫 시점과 마지막 시점을 고른 상태에서
        초점 고리가 차트 틀(.ks-chart-frame)에 안쪽으로 그려지고, 그래프 상자에는 테두리가 없으며,
        고리 띠가 점·막대, x축 글자, 범례, 읽기 줄과 겹치지 않는지.
항목 4: 오른쪽 맞춤 숫자 열 머리 글자의 오른끝이 정렬 없음, 오름, 내림 세 상태에서 같고(1px 이내),
        아래 숫자 칸 글자의 오른끝과 같은지. 정렬 표시는 정렬한 상태에만 있고 열 폭은 그대로다.

  python3 scripts/visual-check/check_1340_layout.py --output <산출폴더> [--port 포트]
  python3 scripts/visual-check/check_1340_layout.py --self-test

중립 미리보기 ?preview=data-controls에 장면 정의를 주입한다. 서버는 이 체크아웃의
ui/harness/e2e-server.mjs를 KS_E2E_PORT로 띄운다. 판정이 하나라도 어긋나면 result.json과 캡처를
남기고 종료 코드 1로 끝난다. 산출물은 --output 폴더에만 쓴다. 시작할 때마다 판정기 자기 확인
(layout_1340_verdicts.self_test와 다시 쓰는 layout_1246_verdicts.self_test)을 돌리고, 심은 위반이
통과하면 종료 코드 2로 끝난다.
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
from check_1246_layout import focus_chart, open_page, sort_table
from layout_1246_fixtures import (
    APP_ID, CONTROL_ROW_STATE, NARROW, STACK_GAP_JS, WIDE, control_row_scene, section_stack_scene, share_table_scene)
from layout_1246_verdicts import UNCHECKED, self_test as self_test_1246
from layout_1246_verdicts import stack_gap_verdicts, widths_stable_verdict
from layout_1340_fixtures import (
    ARIA_JS, CHART_FILL_SCENES, DOT_JS, FILL_JS, FILL_SCENES, GAP_PX, HEADER_JS, focus_bar_single_section_scene,
    focus_bar_single_stack_scene, focus_line_single_scene, focus_two_series_scene)
from layout_1340_verdicts import chart_fill_verdicts, dot_outline_verdicts, fill_floor_verdicts
from layout_1340_verdicts import header_alignment_verdicts
from layout_1340_verdicts import self_test as self_test_1340

# 항목 2의 장면들. 이름, 장면, 기대 아래 간격, 기대 위 간격(None이면 재지 않음).
# 간격 없는 쌓기는 지금처럼 차트가 자기 아래 여백 12px를 남긴다(쌓기 gap이 0이라 간격을 맡지 않는다).
GAP_SCENES = (
    ("same-none", lambda: section_stack_scene("none"), 12, None),
    ("same-small", lambda: section_stack_scene("small"), GAP_PX["small"], None),
    ("same-medium", lambda: section_stack_scene("medium"), GAP_PX["medium"], None),
    ("same-large", lambda: section_stack_scene("large"), GAP_PX["large"], None),
    ("control", control_row_scene, GAP_PX["medium"], GAP_PX["medium"]),
)
# 항목 3: 장면마다 (차트 index, 이름)과 그 시점들. 두 계열 장면(선, 면적)은 그대로 두고,
# 범례 없는 한 계열(선, 막대 둘)을 더한다. 막대는 시점 일곱 개라 끝 시점 index가 6이다.
FOCUS_SCENES = (
    ("two-series", focus_two_series_scene, ((0, "line", 3), (1, "area", 3))),
    ("single-line", focus_line_single_scene, ((0, "single-line", 3),)),
    ("single-bar-stack", focus_bar_single_stack_scene, ((0, "single-bar-stack", 6),)),
    ("single-bar-section", focus_bar_single_section_scene, ((0, "single-bar-section", 6),)),
)
NUMERIC_LABELS = ["몫", "값"]


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


def wait_server(port):
    deadline = time.time() + 240
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}", timeout=5)
            return
        except Exception:
            time.sleep(2)
    raise SystemExit("하네스 서버가 뜨지 않았습니다")


def record(result, key, verdicts):
    result["scenes"][key] = {"verdicts": verdicts}
    for verdict, passed in verdicts.items():
        if not passed:
            result["failures"].append(f"{key}: {verdict}")
    print(key, "ok" if all(verdicts.values()) else "FAIL " + ",".join(
        name for name, ok in verdicts.items() if not ok), flush=True)


def capture(output, result, page, name):
    path = output / f"check1340-{name}.png"
    page.screenshot(path=str(path), animations="disabled")
    result["captures"].append(str(path))


def check_fill(page, output, result):
    """항목 1: 기본 채움 칸이 넘칠 때 0으로 접히거나 차트를 잘라 내는지."""
    for scenes, verdict in ((FILL_SCENES, fill_floor_verdicts), (CHART_FILL_SCENES, chart_fill_verdicts)):
        for name, scene, owner, sizes in scenes:
            inject(page, scene())
            for width, height in sizes:
                page.set_viewport_size({"width": width, "height": height})
                page.wait_for_timeout(450)
                measured = page.evaluate(FILL_JS, [APP_ID, owner])
                key = f"item1-{name}-{width}"
                record(result, key, verdict(measured))
                result["scenes"][key]["measurement"] = measured
                capture(output, result, page, key)


def check_gap(page, output, result):
    """항목 2: 간격 있는 쌓기의 차트 앞뒤 간격이 쌓기 gap 하나인지."""
    for name, scene, below, above in GAP_SCENES:
        # 조작 줄 꼴은 고르기 칸이 빈 글로 찍히지 않도록 상태를 준다. 다른 장면은 상태가 필요 없다.
        inject(page, scene(), state=CONTROL_ROW_STATE if name == "control" else None)
        for width, height in (WIDE, NARROW):
            page.set_viewport_size({"width": width, "height": height})
            page.wait_for_timeout(450)
            measured = page.evaluate(STACK_GAP_JS, APP_ID)
            key = f"item2-{name}-{width}"
            verdicts = stack_gap_verdicts(measured, below=below, above=UNCHECKED if above is None else above,
                                          control=name == "control")
            record(result, key, verdicts)
            result["scenes"][key]["measurement"] = measured
            result["scenes"][key]["expected"] = {"below": below, "above": above}
            capture(output, result, page, key)


def check_dots(page, output, result):
    """항목 3: 초점 고리가 차트 틀에 그려지고 점·막대, 축 글자, 범례, 읽기 줄을 지나지 않는지."""
    for scene_name, scene, charts in FOCUS_SCENES:
        inject(page, scene())
        for width, height in (WIDE, NARROW):
            page.set_viewport_size({"width": width, "height": height})
            page.wait_for_timeout(400)
            for index, kind, last in charts:
                for point, point_name in ((0, "first"), (last, "last")):
                    if not focus_chart(page, index):
                        key = f"item3-{kind}-{point_name}-{width}"
                        record(result, key, {"focused": False})
                        result["scenes"][key]["measurement"] = {"focusedIndex": None, "scene": scene_name}
                        continue
                    page.keyboard.press("Home" if point == 0 else "End")
                    page.wait_for_timeout(250)
                    measured = page.evaluate(DOT_JS)
                    measured["scene"] = scene_name
                    key = f"item3-{kind}-{point_name}-{width}"
                    record(result, key, dot_outline_verdicts(measured, index, point))
                    result["scenes"][key]["measurement"] = measured
                    capture(output, result, page, key)
                    # 다음 재기가 같은 차트에서 시작하도록 초점을 놓는다.
                    page.evaluate("() => document.activeElement instanceof HTMLElement && document.activeElement.blur()")


def check_header(page, output, result):
    """항목 4: 숫자 열 머리 글자의 오른끝이 정렬 세 상태에서 같은지."""
    inject(page, share_table_scene())
    for width, height in (WIDE, NARROW):
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(450)
        states = []
        # 앞 폭에서 남은 정렬을 풀어 세 상태를 정렬 없음에서 시작한다.
        for _ in range(3):
            if all(sort == "none" for sort in (page.evaluate(ARIA_JS, APP_ID) or [])):
                break
            sort_table(page, APP_ID, "몫")
        measured = page.evaluate(HEADER_JS, APP_ID)
        if measured.get("error"):
            record(result, f"item4-{width}", {"table_found": False})
            continue
        states.append({"state": "none", "ariaSort": measured["ariaSort"], "columns": measured["columns"]})
        widths = [column["columnWidth"] for column in measured["columns"]]
        for state in ("ascending", "descending"):
            clicked = sort_table(page, APP_ID, "몫")
            sorted_measured = page.evaluate(HEADER_JS, APP_ID)
            if not clicked.get("found") or sorted_measured.get("error"):
                record(result, f"item4-{width}-{state}", {"sort_button_found": False})
                continue
            states.append({"state": state, "ariaSort": sorted_measured["ariaSort"], "columns": sorted_measured["columns"]})
            capture(output, result, page, f"item4-{width}-{state}")
        key = f"item4-{width}"
        record(result, key, header_alignment_verdicts(states, NUMERIC_LABELS, widths=widths))
        result["scenes"][key]["measurement"] = states
        capture(output, result, page, key)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output")
    parser.add_argument("--port", type=int, default=5431)
    parser.add_argument("--self-test", action="store_true", help="판정기 자기 확인만 하고 끝낸다")
    args = parser.parse_args()
    broken = self_test_1340() + self_test_1246()
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
                check_fill(page, output, result)
                check_gap(page, output, result)
                check_dots(page, output, result)
                check_header(page, output, result)
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
