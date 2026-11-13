"""카드 #1246 시각 검수(check_1246_layout.py)의 판정 함수와 판정기 자기 확인.

판정은 페이지에서 잰 값(dict, list)만 받는 순수 함수다. 검수 스크립트의 모든 판정이 이 함수들을 거친다.
잴 대상의 개수를 기대값으로 단언해, 빈 목록이나 다른 화면을 재고도 통과하는 일이 없게 한다.
self_test()는 판정 함수마다 맞는 측정과 심은 위반을 넣어 맞는 쪽은 모두 통과하고 위반 쪽은 하나 이상
실패하는지 본다. 이름이 _verdict, _verdicts로 끝나는 함수에 자기 확인 사례가 없어도 실패한다.
검수 스크립트가 시작할 때마다 돈다.
"""
from layout_1246_fixtures import LONG_BODY_LINES, SORT_RESERVE

# 기대값을 주지 않은 판정을 건너뛰는 표지. 기대값이 None이면(비교할 측정이 깨졌으면) 건너뛰지 않고 실패한다.
UNCHECKED = object()


def near(value, target, tolerance=1):
    return value is not None and target is not None and abs(value - target) <= tolerance


def pane_gap_verdicts(measured, expected_count):
    """항목 3 기본 칸(분할 칸, 탭 판, 구역, 대화상자 본문): 차트 틀 아래 끝과 칸 아래 끝의 차이가 12px."""
    return {"charts": len(measured) == expected_count,
            "one_space_3": len(measured) == expected_count and all(near(item["gap"], 12) for item in measured)}


def stack_gap_verdicts(measured, below=UNCHECKED, above=UNCHECKED, control=False):
    """구역 안 차트 틀 아래 끝과 표 위 끝(below), 조작 줄 아래 끝과 차트 틀 위 끝(above)의 간격."""
    verdicts = {"one_chart_one_table": measured["charts"] == 1 and measured["tables"] == 1}
    if control:
        verdicts["one_control_row"] = measured["toolbars"] == 1
    if below is not UNCHECKED:
        verdicts["below_expected"] = near(measured["below"], below)
    if above is not UNCHECKED:
        verdicts["above_expected"] = near(measured["above"], above)
    return verdicts


def section_end_verdicts(measured, expected_below, sections=1, panels=0):
    """구역 끝 차트: 차트 틀 아래 끝에서 다음 내용 위 끝이나 스크롤 내용 끝까지의 차이."""
    return {"counts": measured["charts"] == 1 and measured["tables"] == 1
            and measured["sections"] == sections and measured["panels"] == panels,
            "edge_found": measured["edge"] is not None,
            "below_expected": near(measured["below"], expected_below)}


def focus_verdict(reached, measured, index, first, last):
    """항목 4: 초점 테두리가 plot에 그려지고 x축 첫 글, 끝 글(실제로 있어야 함)과 겹치지 않는다."""
    plot = measured.get("plotStyle") or {}
    labels = measured.get("labels") or []
    return {
        "focused": reached and measured.get("focusedIndex") == index,
        "first_last_glyphs": len(labels) >= 2 and labels[0].get("text") == first and labels[-1].get("text") == last
        and labels[0].get("glyph") is not None and labels[-1].get("glyph") is not None,
        "outline_on_plot": plot.get("outlineStyle") == "solid" and plot.get("outlineWidth") == "2px",
        "outline_color": measured.get("focusColor") is not None and plot.get("outlineColor") == measured.get("focusColor"),
        "outline_offset": plot.get("outlineOffset") == "-2px",
        "graph_outline_none": (measured.get("graphStyle") or {}).get("outlineStyle") == "none",
        "no_label_overlap": measured.get("overlaps") is False,
    }


