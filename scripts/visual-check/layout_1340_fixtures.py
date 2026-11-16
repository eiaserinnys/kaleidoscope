"""카드 #1340 시각 검수(check_1340_layout.py)의 장면 정의와 화면 측정 JS.

결함 넷의 재현 장면만 둔다. 판정 흐름은 check_1340_layout.py, 판정 함수는 layout_1340_verdicts.py다.
장면과 측정 JS 가운데 이미 있는 것은 layout_1246_fixtures.py에서 가져다 쓴다(구역 > 쌓기 차트 간격, 선 차트 초점, 몫 표).
"""

APP_ID = "data-controls"
WIDE = (1180, 720)
NARROW = (360, 720)
# 쉘 최소 창(브라우저 384×317). 차트를 담은 채움 칸은 여기서도 같은 판정을 받는다.
SHELL_MIN = (384, 317)
# --ks-pane-min-size(foundation.css:34). 기본 채움 칸이 넘칠 때 받는 바닥의 상한이다.
PANE_MIN = 160
# 쌓기 gap 토큰 값(px). 결함 2의 기대 간격이다.
GAP_PX = {"none": 0, "small": 8, "medium": 12, "large": 24}
FILL_LINES = 40
FILL_NESTED_LINES = 25


def _line(index, tail="본문이 길어 아래로 굴려야 합니다."):
    return {"type": "text", "value": f"{index}번째 줄입니다. {tail}"}


def _long_head(count=FILL_LINES):
    return [_line(index) for index in range(1, count + 1)]


def fill_text_scene():
    """기본 채움 칸(마지막 자식)의 내용이 글 한 줄인 장면. 앞 칸들이 창을 넘치게 한다.
    fill을 적지 않아 마지막 글 칸이 기본 채움을 받는다."""
    return {"type": "stack", "direction": "column", "children": [
        *_long_head(), {"type": "text", "value": "마지막 한 줄"}]}


def fill_long_scene():
    """기본 채움 칸의 내용이 pane 최소 크기(160px)보다 긴 장면. 채움 칸은 160px를 받고 그 안에서 굴러야 한다."""
    nested = {"type": "stack", "direction": "column",
              "children": [_line(index, "채움 칸 안쪽 줄입니다.") for index in range(1, FILL_NESTED_LINES + 1)]}
    return {"type": "stack", "direction": "column", "children": [*_long_head(), nested]}


def focus_two_series_scene():
    """항목 3의 장면. 선 차트와 면적 차트를 세로로 두고, 범례가 그려지도록 계열을 둘씩 둔다.
    시점은 넷이라 첫 점이 plot 왼쪽 경계, 끝 점이 오른쪽 경계에 놓인다."""
    def series(name, values):
        return {"key": name, "name": name, "points": [{"x": f"11월 {day}일", "y": value}
                                                     for day, value in zip(range(9, 13), values)]}
    return {"type": "stack", "direction": "column", "gap": "none", "children": [
        {"type": "chart", "kind": "line", "series": [series("선 가", (12, 18, 15, 22)), series("선 나", (8, 11, 9, 14))]},
        {"type": "chart", "kind": "area", "series": [series("면 가", (12, 18, 15, 22)), series("면 나", (8, 11, 9, 14))]},
    ]}


def _single_series(values=(12, 18, 15, 22)):
    return {"key": "s", "name": "값", "points": [{"x": f"11월 {day}일", "y": value}
                                                 for day, value in zip(range(9, 9 + len(values)), values)]}


def fill_tab_scene():
    """같은 결함을 탭 판에서 재는 장면. 차트가 든 쌓기는 탭 판 안 예외(data-stack-context.css:3-8)를 받지 않는다."""
    chart = {"type": "chart", "kind": "bar", "series": [{"key": "s", "name": "값", "points": [
        {"x": f"11월 {day}일", "y": value} for day, value in zip(range(9, 16), (12, 18, 15, 22, 19, 27, 24))]}]}
    return {"type": "tabs", "tabs": [{"label": "차트", "child": {"type": "stack", "direction": "column",
                                                              "children": [*_long_head(), chart]}}]}


def fill_body_chart_scene():
    """창 본문 [글 40줄, 선 차트]. 넘칠 때 기본 채움 칸이 차트를 잘라 내지 않는지 재는 장면이다."""
    return {"type": "stack", "direction": "column", "children": [
        *_long_head(), {"type": "chart", "kind": "line", "series": [_single_series()]}]}


