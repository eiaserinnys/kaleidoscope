#!/usr/bin/env python3
"""카드 #1246 셸 UI 다듬기의 항목 3~9를 1180과 360 폭에서 화면으로 잰다.

항목 3: 분할 칸, 탭 판, 구역, 대화상자 본문에서 차트 틀 아래 끝과 칸 아래 끝의 차이가 12px(±1).
항목 4: 선, 면적 차트 초점 상태에서 초점 테두리가 plot에 그려지고 x축 첫 글, 끝 글 상자와 겹치지 않음.
항목 5: 한 축의 눈금 글 오른끝 x 차이가 1px 이하(음수 눈금이 있는 축 포함).
항목 6: 값이 없는 계열이 범례와 읽기 줄과 접근성 표에 없고, 남은 계열 색이 원래 index 그대로임.
항목 7: 360 폭 몫 표 꼴에서 숫자 열 폭 - (가장 긴 글 폭 + 칸 좌우 여백)이 4px 이하이고
        머리 글과 값이 잘리지 않음. profiler 꼴 좁은 숫자 열도 잘리지 않음.
항목 8: 360 폭, 알림이 떠 있고 본문을 끝까지 내렸을 때 마지막 블록 아래 끝이 알림 위 끝보다 8px 이상 위.
        알림을 닫으면 본문 아래 여백이 알림 전과 같아짐.
항목 9: 받는 중 뼈대 높이와 다 받은 뒤 차트 높이 차이가 2px 이하(small/medium/tall 전부).

  python3 scripts/visual-check/check_1246_layout.py --output <산출폴더> [--port 포트]

중립 미리보기 ?preview=data-controls에 장면 정의를 주입하고, 항목 8만 ?preview=notice-fixture를 쓴다.
서버는 이 체크아웃의 ui/harness/e2e-server.mjs를 KS_E2E_PORT로 띄운다. 판정이 하나라도 어긋나면
result.json과 캡처를 남기고 종료 코드 1로 끝난다. 산출물은 --output 폴더에만 쓴다.
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

APP_ID = "data-controls"
NOTICE_APP = "notice-fixture"
WIDE = (1180, 720)
NARROW = (360, 720)
DAYS = [f"11월 {day}일" for day in range(9, 16)]


def bar_series(values=(12, 18, 15, 22, 19, 27, 24)):
    return [{"key": "s", "name": "값", "points": [{"x": day, "y": value} for day, value in zip(DAYS, values)]}]


def split_scene():
    chart = {"type": "chart", "kind": "bar", "series": bar_series()}
    return {"type": "split", "direction": "row", "sizes": [1, 1], "children": [
        chart, {"type": "tabs", "tabs": [{"label": "차트", "child": chart}]}]}


def section_scene():
    return {"type": "section", "title": "구역", "child": {"type": "chart", "kind": "bar", "series": bar_series()}}


def dialog_scene():
    return {"type": "dialog", "open": True, "title": "대화상자", "on_close": [], "child":
            {"type": "chart", "kind": "bar", "series": bar_series()}}


def focus_scene():
    points = [{"x": day, "y": value} for day, value in zip(DAYS[:4], [12, 18, 15, 22])]
    return {"type": "stack", "direction": "column", "gap": "none", "children": [
        {"type": "chart", "kind": "line", "series": [{"key": "line", "name": "선", "points": points}]},
        {"type": "chart", "kind": "area", "series": [{"key": "area", "name": "면", "points": points}]},
    ]}


def tick_scene():
    return {"type": "stack", "direction": "column", "gap": "none", "children": [
        {"type": "section", "title": "통화", "child": {"type": "chart", "kind": "line", "number_format": {"style": "currency", "currency": "USD"},
                                                       "series": [{"key": "a", "name": "값", "points": [
                                                           {"x": "1월", "y": 2.5}, {"x": "2월", "y": -2.5}, {"x": "3월", "y": 1.0}]}]}},
        {"type": "section", "title": "정수", "child": {"type": "chart", "kind": "line",
                                                       "series": [{"key": "a", "name": "값", "points": [
                                                           {"x": "1월", "y": 3}, {"x": "2월", "y": -3}, {"x": "3월", "y": 1}]}]}},
    ]}


def empty_series_scene():
    series = [
        {"key": "a", "name": "계열 가", "points": [{"x": day, "y": value} for day, value in zip(DAYS[:4], [12, 18, 15, 22])]},
        {"key": "b", "name": "빈 계열", "points": [{"x": day, "y": None} for day in DAYS[:4]]},
        {"key": "c", "name": "계열 다", "points": [{"x": day, "y": value} for day, value in zip(DAYS[:4], [7, 9, 8, 11])]},
    ]
    return {"type": "section", "title": "빈 계열", "child": {"type": "chart", "kind": "bar", "series": series}}


def share_table_scene():
    rows = [
        {"key": "1", "name": "아주 긴 이름을 가진 첫 번째 작업 항목", "share": 44, "value": 1238},
        {"key": "2", "name": "둘째", "share": 21, "value": 987},
        {"key": "3", "name": "셋째", "share": 18, "value": 640},
        {"key": "4", "name": "넷째", "share": 17, "value": 12},
    ]
    return {"type": "table", "rows": rows, "columns": [
        {"field": "name", "label": "이름", "width": "fill"},
        {"field": "share", "label": "몫", "width": "medium", "format": "number"},
        {"field": "value", "label": "값", "width": "narrow", "format": "number"},
    ]}


def profiler_table_scene():
    return {"type": "table", "rows": [
        {"key": "1", "label": "입력 처리 중 아주 긴 구간 이름", "calls": 1234, "avg_ms": 12345, "p95_ms": 23456, "max_ms": 34567, "total_ms": 1234567},
        {"key": "2", "label": "둘째 구간", "calls": 12, "avg_ms": 123, "p95_ms": 234, "max_ms": 345, "total_ms": 1234},
    ], "columns": [
        {"field": "label", "label": "구간", "width": "fill"},
        {"field": "calls", "label": "호출", "width": "narrow", "format": "number"},
        {"field": "avg_ms", "label": "평균(ms)", "width": "narrow", "format": "number"},
        {"field": "p95_ms", "label": "P95(ms)", "width": "narrow", "format": "number"},
        {"field": "max_ms", "label": "최대(ms)", "width": "narrow", "format": "number"},
        {"field": "total_ms", "label": "합계(ms)", "width": "narrow", "format": "number"},
    ]}


def long_body_scene():
    return {"type": "stack", "direction": "column", "children": [
        {"type": "text", "value": f"{index}번째 줄입니다. 본문이 길어 아래로 굴려야 알림과 만납니다."} for index in range(1, 41)]}


def loading_scene():
    return {"type": "stack", "direction": "column", "gap": "none", "children": [
        {"type": "chart", "kind": "bar", "height": height, "series": {"expr": "$data.sample"}}
        for height in ("small", "medium", "tall")]}


def loaded_scene():
    return {"type": "stack", "direction": "column", "gap": "none", "children": [
        {"type": "chart", "kind": "bar", "height": height, "series": bar_series()}
        for height in ("small", "medium", "tall")]}


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


ITEM3_JS = """(appId) => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (element) => { if (!element) return null; const r = element.getBoundingClientRect();
    return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }; };
  const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
  if (!win) return { error: '창을 찾지 못했습니다' };
  return [...win.querySelectorAll('.ks-chart')].map((chart) => {
    const frame = chart.querySelector('.ks-chart-frame');
    const panel = chart.closest('.ks-data-tab-panel');
    const section = chart.closest('.ks-data-section');
    const pane = chart.closest('.ks-split-pane');
    const body = chart.closest('.ks-dialog-body');
    const owner = panel || section || pane || body;
    const frameBox = box(frame);
    return { ownerName: panel ? 'tab-panel' : section ? 'section' : pane ? 'split-pane' : body ? 'dialog-body' : null,
             frame: frameBox, owner: box(owner),
             gap: owner ? round(owner.getBoundingClientRect().bottom - frame.getBoundingClientRect().bottom) : null };
  });
}"""

FOCUS_JS = """() => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (element) => { const r = element.getBoundingClientRect();
    return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }; };
  const win = document.querySelector('[data-testid="app-window-data-controls"]');
  const active = document.activeElement;
  const focusedIndex = [...win.querySelectorAll('.ks-chart')].findIndex((chart) => chart.contains(active));
  const chart = [...win.querySelectorAll('.ks-chart')][focusedIndex];
  if (!chart) return { focusedIndex, error: '초점이 차트에 없습니다' };
  const graph = chart.querySelector('.ks-chart-graph');
  const plot = chart.querySelector('.ks-chart-plot');
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;';
  document.body.appendChild(probe);
  probe.style.color = 'var(--ks-color-focus)';
  const focusColor = getComputedStyle(probe).color;
  probe.remove();
  const plotBox = box(plot);
  const labels = [...chart.querySelectorAll('.ks-chart-x-axis span')].map((span) => {
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()];
    return { text: span.textContent, glyph: rects.length ? box({ getBoundingClientRect: () => rects[0] }) : null,
             span: box(span) };
  });
  const style = (element) => { const s = getComputedStyle(element);
    return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, outlineColor: s.outlineColor, outlineOffset: s.outlineOffset }; };
  const overlaps = labels.some((label) => label.glyph
    && label.glyph.bottom > plotBox.top && label.glyph.top < plotBox.bottom
    && label.glyph.right > plotBox.left && label.glyph.left < plotBox.right);
  return { focusedIndex, focusColor, plot: plotBox, labels,
           graphStyle: style(graph), plotStyle: style(plot), overlaps };
}"""

TICK_JS = """(appId) => {
  const round = (value) => Math.round(value * 10) / 10;
  const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
  return [...win.querySelectorAll('.ks-chart')].map((chart) => {
    const axis = chart.querySelector('.ks-chart-y-axis');
    const style = getComputedStyle(axis);
    const spans = [...axis.querySelectorAll('span')].map((span) => {
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()];
      const glyphRight = rects.length ? Math.max(...rects.map((rect) => rect.right)) : null;
      return { text: span.textContent, textAlign: getComputedStyle(span).textAlign,
               right: glyphRight === null ? null : round(glyphRight),
               spanRight: round(span.getBoundingClientRect().right) };
    });
    const rights = spans.map((span) => span.right).filter((right) => right !== null);
    return { textAlign: style.textAlign, fontVariantNumeric: style.fontVariantNumeric, spans,
             spread: rights.length ? round(Math.max(...rights) - Math.min(...rights)) : null,
             hasNegative: spans.some((span) => span.text.trim().startsWith('-')),
             hasPositive: spans.some((span) => span.text.trim() && !span.text.trim().startsWith('-')) };
  });
}"""

EMPTY_SERIES_JS = """(appId) => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (element) => { const r = element.getBoundingClientRect();
    return { left: round(r.left), right: round(r.right), width: round(r.width), height: round(r.height) }; };
  const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
  const chart = win.querySelector('.ks-chart');
  const legend = chart.querySelector('.ks-chart-legend');
  return {
    readout: chart.querySelector('.ks-chart-readout-values').textContent,
    readoutItems: [...chart.querySelectorAll('.ks-chart-readout-values > span')].map((span) => span.textContent),
    legend: legend ? [...legend.querySelectorAll('.ks-chart-legend-item')].map((item) => ({
      text: item.textContent, style: item.getAttribute('style'),
      color: item.querySelector('.ks-list-color') ? getComputedStyle(item.querySelector('.ks-list-color')).backgroundColor : null,
    })) : null,
    legendBox: legend ? box(legend) : null,
    seriesStyles: [...chart.querySelectorAll('.ks-chart-series')].map((group) => group.getAttribute('style')),
    tableHeaders: [...chart.querySelectorAll('.ks-accessible-hidden thead th')].map((th) => th.textContent),
    tableText: chart.querySelector('.ks-accessible-hidden').textContent,
  };
}"""

TABLE_JS = """(appId) => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (element) => { const r = element.getBoundingClientRect();
    return { left: round(r.left), right: round(r.right), width: round(r.width), height: round(r.height) }; };
  const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
  const table = win.querySelector('.ks-table-scroll');
  if (!table) return { error: '표가 없습니다' };
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;';
  win.appendChild(probe);
  const textWidth = (text, font, variant) => { probe.style.font = font; probe.style.fontVariantNumeric = variant || 'normal';
    probe.textContent = text; return round(probe.getBoundingClientRect().width); };
  const headerCells = [...table.querySelectorAll('.ks-table-header > div')];
  const bodyRows = [...table.querySelectorAll('.ks-table-row')];
  const headerStyle = getComputedStyle(table.querySelector('.ks-table-header'));
  const firstCell = bodyRows[0]?.querySelector('.ks-table-cell');
  const cellStyle = firstCell ? getComputedStyle(firstCell) : headerStyle;
  const headerFont = `${headerStyle.fontSize} ${headerStyle.fontFamily}`;
  const cellFont = `${cellStyle.fontSize} ${cellStyle.fontFamily}`;
  const columns = headerCells.map((header, index) => {
    // 잘림은 overflow:hidden 상자의 내용 폭과 글 폭을 맞대어 본다. scrollWidth는 여백이 섞여 쓸 수 없다.
    const label = header.querySelector('button') || header;
    const labelStyle = getComputedStyle(label);
    const headerPadding = parseFloat(labelStyle.paddingLeft) + parseFloat(labelStyle.paddingRight);
    const headerText = textWidth(label.textContent, headerFont, 'normal');
    const headerAvailable = box(header).width - headerPadding;
    const cells = bodyRows.map((row) => row.querySelectorAll('.ks-table-cell')[index]).filter(Boolean);
    const texts = cells.map((cell) => cell.textContent);
    const widths = texts.map((text) => textWidth(text, cellFont, 'tabular-nums'));
    const paddingLeft = cells.length ? parseFloat(getComputedStyle(cells[0]).paddingLeft) : 0;
    const paddingRight = cells.length ? parseFloat(getComputedStyle(cells[0]).paddingRight) : 0;
    const cellFits = cells.map((cell, cellIndex) => {
      const style = getComputedStyle(cell);
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      return widths[cellIndex] <= box(cell).width - padding + 0.5;
    });
    return {
      label: label.textContent, columnWidth: cells.length ? box(cells[0]).width : box(header).width,
      padding: round(paddingLeft + paddingRight), longest: Math.max(0, ...widths), texts,
      headerTruncated: headerText > headerAvailable + 0.5,
      cellTruncated: cellFits.some((fits) => !fits),
      headerText, headerAvailable: round(headerAvailable), widths,
    };
  });
  probe.remove();
  return { styles: { columns: getComputedStyle(table).getPropertyValue('--ks-table-columns'), headerFontSize: headerStyle.fontSize,
                     cellFontSize: cellStyle.fontSize }, columns,
           scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
}"""

NOTICE_JS = """(appId) => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (element) => { if (!element) return null; const r = element.getBoundingClientRect();
    return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }; };
  const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
  const body = win.querySelector('.ks-data-window-body');
  const notice = win.querySelector('.ks-data-window-notice');
  const items = [...body.querySelectorAll('.ks-data-stack > .ks-data-stack-item')];
  const last = items.at(-1);
  body.scrollTop = body.scrollHeight;
  const lastBox = last ? box(last) : null;
  const noticeBox = box(notice);
  return {
    body: box(body), borderBlockEnd: round(parseFloat(getComputedStyle(body).borderBlockEndWidth)),
    notice: noticeBox, noticeHeight: noticeBox ? noticeBox.height : 0,
    windowHeight: box(win).height,
    scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
    lastBottom: lastBox ? lastBox.bottom : null,
    gap: lastBox && noticeBox ? round(noticeBox.top - lastBox.bottom) : null,
  };
}"""

HEIGHT_JS = """(appId) => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (element) => { if (!element) return null; const r = element.getBoundingClientRect();
    return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }; };
  const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
  return [...win.querySelectorAll('.ks-data-stack > .ks-data-stack-item')].map((item) => {
    const chart = item.querySelector('.ks-chart');
    const frame = item.querySelector('.ks-chart-frame');
    const skeleton = item.querySelector('.ks-data-skeleton');
    return { chartClass: chart ? chart.className : null, chart: box(chart), frame: box(frame), skeleton: box(skeleton),
             chartHeight: chart ? box(chart).height : null, frameHeight: frame ? box(frame).height : null,
             skeletonHeight: skeleton ? box(skeleton).height : null };
  });
}"""


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
            expected = 2 if name == "split" else 1
            record(result, key, {
                "charts": len(measured) == expected,
                "one_space_3": len(measured) == expected and all(m["gap"] is not None and abs(m["gap"] - 12) <= 1 for m in measured),
            })
            result["scenes"][key]["measurement"] = measured
            capture(output, result, page, key)


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
            plot_style = measured.get("plotStyle") or {}
            record(result, key, {
                "focused": reached and measured.get("focusedIndex") == index,
                "outline_on_plot": plot_style.get("outlineStyle") == "solid" and plot_style.get("outlineWidth") == "2px",
                "outline_color": plot_style.get("outlineColor") == measured.get("focusColor"),
                "outline_offset": plot_style.get("outlineOffset") == "-2px",
                "graph_outline_none": (measured.get("graphStyle") or {}).get("outlineStyle") == "none",
                "no_label_overlap": measured.get("overlaps") is False,
            })
            result["scenes"][key]["measurement"] = measured
            capture(output, result, page, key)


def check_item5(page, output, result):
    inject(page, tick_scene())
    for width, height in (WIDE, NARROW):
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(450)
        measured = page.evaluate(TICK_JS, APP_ID)
        key = f"item5-{width}"
        record(result, key, {
            "two_axes": len(measured) == 2,
            "end_aligned": len(measured) == 2 and all(
                m["spans"] and all(span["textAlign"] == "end" for span in m["spans"]) for m in measured),
            "tabular": len(measured) == 2 and all("tabular-nums" in m["fontVariantNumeric"] for m in measured),
            "right_spread_1px": len(measured) == 2 and all(m["spread"] is not None and m["spread"] <= 1 for m in measured),
            "negative_tick_present": len(measured) == 2 and all(m["hasNegative"] for m in measured),
        })
        result["scenes"][key]["measurement"] = measured
        capture(output, result, page, key)


def check_item6(page, output, result):
    inject(page, empty_series_scene())
    for width, height in (WIDE, NARROW):
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(450)
        measured = page.evaluate(EMPTY_SERIES_JS, APP_ID)
        legend = measured["legend"] or []
        key = f"item6-{width}"
        record(result, key, {
            "legend_two": [item["text"] for item in legend] == ["계열 가", "계열 다"],
            "readout_hides_empty": "빈 계열" not in measured["readout"] and "계열 다" in measured["readout"],
            "table_hides_empty": "빈 계열" not in measured["tableText"] and measured["tableHeaders"] == ["시점", "계열 가", "계열 다"],
            "colors_by_original_index": len(legend) == 2
            and "--ks-chart-series-color: var(--ks-color-series-1)" in (legend[0]["style"] or "")
            and "--ks-chart-series-color: var(--ks-color-series-3)" in (legend[1]["style"] or ""),
        })
        result["scenes"][key]["measurement"] = measured
        capture(output, result, page, key)


def share_verdict(measured):
    if measured.get("error"):
        return {"columns": False}
    value = measured["columns"][-1]
    slack = value["columnWidth"] - (value["longest"] + value["padding"])
    return {
        "value_slack_4px": slack <= 4,
        "value_not_truncated": not value["headerTruncated"] and not value["cellTruncated"],
        "no_horizontal_overflow": measured["scrollWidth"] <= measured["clientWidth"] + 1,
        "slack": round(slack, 1),
    }


def profiler_verdict(measured):
    if measured.get("error"):
        return {"columns": False}
    narrow = measured["columns"][1:]
    return {
        "narrow_not_truncated": all(not column["headerTruncated"] and not column["cellTruncated"] for column in narrow),
        "no_horizontal_overflow": measured["scrollWidth"] <= measured["clientWidth"] + 1,
    }


def check_item7(page, output, result):
    for name, scene, judge in (("share", share_table_scene(), share_verdict),
                               ("profiler", profiler_table_scene(), profiler_verdict)):
        inject(page, scene)
        for width, height in (WIDE, NARROW):
            page.set_viewport_size({"width": width, "height": height})
            page.wait_for_timeout(500)
            measured = page.evaluate(TABLE_JS, APP_ID)
            key = f"item7-{name}-{width}"
            judged = judge(measured)
            slack = judged.pop("slack", None)
            record(result, key, judged)
            if slack is not None:
                result["scenes"][key]["slack"] = slack
            result["scenes"][key]["measurement"] = measured
            capture(output, result, page, key)


def check_item8(page, output, result):
    page.set_viewport_size({"width": NARROW[0], "height": NARROW[1]})
    open_page(page, result["port"], NOTICE_APP)
    page.evaluate("() => { const panel = document.querySelector('[data-testid=fake-files-panel]'); if (panel) panel.remove(); }")
    inject(page, long_body_scene(), app_id=NOTICE_APP)
    before = page.evaluate(NOTICE_JS, NOTICE_APP)
    page.evaluate("() => window.noticeFixture.alert()")
    page.wait_for_timeout(500)
    opened = page.evaluate(NOTICE_JS, NOTICE_APP)
    key = "item8-360"
    space = opened["noticeHeight"] + 16
    record(result, key, {
        "no_space_without_notice": abs(before["clientHeight"] - (before["body"]["height"] - before["borderBlockEnd"])) <= 1,
        "gap_at_least_8": opened["gap"] is not None and opened["gap"] >= 8,
        "scrollport_matches_notice": abs((before["clientHeight"] - opened["clientHeight"]) - space) <= 1.5,
        "notice_capped": opened["noticeHeight"] * 2 <= opened["windowHeight"] + 1,
    })
    result["scenes"][key]["measurement"] = {"before": before, "opened": opened}
    capture(output, result, page, key)
    page.evaluate("""() => { const button = document.querySelector('[data-testid="app-window-notice-fixture"] .ks-notice button[aria-label="닫기"]'); if (button) button.click(); }""")
    page.wait_for_timeout(500)
    closed = page.evaluate(NOTICE_JS, NOTICE_APP)
    record(result, f"{key}-closed", {
        "scrollport_restored": abs(closed["clientHeight"] - before["clientHeight"]) <= 1,
        "scroll_height_restored": abs(closed["scrollHeight"] - before["scrollHeight"]) <= 1,
    })
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
        frames_equal = len(skeleton) == len(chart) == 3 and all(
            abs(left["frameHeight"] - right["frameHeight"]) <= 2 for left, right in zip(skeleton, chart))
        charts_equal = len(skeleton) == len(chart) == 3 and all(
            abs(left["chartHeight"] - right["chartHeight"]) <= 2 for left, right in zip(skeleton, chart))
        record(result, key, {"three_branches": len(skeleton) == len(chart) == 3,
                             "frame_height": frames_equal, "chart_height": charts_equal})
        result["scenes"][key]["measurement"] = {"loading": skeleton, "loaded": chart}


def main(checker=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--port", type=int, default=5397)
    args = parser.parse_args()
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
                if checker:
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