def tick_verdict(measured, expected_texts):
    """항목 5: 축마다 눈금 글이 기대한 글 그대로이고, 오른끝 x 차이가 1px 이하다(음수 눈금 포함)."""
    axes = bool(measured) and len(measured) == len(expected_texts)
    return {
        "axes": axes,
        "tick_texts": [[span["text"] for span in axis["spans"]] for axis in measured] == expected_texts,
        "end_aligned": axes and all(axis["spans"] and all(span["textAlign"] == "end" for span in axis["spans"]) for axis in measured),
        "tabular": axes and all("tabular-nums" in axis["fontVariantNumeric"] for axis in measured),
        "right_spread_1px": axes and all(axis["spread"] is not None and axis["spread"] <= 1 for axis in measured),
        "negative_tick_present": axes and all(axis["hasNegative"] for axis in measured),
    }


def legend_verdict(measured, names, hidden, colors):
    """항목 6: 값이 없는 계열(hidden)이 범례, 읽기 줄, 접근성 표에 없고 남은 계열(names)의 색이 원래 index(colors)다."""
    legend = measured.get("legend") or []
    return {
        "legend_names": bool(names) and [item["text"] for item in legend] == names,
        "readout_hides_empty": hidden not in measured["readout"] and len(measured["readoutItems"]) == len(names)
        and all(item.startswith(name) for item, name in zip(measured["readoutItems"], names)),
        "table_hides_empty": hidden not in measured["tableText"] and measured["tableHeaders"] == ["시점", *names],
        "colors_by_original_index": len(legend) == len(colors) > 0 and all(
            f"--ks-chart-series-color: var(--ks-color-series-{color})" in (item["style"] or "") for item, color in zip(legend, colors)),
    }


def bar_slot_verdicts(with_empty, without_empty, labels):
    """쌓지 않은 묶음 막대: 빈 계열(둘째)이 낀 장면의 막대 폭과 x가 빈 계열을 뺀 장면과 같고 색은 원래 index다."""
    drawn = [group for group in with_empty["groups"] if group["bars"]]
    expected = [group for group in without_empty["groups"] if group["bars"]]
    pairs = list(zip(drawn, expected))
    return {
        "one_chart_each": with_empty["charts"] == 1 and without_empty["charts"] == 1,
        "groups": len(with_empty["groups"]) == 3 and len(without_empty["groups"]) == 2,
        "bar_counts": len(drawn) == len(expected) == 2 and all(len(group["bars"]) == labels for group in drawn + expected),
        "same_x_and_width": len(pairs) == 2 and all(
            len(left["bars"]) == len(right["bars"]) == labels and all(
                near(a["left"], b["left"]) and near(a["width"], b["width"]) for a, b in zip(left["bars"], right["bars"]))
            for left, right in pairs),
        "colors_by_original_index": len(drawn) == 2
        and "--ks-chart-series-color: var(--ks-color-series-1)" in (drawn[0]["style"] or "")
        and "--ks-chart-series-color: var(--ks-color-series-3)" in (drawn[1]["style"] or "")
        and "is-series-0" in drawn[0]["className"] and "is-series-2" in drawn[1]["className"],
    }


def slack(column):
    return column["columnWidth"] - (max(column["longest"], column["headerLongest"]) + column["padding"] + SORT_RESERVE)


def table_verdict(measured, expected, slack_limit=False, overflow=False):
    """표 판정. expected는 (열 개수, 행 개수)다. 첫 fill 열은 긴 이름이 말줄임으로 잘리는 것이 정상이라 둘째 열부터 본다."""
    if measured.get("error"):
        return {"table_found": False}
    columns = measured["columns"]
    column_count, row_count = expected
    verdicts = {
        "column_count": len(columns) == column_count,
        "row_count": measured["rowCount"] == row_count,
        "headers_single_line": bool(columns) and all(column["headerLines"] == 1 for column in columns),
        "no_header_overflow": bool(columns) and all(not column["headerOverflow"] for column in columns),
        "no_cell_overflow": len(columns) > 1 and all(not column["cellOverflow"] for column in columns[1:]),
    }
    if slack_limit:
        verdicts["numeric_slack_4px"] = len(columns) > 1 and all(slack(column) <= 4 for column in columns[1:])
    if overflow:
        verdicts["no_horizontal_overflow"] = (measured["cellCount"] == column_count * (row_count + 1)
                                              and measured["tableScrollWidth"] <= measured["tableClientWidth"] + 1
                                              and measured["cellsOutside"] == 0)
    return verdicts