# 항목 1의 글 장면들. 이름, 장면, 스크롤 주인(tab이면 탭 판, 아니면 창 본문), 크기 목록.
FILL_SCENES = (
    ("fill-text", fill_text_scene, "body", (WIDE, NARROW)),
    ("fill-long", fill_long_scene, "body", (WIDE, NARROW)),
)
# 반려 1의 차트 장면들. 세 크기(1180, 360, 쉘 최소 창)에서 잰다.
CHART_FILL_SCENES = (
    ("fill-tab", fill_tab_scene, "tab", (WIDE, NARROW, SHELL_MIN)),
    ("fill-body-chart", fill_body_chart_scene, "body", (WIDE, NARROW, SHELL_MIN)),
)


def focus_line_single_scene():
    """범례가 없는 한 계열 선 차트. 범례가 없어 그래프 상자 고리가 틀 아래 테두리와 겹줄로 보이던 꼴을 잰다."""
    return {"type": "stack", "direction": "column", "gap": "none", "children": [
        {"type": "chart", "kind": "line", "series": [_single_series()]}]}


def focus_bar_single_stack_scene():
    """한 계열 막대 차트를 gap medium 쌓기의 첫 칸에 둔 꼴."""
    return {"type": "stack", "direction": "column", "gap": "medium", "children": [
        {"type": "chart", "kind": "bar", "series": [_single_series((12, 18, 15, 22, 19, 27, 24))]},
        {"type": "text", "value": "차트 아래 글입니다."}]}


def focus_bar_single_section_scene():
    """한 계열 막대 차트를 구역 안에 둔 꼴."""
    return {"type": "section", "title": "차트 구역", "child": {
        "type": "chart", "kind": "bar", "series": [_single_series((12, 18, 15, 22, 19, 27, 24))]}}

FILL_JS = """([appId, owner]) => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (element) => { if (!element) return null; const r = element.getBoundingClientRect();
    return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }; };
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
  const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
  if (!win) return { error: '창을 찾지 못했습니다' };
  const scrollOwner = owner === 'tab' ? win.querySelector('.ks-data-tab-panel') : win.querySelector('.ks-data-window-body');
  if (!scrollOwner) return { error: '스크롤 주인을 찾지 못했습니다' };
  const stack = scrollOwner.querySelector('.ks-data-stack.is-column');
  if (!stack) return { error: '쌓기를 찾지 못했습니다' };
  const items = [...stack.querySelectorAll(':scope > .ks-data-stack-item')];
  const fill = items.find((item) => item.classList.contains('is-fill')) || null;
  if (!fill) return { error: '기본 채움 칸이 없습니다', itemCount: items.length };
  // 스크롤 주인을 내리기 전에 잰다. 높이와 내용 높이는 스크롤과 상관없다.
  const fillBox = box(fill);
  const rects = textRects(fill);
  const glyphTop = rects.length ? round(Math.min(...rects.map((rect) => rect.top))) : null;
  const glyphBottom = rects.length ? round(Math.max(...rects.map((rect) => rect.bottom))) : null;
  const chart = fill.querySelector(':scope > .ks-chart');
  const chartBox = box(chart);
  const frame = chart ? chart.querySelector('.ks-chart-frame') : null;
  const frameBox = box(frame);
  const ownerBox = box(scrollOwner);
  const before = { ownerScrollTop: scrollOwner.scrollTop, fillTop: fillBox.top, fillBottom: fillBox.bottom };
  scrollOwner.scrollTop = scrollOwner.scrollHeight;
  const scrolledBox = box(fill);
  const scrolledChart = box(chart);
  const inside = (inner, outer) => inner !== null && outer !== null
    && inner.left >= outer.left - 1 && inner.right <= outer.right + 1
    && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
  return {
    itemCount: items.length, fillCount: items.filter((item) => item.classList.contains('is-fill')).length,
    fill: fillBox, fillClientHeight: round(fill.clientHeight), fillScrollHeight: round(fill.scrollHeight),
    glyphCount: rects.length, glyphTop, glyphBottom,
    chart: chartBox, chartFrame: frameBox,
    chartInsideFill: inside(chartBox, fillBox),
    fillScrollDiff: round(fill.scrollHeight - fill.clientHeight),
    owner: ownerBox, ownerClientHeight: round(scrollOwner.clientHeight), ownerScrollHeight: round(scrollOwner.scrollHeight),
    ownerScrolls: scrollOwner.scrollHeight > scrollOwner.clientHeight + 1,
    ownerScrolledTo: round(scrollOwner.scrollTop), before,
    after: { fillTop: scrolledBox.top, fillBottom: scrolledBox.bottom },
    visibleAfterScroll: scrolledBox.top >= ownerBox.top - 1 && scrolledBox.bottom <= ownerBox.bottom + 1,
    chartVisibleAfterScroll: inside(scrolledChart, ownerBox),
  };
}"""

