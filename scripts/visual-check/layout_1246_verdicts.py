"""카드 #1246 시각 검수(check_1246_layout.py)의 판정 함수와 판정기 자기 확인.

판정은 페이지에서 잰 값(dict)만 받는 순수 함수다. 잴 대상의 개수를 기대값으로 단언해, 빈 목록이나
다른 화면을 재고도 통과하는 일이 없게 한다. self_test()는 맞는 측정과 심은 위반을 판정에 넣어
맞는 쪽은 모두 통과하고 위반 쪽은 하나 이상 실패하는지 본다. 검수 스크립트가 시작할 때마다 돈다.
"""
from layout_1246_fixtures import LONG_BODY_LINES, SORT_RESERVE


def near(value, target, tolerance=1):
    return value is not None and target is not None and abs(value - target) <= tolerance


def stack_gap_verdicts(measured, expected_below=None, compare=None, control=False):
    """구역 안 차트 틀 아래 끝과 표 위 끝의 간격. compare는 같은 폭에서 잰 비교 장면이나 main 규칙의 측정이다."""
    verdicts = {"one_chart_one_table": measured["charts"] == 1 and measured["tables"] == 1}
    if control:
        verdicts["one_control_row"] = measured["toolbars"] == 1
    if expected_below is not None:
        verdicts[f"below_{expected_below}"] = near(measured["below"], expected_below)
    if compare is not None:
        verdicts["below_matches"] = compare["charts"] == 1 and compare["tables"] == 1 and near(measured["below"], compare["below"])
        if control:
            verdicts["above_matches"] = compare["toolbars"] == 1 and near(measured["above"], compare["above"])
    return verdicts


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


def _gap(below=12.0, above=None, charts=1, tables=1, toolbars=0):
    return {"charts": charts, "tables": tables, "toolbars": toolbars, "below": below, "above": above}


def _bars(slot, positions):
    """positions는 계열마다 묶음 안 자리 번호다(None이면 막대 없는 빈 계열)."""
    def group(index, position):
        bars = [] if position is None else [{"left": 100 * day + slot * position, "width": slot} for day in range(4)]
        return {"className": f"ks-chart-series is-series-{index}", "style": f"--ks-chart-series-color: var(--ks-color-series-{index + 1});", "bars": bars}
    return {"charts": 1, "groups": [group(index, position) for index, position in enumerate(positions)]}


def _table(columns=3, rows=4, outside=0, scroll_width=334, header_lines=1):
    column = {"label": "열", "columnWidth": 60, "padding": 16, "longest": 25, "headerLongest": 20,
              "headerLines": header_lines, "headerOverflow": False, "cellOverflow": False}
    return {"columns": [dict(column) for _ in range(columns)], "rowCount": rows, "ariaSort": ["none"] * columns,
            "tableScrollWidth": scroll_width, "tableClientWidth": 334, "cellCount": columns * (rows + 1), "cellsOutside": outside}


def _notice(last_height=33.0, glyph=640.0, gap=22.0):
    body = {"height": 678}
    before = {"itemCount": LONG_BODY_LINES, "clientHeight": 678, "body": body, "borderBlockEnd": 0}
    opened = {"itemCount": LONG_BODY_LINES, "lastText": f"{LONG_BODY_LINES}번째 줄", "lastHeight": last_height,
              "lastGlyphBottom": glyph, "lastBottom": 643.0, "gap": gap, "clientHeight": 616, "noticeHeight": 46, "windowHeight": 720}
    return before, opened


def self_test():
    """맞는 측정은 모두 통과하고 심은 위반은 하나 이상 실패해야 한다. 어긋나면 그 이름 목록을 돌려준다."""
    good = {
        "같은 쌓기 12": stack_gap_verdicts(_gap(), expected_below=12),
        "중첩 medium = 같은 쌓기": stack_gap_verdicts(_gap(below=24), compare=_gap(below=24)),
        "조작 줄 = main": stack_gap_verdicts(_gap(below=24, above=26, toolbars=1), compare=_gap(below=24, above=26, toolbars=1), control=True),
        "빈 계열 자리 없음": bar_slot_verdicts(_bars(110.6, [0, None, 1]), _bars(110.6, [0, 1]), labels=4),
        "표": table_verdict(_table(), (3, 4), slack_limit=True, overflow=True),
        "정렬": sort_verdict({"found": True, "index": 1}, {"ariaSort": ["none", "ascending", "none"]}, "ascending"),
        "알림": notice_verdict(*_notice()),
    }
    planted = {
        "차트 아래 0": stack_gap_verdicts(_gap(below=0), expected_below=12),
        "차트와 표 없음": stack_gap_verdicts(_gap(below=None, charts=0, tables=0), expected_below=12),
        "중첩 medium 다름": stack_gap_verdicts(_gap(below=12), compare=_gap(below=24)),
        "조작 줄 위 다름": stack_gap_verdicts(_gap(below=24, above=20, toolbars=1), compare=_gap(below=24, above=26, toolbars=1), control=True),
        "조작 줄 없음": stack_gap_verdicts(_gap(below=24, above=None), compare=_gap(below=24, above=None), control=True),
        "빈 계열 자리 남음": bar_slot_verdicts(_bars(73.7, [0, None, 2]), _bars(110.6, [0, 1]), labels=4),
        "막대 없음": bar_slot_verdicts({"charts": 1, "groups": []}, {"charts": 1, "groups": []}, labels=4),
        "빈 표": table_verdict(_table(columns=0, rows=0), (3, 4), slack_limit=True, overflow=True),
        "열 개수 다름": table_verdict(_table(columns=2), (3, 4)),
        "행 개수 다름": table_verdict(_table(rows=2), (3, 4)),
        "칸이 표 밖": table_verdict(_table(outside=1), (3, 4), overflow=True),
        "표 가로 넘침": table_verdict(_table(scroll_width=400), (3, 4), overflow=True),
        "정렬 단추 없음": sort_verdict({"found": False, "index": None}, {"ariaSort": ["none"] * 3}, "ascending"),
        "정렬 안 바뀜": sort_verdict({"found": True, "index": 1}, {"ariaSort": ["none"] * 3}, "ascending"),
        "높이 0 마지막 칸": notice_verdict(*_notice(last_height=0.0, glyph=None)),
        "알림과 붙음": notice_verdict(*_notice(gap=2.0)),
    }
    broken = [f"맞는 측정 실패: {name}" for name, verdicts in good.items() if not all(verdicts.values())]
    broken += [f"심은 위반 통과: {name}" for name, verdicts in planted.items() if all(verdicts.values())]
    return broken