def sort_verdict(clicked, measured, expected):
    """정렬 머리 단추를 찾아 눌렀고 그 머리의 aria-sort가 기대대로 바뀌었는지."""
    index = clicked.get("index")
    aria = measured.get("ariaSort") or []
    return {"sort_button_found": clicked.get("found") is True,
            f"aria_sort_{expected}": index is not None and 0 <= index < len(aria) and aria[index] == expected}


def widths_stable_verdict(base_widths, measured):
    """정렬을 바꾼 뒤에도 열 폭이 정렬 전과 같은지(±1px)."""
    columns = [] if measured.get("error") else measured["columns"]
    return {"widths_stable": bool(base_widths) and len(columns) == len(base_widths)
            and all(near(column["columnWidth"], base) for column, base in zip(columns, base_widths))}


def status_notice_verdict(before, status):
    """스쳐 지나가는 상태 알림만 떴을 때 본문 아래 여백과 스크롤 창 높이가 알림 전과 같다."""
    return {"status_visible": status["statusVisible"] and not status["alertVisible"],
            "no_bottom_space_with_status": abs(status["borderBlockEnd"]) <= 0.5
            and abs(status["clientHeight"] - before["clientHeight"]) <= 1 and status["noticeSpace"] in ("", "0px")}


def notice_verdict(before, opened):
    """창 오류 알림과 본문 마지막 블록. 마지막 블록은 글이 그려진, 높이가 있는 칸이어야 한다."""
    space = opened["noticeHeight"] + 16
    last_text = opened.get("lastText") or ""
    return {
        "items_counted": before["itemCount"] == LONG_BODY_LINES and opened["itemCount"] == LONG_BODY_LINES,
        "last_block_has_height": last_text.startswith(f"{LONG_BODY_LINES}번째") and (opened["lastHeight"] or 0) > 0
        and opened["lastGlyphBottom"] is not None and opened["lastGlyphBottom"] <= opened["lastBottom"] + 1,
        "no_space_without_notice": abs(before["clientHeight"] - (before["body"]["height"] - before["borderBlockEnd"])) <= 1,
        "gap_at_least_8": opened["gap"] is not None and opened["gap"] >= 8,
        "scrollport_matches_notice": abs((before["clientHeight"] - opened["clientHeight"]) - space) <= 1.5,
        "notice_capped": opened["noticeHeight"] > 0 and opened["noticeHeight"] * 2 <= opened["windowHeight"] + 1,
    }


def notice_closed_verdict(before, closed):
    """알림을 닫으면 알림이 사라지고 본문 스크롤 창과 스크롤 높이가 알림 전과 같아진다."""
    return {"alert_closed": not closed["alertVisible"],
            "scrollport_restored": abs(closed["clientHeight"] - before["clientHeight"]) <= 1,
            "scroll_height_restored": abs(closed["scrollHeight"] - before["scrollHeight"]) <= 1}


def skeleton_verdict(loading, loaded, branches=3):
    """항목 9: 받는 중 뼈대가 실제로 그려졌고, 높이 갈래마다 다 받은 뒤 차트와 틀, 전체 높이 차이가 2px 이하다."""
    same = len(loading) == len(loaded) == branches
    return {"skeleton_shown": len(loading) == branches and all(item["loading"] for item in loading),
            "branches": same,
            "frame_height": same and all(near(left["frameHeight"], right["frameHeight"], 2) for left, right in zip(loading, loaded)),
            "chart_height": same and all(near(left["chartHeight"], right["chartHeight"], 2) for left, right in zip(loading, loaded))}


