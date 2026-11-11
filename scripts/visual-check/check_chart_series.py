#!/usr/bin/env python3
"""차트의 계열 색과 쌓은 막대, 범례, 수 형식, 고른 칸, 표 정렬 값을 화면에서 확인한다.

구역 안에 수치 묶음(metrics)과 쌓은 막대 차트, 계열 둘짜리 막대 차트, 정렬 값이 있는 표를
둔다. 쌓은 차트는 시점 일곱, 계열 넷이고 가운데에 빈 값이 있으며, 1월 합계가 66354414,
7월 합계가 160000000이라 한국어 기기에서 눈금이 1.6억, 값 표시가 6635만이 된다. 고른 칸은
1월로 두어 포인터가 다른 칸을 지나 떠난 뒤에도 1월로 돌아오는지 잰다. 둘째 차트는 마지막
시점의 값이 모두 비어 있어, 처음 값 표시가 값이 있는 마지막 칸(2월)인지 잰다.

재는 것: 막대가 축 글자 상자를 침범하지 않는지, 계열마다 색이 다른지, 범례 항목 수,
눈금과 값 표시의 수 형식, 구역 머리 글자 시작선과 수치 묶음 및 차트 테두리의 좌우 끝선,
좁은 폭의 가로 넘침과 범례 줄바꿈, Enter 뒤 초점 유지, 창 폭을 바꿀 때 눈금 자리 재계산,
표 머리를 눌렀을 때 정렬 값 기준 순서.

  python3 scripts/visual-check/check_chart_series.py [--output 산출폴더] [--port 포트]

중립 미리보기 ?preview=data-controls에 장면 정의를 주입하고 넓은 폭 1180×720과 좁은 폭
420×720에서 밝은 테마와 어두운 테마로 잰다. 기본 산출 폴더는
target/visual-check/chart-series 이고, 서버는 이 체크아웃의 ui/harness/e2e-server.mjs를
KS_E2E_PORT로 띄운다. Chromium을 호스트의 주소 변경에서 떼어 두려면 네임스페이스 안에서
돌린다(ui/e2e/run-netns.sh와 같은 이유).

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
APP_ID = "data-controls"
WIDE = (1180, 720)
NARROW = (420, 720)
STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"
LABELS = [f"2026년 {month}월" for month in range(1, 8)]
STATE = {"picked": LABELS[0]}

MEASURE_JS = """(args) => {
  const win = document.querySelector(`[data-testid="app-window-${args.appId}"]`);
  if (!win) return { error: "창을 찾지 못했습니다" };
  const round = (value) => Math.round(value * 100) / 100;
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return { left: round(rect.left), right: round(rect.right), top: round(rect.top), bottom: round(rect.bottom), width: round(rect.width), height: round(rect.height) };
  };
  const glyphX = (element) => {
    if (!element) return null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = range.getClientRects();
      if (rects.length) return round(rects[0].left);
    }
    return round(element.getBoundingClientRect().left);
  };
  const charts = [...win.querySelectorAll('.ks-chart')].map((chart) => {
    const ticks = [...chart.querySelectorAll('.ks-chart-y-axis span')].map((span) => ({ text: span.textContent, ...box(span) }));
    const band = chart.querySelector('.ks-chart-band');
    const legend = chart.querySelector('.ks-chart-legend');
    return {
      plot: box(chart.querySelector('.ks-chart-plot')),
      ticks,
      axisTextRight: Math.max(...ticks.map((tick) => tick.right)),
      bars: [...chart.querySelectorAll('.ks-chart-bar')].map((bar) => ({ ...box(bar), fill: getComputedStyle(bar).fill, color: bar.closest('.ks-chart-series')?.style.getPropertyValue('--ks-chart-series-color') ?? '' })),
      band: band ? box(band) : null,
      frame: box(chart.querySelector('.ks-chart-frame')),
      readoutX: chart.querySelector('.ks-chart-readout-x')?.textContent ?? '',
      readout: chart.querySelector('.ks-chart-readout')?.textContent ?? '',
      legend: legend ? { ...box(legend), items: [...legend.querySelectorAll('.ks-chart-legend-item')].map((item) => ({ text: item.textContent, ...box(item), dot: getComputedStyle(item.querySelector('.ks-list-color')).backgroundColor })) } : null,
      axisLabels: [...chart.querySelectorAll('.ks-chart-x-axis span')].map((span) => ({ text: span.textContent, ...box(span) })),
      headers: [...chart.querySelectorAll('.ks-accessible-hidden th')].map((th) => th.textContent),
    };
  });
  const section = win.querySelector('.ks-data-section');
  const metrics = section && section.querySelector('.ks-metrics');
  return {
    charts,
    section: section ? box(section) : null,
    headerGlyphX: glyphX(section && section.querySelector('.ks-data-section-header')),
    metrics: metrics ? box(metrics) : null,
    cards: metrics ? [...metrics.querySelectorAll('.ks-metric-card')].map((card) => box(card)) : [],
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  };
}"""

TABLE_ROWS_JS = """(args) => {
  const win = document.querySelector(`[data-testid="app-window-${args.appId}"]`);
  if (!win) return { error: "창을 찾지 못했습니다" };
  return [...win.querySelectorAll('.ks-table-row')].map((row) => row.textContent);
}"""

ACTIVE_GRAPH_JS = """() => Boolean(document.activeElement && document.activeElement.classList.contains('ks-chart-graph'))"""


def chart_series():
    return [
        {"key": "alpha", "name": "모델 알파", "color": "#9b59b6", "points": [
            {"x": LABELS[0], "y": 30000000}, {"x": LABELS[1], "y": 24000000}, {"x": LABELS[2], "y": None},
            {"x": LABELS[3], "y": 20000000}, {"x": LABELS[4], "y": 18000000}, {"x": LABELS[5], "y": 16000000},
            {"x": LABELS[6], "y": 40000000}]},
        {"key": "beta", "name": "모델 베타", "points": [
            {"x": LABELS[0], "y": 20000000}, {"x": LABELS[1], "y": 16000000}, {"x": LABELS[2], "y": None},
            {"x": LABELS[3], "y": 14000000}, {"x": LABELS[4], "y": 12000000}, {"x": LABELS[5], "y": 10000000},
            {"x": LABELS[6], "y": 30000000}]},
        {"key": "gamma", "name": "모델 감마", "points": [
            {"x": LABELS[0], "y": None}, {"x": LABELS[1], "y": 12000000}, {"x": LABELS[2], "y": 10000000},
            {"x": LABELS[3], "y": 10000000}, {"x": LABELS[4], "y": 9000000}, {"x": LABELS[5], "y": 8000000},
            {"x": LABELS[6], "y": 20000000}]},
        {"key": "delta", "name": "모델 델타", "points": [
            {"x": LABELS[0], "y": 16354414}, {"x": LABELS[1], "y": 10000000}, {"x": LABELS[2], "y": 9000000},
            {"x": LABELS[3], "y": 8000000}, {"x": LABELS[4], "y": 7000000}, {"x": LABELS[5], "y": 6000000},
            {"x": LABELS[6], "y": 70000000}]},
    ]


def scene():
    return {"type": "stack", "direction": "column", "gap": "none", "children": [
        {"type": "section", "title": "세션 통계", "child": {"type": "stack", "direction": "column", "gap": "none", "children": [
            {"type": "metrics", "items": [
                {"label": "이번 주 세션", "value": "142"},
                {"label": "쓴 토큰", "value": "1.6억"},
                {"label": "가장 많이 쓴 모델", "value": "모델 알파"},
            ]},
            {"type": "chart", "kind": "bar", "stacked": True, "number_format": {"notation": "compact"},
             "selected": {"state": "picked"}, "on_select": {"set_state": "picked"}, "series": chart_series()},
            {"type": "chart", "kind": "bar", "series": [
                {"key": "alpha", "name": "모델 알파", "points": [
                    {"x": LABELS[0], "y": 12}, {"x": LABELS[1], "y": 18}, {"x": LABELS[2], "y": None}]},
                {"key": "beta", "name": "모델 베타", "points": [
                    {"x": LABELS[0], "y": 8}, {"x": LABELS[1], "y": 9}, {"x": LABELS[2], "y": None}]},
            ]},
            {"type": "table", "columns": [{"field": "value", "label": "값", "sort_field": "raw"}], "rows": [
                {"key": "a", "value": "1.5억+", "raw": 150000000},
                {"key": "b", "value": "1.6억+", "raw": 160000000},
                {"key": "c", "value": "6075만+", "raw": 60750000},
                {"key": "d", "value": "6276.2만+", "raw": 62762000},
            ]},
        ]}},
    ]}


def definition():
    return {"id": APP_ID, "name": "차트 검수", "requires": {"blocks": 62}, "state": STATE, "ui": scene()}


def wait_server(port):
    deadline = time.time() + 240
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}", timeout=5)
            return
        except Exception:
            time.sleep(2)
    raise SystemExit("하네스 서버가 뜨지 않았습니다")


def open_scene(page, port):
    page.goto(f"http://127.0.0.1:{port}/?preview={APP_ID}")
    page.wait_for_function(
        "() => window.__ksHarness && document.querySelector('[data-testid=app-window-data-controls]')",
        timeout=120000,
    )
    page.evaluate(
        """async (layout) => {
          const harness = window.__ksHarness;
          const { snapshot } = await harness.call({ op: 'state.get' });
          const version = snapshot.shared.app_versions.find((v) => v.app_id === 'data-controls');
          version.definition.state = %s;
          version.definition.ui = layout;
          version.version += 1;
          const win = snapshot.shared.windows.find((w) => w.app_id === 'data-controls');
          win.app_version = version.version;
          win.state = %s;
          harness.emit({ event: 'state.changed', snapshot });
        }""" % (json.dumps(STATE), json.dumps(STATE)),
        scene(),
    )
    page.add_style_tag(content=STYLE)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(400)
    return page.get_by_test_id(f"app-window-{APP_ID}")


def judge(measurement, width):
    charts = measurement["charts"]
    stacked, plain = charts[0], charts[1]
    verdicts = {
        # 막대가 축 글자 상자와 겹치지 않고 그리기 영역 안에 있다.
        "bars_inside_plot": all(
            bar["left"] >= stacked["plot"]["left"] - 0.5 and bar["right"] <= stacked["plot"]["right"] + 0.5
            for bar in stacked["bars"]),
        "axis_text_clear_of_bars": bool(stacked["ticks"]) and bool(stacked["bars"])
        and min(bar["left"] for bar in stacked["bars"]) - stacked["axisTextRight"] >= 0,
        # 계열마다 다른 색이다(쌓은 막대 넷, 나란한 막대 둘).
        "series_colors_distinct": len({bar["color"] for bar in stacked["bars"]}) == 4
        and len({bar["color"] for bar in plain["bars"]}) == 2,
        "legend_items": bool(stacked["legend"]) and len(stacked["legend"]["items"]) == 4
        and all(item["text"].startswith("모델") for item in stacked["legend"]["items"]),
        # 한국어 기기에서 짧은 수 표기: 눈금 1.6억, 값 표시 6635만.
        "compact_ticks": bool(stacked["ticks"]) and stacked["ticks"][0]["text"] == "1.6억",
        "compact_readout": "6635만" in stacked["readout"],
        "selected_initial": stacked["readoutX"] == LABELS[0],
        "selected_band": bool(stacked["band"]) and abs(stacked["band"]["left"] - stacked["plot"]["left"]) <= 1,
        "initial_last_with_data": plain["readoutX"] == LABELS[1],
        # 구역 머리 글자 시작선, 수치 묶음, 차트 테두리의 좌우 끝선이 맞는다.
        "metrics_left": bool(measurement["cards"]) and measurement["headerGlyphX"] is not None
        and abs(measurement["cards"][0]["left"] - stacked["frame"]["left"]) <= 1
        and abs(measurement["headerGlyphX"] - stacked["frame"]["left"]) <= 1,
        "metrics_right": bool(measurement["cards"])
        and abs(measurement["cards"][-1]["right"] - stacked["frame"]["right"]) <= 1,
        "no_horizontal_overflow": measurement["scrollWidth"] <= measurement["clientWidth"] + 1,
        "legend_fits": bool(stacked["legend"])
        and all(item["right"] <= stacked["frame"]["right"] + 1 for item in stacked["legend"]["items"]),
        "axis_labels_inside_plot": bool(stacked["axisLabels"]) and all(
            label["left"] >= stacked["plot"]["left"] - 1 and label["right"] <= stacked["plot"]["right"] + 1
            for label in stacked["axisLabels"]),
        "stacked_table_total": "합계" in stacked["headers"],
        "plain_table_no_total": "합계" not in plain["headers"],
    }
    # 좁은 폭에서는 첫 시점 눈금이 그리기 영역 왼쪽 끝에서 시작해야 한다.
    if width <= NARROW[0]:
        verdicts["narrow_first_label_at_left"] = bool(stacked["axisLabels"]) and abs(stacked["axisLabels"][0]["left"] - stacked["plot"]["left"]) <= 2
    return verdicts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="target/visual-check/chart-series")
    parser.add_argument("--port", type=int, default=5395)
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
    result = {"windows": {"wide": list(WIDE), "narrow": list(NARROW)}, "scenes": {}, "captures": [], "failures": []}
    try:
        wait_server(args.port)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(locale="ko-KR", viewport={"width": WIDE[0], "height": WIDE[1]})
            page = context.new_page()
            application = open_scene(page, args.port)
            table = application.locator('.ks-table-header button')
            table.first.wait_for(state="visible", timeout=20000)

            for width, height in (WIDE, NARROW):
                for theme in ("light", "dark"):
                    page.set_viewport_size({"width": width, "height": height})
                    page.emulate_media(color_scheme=theme)
                    page.wait_for_timeout(500)
                    measurement = page.evaluate(MEASURE_JS, {"appId": APP_ID})
                    if measurement.get("error"):
                        raise AssertionError(measurement["error"])
                    verdicts = judge(measurement, width)
                    key = f"{width}x{height}-{theme}"
                    capture = output / f"chart-series-{key}.png"
                    page.screenshot(path=str(capture), animations="disabled")
                    result["captures"].append(str(capture))
                    result["scenes"][key] = {"measurement": measurement, "verdicts": verdicts}
                    for verdict, passed in verdicts.items():
                        if not passed:
                            result["failures"].append(f"{key}: {verdict}")
                    print(key, "ok" if all(verdicts.values()) else "FAIL " + ",".join(name for name, ok in verdicts.items() if not ok), flush=True)

            page.emulate_media(color_scheme="light")
            page.set_viewport_size({"width": WIDE[0], "height": WIDE[1]})
            page.wait_for_timeout(500)

            # 고른 칸: 포인터가 다른 칸을 지나 떠나면 1월로 돌아와야 한다. 초점을 주지 않은 채로 잰다.
            chart = application.locator(".ks-chart").nth(0)
            plot = chart.locator(".ks-chart-plot").bounding_box()
            page.mouse.move(plot["x"] + plot["width"] * 4.5 / 7, plot["y"] + plot["height"] / 2)
            page.wait_for_timeout(250)
            hovered = chart.locator(".ks-chart-readout-x").text_content()
            page.mouse.move(3, 3)
            page.wait_for_timeout(250)
            returned = chart.locator(".ks-chart-readout-x").text_content()
            returned_measure = page.evaluate(MEASURE_JS, {"appId": APP_ID})["charts"][0]
            # 키보드: 초점을 주고 Enter를 눌러도 초점이 차트에 남는다.
            application.locator(".ks-chart-graph").nth(0).focus()
            page.keyboard.press("Enter")
            page.wait_for_timeout(150)
            focus_verdict = page.evaluate(ACTIVE_GRAPH_JS)
            selected = {"focus_after_enter": focus_verdict, "hovered": hovered, "returned": returned,
                        "returned_band": returned_measure["band"],
                        "passed": focus_verdict and hovered == LABELS[4] and returned == LABELS[0]
                        and bool(returned_measure["band"])
                        and abs(returned_measure["band"]["left"] - returned_measure["plot"]["left"]) <= 1}
            result["scenes"]["selected-band"] = selected
            if not selected["passed"]:
                result["failures"].append("selected-band: pointer_leave_returns_to_selected")

            # 표: 머리를 누르면 보이는 글 대신 정렬 값(raw) 순서가 된다.
            table.first.click()
            page.wait_for_timeout(300)
            sorted_rows = page.evaluate(TABLE_ROWS_JS, {"appId": APP_ID})
            expected = ["6075만+", "6276.2만+", "1.5억+", "1.6억+"]
            result["scenes"]["table-sort"] = {"rows": sorted_rows, "expected": expected, "passed": sorted_rows == expected}
            if sorted_rows != expected:
                result["failures"].append("table-sort: sort_field_order")
            page.screenshot(path=str(output / "table-sort-wide-light.png"), animations="disabled")
            result["captures"].append(str(output / "table-sort-wide-light.png"))

            # 창 폭 바꾸기: 좁아지면 첫 시점 눈금이 그리기 영역 왼쪽 끝으로 다시 선다.
            wide_measure = page.evaluate(MEASURE_JS, {"appId": APP_ID})
            wide_chart = wide_measure["charts"][0]
            page.set_viewport_size({"width": NARROW[0], "height": NARROW[1]})
            page.wait_for_timeout(600)
            narrow_measure = page.evaluate(MEASURE_JS, {"appId": APP_ID})
            narrow_chart = narrow_measure["charts"][0]
            resize = {"wide_axis_labels": wide_chart["axisLabels"], "narrow_axis_labels": narrow_chart["axisLabels"], "passed": False}
            if wide_chart["axisLabels"] and narrow_chart["axisLabels"]:
                wide_offset = wide_chart["axisLabels"][0]["left"] - wide_chart["plot"]["left"]
                narrow_offset = narrow_chart["axisLabels"][0]["left"] - narrow_chart["plot"]["left"]
                resize.update({"wide_offset": wide_offset, "narrow_offset": narrow_offset,
                               "passed": wide_offset > narrow_offset + 2 and abs(narrow_offset) <= 2})
            result["scenes"]["resize"] = resize
            if not resize["passed"]:
                result["failures"].append("resize: first_label_reanchored")
            browser.close()
    finally:
        server.stdin.close()
        try:
            server.wait(timeout=20)
        except subprocess.TimeoutExpired:
            server.kill()

    result["ok"] = not result["failures"]
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print("RESULT", "ok" if result["ok"] else f"{len(result['failures'])} failures", output / "result.json")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
