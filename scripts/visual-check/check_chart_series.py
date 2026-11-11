#!/usr/bin/env python3
"""차트의 계열 색과 쌓은 막대, 눈금 끝, 읽기 줄, 범례, 팔레트, 고른 칸, 표 정렬 값을 화면에서 확인한다.

구역 안에 수치 묶음(metrics)과 쌓은 막대 차트, 계열 둘짜리 막대 차트, 정렬 값이 있는 표를
둔다. 쌓은 차트는 시점 일곱, 계열 넷이고 가운데에 빈 값이 있으며, 1월 합계가 66354414,
7월 합계가 160000000이라 한국어 기기에서 눈금이 1.6억, 8000만, 0이고 값 표시가 6635만이 된다.
고른 칸은 1월로 두어 포인터가 다른 칸을 지나 떠난 뒤에도 1월로 돌아오는지 잰다. 둘째 차트는
마지막 시점의 값이 모두 비어 있어, 처음 값 표시가 값이 있는 마지막 칸(2월)인지 잰다.

추가 장면(카드 #1229 1차 검수 반려의 세라피엘 시나리오를 옮긴 것):
- 최대 합계 166354414인 쌓은 막대: 눈금이 1.8억, 9000만, 0인지.
- 긴 이름 여덟 계열의 묶음 막대(쌓지 않음): 좁은 폭에서 읽기 줄과 범례가 넘치지 않는지.
- 420px의 통화(USD) 세 계열 선 차트: 읽기 줄이 한 줄이고 수가 잘리지 않는지.
- 시점 서른 개를 쌓은 막대.
- 계열 하나짜리 막대: 강조색 그대로이고 지금 칸은 띠로 보이는지.

재는 것: 막대마다 지금 칸 띠가 있고 그 좌우가 칸 경계와 1px 이내인지, 막대 차트에 값 점과
안내선이 없는지(선과 면적에는 그대로인지), 막대가 계열 색 그대로인지(투명도 없이), 범례
왼쪽이 읽기 줄의 시점 글과 같은 선인지, 좁은 폭에서 시점 글이 한 줄이고 수가 차트 틀 안에
있는지, 어두운 테마에서 지금 칸이 아닌 막대 픽셀과 범례 견본의 L* 차이가 10 이하인지,
두 테마에서 팔레트 여덟 색의 쌍별 dE2000이 15 이상인지, data-blocks.css에 user-select가
없는지. 기존 판정(막대가 축 글자 상자를 침범하지 않는지, 구역 머리와 수치 묶음과 차트
테두리의 좌우 끝선, 가로 넘침, 표 머리를 한 번 눌러 오름차순 두 번 눌러 내림차순, 창 폭을
바꿀 때 눈금 자리 재계산, 차트를 눌러 초점을 준 뒤 다른 칸을 지나 포인터를 빼면 고른 칸으로
돌아오는지)도 함께 잰다.

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
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
APP_ID = "data-controls"
WIDE = (1180, 720)
NARROW = (420, 720)
STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"
LABELS = [f"2026년 {month}월" for month in range(1, 8)]
DAYS = [f"11월 {day}일" for day in range(9, 16)]
STATE = {"picked": LABELS[0]}


def main_series():
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


def plain_series():
    return [
        {"key": "alpha", "name": "모델 알파", "points": [
            {"x": LABELS[0], "y": 12}, {"x": LABELS[1], "y": 18}, {"x": LABELS[2], "y": None}]},
        {"key": "beta", "name": "모델 베타", "points": [
            {"x": LABELS[0], "y": 8}, {"x": LABELS[1], "y": 9}, {"x": LABELS[2], "y": None}]},
    ]


def stacked_166_series():
    # 1일 합계가 61234567 + 40211890 + 30123456 + 34784501 = 166354414다.
    totals = [
        [61234567, 40211890, 30123456, 34784501],
        [50111222, 32000123, 26000456, 18242613],
        [42000111, 30123123, 21000999, 12000000],
        [40123456, 25111999, 15000111, 11118848],
        [35000000, 20000000, 10000000, 5000000],
        [30000000, 10000000, None, 2000000],
        [None, None, None, None],
    ]
    names = ["모델 알파", "모델 베타", "모델 감마", "모델 델타"]
    return [{"key": f"m{index}", "name": names[index], "points": [
        {"x": DAYS[day], "y": totals[day][index]} for day in range(7)]} for index in range(4)]


def long_name_series():
    long_names = ["claude-opus-4-1-20250805-long-preview", "claude-sonnet", "gpt-5", "gemini-2.5-pro",
                  "모델 다섯", "모델 여섯", "모델 일곱", "모델 여덟"]
    labels = ["1월", "2월", "3월"]
    return [{"key": f"p{index}", "name": long_names[index],
             "points": [{"x": label, "y": 10 + index + step * 3} for step, label in enumerate(labels)]}
            for index in range(8)]


def usd_line_series():
    names = ["정가", "캐시 읽기", "캐시 쓰기"]
    values = [[812.4, 930.1, 1022.98, 640.0, 1200.5, 980.0, 1100.2],
              [301.1, 280.9, 450.0, 390.3, 520.75, 410.0, 480.1],
              [120.0, 90.5, 160.25, 140.0, 200.0, 170.4, 150.0]]
    return [{"key": f"l{index}", "name": names[index],
             "points": [{"x": LABELS[day], "y": values[index][day]} for day in range(7)]}
            for index in range(3)]


def stacked_30_series():
    days = [f"{day}일" for day in range(1, 31)]
    return [{"key": f"d{index}", "name": f"모델 {index + 1}",
             "points": [{"x": label, "y": (step * 37 + index * 11) % 50 + 5} for step, label in enumerate(days)]}
            for index in range(3)]


def single_series():
    values = [3, 7, 12, 5, 9, 0, 4]
    return [{"key": "s", "name": "세션", "points": [{"x": DAYS[day], "y": values[day]} for day in range(7)]}]


def main_scene():
    return {"type": "stack", "direction": "column", "gap": "none", "children": [
        {"type": "section", "title": "세션 통계", "child": {"type": "stack", "direction": "column", "gap": "none", "children": [
            {"type": "metrics", "items": [
                {"label": "이번 주 세션", "value": "142"},
                {"label": "쓴 토큰", "value": "1.6억"},
                {"label": "가장 많이 쓴 모델", "value": "모델 알파"},
            ]},
            {"type": "chart", "kind": "bar", "stacked": True, "number_format": {"notation": "compact"},
             "selected": {"state": "picked"}, "on_select": {"set_state": "picked"}, "series": main_series()},
            {"type": "chart", "kind": "bar", "series": plain_series()},
            {"type": "table", "columns": [{"field": "value", "label": "값", "sort_field": "raw"}], "rows": [
                {"key": "a", "value": "1.5억+", "raw": 150000000},
                {"key": "b", "value": "1.6억+", "raw": 160000000},
                {"key": "c", "value": "6075만+", "raw": 60750000},
                {"key": "d", "value": "6276.2만+", "raw": 62762000},
            ]},
        ]}},
    ]}


def extra_scene():
    return {"type": "stack", "direction": "column", "gap": "none", "children": [
        {"type": "section", "title": "추가 장면", "child": {"type": "stack", "direction": "column", "gap": "none", "children": [
            {"type": "chart", "kind": "bar", "stacked": True, "number_format": {"notation": "compact"},
             "series": stacked_166_series()},
            {"type": "chart", "kind": "bar", "series": long_name_series()},
            {"type": "chart", "kind": "line", "number_format": {"style": "currency", "currency": "USD"},
             "series": usd_line_series()},
            {"type": "chart", "kind": "bar", "stacked": True, "series": stacked_30_series()},
            {"type": "chart", "kind": "bar", "series": single_series()},
        ]}},
    ]}


MEASURE_JS = """(args) => {
  const win = document.querySelector(`[data-testid="app-window-${args.appId}"]`);
  if (!win) return { error: "창을 찾지 못했습니다" };
  const round = (value) => Math.round(value * 10) / 10;
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
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolve = (value) => { probe.style.color = value; return getComputedStyle(probe).color; };
  const palette = Array.from({ length: 8 }, (_, index) => resolve(`var(--ks-color-series-${index + 1})`));
  const charts = [...win.querySelectorAll('.ks-chart')].map((chart) => {
    const chartBox = box(chart);
    const svgElement = chart.querySelector('.ks-chart-plot svg');
    const svg = svgElement ? box(svgElement) : null;
    const graph = chart.querySelector('.ks-chart-graph');
    const count = Number(graph.getAttribute('aria-valuemax') || 0) + 1;
    const now = Number(graph.getAttribute('aria-valuenow'));
    const readout = chart.querySelector('.ks-chart-readout');
    const readoutBox = readout ? box(readout) : null;
    const readoutX = chart.querySelector('.ks-chart-readout-x');
    const xBox = readoutX ? box(readoutX) : { left: 0, right: 0, height: 0 };
    const xStyle = readoutX ? getComputedStyle(readoutX) : null;
    const lineHeight = xStyle ? parseFloat(xStyle.lineHeight) : NaN;
    const xLine = xStyle ? (Number.isFinite(lineHeight) ? lineHeight : parseFloat(xStyle.fontSize) * 1.5) : 0;
    const legendElement = chart.querySelector('.ks-chart-legend');
    const groups = [...chart.querySelectorAll('.ks-chart-series')];
    const groupColors = groups.map((group) => resolve(group.style.getPropertyValue('--ks-chart-series-color') || 'var(--ks-color-accent)'));
    const barElements = [...chart.querySelectorAll('.ks-chart-bar')];
    const kind = barElements.length ? 'bar' : chart.querySelector('.ks-chart-candle') ? 'candlestick' : chart.querySelector('.ks-chart-line') ? (chart.querySelector('.ks-chart-area') ? 'area' : 'line') : 'empty';
    const bars = barElements.map((bar) => {
      const rect = box(bar);
      const seriesIndex = Math.max(0, groups.indexOf(bar.closest('.ks-chart-series')));
      const centerX = rect.left + rect.width / 2 - chartBox.left;
      const centerY = rect.top + rect.height / 2 - chartBox.top;
      const index = svg && svg.width ? Math.max(0, Math.min(count - 1, Math.floor((rect.left + rect.width / 2 - svg.left) / (svg.width / count)))) : -1;
      return { index, seriesIndex, ...rect, fill: getComputedStyle(bar).fill, expectedFill: groupColors[seriesIndex] || '', sample: { x: round(centerX), y: round(centerY) } };
    });
    const ticks = [...chart.querySelectorAll('.ks-chart-y-axis span')].map((span) => ({ text: span.textContent, ...box(span) }));
    return {
      kind, count, now, chart: chartBox, svg,
      plot: chart.querySelector('.ks-chart-plot') ? box(chart.querySelector('.ks-chart-plot')) : null,
      frame: box(chart.querySelector('.ks-chart-frame')),
      ticks,
      axisTextRight: ticks.length ? Math.max(...ticks.map((tick) => tick.right)) : 0,
      bars,
      band: chart.querySelector('.ks-chart-band') ? box(chart.querySelector('.ks-chart-band')) : null,
      dots: chart.querySelectorAll('.ks-chart-dot').length,
      guide: Boolean(chart.querySelector('.ks-chart-guide')),
      readout: readout ? readout.textContent : '',
      readoutBox,
      readoutX: { text: readoutX ? readoutX.textContent : '', line: xLine, ...xBox },
      strongs: [...chart.querySelectorAll('.ks-chart-readout-values strong')].map(box),
      valueItems: [...chart.querySelectorAll('.ks-chart-readout-values > span')].map(box),
      legend: legendElement ? { ...box(legendElement), items: [...legendElement.querySelectorAll('.ks-chart-legend-item')].map((item, index) => {
        const dot = item.querySelector('.ks-list-color');
        return { text: item.textContent, ...box(item), swatch: dot ? { ...box(dot), color: getComputedStyle(dot).backgroundColor } : null, seriesIndex: index };
      }) } : null,
      axisLabels: [...chart.querySelectorAll('.ks-chart-x-axis span')].map((span) => ({ text: span.textContent, ...box(span) })),
      headers: [...chart.querySelectorAll('.ks-accessible-hidden th')].map((th) => th.textContent),
    };
  });
  probe.remove();
  const section = win.querySelector('.ks-data-section');
  const metrics = section && section.querySelector('.ks-metrics');
  return {
    charts,
    palette,
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


def wait_server(port):
    deadline = time.time() + 240
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}", timeout=5)
            return
        except Exception:
            time.sleep(2)
    raise SystemExit("하네스 서버가 뜨지 않았습니다")


def inject(page, layout):
    page.evaluate(
        """async ([layout, state]) => {
          const harness = window.__ksHarness;
          const { snapshot } = await harness.call({ op: 'state.get' });
          const version = snapshot.shared.app_versions.find((v) => v.app_id === 'data-controls');
          version.definition.state = state;
          version.definition.requires = { ...(version.definition.requires ?? {}), blocks: 62 };
          version.definition.ui = layout;
          version.version += 1;
          const win = snapshot.shared.windows.find((w) => w.app_id === 'data-controls');
          win.app_version = version.version;
          win.state = state;
          harness.emit({ event: 'state.changed', snapshot });
        }""",
        [layout, STATE],
    )
    page.wait_for_timeout(500)


def open_page(page, port, layout):
    page.goto(f"http://127.0.0.1:{port}/?preview={APP_ID}")
    page.wait_for_function(
        "() => window.__ksHarness && document.querySelector('[data-testid=app-window-data-controls]')",
        timeout=120000,
    )
    page.add_style_tag(content=STYLE)
    inject(page, layout)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(400)
    return page.get_by_test_id(f"app-window-{APP_ID}")


def parse_rgb(text):
    numbers = [float(value) for value in re.findall(r"[\d.]+", text)]
    if "color(srgb" in text:
        return tuple(round(value * 255) for value in numbers[:3])
    return tuple(round(value) for value in numbers[:3])


def linear(channel):
    value = channel / 255
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def lab(rgb):
    red, green, blue = (linear(channel) for channel in rgb)
    x = (0.4124 * red + 0.3576 * green + 0.1805 * blue) / 0.95047
    y = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    z = (0.0193 * red + 0.1192 * green + 0.9505 * blue) / 1.08883

    def f(value):
        return value ** (1 / 3) if value > 0.008856 else 7.787 * value + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def de2000(first, second):
    import math

    l1, a1, b1 = lab(first)
    l2, a2, b2 = lab(second)
    c1, c2 = math.hypot(a1, b1), math.hypot(a2, b2)
    average = (c1 + c2) / 2
    g = 0.5 * (1 - math.sqrt(average ** 7 / (average ** 7 + 25 ** 7)))
    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360
    h2p = math.degrees(math.atan2(b2, a2p)) % 360
    dl, dc = l2 - l1, c2p - c1p
    dh = h2p - h1p
    if c1p * c2p == 0:
        dh = 0
    elif dh > 180:
        dh -= 360
    elif dh < -180:
        dh += 360
    dhp = 2 * math.sqrt(c1p * c2p) * math.sin(math.radians(dh / 2))
    average_l = (l1 + l2) / 2
    average_c = (c1p + c2p) / 2
    if c1p * c2p == 0:
        average_h = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        average_h = (h1p + h2p) / 2
    elif h1p + h2p < 360:
        average_h = (h1p + h2p + 360) / 2
    else:
        average_h = (h1p + h2p - 360) / 2
    t = (1 - 0.17 * math.cos(math.radians(average_h - 30)) + 0.24 * math.cos(math.radians(2 * average_h))
         + 0.32 * math.cos(math.radians(3 * average_h + 6)) - 0.20 * math.cos(math.radians(4 * average_h - 63)))
    delta_theta = 30 * math.exp(-(((average_h - 275) / 25) ** 2))
    rc = 2 * math.sqrt(average_c ** 7 / (average_c ** 7 + 25 ** 7))
    sl = 1 + 0.015 * (average_l - 50) ** 2 / math.sqrt(20 + (average_l - 50) ** 2)
    sc = 1 + 0.045 * average_c
    sh = 1 + 0.015 * average_c * t
    rt = -math.sin(math.radians(2 * delta_theta)) * rc
    return math.sqrt((dl / sl) ** 2 + (dc / sc) ** 2 + (dhp / sh) ** 2 + rt * (dc / sc) * (dhp / sh))


def palette_min(colors):
    rgbs = [parse_rgb(color) for color in colors]
    return min(de2000(rgbs[i], rgbs[j]) for i in range(len(rgbs)) for j in range(i + 1, len(rgbs)))


def chart_common_verdicts(chart, width, key, verdicts):
    if chart["kind"] == "bar":
        verdicts[f"{key}:band"] = chart["band"] is not None
        if chart["band"] and chart["svg"] and chart["svg"]["width"]:
            expected_left = chart["svg"]["left"] + chart["now"] * chart["svg"]["width"] / chart["count"]
            expected_right = chart["svg"]["left"] + (chart["now"] + 1) * chart["svg"]["width"] / chart["count"]
            verdicts[f"{key}:band_bounds"] = (abs(chart["band"]["left"] - expected_left) <= 1
                                              and abs(chart["band"]["right"] - expected_right) <= 1)
        verdicts[f"{key}:no_dots"] = chart["dots"] == 0
        verdicts[f"{key}:no_guide"] = not chart["guide"]
        verdicts[f"{key}:solid_bars"] = bool(chart["bars"]) and all(
            bar["fill"].replace(" ", "") == bar["expectedFill"].replace(" ", "") for bar in chart["bars"])
    elif chart["kind"] in ("line", "area"):
        verdicts[f"{key}:guide"] = chart["guide"]
        verdicts[f"{key}:dots"] = chart["dots"] >= 1
    if chart["legend"] and chart["readoutX"]["height"]:
        verdicts[f"{key}:legend_left"] = abs(chart["legend"]["left"] - chart["readoutX"]["left"]) <= 1
        verdicts[f"{key}:legend_fit"] = all(item["right"] <= chart["frame"]["right"] + 1
                                           for item in chart["legend"]["items"])
    if width <= NARROW[0]:
        verdicts[f"{key}:readout_x_one_line"] = chart["readoutX"]["height"] <= chart["readoutX"]["line"] + 1
        right = chart["readoutBox"]["right"] if chart["readoutBox"] else 0
        verdicts[f"{key}:numbers_inside"] = all(strong["right"] <= right + 1 for strong in chart["strongs"])
        verdicts[f"{key}:items_inside"] = all(item["right"] <= right + 1 for item in chart["valueItems"])


def judge_main(measurement, width):
    stacked, plain = measurement["charts"][0], measurement["charts"][1]
    verdicts = {
        # 막대가 축 글자 상자와 겹치지 않고 그리기 영역 안에 있다.
        "bars_inside_plot": all(
            bar["left"] >= stacked["plot"]["left"] - 0.5 and bar["right"] <= stacked["plot"]["right"] + 0.5
            for bar in stacked["bars"]),
        "axis_text_clear_of_bars": bool(stacked["ticks"]) and bool(stacked["bars"])
        and min(bar["left"] for bar in stacked["bars"]) - stacked["axisTextRight"] >= 0,
        # 계열마다 다른 색이다(쌓은 막대 넷, 나란한 막대 둘).
        "series_colors_distinct": len({bar["expectedFill"] for bar in stacked["bars"]}) == 4
        and len({bar["expectedFill"] for bar in plain["bars"]}) == 2,
        "legend_items": bool(stacked["legend"]) and len(stacked["legend"]["items"]) == 4
        and all(item["text"].startswith("모델") for item in stacked["legend"]["items"]),
        # 한국어 기기에서 짧은 수 표기: 눈금 1.6억, 8000만, 0. 값 표시 6635만.
        "compact_ticks": [tick["text"] for tick in stacked["ticks"]] == ["1.6억", "8000만", "0"],
        "compact_readout": "6635만" in stacked["readout"],
        "selected_initial": stacked["readoutX"]["text"] == LABELS[0],
        "initial_last_with_data": plain["readoutX"]["text"] == LABELS[1],
        # 구역 머리 글자 시작선, 수치 묶음, 차트 테두리의 좌우 끝선이 맞는다.
        "metrics_left": bool(measurement["cards"]) and measurement["headerGlyphX"] is not None
        and abs(measurement["cards"][0]["left"] - stacked["frame"]["left"]) <= 1
        and abs(measurement["headerGlyphX"] - stacked["frame"]["left"]) <= 1,
        "metrics_right": bool(measurement["cards"])
        and abs(measurement["cards"][-1]["right"] - stacked["frame"]["right"]) <= 1,
        "no_horizontal_overflow": measurement["scrollWidth"] <= measurement["clientWidth"] + 1,
        "axis_labels_inside_plot": bool(stacked["axisLabels"]) and all(
            label["left"] >= stacked["plot"]["left"] - 1 and label["right"] <= stacked["plot"]["right"] + 1
            for label in stacked["axisLabels"]),
        "stacked_table_total": "합계" in stacked["headers"],
        "plain_table_no_total": "합계" not in plain["headers"],
    }
    # 좁은 폭에서는 첫 시점 눈금이 그리기 영역 왼쪽 끝에서 시작해야 한다.
    if width <= NARROW[0]:
        verdicts["narrow_first_label_at_left"] = bool(stacked["axisLabels"]) and abs(
            stacked["axisLabels"][0]["left"] - stacked["plot"]["left"]) <= 2
    chart_common_verdicts(stacked, width, "stacked", verdicts)
    chart_common_verdicts(plain, width, "plain", verdicts)
    return verdicts


def judge_extra(measurement, width):
    charts = measurement["charts"]
    stacked_166, eight, usd, thirty, single = charts
    verdicts = {
        "ticks_166m": [tick["text"] for tick in stacked_166["ticks"]] == ["1.8억", "9000만", "0"],
        "eight_series_legend": bool(eight["legend"]) and len(eight["legend"]["items"]) == 8,
        "usd_readout": "$" in usd["readout"],
        "single_bar_no_legend": single["legend"] is None,
        "no_horizontal_overflow": measurement["scrollWidth"] <= measurement["clientWidth"] + 1,
    }
    for index, chart in enumerate(charts):
        chart_common_verdicts(chart, width, f"chart{index}", verdicts)
    return verdicts


def pixel_verdict(capture, chart):
    if chart["kind"] != "bar":
        return None
    if not chart["legend"]:
        return {"skipped": "범례가 없는 한 계열 차트"}
    candidates = [bar for bar in chart["bars"]
                  if bar["index"] != chart["now"] and bar["width"] >= 6 and bar["height"] >= 6]
    if not candidates:
        return {"passed": False, "reason": "지금 칸이 아닌 막대를 찾지 못했습니다"}
    bar = max(candidates, key=lambda item: item["width"] * item["height"])
    swatch = next((item["swatch"] for item in chart["legend"]["items"]
                   if item["seriesIndex"] == bar["seriesIndex"] and item["swatch"]), None)
    if swatch is None:
        return {"passed": False, "reason": "같은 계열의 범례 견본을 찾지 못했습니다"}
    image = Image.open(capture).convert("RGB")
    x, y = round(bar["sample"]["x"]), round(bar["sample"]["y"])
    if not (0 <= x < image.width and 0 <= y < image.height):
        return {"passed": False, "reason": "표본 지점이 캡처 밖입니다", "sample": [x, y],
                "size": [image.width, image.height]}
    patch = [image.getpixel((min(image.width - 1, max(0, x + dx)), min(image.height - 1, max(0, y + dy))))
             for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
    pixel = tuple(sorted(item[channel] for item in patch)[len(patch) // 2] for channel in range(3))
    delta = abs(lab(pixel)[0] - lab(parse_rgb(swatch["color"]))[0])
    return {"passed": delta <= 10, "sample": [x, y],
            "bar": {key: bar[key] for key in ("index", "seriesIndex", "width", "height", "fill")},
            "pixel": list(pixel), "swatch": swatch["color"], "delta_l": round(delta, 1)}


def record(result, key, verdicts):
    result["scenes"][key] = {"verdicts": verdicts}
    for verdict, passed in verdicts.items():
        if not passed:
            result["failures"].append(f"{key}: {verdict}")
    print(key, "ok" if all(verdicts.values()) else "FAIL " + ",".join(
        name for name, ok in verdicts.items() if not ok), flush=True)


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
    result = {"windows": {"wide": list(WIDE), "narrow": list(NARROW)}, "scenes": {}, "palettes": {},
              "pixel": {}, "table": {}, "interaction": {}, "css": {}, "captures": [], "failures": []}
    try:
        wait_server(args.port)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(locale="ko-KR", viewport={"width": WIDE[0], "height": WIDE[1]})
            page = context.new_page()
            application = open_page(page, args.port, main_scene())
            application.locator('.ks-chart').first.wait_for(state="visible", timeout=20000)

            for width, height in (WIDE, NARROW):
                for theme in ("light", "dark"):
                    page.set_viewport_size({"width": width, "height": height})
                    page.emulate_media(color_scheme=theme)
                    page.wait_for_timeout(500)
                    measurement = page.evaluate(MEASURE_JS, {"appId": APP_ID})
                    if measurement.get("error"):
                        raise AssertionError(measurement["error"])
                    key = f"main-{width}x{height}-{theme}"
                    capture = output / f"chart-series-{key}.png"
                    page.screenshot(path=str(capture), animations="disabled")
                    result["captures"].append(str(capture))
                    record(result, key, judge_main(measurement, width))
                    result["scenes"][key]["measurement"] = measurement
                    minimum = palette_min(measurement["palette"])
                    result["palettes"].setdefault(theme, round(minimum, 1))
                    if minimum < 15:
                        result["failures"].append(f"{key}: palette_delta_e2000")
                    if theme == "dark":
                        for index in range(2):
                            chart_capture = output / f"bar-{key}-chart{index}.png"
                            application.locator('.ks-chart').nth(index).screenshot(
                                path=str(chart_capture), animations="disabled")
                            result["captures"].append(str(chart_capture))
                            verdict = pixel_verdict(chart_capture, measurement["charts"][index])
                            if verdict is not None:
                                pixel_key = f"{key}-chart{index}"
                                result["pixel"][pixel_key] = verdict
                                if verdict.get("passed") is False:
                                    result["failures"].append(f"{pixel_key}: bar_pixel_vs_legend")

            page.emulate_media(color_scheme="light")
            page.set_viewport_size({"width": WIDE[0], "height": WIDE[1]})
            page.wait_for_timeout(500)

            # 고른 칸: 차트를 눌러 초점을 준 뒤 다른 칸을 지나 포인터를 빼면 누른 칸으로 돌아와야 한다.
            stacked = application.locator(".ks-chart").nth(0)
            stacked.scroll_into_view_if_needed()
            plot = stacked.locator(".ks-chart-plot").bounding_box()
            page.mouse.click(plot["x"] + plot["width"] * 4.5 / 7, plot["y"] + plot["height"] * 0.6)
            page.wait_for_timeout(400)
            clicked = stacked.locator(".ks-chart-readout-x").text_content()
            focus = page.evaluate(ACTIVE_GRAPH_JS)
            page.mouse.move(plot["x"] + plot["width"] * 6.5 / 7, plot["y"] + plot["height"] * 0.6)
            page.wait_for_timeout(300)
            hovered = stacked.locator(".ks-chart-readout-x").text_content()
            page.mouse.move(3, 3)
            page.wait_for_timeout(300)
            returned = stacked.locator(".ks-chart-readout-x").text_content()
            returned_chart = page.evaluate(MEASURE_JS, {"appId": APP_ID})["charts"][0]
            band = returned_chart["band"]
            expected_left = (returned_chart["svg"]["left"]
                             + returned_chart["now"] * returned_chart["svg"]["width"] / returned_chart["count"])
            interaction = {
                "clicked": clicked, "hovered": hovered, "returned": returned, "focus": focus,
                "band_left_error": round(abs(band["left"] - expected_left), 1) if band else None,
                "passed": focus and clicked == LABELS[4] and hovered == LABELS[6]
                and returned == LABELS[4] and band is not None
                and abs(band["left"] - expected_left) <= 1,
            }
            result["interaction"] = interaction
            result["scenes"]["selected-band"] = {"interaction": interaction}
            if not interaction["passed"]:
                result["failures"].append("selected-band: pointer_leave_returns_to_clicked")
            print("selected-band", "ok" if interaction["passed"] else "FAIL", flush=True)

            # 키보드: 초점을 주고 Enter를 눌러도 초점이 차트에 남는다.
            application.locator(".ks-chart-graph").nth(0).focus()
            page.keyboard.press("Enter")
            page.wait_for_timeout(150)
            focus_verdict = page.evaluate(ACTIVE_GRAPH_JS)
            result["scenes"]["focus-after-enter"] = {"passed": focus_verdict}
            if not focus_verdict:
                result["failures"].append("focus-after-enter: focus_kept")

            # 표: 머리를 누르면 보이는 글 대신 정렬 값(raw) 순서가 된다.
            table = application.locator(".ks-table-inner").first
            table.scroll_into_view_if_needed()
            header = application.locator('.ks-table-header button').first
            header.click()
            page.wait_for_timeout(300)
            ascending = page.evaluate(TABLE_ROWS_JS, {"appId": APP_ID})
            table.screenshot(path=str(output / "table-sort1-wide-light.png"), animations="disabled")
            result["captures"].append(str(output / "table-sort1-wide-light.png"))
            header.click()
            page.wait_for_timeout(300)
            descending = page.evaluate(TABLE_ROWS_JS, {"appId": APP_ID})
            table.screenshot(path=str(output / "table-sort2-wide-light.png"), animations="disabled")
            result["captures"].append(str(output / "table-sort2-wide-light.png"))
            expected_ascending = ["6075만+", "6276.2만+", "1.5억+", "1.6억+"]
            table_result = {"ascending": ascending, "descending": descending,
                            "expected_ascending": expected_ascending,
                            "passed": ascending == expected_ascending and descending == expected_ascending[::-1]}
            result["table"] = table_result
            result["scenes"]["table-sort"] = table_result
            if not table_result["passed"]:
                result["failures"].append("table-sort: sort_field_order")
            print("table-sort", "ok" if table_result["passed"] else "FAIL", flush=True)

            # 창 폭 바꾸기: 좁아지면 첫 시점 눈금이 그리기 영역 왼쪽 끝으로 다시 선다.
            wide_chart = page.evaluate(MEASURE_JS, {"appId": APP_ID})["charts"][0]
            page.set_viewport_size({"width": NARROW[0], "height": NARROW[1]})
            page.wait_for_timeout(600)
            narrow_chart = page.evaluate(MEASURE_JS, {"appId": APP_ID})["charts"][0]
            resize = {"wide_axis_labels": wide_chart["axisLabels"], "narrow_axis_labels": narrow_chart["axisLabels"],
                      "passed": False}
            if wide_chart["axisLabels"] and narrow_chart["axisLabels"]:
                wide_offset = wide_chart["axisLabels"][0]["left"] - wide_chart["plot"]["left"]
                narrow_offset = narrow_chart["axisLabels"][0]["left"] - narrow_chart["plot"]["left"]
                resize.update({"wide_offset": wide_offset, "narrow_offset": narrow_offset,
                               "passed": wide_offset > narrow_offset + 2 and abs(narrow_offset) <= 2})
            result["scenes"]["resize"] = resize
            if not resize["passed"]:
                result["failures"].append("resize: first_label_reanchored")
            print("resize", "ok" if resize["passed"] else "FAIL", flush=True)

            # 추가 장면: 166354414 쌓은 막대, 긴 이름 여덟 계열, 통화 선, 시점 서른 쌓은 막대, 한 계열 막대.
            inject(page, extra_scene())
            application.locator('.ks-chart').first.wait_for(state="visible", timeout=20000)
            for width, height in (WIDE, NARROW):
                for theme in ("light", "dark"):
                    page.set_viewport_size({"width": width, "height": height})
                    page.emulate_media(color_scheme=theme)
                    page.wait_for_timeout(500)
                    measurement = page.evaluate(MEASURE_JS, {"appId": APP_ID})
                    if measurement.get("error"):
                        raise AssertionError(measurement["error"])
                    key = f"extra-{width}x{height}-{theme}"
                    capture = output / f"chart-series-{key}.png"
                    page.screenshot(path=str(capture), animations="disabled")
                    result["captures"].append(str(capture))
                    record(result, key, judge_extra(measurement, width))
                    result["scenes"][key]["measurement"] = measurement
                    minimum = palette_min(measurement["palette"])
                    result["palettes"].setdefault(theme, round(minimum, 1))
                    if minimum < 15:
                        result["failures"].append(f"{key}: palette_delta_e2000")
                    if theme == "dark":
                        for index in range(5):
                            chart = measurement["charts"][index]
                            chart_capture = output / f"bar-{key}-chart{index}.png"
                            application.locator('.ks-chart').nth(index).screenshot(
                                path=str(chart_capture), animations="disabled")
                            result["captures"].append(str(chart_capture))
                            verdict = pixel_verdict(chart_capture, chart)
                            if verdict is not None:
                                pixel_key = f"{key}-chart{index}"
                                result["pixel"][pixel_key] = verdict
                                if verdict.get("passed") is False:
                                    result["failures"].append(f"{pixel_key}: bar_pixel_vs_legend")

            # 정본 CSS: data-blocks.css에는 user-select를 적지 않는다(selection.css가 정본).
            data_blocks = (ROOT / "ui/src/styles/data-blocks.css").read_text(encoding="utf-8")
            css_result = {"user_select": data_blocks.count("user-select"), "passed": data_blocks.count("user-select") == 0}
            result["css"] = css_result
            result["scenes"]["user-select"] = css_result
            if not css_result["passed"]:
                result["failures"].append("user-select: data_blocks_css")
            print("user-select", "ok" if css_result["passed"] else "FAIL", flush=True)
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