def _gap(below=12.0, above=None, charts=1, tables=1, toolbars=0):
    return {"charts": charts, "tables": tables, "toolbars": toolbars, "below": below, "above": above}


def _end(below=12.0, sections=1, panels=0, edge=500.0):
    return {"charts": 1, "tables": 1, "sections": sections, "panels": panels, "edge": edge, "below": below}


def _bars(slot, positions):
    """positions는 계열마다 묶음 안 자리 번호다(None이면 막대 없는 빈 계열)."""
    def group(index, position):
        bars = [] if position is None else [{"left": 100 * day + slot * position, "width": slot} for day in range(4)]
        return {"className": f"ks-chart-series is-series-{index}", "style": f"--ks-chart-series-color: var(--ks-color-series-{index + 1});", "bars": bars}
    return {"charts": 1, "groups": [group(index, position) for index, position in enumerate(positions)]}


def _table(columns=3, rows=4, outside=0, scroll_width=334, header_lines=1, width=60):
    column = {"label": "열", "columnWidth": width, "padding": 16, "longest": 25, "headerLongest": 20,
              "headerLines": header_lines, "headerOverflow": False, "cellOverflow": False}
    return {"columns": [dict(column) for _ in range(columns)], "rowCount": rows, "ariaSort": ["none"] * columns,
            "tableScrollWidth": scroll_width, "tableClientWidth": 334, "cellCount": columns * (rows + 1), "cellsOutside": outside}


def _focus(first="1일", overlaps=False, color="rgb(1, 2, 3)", graph="none"):
    glyph = {"left": 0, "right": 10, "top": 0, "bottom": 10}
    return {"focusedIndex": 0, "focusColor": "rgb(1, 2, 3)", "overlaps": overlaps, "graphStyle": {"outlineStyle": graph},
            "plotStyle": {"outlineStyle": "solid", "outlineWidth": "2px", "outlineColor": color, "outlineOffset": "-2px"},
            "labels": [{"text": first, "glyph": glyph}, {"text": "2일", "glyph": glyph}, {"text": "4일", "glyph": glyph}]}


def _ticks(spread=0.0, align="end", negative=True):
    def axis(texts):
        return {"spans": [{"text": text, "textAlign": align} for text in texts], "fontVariantNumeric": "tabular-nums",
                "spread": spread, "hasNegative": negative}
    return [axis(["3", "0", "-3"]), axis(["$1", "$0", "-$1"])]


def _legend(names=("가", "다"), styles=(1, 3), readout=None):
    legend = [{"text": name, "style": f"--ks-chart-series-color: var(--ks-color-series-{color});"} for name, color in zip(names, styles)]
    items = [f"{name} 1" for name in names]
    return {"legend": legend, "readout": readout if readout is not None else "".join(items), "readoutItems": items,
            "tableHeaders": ["시점", *names], "tableText": " ".join(names)}


def _notice(last_height=33.0, glyph=640.0, gap=22.0):
    body = {"height": 678}
    before = {"itemCount": LONG_BODY_LINES, "clientHeight": 678, "scrollHeight": 852, "body": body, "borderBlockEnd": 0,
              "alertVisible": False}
    opened = {"itemCount": LONG_BODY_LINES, "lastText": f"{LONG_BODY_LINES}번째 줄", "lastHeight": last_height,
              "lastGlyphBottom": glyph, "lastBottom": 643.0, "gap": gap, "clientHeight": 616, "noticeHeight": 46, "windowHeight": 720}
    return before, opened


def _status(client=678.0, space="0px", status=True):
    return {"statusVisible": status, "alertVisible": False, "borderBlockEnd": 0, "clientHeight": client, "noticeSpace": space}


def _heights(loading=True, frame=160.0, count=3):
    return [{"loading": loading, "frameHeight": frame, "chartHeight": frame + 24} for _ in range(count)]


