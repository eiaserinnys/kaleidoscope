#!/usr/bin/env python3
"""카드 #1667 창 아래 모서리 초점 고리, 360px 오류 코드, 360px 탐색기 경로 실화면 검수.

python3 -P scripts/visual-check/check_1667_corner_focus_360.py [--output 산출폴더] [--port 포트]

ui/e2e/corner-focus-360-1667.spec.ts를 e2e:netns로 돌리고, 1100px과 360px의 캡처와
측정값(measurements.json)을 견준다. 창 아래 모서리에 닿는 구조용 초점 칸의 계산 반경과
모서리 근처 초점 색 픽셀, 360px 오류 코드의 줄 나눔과 넘침, 경로 접힘과 「…」 표시를 잰다.
하나라도 실패하거나 캡처가 빠지면 0이 아닌 값으로 끝난다.
"""
import argparse
import json
import os
import re
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
FOCUS_COLOR = (140, 106, 175)

CAPTURES = [f"{width}-{state}.png" for width in (1100, 360) for state in (
    "corner-split-left", "corner-split-right", "corner-resize", "corner-explorer-content",
    "corner-tree-list", "corner-tab-panel", "corner-window-body")]
CAPTURES += ["360-code-body.png", "360-code-tree-child-1.png", "360-code-tree-child-2.png",
             "360-path-notes.png", "1100-path-notes.png", "360-path-notes-back.png",
             "360-path-deeper.png", "360-path-long-name.png"]


def parse_color(value):
    match = re.match(r"rgba?\(([^)]+)\)", value or "")
    if not match:
        return FOCUS_COLOR
    parts = [float(part.strip()) for part in match.group(1).split(",")]
    return tuple(int(round(part)) for part in parts[:3])


def count_corner_pixels(path, app, rect, corner, want):
    """모서리 12x12 칸에서 초점 색(겹침·안티에일리어싱 여유) 픽셀 수를 센다.

    고리는 2px라 한 점을 찍으면 안쪽 빈틈에 떨어지기 쉽다. 초점 색과 가까운 픽셀이
    모서리 근처에 이어지는지로 본다.
    """
    image = Image.open(path).convert("RGB")
    scale_x = image.width / app["width"]
    scale_y = image.height / app["height"]
    if corner == "bl":
        left = rect["left"] + 1
    else:
        left = rect["right"] - 12
    top = rect["bottom"] - 12
    count = 0
    closest = None
    for dx in range(12):
        for dy in range(12):
            x = (left + dx - app["left"]) * scale_x
            y = (top + dy - app["top"]) * scale_y
            pixel = image.getpixel((max(0, min(image.width - 1, int(round(x)))),
                                    max(0, min(image.height - 1, int(round(y))))))
            distance = sum((channel - target) ** 2 for channel, target in zip(pixel, want)) ** 0.5
            if distance <= 40:
                count += 1
            if closest is None or distance < closest[0]:
                closest = (distance, pixel)
    return count, closest[1]


def check_corner(name, record, output):
    failures = []
    expected = record["expected"]
    frame_radius = record["frameRadius"] - record["frameBorder"]
    if not record.get("focusVisible"):
        failures.append("구조용 초점이 :focus-visible이 아님")
    if record.get("outlineStyle") != "solid" or record.get("outlineOffset") != "-2px":
        failures.append("초점 고리 모양이 안쪽 실선이 아님")
    if record.get("marks") != expected:
        failures.append(f"모서리 표시 {record.get('marks')}가 배치 {expected}와 다름")
    for corner in ("bl", "br"):
        want = frame_radius if expected[corner] else 0
        if abs(record["radius"][corner] - want) > 0.1:
            failures.append(f"{corner} 계산 반경 {record['radius'][corner]} != {want}")
    # 창 모서리에 닿는 모서리 근처에 초점 색 픽셀이 이어지는지 본다.
    want = parse_color(record.get("outlineColor"))
    pixels = {}
    rect, app = record["rect"], record["app"]
    for corner in ("bl", "br"):
        if not expected[corner]:
            continue
        count, closest = count_corner_pixels(output / f"{name}.png", app, rect, corner, want)
        pixels[corner] = {"초점색_픽셀": count, "가장가까운색": list(closest)}
        if count < 6:
            failures.append(f"{corner} 모서리 근처 초점 색 픽셀 {count}개(가장 가까운 색 {closest})")
    return {"통과": not failures, "실패": failures, "픽셀": pixels,
            "반경": record["radius"], "기대": expected, "초점색": list(want)}


