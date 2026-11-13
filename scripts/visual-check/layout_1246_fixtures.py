"""카드 #1246 시각 검수(check_1246_layout.py)의 장면 정의와 화면 측정 JS.

판정 흐름은 check_1246_layout.py에 있고, 이 파일은 데이터(장면 블록, 페이지에서 도는 측정식)만 둔다.
"""

APP_ID = "data-controls"
NOTICE_APP = "notice-fixture"
WIDE = (1180, 720)
NARROW = (360, 720)
# 정렬 단추가 붙는 표(RowTableView)는 정렬표 15px와 그 간격 4px를 머리 폭에 늘 잡아 둔다.
SORT_RESERVE = 19
DAYS = [f"11월 {day}일" for day in range(9, 16)]
LONG_BODY_LINES = 40


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


def small_table():
    rows = [
        {"key": "1", "name": "첫 줄", "count": 12},
        {"key": "2", "name": "둘째 줄", "count": 7},
    ]
    return {"type": "table", "rows": rows, "columns": [
        {"field": "name", "label": "이름", "width": "fill"},
        {"field": "count", "label": "수", "width": "narrow", "format": "number"},
    ]}


def section_stack_scene(gap="none", nested=False):
    """구역 > 쌓기(gap) > [차트, 표]. nested면 차트를 간격 없는 안쪽 쌓기 하나로 한 번 더 감싼다."""
    chart = {"type": "chart", "kind": "bar", "series": bar_series()}
    first = {"type": "stack", "direction": "column", "children": [chart]} if nested else chart
    title = f"{'중첩' if nested else '같은 쌓기'} {gap}"
    return {"type": "section", "title": title, "child": {"type": "stack", "direction": "column", "gap": gap, "children": [
        first, small_table()]}}


CONTROL_ROW_STATE = {"view": "all", "alt": False}


def control_row_scene():
    """조작 줄 꼴: 구역 > 쌓기(medium) > [고르기 줄, 쌓기(medium) > [숨은 갈래, 차트], 표]."""
    toolbar = {"type": "toolbar", "start": [{"type": "select", "style": "dropdown", "value": {"state": "view"},
                                             "on_change": {"set_state": "view"},
                                             "options": [{"value": "all", "label": "전체"}, {"value": "week", "label": "이번 주"}]}]}
    return {"type": "section", "title": "사용량", "child": {"type": "stack", "direction": "column", "gap": "medium", "children": [
        toolbar,
        {"type": "stack", "direction": "column", "gap": "medium", "children": [
            {"type": "when", "value": {"state": "alt"}, "child": {"type": "chart", "kind": "line", "series": bar_series()}},
            {"type": "chart", "kind": "bar", "height": "medium", "series": bar_series()}]},
        small_table()]}}


# origin/main(e9329367)의 차트 아래 여백 규칙. 그때는 구역과 탭 판 안의 차트가 늘 아래 여백 한 겹을 가졌다.
# 조작 줄 꼴은 이 규칙을 덧씌워 잰 값과 같아야 한다(간격 있는 쌓기의 차트 간격은 main과 같게 둔다).
MAIN_CHART_END_CSS = ":is(.ks-data-tab-panel, .ks-data-section) .ks-chart { padding-block-end: var(--ks-space-3) !important; }"


def two_series_scene():
    """빈 계열 장면에서 빈 계열만 뺀 같은 차트. 묶음 막대 자리를 비교하는 기준이다."""
    scene = empty_series_scene()
    series = scene["child"]["series"]
    scene["child"]["series"] = [series[0], series[2]]
    scene["title"] = "두 계열"
    return scene


def long_body_scene():
    # fill: []로 기본 채움 칸을 끈다. 기본 채움 칸은 본문이 넘치면 높이 0으로 접혀, 마지막 칸으로 재면 늘 통과한다.
    return {"type": "stack", "direction": "column", "fill": [], "children": [
        {"type": "text", "value": f"{index}번째 줄입니다. 본문이 길어 아래로 굴려야 알림과 만납니다."} for index in range(1, LONG_BODY_LINES + 1)]}