DOT_JS = """() => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (element) => { if (!element) return null; const r = element.getBoundingClientRect();
    return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }; };
  const raw = (element) => { const r = element.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const win = document.querySelector('[data-testid="app-window-data-controls"]');
  if (!win) return { error: '창을 찾지 못했습니다' };
  const active = document.activeElement;
  const charts = [...win.querySelectorAll('.ks-chart')];
  const focusedIndex = charts.findIndex((chart) => chart.contains(active));
  const chart = charts[focusedIndex];
  if (!chart) return { focusedIndex, error: '초점이 차트에 없습니다' };
  const frame = chart.querySelector('.ks-chart-frame');
  const graph = chart.querySelector('.ks-chart-graph');
  const plot = chart.querySelector('.ks-chart-plot');
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--ks-color-focus);';
  document.body.appendChild(probe);
  const focusColor = getComputedStyle(probe).color;
  probe.remove();
  const frameRaw = raw(frame);
  const frameStyle = getComputedStyle(frame);
  // outline-style이 none이면 그려지는 테두리가 없다. 너비 값(브라우저 기본 3px)을 띠로 오해하지 않는다.
  const width = frameStyle.outlineStyle === 'none' ? 0 : parseFloat(frameStyle.outlineWidth) || 0;
  const offset = parseFloat(frameStyle.outlineOffset) || 0;
  const bandFrom = (rect, offset, width) => {
    const outer = { left: rect.left - offset - width, right: rect.right + offset + width,
                    top: rect.top - offset - width, bottom: rect.bottom + offset + width };
    const inner = { left: rect.left - offset, right: rect.right + offset,
                    top: rect.top - offset, bottom: rect.bottom + offset };
    return width > 0 ? [
      { name: 'top', left: outer.left, right: outer.right, top: outer.top, bottom: inner.top },
      { name: 'bottom', left: outer.left, right: outer.right, top: inner.bottom, bottom: outer.bottom },
      { name: 'left', left: outer.left, right: inner.left, top: inner.top, bottom: inner.bottom },
      { name: 'right', left: inner.right, right: outer.right, top: inner.top, bottom: inner.bottom },
    ] : [];
  };
  // 테두리 띠: 틀 상자에서 offset만큼(음수면 안쪽) 들어간 자리에서 두께 width만큼 그린다.
  const band = bandFrom(frameRaw, offset, width);
  // 고치기 전 꼴(79affd09 이전 main)은 plot에 고리를 그렸다. 전후 측정을 위해 plot 띠도 함께 잰다.
  const plotStyle = getComputedStyle(plot);
  const plotWidth = plotStyle.outlineStyle === 'none' ? 0 : parseFloat(plotStyle.outlineWidth) || 0;
  const plotBand = bandFrom(raw(plot), parseFloat(plotStyle.outlineOffset) || 0, plotWidth);
  const overlap = (a, b) => a.left < b.right - 0.01 && a.right > b.left + 0.01
    && a.top < b.bottom - 0.01 && a.bottom > b.top + 0.01;
  // 막대 차트는 점 대신 막대가 시점 표시다. 둘 다 띠와 겹치지 않아야 한다.
  const marks = [...chart.querySelectorAll('.ks-chart-dot, .ks-chart-bar')].map(raw);
  const roundRect = (rect) => ({ left: round(rect.left), right: round(rect.right),
                                 top: round(rect.top), bottom: round(rect.bottom) });
  const labels = [...chart.querySelectorAll('.ks-chart-x-axis span')].flatMap((span) => {
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    const rects = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      rects.push(...range.getClientRects());
    }
    return rects;
  });
  const legend = chart.querySelector('.ks-chart-legend');
  const readout = chart.querySelector('.ks-chart-readout');
  const styleOf = (element) => { const s = getComputedStyle(element);
    return { style: s.outlineStyle, width: s.outlineWidth, offset: s.outlineOffset, color: s.outlineColor }; };
  const bandInsideFrame = band.length === 4 && band.every((rect) =>
    rect.left >= frameRaw.left - 0.01 && rect.right <= frameRaw.right + 0.01
    && rect.top >= frameRaw.top - 0.01 && rect.bottom <= frameRaw.bottom + 0.01);
  return {
    focusedIndex, current: graph.getAttribute('aria-valuenow'), focusColor,
    frameOutline: styleOf(frame), graphOutline: styleOf(graph), frameRadius: frameStyle.borderTopLeftRadius,
    plotOutline: { style: plotStyle.outlineStyle, width: plotStyle.outlineWidth,
                   offset: plotStyle.outlineOffset, color: plotStyle.outlineColor },
    frame: box(frame), graph: box(graph), plot: box(plot),
    band: band.map((rect) => ({ name: rect.name, left: round(rect.left), right: round(rect.right),
                                top: round(rect.top), bottom: round(rect.bottom) })),
    plotBand: plotBand.map((rect) => ({ name: rect.name, left: round(rect.left), right: round(rect.right),
                                        top: round(rect.top), bottom: round(rect.bottom) })),
    bandInsideFrame,
    marks: marks.map(roundRect), markCount: marks.length,
    marksInBand: marks.filter((mark) => band.some((rect) => overlap(mark, rect))).length,
    labelsInBand: labels.filter((label) => band.some((rect) => overlap(label, rect))).length,
    legend: box(legend),
    legendInBand: legend ? band.some((rect) => overlap(raw(legend), rect)) : null,
    readout: box(readout),
    readoutInBand: readout ? band.some((rect) => overlap(raw(readout), rect)) : null,
    ringOutsideGraph: band.length === 4
      && band[0].bottom <= graph.getBoundingClientRect().top + 0.01
      && band[1].top >= graph.getBoundingClientRect().bottom - 0.01
      && band[2].right <= graph.getBoundingClientRect().left + 0.01
      && band[3].left >= graph.getBoundingClientRect().right - 0.01,
  };
}"""

