"""카드 #1340 시각 검수(check_1340_layout.py)의 판정 함수와 판정기 자기 확인.

판정은 페이지에서 잰 값(dict, list)만 받는 순수 함수다. 결함 2(간격 있는 쌓기의 차트 앞뒤)와
표 열 폭은 카드 #1246의 판정 함수(stack_gap_verdicts, widths_stable_verdict)를 그대로 쓴다.
self_test()는 이 파일의 판정 함수마다 맞는 측정과 심은 위반을 넣어, 맞는 쪽은 모두 통과하고
위반 쪽은 하나 이상 실패하는지 본다. 이름이 _verdict, _verdicts로 끝나는 함수에 자기 확인
사례가 없어도 실패한다.
"""
from layout_1340_fixtures import PANE_MIN

# 기대값을 주지 않은 판정을 건너뛰는 표지. 기대값이 None이면(비교할 측정이 깨졌으면) 건너뛰지 않고 실패한다.
UNCHECKED = object()


def near(value, target, tolerance=1):
    return value is not None and target is not None and abs(value - target) <= tolerance


def fill_floor_verdicts(measured, pane_min=PANE_MIN, tolerance=1):
    """결함 1: 기본 채움 칸이 넘칠 때 높이 0으로 접히지 않고, 내용과 pane 최소 크기 가운데 작은 값을 받는다.
    내용이 작으면 내용 높이만 받아 빈 자리를 만들지 않고, 스크롤 주인을 내리면 칸이 보인다."""
    if measured.get("error"):
        return {"fill_found": False}
    fill = measured["fill"]
    content = measured["fillScrollHeight"]
    floor = min(content, pane_min)
    inside = measured["glyphCount"] > 0 and measured["glyphTop"] >= fill["top"] - tolerance
    # 내용이 칸보다 길면 칸 안에서 굴러가므로 첫 줄만 칸 안에 있으면 된다. 다 들어가는 내용은 끝 줄까지 칸 안에 있어야 한다.
    inside = inside and (content > fill["height"] + tolerance or measured["glyphBottom"] <= fill["bottom"] + tolerance)
    return {
        "fill_found": measured["fillCount"] == 1 and measured["itemCount"] > 1,
        "owner_scrolls": measured["ownerScrolls"] is True,
        "fill_has_height": fill["height"] > 0,
        "floor_reached": fill["height"] >= floor - tolerance,
        "no_extra_space": fill["height"] <= content + tolerance,
        "glyphs_inside": inside,
        "visible_after_scroll": measured["visibleAfterScroll"] is True,
    }


def dot_outline_verdicts(measured, expected_index, expected_point, tolerance=1):
    """결함 3: 초점 테두리가 그래프 상자 바깥으로 물러나 점 상자와 겹치지 않고, x축 글자, 범례,
    읽기 줄과도 겹치지 않는다. 초점은 기대한 차트에, 시점은 기대한 자리에 있다."""
    if measured.get("error"):
        return {"focused": False}
    outline = measured.get("outline") or {}
    graph = measured.get("graph")
    band = {rect["name"]: rect for rect in measured.get("band") or []}
    return {
        "focused": measured.get("focusedIndex") == expected_index,
        "at_expected_point": measured.get("current") == str(expected_point),
        "outline_on_graph": outline.get("style") == "solid" and outline.get("width") == "2px",
        "outline_color": measured.get("focusColor") is not None and outline.get("color") == measured.get("focusColor"),
        "outline_offset_outward": outline.get("offset") == "4px",
        "dots_drawn": measured.get("dotCount", 0) > 0,
        "no_dot_overlap": measured.get("dotsInBand") == 0,
        "no_axis_overlap": measured.get("labelsInBand") == 0,
        "no_legend_overlap": measured.get("legendInBand") is False,
        "no_readout_overlap": measured.get("readoutInBand") is False,
        # 띠는 그래프 상자 바깥에 있어야 한다. 안쪽으로 물린 테두리(plot 안쪽 0~2px)는 이 조건에 걸린다.
        "ring_outside_graph": graph is not None and set(band) == {"top", "bottom", "left", "right"}
        and band["top"]["bottom"] <= graph["top"] + 0.01 and band["bottom"]["top"] >= graph["bottom"] - 0.01
        and band["left"]["right"] <= graph["left"] + 0.01 and band["right"]["left"] >= graph["right"] - 0.01,
    }