def loading_scene():
    return {"type": "stack", "direction": "column", "gap": "none", "children": [
        {"type": "chart", "kind": "bar", "height": height, "series": {"expr": "$data.sample"}}
        for height in ("compact", "medium", "tall")]}


def loaded_scene():
    return {"type": "stack", "direction": "column", "gap": "none", "children": [
        {"type": "chart", "kind": "bar", "height": height, "series": bar_series()}
        for height in ("compact", "medium", "tall")]}

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
  // 넘침은 문서 폭이 아니라 표 스크롤 상자와 그 안의 칸에서 잰다.
  const scrollBox = box(table);
  const cellBoxes = [...headerCells, ...bodyRows.flatMap((row) => [...row.querySelectorAll('.ks-table-cell')])].map(box);
  const outside = cellBoxes.filter((cell) => cell.left < scrollBox.left - 1 || cell.right > scrollBox.right + 1);
  return { styles: { columns: getComputedStyle(table).getPropertyValue('--ks-table-columns') }, columns,
           rowCount: bodyRows.length, ariaSort: headerCells.map((header) => header.getAttribute('aria-sort')),
           tableScrollWidth: table.scrollWidth, tableClientWidth: table.clientWidth,
           cellCount: cellBoxes.length, cellsOutside: outside.length };
}"""

STACK_GAP_JS = """(appId) => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (element) => { if (!element) return null; const r = element.getBoundingClientRect();
    return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }; };
  const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
  const section = win && win.querySelector('.ks-data-section');
  const charts = section ? [...section.querySelectorAll('.ks-chart')] : [];
  const tables = section ? [...section.querySelectorAll('.ks-table-scroll')] : [];
  const toolbars = section ? [...section.querySelectorAll('.ks-data-toolbar')] : [];
  const frame = charts.length === 1 ? box(charts[0].querySelector('.ks-chart-frame')) : null;
  const table = tables.length === 1 ? box(tables[0]) : null;
  const toolbar = toolbars.length === 1 ? box(toolbars[0]) : null;
  return { charts: charts.length, tables: tables.length, toolbars: toolbars.length, frame, table, toolbar,
           chartPaddingEnd: charts.length === 1 ? getComputedStyle(charts[0]).paddingBlockEnd : null,
           below: frame && table ? round(table.top - frame.bottom) : null,
           above: frame && toolbar ? round(frame.top - toolbar.bottom) : null };
}"""

BARS_JS = """(appId) => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (element) => { const r = element.getBoundingClientRect();
    return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }; };
  const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
  const charts = win ? [...win.querySelectorAll('.ks-chart')] : [];
  if (charts.length !== 1) return { charts: charts.length, groups: [] };
  return { charts: 1, groups: [...charts[0].querySelectorAll('.ks-chart-series')].map((group) => ({
    className: group.getAttribute('class'), style: group.getAttribute('style'),
    bars: [...group.querySelectorAll('.ks-chart-bar')].map(box) })) };
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
  const lastGlyph = (() => { if (!last) return null; const walker = document.createTreeWalker(last, NodeFilter.SHOW_TEXT);
    const rects = []; for (let node = walker.nextNode(); node; node = walker.nextNode()) { const range = document.createRange();
      range.selectNodeContents(node); rects.push(...range.getClientRects()); }
    return rects.length ? round(Math.max(...rects.map((rect) => rect.bottom))) : null; })();
  const noticeBox = box(alert);
  return {
    body: box(body), borderBlockEnd: round(parseFloat(getComputedStyle(body).borderBlockEndWidth)),
    noticeSpace: body.style.getPropertyValue('--ks-notice-space'),
    notice: noticeBox, noticeHeight: noticeBox ? noticeBox.height : 0,
    statusVisible: Boolean(notice && notice.querySelector('.ks-window-status')),
    alertVisible: Boolean(alert),
    windowHeight: box(win).height,
    scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
    itemCount: items.length, lastText: last ? last.textContent : null,
    lastHeight: lastBox ? lastBox.height : null, lastGlyphBottom: lastGlyph,
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