ARIA_JS = """(appId) => {
  const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
  const table = win && win.querySelector('.ks-table-scroll');
  if (!table) return null;
  return [...table.querySelectorAll('.ks-table-header > div')].map((header) => header.getAttribute('aria-sort'));
}"""

HEADER_JS = """(appId) => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (element) => { if (!element) return null; const r = element.getBoundingClientRect();
    return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }; };
  // 글 노드의 줄 상자만 읽는다. 정렬 표시(svg)는 글 노드가 아니라 상자에 들지 않는다.
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
  const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
  const table = win && win.querySelector('.ks-table-scroll');
  if (!table) return { error: '표가 없습니다' };
  const headers = [...table.querySelectorAll('.ks-table-header > div')];
  const rows = [...table.querySelectorAll('.ks-table-row')];
  return { ariaSort: headers.map((header) => header.getAttribute('aria-sort')),
           columns: headers.map((header, index) => {
    const button = header.querySelector('button');
    const labelRects = textRects(button);
    const cells = rows.map((row) => row.querySelectorAll('.ks-table-cell')[index]).filter(Boolean);
    const cellRects = cells.flatMap((cell) => textRects(cell));
    return {
      label: button.textContent.trim(), numeric: button.classList.contains('is-numeric'),
      labelLeft: labelRects.length ? round(Math.min(...labelRects.map((rect) => rect.left))) : null,
      labelRight: labelRects.length ? round(Math.max(...labelRects.map((rect) => rect.right))) : null,
      cellLeft: cellRects.length ? round(Math.min(...cellRects.map((rect) => rect.left))) : null,
      cellRight: cellRects.length ? round(Math.max(...cellRects.map((rect) => rect.right))) : null,
      icon: box(button.querySelector('svg')), button: box(button), columnWidth: cells.length ? box(cells[0]).width : null,
    };
  }) };
}"""