def _cases():
    """판정 함수마다 ([맞는 측정], [심은 위반]). 항목은 (이름, 판정 결과)다."""
    before, opened = _notice()
    return {
        pane_gap_verdicts: (
            [("칸 둘 12", pane_gap_verdicts([{"gap": 12.0}, {"gap": 12.4}], 2))],
            [("칸 24", pane_gap_verdicts([{"gap": 24.0}], 1)), ("차트 없음", pane_gap_verdicts([], 1))]),
        stack_gap_verdicts: (
            [("같은 쌓기 12", stack_gap_verdicts(_gap(), below=12)),
             ("조작 줄 = main", stack_gap_verdicts(_gap(below=24, above=24, toolbars=1), below=24, above=24, control=True))],
            [("차트 아래 0", stack_gap_verdicts(_gap(below=0), below=12)),
             ("차트와 표 없음", stack_gap_verdicts(_gap(below=None, charts=0, tables=0), below=12)),
             ("비교 측정 깨짐", stack_gap_verdicts(_gap(below=24), below=None)),
             ("조작 줄 위 다름", stack_gap_verdicts(_gap(below=24, above=20, toolbars=1), below=24, above=24, control=True)),
             ("조작 줄 없음", stack_gap_verdicts(_gap(below=24, above=None), below=24, above=24, control=True))]),
        section_end_verdicts: (
            [("구역 뒤 표 12", section_end_verdicts(_end(), 12)),
             ("둘째 구역 = main", section_end_verdicts(_end(below=20, sections=2), 20, sections=2))],
            [("틀이 붙음", section_end_verdicts(_end(below=0), 12)),
             ("둘째 구역 없음", section_end_verdicts(_end(below=None, sections=1, edge=None), 20, sections=2)),
             ("탭 판 없음", section_end_verdicts(_end(), 12, panels=1))]),
        focus_verdict: (
            [("초점", focus_verdict(True, _focus(), 0, "1일", "4일"))],
            [("초점 못 줌", focus_verdict(False, _focus(), 0, "1일", "4일")),
             ("첫 글 다름", focus_verdict(True, _focus(first="0일"), 0, "1일", "4일")),
             ("글과 겹침", focus_verdict(True, _focus(overlaps=True), 0, "1일", "4일")),
             ("테두리 색 다름", focus_verdict(True, _focus(color="rgb(0, 0, 0)"), 0, "1일", "4일")),
             ("그래프 테두리 남음", focus_verdict(True, _focus(graph="solid"), 0, "1일", "4일"))]),
        tick_verdict: (
            [("끝선 맞음", tick_verdict(_ticks(), [["3", "0", "-3"], ["$1", "$0", "-$1"]]))],
            [("끝선 어긋남", tick_verdict(_ticks(spread=6), [["3", "0", "-3"], ["$1", "$0", "-$1"]])),
             ("왼쪽 맞춤", tick_verdict(_ticks(align="start"), [["3", "0", "-3"], ["$1", "$0", "-$1"]])),
             ("눈금 없음", tick_verdict([], [["3", "0", "-3"], ["$1", "$0", "-$1"]]))]),
        legend_verdict: (
            [("빈 계열 빠짐", legend_verdict(_legend(), ["가", "다"], "빈", [1, 3]))],
            [("빈 계열 남음", legend_verdict(_legend(names=("가", "빈", "다"), styles=(1, 2, 3)), ["가", "다"], "빈", [1, 3])),
             ("색이 밀림", legend_verdict(_legend(styles=(1, 2)), ["가", "다"], "빈", [1, 3])),
             ("범례 없음", legend_verdict({**_legend(), "legend": None}, ["가", "다"], "빈", [1, 3]))]),
        bar_slot_verdicts: (
            [("빈 계열 자리 없음", bar_slot_verdicts(_bars(110.6, [0, None, 1]), _bars(110.6, [0, 1]), labels=4))],
            [("빈 계열 자리 남음", bar_slot_verdicts(_bars(73.7, [0, None, 2]), _bars(110.6, [0, 1]), labels=4)),
             ("막대 없음", bar_slot_verdicts({"charts": 1, "groups": []}, {"charts": 1, "groups": []}, labels=4))]),
        table_verdict: (
            [("표", table_verdict(_table(), (3, 4), slack_limit=True, overflow=True))],
            [("빈 표", table_verdict(_table(columns=0, rows=0), (3, 4), slack_limit=True, overflow=True)),
             ("열 개수 다름", table_verdict(_table(columns=2), (3, 4))),
             ("행 개수 다름", table_verdict(_table(rows=2), (3, 4))),
             ("칸이 표 밖", table_verdict(_table(outside=1), (3, 4), overflow=True)),
             ("표 가로 넘침", table_verdict(_table(scroll_width=400), (3, 4), overflow=True)),
             ("표 없음", table_verdict({"error": "표가 없습니다"}, (3, 4)))]),
        sort_verdict: (
            [("정렬", sort_verdict({"found": True, "index": 1}, {"ariaSort": ["none", "ascending", "none"]}, "ascending"))],
            [("정렬 단추 없음", sort_verdict({"found": False, "index": None}, {"ariaSort": ["none"] * 3}, "ascending")),
             ("정렬 안 바뀜", sort_verdict({"found": True, "index": 1}, {"ariaSort": ["none"] * 3}, "ascending"))]),
        widths_stable_verdict: (
            [("폭 그대로", widths_stable_verdict([60, 60, 60], _table()))],
            [("폭 바뀜", widths_stable_verdict([60, 60, 60], _table(width=70))),
             ("기준 없음", widths_stable_verdict([], _table(columns=0)))]),
        status_notice_verdict: (
            [("상태 알림", status_notice_verdict(before, _status()))],
            [("본문이 줄어듦", status_notice_verdict(before, _status(client=630, space="46px"))),
             ("상태 알림 없음", status_notice_verdict(before, _status(status=False)))]),
        notice_verdict: (
            [("알림", notice_verdict(before, opened))],
            [("높이 0 마지막 칸", notice_verdict(*_notice(last_height=0.0, glyph=None))),
             ("알림과 붙음", notice_verdict(*_notice(gap=2.0)))]),
        notice_closed_verdict: (
            [("닫음", notice_closed_verdict(before, {**before}))],
            [("안 닫힘", notice_closed_verdict(before, {**before, "alertVisible": True, "clientHeight": 616})),
             ("스크롤 남음", notice_closed_verdict(before, {**before, "scrollHeight": 900}))]),
        skeleton_verdict: (
            [("뼈대 = 차트", skeleton_verdict(_heights(), _heights(loading=False)))],
            [("뼈대 안 보임", skeleton_verdict(_heights(loading=False), _heights(loading=False))),
             ("높이 다름", skeleton_verdict(_heights(frame=120.0), _heights(loading=False))),
             ("갈래 빠짐", skeleton_verdict(_heights(count=2), _heights(loading=False, count=2)))]),
    }


def self_test():
    """맞는 측정은 모두 통과하고 심은 위반은 하나 이상 실패해야 한다. 어긋나면 그 이름 목록을 돌려준다."""
    cases = _cases()
    functions = [value for name, value in globals().items() if callable(value) and name.endswith(("_verdict", "_verdicts"))]
    broken = [f"자기 확인 사례 없음: {function.__name__}" for function in functions
              if function not in cases or not cases[function][0] or not cases[function][1]]
    for function, (good, planted) in cases.items():
        broken += [f"맞는 측정 실패: {function.__name__} {name}" for name, verdicts in good if not all(verdicts.values())]
        broken += [f"심은 위반 통과: {function.__name__} {name}" for name, verdicts in planted if all(verdicts.values())]
    return broken