def check_code(name, record):
    failures = []
    box = record["noticeBox"]
    inside = all(line["left"] >= box["left"] - 1 and line["right"] <= box["right"] + 1
                 and line["top"] >= box["top"] - 1 and line["bottom"] <= box["bottom"] + 1
                 for line in record["lines"])
    if record["text"].replace(" ", "") != "FILE_LIST_DIRECTORY_IO":
        failures.append(f"코드 전문이 다름: {record['text']!r}")
    if len(record["lines"]) < 2:
        failures.append("코드가 한 줄임")
    if not inside:
        failures.append("코드 글자가 알림 상자 밖으로 나감")
    if record["codeOverflow"] > 1:
        failures.append(f"코드 상자 가로 넘침 {record['codeOverflow']}")
    if record["noticeOverflow"] > 1:
        failures.append(f"알림 상자 가로 넘침 {record['noticeOverflow']}")
    first = record["lines"][0]["text"]
    # 첫 조각(FILE_LIST_)이 칸에 들어가면 `_` 경계에서 먼저 나뉘어야 한다. 칸이 더 좁으면
    # 마지막 수단으로 조각 안에서 나뉘는 것이 맞으므로 그때는 첫 줄 폭이 칸을 채웠는지 본다.
    if not first.endswith("_"):
        filled = record["lines"][0]["right"] - record["lines"][0]["left"] >= record["codeBox"]["width"] - 1
        if not filled:
            failures.append(f"첫 줄이 `_` 경계에서 나뉘지 않음: {first!r}")
    return {"통과": not failures, "실패": failures, "줄": [line["text"] for line in record["lines"]],
            "코드_넘침": record["codeOverflow"], "알림_넘침": record["noticeOverflow"]}


def check_path(name, record, collapsed):
    failures = []
    if record["hasCollapsed"] != collapsed:
        failures.append(f"접힘 {record['hasCollapsed']} != {collapsed}")
    if record["indicatorVisible"] != collapsed:
        failures.append("「…」 표시가 접힘과 다름")
    if record["gap"] > 1:
        failures.append(f"경로 줄 왼쪽에 빈 앞자리 {record['gap']}px")
    if record["current"] != "notes":
        failures.append(f"현재 폴더 {record['current']!r}")
    if collapsed and not record["collapsed"][0]:
        failures.append("뿌리 조상부터 접지 않음")
    if not collapsed and record["visibleCrumbTexts"] != ["문서"]:
        failures.append(f"넓은 폭 조상 {record['visibleCrumbTexts']}")
    return {"통과": not failures, "실패": failures, "접힘": record["hasCollapsed"],
            "앞자리": record["gap"], "보이는_조상": record["visibleCrumbTexts"]}