def header_alignment_verdicts(states, numeric_labels, tolerance=1, widths=None):
    """결함 4: 숫자 열 머리 글자의 오른끝이 정렬 없음, 오름, 내림 세 상태에서 같고, 아래 숫자 칸 글자의
    오른끝과도 같다. 정렬 표시는 정렬한 상태에만 있다가 사라진다. states는 [{"state", "ariaSort", "columns"}],
    widths는 정렬 전 열 폭 목록이다(있으면 정렬한 뒤에도 같은지 본다)."""
    if not states or any(state["columns"] is None for state in states):
        return {"states_found": False}
    first = states[0]["columns"]
    numeric = [index for index, column in enumerate(first) if column["numeric"]]
    labels = [first[index]["label"] for index in numeric]
    verdicts = {
        "states_found": len(states) == 3,
        "numeric_columns": labels == numeric_labels,
    }
    if not verdicts["numeric_columns"]:
        return verdicts
    for index in numeric:
        rights = [state["columns"][index]["labelRight"] for state in states]
        cells = [state["columns"][index]["cellRight"] for state in states]
        name = first[index]["label"].replace(" ", "")
        verdicts[f"{name}_right_stable"] = all(right is not None for right in rights) and max(rights) - min(rights) <= tolerance
        verdicts[f"{name}_right_matches_cell"] = all(
            right is not None and cell is not None and abs(right - cell) <= tolerance for right, cell in zip(rights, cells))
    # 정렬 표시는 정렬한 열에만, 정렬한 상태에서만 있다. 정렬하지 않은 숫자 열에는 늘 없다.
    shown_right = all(
        (state["columns"][index]["icon"] is not None) == (state["state"] != "none" and index == numeric[0])
        for state in states for index in numeric)
    verdicts["icon_only_when_sorted"] = shown_right
    sort_column = numeric[0]
    verdicts["aria_sort_order"] = all(len(state["ariaSort"]) == len(first) for state in states) and (
        states[0]["ariaSort"][sort_column] == "none" and states[1]["ariaSort"][sort_column] == "ascending"
        and states[2]["ariaSort"][sort_column] == "descending")
    if widths is not None:
        last = states[-1]["columns"]
        verdicts["widths_stable"] = len(widths) == len(last) and all(
            near(column["columnWidth"], width) for column, width in zip(last, widths))
    return verdicts


def _fill(height=160.0, content=160.0, glyph_top=10.0, glyph_bottom=30.0, errors=None, count=1, items=8):
    measured = {"itemCount": items, "fillCount": count, "fillScrollHeight": content, "glyphCount": 3,
                "glyphTop": glyph_top, "glyphBottom": glyph_bottom, "ownerScrolls": True, "visibleAfterScroll": True,
                "fill": {"top": 0.0, "bottom": height, "height": height}}
    measured.update(errors or {})
    return measured


def _dot(**changes):
    measured = {"focusedIndex": 0, "current": "0", "focusColor": "rgb(1, 2, 3)", "dotCount": 1, "dotsInBand": 0,
                "labelsInBand": 0, "legendInBand": False, "readoutInBand": False,
                "outline": {"style": "solid", "width": "2px", "offset": "4px", "color": "rgb(1, 2, 3)"},
                "graph": {"left": 0.0, "right": 100.0, "top": 0.0, "bottom": 100.0},
                "band": [{"name": "top", "left": -6.0, "right": 106.0, "top": -6.0, "bottom": -4.0},
                         {"name": "bottom", "left": -6.0, "right": 106.0, "top": 104.0, "bottom": 106.0},
                         {"name": "left", "left": -6.0, "right": -4.0, "top": -4.0, "bottom": 104.0},
                         {"name": "right", "left": 104.0, "right": 106.0, "top": -4.0, "bottom": 104.0}]}
    measured.update(changes)
    return measured


def _inner_band():
    return [{"name": "top", "left": 0.0, "right": 100.0, "top": 0.0, "bottom": 2.0},
            {"name": "bottom", "left": 0.0, "right": 100.0, "top": 98.0, "bottom": 100.0},
            {"name": "left", "left": 0.0, "right": 2.0, "top": 0.0, "bottom": 100.0},
            {"name": "right", "left": 98.0, "right": 100.0, "top": 0.0, "bottom": 100.0}]


def _header_state(state, aria=None, right=200.0, cell=200.0, icon=True, width=60.0):
    """icon은 정렬한 열(몫)의 정렬 표시가 있는지다. 정렬하지 않은 숫자 열(값)에는 늘 없다."""
    shown = {"left": 100.0, "right": 115.0} if icon else None
    columns = [
        {"label": "이름", "numeric": False, "labelLeft": 12.0, "labelRight": 60.0, "cellLeft": 12.0, "cellRight": 60.0,
         "icon": None, "columnWidth": 200.0},
        {"label": "몫", "numeric": True, "labelLeft": right - 20.0, "labelRight": right, "cellLeft": cell - 18.0,
         "cellRight": cell, "icon": shown, "columnWidth": width},
        {"label": "값", "numeric": True, "labelLeft": right - 20.0, "labelRight": right, "cellLeft": cell - 18.0,
         "cellRight": cell, "icon": None, "columnWidth": width},
    ]
    return {"state": state, "ariaSort": aria or ["none"] * 3, "columns": columns}


HEADER_WIDTHS = (200.0, 60.0, 60.0)


