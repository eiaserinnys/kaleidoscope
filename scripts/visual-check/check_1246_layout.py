#!/usr/bin/env python3
"""카드 #1246 셸 UI 다듬기의 항목 3~9를 1180과 360 폭에서 화면으로 잰다.

항목 3: 분할 칸, 탭 판, 구역, 대화상자 본문에서 차트 틀 아래 끝과 칸 아래 끝의 차이가 12px(±1).
        같은 구역에서 차트 뒤에 표가 이어지면 차트 틀 아래 끝과 표 위 끝의 차이가 12px(±1).
항목 4: 선, 면적 차트 초점 상태에서 초점 테두리가 plot에 그려지고 x축 첫 글, 끝 글 상자와 겹치지 않음.
항목 5: 한 축의 눈금 글 오른끝 x 차이가 1px 이하(음수 눈금이 있는 축 포함).
항목 6: 값이 없는 계열이 범례와 읽기 줄과 접근성 표에 없고, 남은 계열 색이 원래 index 그대로임.
항목 7: 360 폭 몫 표 꼴(긴 이름 fill 열 + 「44%」 몫 열 + 값 열)에서 숫자 열 폭 -
        (가장 긴 글 폭 + 칸 좌우 여백 + 정렬표 자리 19px)이 4px 이하이고, 실제 화면의 머리 칸과
        값 칸이 잘리지 않으며 머리가 한 줄임. 정렬 오름차순·내림차순에서도 같고 열 폭이 움직이지 않음.
        apps/profiler.json의 좁은 숫자 열과 예제 앱(block-gallery) 표도 실제 정의 그대로 잘리지 않음.
항목 8: 360 폭, 알림이 떠 있고 본문을 끝까지 내렸을 때 마지막 블록 아래 끝이 알림 위 끝보다 8px 이상 위.
        알림을 닫으면 본문 아래 여백이 알림 전과 같아짐. 5초짜리 상태 알림만 떴을 때는 여백이 늘지 않음.
항목 9: 받는 중 뼈대 높이와 다 받은 뒤 차트 높이 차이가 2px 이하(compact/medium/tall 전부).
        받는 중 측정 전에 뼈대(ks-chart-loading)가 실제로 그려졌는지 확인함.

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
# 정렬 단추가 붙는 표(RowTableView)는 정렬표 15px와 그 간격 4px를 머리 폭에 늘 잡아 둔다.
SORT_RESERVE = 19
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
    # 기준본 장면: 360 폭에서 긴 이름 fill 열 + 좁은 숫자 몫 열(「44%」) + 좁은 숫자 값 열.
    rows = [
        {"key": "1", "name": "아주 긴 이름을 가진 첫 번째 작업 항목", "share": "44%", "value": 1238},
        {"key": "2", "name": "둘째", "share": "21%", "value": 987},
        {"key": "3", "name": "셋째", "share": "8%", "value": 640},
        {"key": "4", "name": "넷째", "share": "3%", "value": 12},
    ]
    return {"type": "table", "rows": rows, "columns": [
        {"field": "name", "label": "이름", "width": "fill"},
        {"field": "share", "label": "몫", "width": "narrow", "format": "number"},
        {"field": "value", "label": "값", "width": "narrow", "format": "number"},
    ]}


def section_stack_scene():
    rows = [
        {"key": "1", "name": "첫 줄", "count": 12},
        {"key": "2", "name": "둘째 줄", "count": 7},
    ]
    return {"type": "section", "title": "차트와 표", "child": {"type": "stack", "direction": "column", "gap": "none", "children": [
        {"type": "chart", "kind": "bar", "series": bar_series()},
        {"type": "table", "rows": rows, "columns": [
            {"field": "name", "label": "이름", "width": "fill"},
            {"field": "count", "label": "수", "width": "narrow", "format": "number"},
        ]},
    ]}}


def long_body_scene():
    return {"type": "stack", "direction": "column", "children": [
        {"type": "text", "value": f"{index}번째 줄입니다. 본문이 길어 아래로 굴려야 알림과 만납니다."} for index in range(1, 41)]}


def loading_scene():
    return {"type": "stack", "direction": "column", "gap": "none", "children": [
        {"type": "chart", "kind": "bar", "height": height, "series": {"expr": "$data.sample"}}
        for height in ("compact", "medium", "tall")]}


def loaded_scene():
    return {"type": "stack", "direction": "column", "gap": "none", "children": [
        {"type": "chart", "kind": "bar", "height": height, "series": bar_series()}
        for height in ("compact", "medium", "tall")]}


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
    if (!node) return { text: span.textContent, glyph: null, span: box(span) };
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
    return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }; };
  // 실제 화면에 그려진 글의 줄 상자를 읽는다. 구현의 탐침 폭 계산을 되풀이하지 않는다.
  const textRects = (element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const rects = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      rects.push(...range.getClientRects());
    }
    return rects;
  };
  const lineCount = (rects) => new Set(rects.map((rect) => Math.round(rect.top))).size;
  const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
  const table = win && win.querySelector('.ks-table-scroll');
  if (!table) return { error: '표가 없습니다' };
  const headerCells = [...table.querySelectorAll('.ks-table-header > div')];
  const bodyRows = [...table.querySelectorAll('.ks-table-row')];
  const columns = headerCells.map((header, index) => {
    const button = header.querySelector('button') || header;
    const headerRects = textRects(button);
    const headerBox = box(header);
    const headerOutside = headerRects.some((rect) => rect.left < headerBox.left - 0.5 || rect.right > headerBox.right + 0.5);
    const headerOverflow = header.scrollWidth > header.clientWidth + 1 || headerOutside;
    const cells = bodyRows.map((row) => row.querySelectorAll('.ks-table-cell')[index]).filter(Boolean);
    const cellOverflow = cells.some((cell) => cell.scrollWidth > cell.clientWidth + 1);
    const cellRects = cells.flatMap((cell) => textRects(cell));
    const style = cells.length ? getComputedStyle(cells[0]) : getComputedStyle(header);
    return {
      label: button.textContent,
      columnWidth: cells.length ? box(cells[0]).width : headerBox.width,
      padding: round(parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)),
      longest: round(Math.max(0, ...cellRects.map((rect) => rect.width))),
      headerLongest: round(Math.max(0, ...headerRects.map((rect) => rect.width))),
      headerLines: lineCount(headerRects), headerOverflow, cellOverflow,
    };
  });
  return { styles: { columns: getComputedStyle(table).getPropertyValue('--ks-table-columns') }, columns,
           rowCount: bodyRows.length,
           scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
}"""