def check_path_depth(name, record, collapsed, current, clipped=None):
    """깊은 경로·긴 이름 장면: 오른쪽 끝이 경로 줄 안이고, 좁은 칸은 말줄임으로 끝난다."""
    failures = []
    if record["current"] != current:
        failures.append(f"현재 폴더 {record['current']!r} != {current!r}")
    if record["hasCollapsed"] != collapsed:
        failures.append(f"접힘 {record['hasCollapsed']} != {collapsed}")
    if record["indicatorVisible"] != collapsed:
        failures.append("「…」 표시가 접힘과 다름")
    if record["gap"] > 1:
        failures.append(f"경로 줄 왼쪽에 빈 앞자리 {record['gap']}px")
    if record["overflowRight"] > 0.5:
        failures.append(f"보이는 요소의 오른쪽 끝이 경로 줄을 {record['overflowRight']}px 넘음")
    if clipped is not None and record["currentClipped"] != clipped:
        failures.append(f"현재 폴더 칸 좁아짐 {record['currentClipped']} != {clipped}")
    if record["currentClipped"]:
        if record["currentScrollWidth"] <= record["currentClientWidth"]:
            failures.append("칸이 좁은데 scrollWidth가 clientWidth 이하")
        if record["textOverflow"] != "ellipsis":
            failures.append(f"말줄임이 아님: {record['textOverflow']!r}")
        if record["overflow"] != "hidden":
            failures.append(f"경로 줄 안에서 감추지 않음: {record['overflow']!r}")
        if record["whiteSpace"] != "nowrap":
            failures.append(f"한 줄이 아님: {record['whiteSpace']!r}")
    return {"통과": not failures, "실패": failures, "보이는_글": record["visibleText"],
            "접힘": record["hasCollapsed"], "오른쪽_넘침": record["overflowRight"],
            "현재_칸": [record["currentClientWidth"], record["currentScrollWidth"]],
            "말줄임": record["currentClipped"]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=".local/visual/card1667")
    parser.add_argument("--port", type=int, default=5667)
    args = parser.parse_args()
    output = (ROOT / args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    for stale in ("measurements.json", "result.json"):
        (output / stale).unlink(missing_ok=True)
    env = os.environ.copy()
    env["KS_E2E_PORT"] = str(args.port)
    env["KS_1667_VISUAL_OUTPUT"] = str(output)
    command = ["corepack", "pnpm@10.32.1", "--dir", "ui", "e2e:netns", "corner-focus-360-1667", "--workers=1"]
    result = subprocess.run(command, cwd=ROOT, env=env, timeout=840, check=False)
    missing = [name for name in CAPTURES if not (output / name).is_file()]
    measurements = {}
    if (output / "measurements.json").is_file():
        measurements = json.loads((output / "measurements.json").read_text(encoding="utf-8"))
    records = measurements.get("records", {})
    corners, codes, paths, depths, failures = {}, {}, {}, {}, []
    if not missing:
        for width in (1100, 360):
            for state in ("corner-split-left", "corner-split-right", "corner-resize",
                          "corner-explorer-content", "corner-tree-list", "corner-tab-panel",
                          "corner-window-body"):
                key = f"{width}-{state}"
                if key in records:
                    corners[key] = check_corner(key, records[key], output)
                else:
                    failures.append(f"{key}: 측정값 없음")
        for key in ("360-code-body", "360-code-tree-child-1", "360-code-tree-child-2"):
            if key in records:
                codes[key] = check_code(key, records[key])
            else:
                failures.append(f"{key}: 측정값 없음")
        for key, collapsed in (("360-path-notes", True), ("1100-path-notes", False), ("360-path-notes-back", True)):
            if key in records:
                paths[key] = check_path(key, records[key], collapsed)
            else:
                failures.append(f"{key}: 측정값 없음")
        depth_cases = [
            ("360-path-open-notes", True, "notes", None),
            ("360-path-open-deep", True, "deep", None),
            ("360-path-open-deeper", True, "deeper", None),
            ("path-resize-1100-first", False, "deeper", None),
            ("path-resize-700", False, "deeper", None),
            ("path-resize-520", True, "deeper", None),
            ("path-resize-360", True, "deeper", None),
            ("path-resize-1100-second", False, "deeper", None),
            ("360-path-long-name", True, "2026-11-회의록-아주-긴-폴더-이름", True),
        ]
        for key, collapsed, current, clipped in depth_cases:
            if key in records:
                depths[key] = check_path_depth(key, records[key], collapsed, current, clipped)
            else:
                failures.append(f"{key}: 측정값 없음")
        if len(corners) != 14:
            failures.append(f"모서리 초점 측정 {len(corners)}/14")
        for group in (corners, codes, paths, depths):
            for key, verdict in group.items():
                if not verdict["통과"]:
                    failures.append(f"{key}: " + "; ".join(verdict["실패"]))
    else:
        failures.append("누락 캡처: " + ", ".join(missing))
    ui_design = measurements.get("uiDesign", {})
    for item in ("누른 뒤 초점", "Tab과 Esc", "최소 폭에서 넘침과 잘림", "오류 상태", "창 크기 바꾸기"):
        if not ui_design.get(item, {}).get("통과"):
            failures.append(f"ui-design 0절 {item}: 기록 없음 또는 미통과")
    summary = {
        "시험_종료코드": result.returncode,
        "누락_캡처": missing,
        "모서리_초점": corners,
        "오류_코드": codes,
        "경로": paths,
        "경로_깊이": depths,
        "ui_design_14_18": ui_design,
        "실패": failures,
    }
    (output / "result.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"시험_종료코드": result.returncode, "누락_캡처": missing, "실패": failures}, ensure_ascii=False))
    return 1 if result.returncode or missing or failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