def _header_states(rights=(200.0, 200.0, 200.0), cells=(200.0, 200.0, 200.0), icons=(False, True, True),
                   aria=None, widths=None):
    """widths는 상태마다 열 폭 목록이다. 주지 않으면 세 상태 모두 HEADER_WIDTHS다."""
    aria = aria or (["none"] * 3, ["none", "ascending", "none"], ["none", "descending", "none"])
    widths = widths or (HEADER_WIDTHS,) * 3
    states = []
    for index, state in enumerate(("none", "ascending", "descending")):
        columns = _header_state(state, list(aria[index]), rights[index], cells[index], icons[index])["columns"]
        for column, width in zip(columns, widths[index]):
            column["columnWidth"] = width
        states.append({"state": state, "ariaSort": list(aria[index]), "columns": columns})
    return states


def _cases():
    """판정 함수마다 ([맞는 측정], [심은 위반]). 항목은 (이름, 판정 결과)다."""
    return {
        fill_floor_verdicts: (
            [("내용이 길어 160", fill_floor_verdicts(_fill())),
             ("칸 안에서 굴러감", fill_floor_verdicts(_fill(content=500.0, glyph_top=5.0, glyph_bottom=460.0))),
             ("한 줄", fill_floor_verdicts(_fill(height=21.0, content=21.0, glyph_top=3.0, glyph_bottom=18.0)))],
            [("높이 0", fill_floor_verdicts(_fill(height=0.0, content=500.0, glyph_top=10.0, glyph_bottom=30.0))),
             ("바닥보다 작음", fill_floor_verdicts(_fill(height=120.0, content=500.0))),
             ("한 줄인데 160", fill_floor_verdicts(_fill(height=160.0, content=21.0, glyph_top=3.0, glyph_bottom=18.0))),
             ("글자가 칸 밖", fill_floor_verdicts(_fill(height=160.0, content=160.0, glyph_top=-30.0, glyph_bottom=-10.0))),
             ("끝 줄이 칸 밖", fill_floor_verdicts(_fill(height=160.0, content=160.0, glyph_top=5.0, glyph_bottom=220.0))),
             ("스크롤 주인 안 굴러감", fill_floor_verdicts(_fill(errors={"ownerScrolls": False}))),
             ("스크롤해도 안 보임", fill_floor_verdicts(_fill(errors={"visibleAfterScroll": False}))),
             ("채움 칸 없음", fill_floor_verdicts({"error": "기본 채움 칸이 없습니다"}))]),
        dot_outline_verdicts: (
            [("첫 점", dot_outline_verdicts(_dot(), 0, 0))],
            [("점과 겹침", dot_outline_verdicts(_dot(dotsInBand=1), 0, 0)),
             ("축 글자와 겹침", dot_outline_verdicts(_dot(labelsInBand=1), 0, 0)),
             ("범례와 겹침", dot_outline_verdicts(_dot(legendInBand=True), 0, 0)),
             ("읽기 줄과 겹침", dot_outline_verdicts(_dot(readoutInBand=True), 0, 0)),
             ("초점 아님", dot_outline_verdicts(_dot(), 1, 0)),
             ("다른 시점", dot_outline_verdicts(_dot(), 0, 3)),
             ("안쪽으로 물러남", dot_outline_verdicts(_dot(outline={"style": "solid", "width": "2px", "offset": "-2px",
                                                                  "color": "rgb(1, 2, 3)"}), 0, 0)),
             ("plot에 그림", dot_outline_verdicts(_dot(outline={"style": "none", "width": "0px", "offset": "4px",
                                                                "color": "rgb(1, 2, 3)"}), 0, 0)),
             ("점 없음", dot_outline_verdicts(_dot(dotCount=0), 0, 0)),
             ("띠 없음", dot_outline_verdicts(_dot(band=[]), 0, 0)),
             ("테두리가 안쪽", dot_outline_verdicts(_dot(band=_inner_band()), 0, 0))]),
        header_alignment_verdicts: (
            [("세 상태 같음", header_alignment_verdicts(_header_states(), ["몫", "값"], widths=HEADER_WIDTHS))],
            [("정렬 때 19px 밀림", header_alignment_verdicts(_header_states(rights=(200.0, 181.0, 181.0)), ["몫", "값"])),
             ("칸 글자와 어긋남", header_alignment_verdicts(_header_states(cells=(219.0, 219.0, 219.0)), ["몫", "값"])),
             ("정렬 표시 늘 있음", header_alignment_verdicts(_header_states(icons=(True, True, True)), ["몫", "값"])),
             ("정렬 표시 늘 없음", header_alignment_verdicts(_header_states(icons=(False, False, False)), ["몫", "값"])),
             ("열 폭 바뀜", header_alignment_verdicts(
                 _header_states(widths=((200.0, 60.0, 60.0), (200.0, 60.0, 60.0), (200.0, 70.0, 60.0))),
                 ["몫", "값"], widths=HEADER_WIDTHS)),
             ("aria 순서 다름", header_alignment_verdicts(_header_states(aria=(["none"] * 3, ["none"] * 3, ["none"] * 3)),
                                                        ["몫", "값"])),
             ("숫자 열 다름", header_alignment_verdicts(_header_states(), ["값", "몫"])),
             ("표 없음", header_alignment_verdicts([], ["몫", "값"]))]),
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