SECTION_STACK_JS = """(appId) => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (element) => { const r = element.getBoundingClientRect();
    return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }; };
  const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
  const section = win && win.querySelector('.ks-data-section');
  const frame = box(section && section.querySelector('.ks-chart-frame'));
  const table = box(section && section.querySelector('.ks-table-scroll'));
  return { frame, table, gap: frame && table ? round(table.top - frame.bottom) : null };
}"""

NOTICE_JS = """(appId) => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (element) => { if (!element) return null; const r = element.getBoundingClientRect();
    return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }; };
  const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
  const body = win.querySelector('.ks-data-window-body');
  const notice = win.querySelector('.ks-data-window-notice');
  const alert = notice && [...notice.children].find((child) => child.classList.contains('ks-notice'));
  const items = [...body.querySelectorAll('.ks-data-stack > .ks-data-stack-item')];
  const last = items.at(-1);
  body.scrollTop = body.scrollHeight;
  const lastBox = last ? box(last) : null;
  const noticeBox = box(alert);
  return {
    body: box(body), borderBlockEnd: round(parseFloat(getComputedStyle(body).borderBlockEndWidth)),
    noticeSpace: body.style.getPropertyValue('--ks-notice-space'),
    notice: noticeBox, noticeHeight: noticeBox ? noticeBox.height : 0,
    statusVisible: Boolean(notice && notice.querySelector('.ks-window-status')),
    alertVisible: Boolean(alert),
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
    return { chartClass: chart ? chart.className : null,
             loading: Boolean(chart && chart.classList.contains('ks-chart-loading')),
             chart: box(chart), frame: box(frame), skeleton: box(skeleton),
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
    # 같은 구역에서 차트 뒤에 표가 이어질 때 차트가 아래 여백을 남기는지.
    inject(page, section_stack_scene())
    for width, height in (WIDE, NARROW):
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(450)
        measured = page.evaluate(SECTION_STACK_JS, APP_ID)
        key = f"item3-section-stack-{width}"
        record(result, key, {
            "chart_and_table": measured["gap"] is not None,
            "gap_12": measured["gap"] is not None and abs(measured["gap"] - 12) <= 1,
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
            labels = measured.get("labels") or []
            record(result, key, {
                "focused": reached and measured.get("focusedIndex") == index,
                "first_last_glyphs": len(labels) >= 2
                and labels[0].get("glyph") is not None and labels[-1].get("glyph") is not None,
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


def table_verdict(measured, slack=False, overflow=False):
    if measured.get("error"):
        return {"columns": False}
    columns = measured["columns"]
    verdicts = {
        "rows_present": measured.get("rowCount", 0) > 0,
        "headers_single_line": all(column["headerLines"] == 1 for column in columns),
        "no_header_overflow": all(not column["headerOverflow"] for column in columns),
        # 첫 fill 열은 긴 이름이 말줄임으로 잘리는 것이 정상이라 숫자·좁은 열만 본다.
        "no_cell_overflow": all(not column["cellOverflow"] for column in columns[1:]),
    }
    if slack:
        verdicts["numeric_slack_4px"] = all(
            column["columnWidth"] - (max(column["longest"], column["headerLongest"]) + column["padding"] + SORT_RESERVE) <= 4
            for column in columns[1:])
    if overflow:
        verdicts["no_horizontal_overflow"] = measured["scrollWidth"] <= measured["clientWidth"] + 1
    return verdicts


def sort_table(page, app_id, label):
    page.evaluate(
        """([appId, label]) => {
          const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
          const button = win && [...win.querySelectorAll('.ks-table-header button')]
            .find((item) => item.textContent.trim() === label);
          if (button) button.click();
        }""",
        [app_id, label],
    )
    page.wait_for_timeout(450)


def measure_table(page, output, result, name, app_id, width, label, slack=False, overflow=False):
    page.set_viewport_size({"width": width, "height": 720})
    page.wait_for_timeout(450)
    measured = page.evaluate(TABLE_JS, app_id)
    key = f"item7-{name}-{width}"
    record(result, key, table_verdict(measured, slack=slack, overflow=overflow))
    if not measured.get("error"):
        result["scenes"][key]["slacks"] = [
            round(column["columnWidth"] - (max(column["longest"], column["headerLongest"]) + column["padding"] + SORT_RESERVE), 1)
            for column in measured["columns"][1:]]
        base_widths = [column["columnWidth"] for column in measured["columns"]]
    result["scenes"][key]["measurement"] = measured
    capture(output, result, page, key)
    if measured.get("error"):
        return
    for direction in ("asc", "desc"):
        sort_table(page, app_id, label)
        sorted_measured = page.evaluate(TABLE_JS, app_id)
        sorted_key = f"{key}-{direction}"
        verdicts = table_verdict(sorted_measured, slack=slack, overflow=overflow)
        verdicts["widths_stable"] = not sorted_measured.get("error") and len(sorted_measured["columns"]) == len(base_widths) and all(
            abs(column["columnWidth"] - base) <= 1 for column, base in zip(sorted_measured["columns"], base_widths))
        record(result, sorted_key, verdicts)
        result["scenes"][sorted_key]["measurement"] = sorted_measured
        capture(output, result, page, sorted_key)
    # 다음 폭의 기준 측정이 정렬 없는 상태에서 시작하도록 한 번 더 눌러 정렬을 푼다.
    sort_table(page, app_id, label)


def check_item7(page, output, result):
    inject(page, share_table_scene())
    for width, height in (WIDE, NARROW):
        measure_table(page, output, result, "share", APP_ID, width, "몫", slack=True, overflow=True)
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
    record(result, status_key, {
        "status_visible": status["statusVisible"] and not status["alertVisible"],
        "no_bottom_space_with_status": abs(status["borderBlockEnd"]) <= 0.5
        and abs(status["clientHeight"] - before["clientHeight"]) <= 1
        and status["noticeSpace"] in ("", "0px"),
    })
    result["scenes"][status_key]["measurement"] = status
    capture(output, result, page, status_key)
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
        record(result, key, {"skeleton_shown": len(skeleton) == 3 and all(item["loading"] for item in skeleton),
                             "three_branches": len(skeleton) == len(chart) == 3,
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
