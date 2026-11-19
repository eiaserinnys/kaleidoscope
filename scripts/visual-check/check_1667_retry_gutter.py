#!/usr/bin/env python3
"""카드 #1667 후속 깊은 트리 실패 안내 폭, 코드 편집기 초점 고리 실화면 검수.

python3 -P scripts/visual-check/check_1667_retry_gutter.py [--output 산출폴더] [--port 포트]

ui/e2e/retry-gutter-1667.spec.ts를 e2e:netns로 돌리고, 1100px과 360px의 캡처와
측정값(measurements.json)을 견준다. 깊이 1~5 폴더 읽기 실패 행의 단추·코드가 알림 상자
안에 있고 목록에 가로 스크롤이 없으며 안내 글이 낱말 중간에서 끊기지 않는지, 폴더 작업
안내 행이 행 전체 폭인지, 코드 편집기·코드 보기·마크다운 편집기 칸의 구조용 초점 고리가
네 쪽 모두 이어지는지 잰다. 하나라도 실패하거나 캡처가 빠지면 0이 아닌 값으로 끝난다.
"""
import argparse
import json
import math
import os
import re
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
FOCUS_COLOR = (140, 106, 175)

CAPTURES = [f"360-depth-{depth}.png" for depth in range(1, 6)]
CAPTURES += ["1100-depth-4.png", "360-operation.png"]
for width in (1100, 360):
    CAPTURES += [f"{width}-{scene}.png" for scene in ("code-editor", "code-view", "markdown-editor")]

FAILURE_KEYS = [f"360-depth-{depth}" for depth in range(1, 6)]
FAILURE_KEYS += ["360-depth-5-resized-1100", "360-depth-5-resized-back", "1100-depth-4"]
RING_KEYS = [f"{width}-{scene}" for width in (1100, 360) for scene in ("code-editor", "code-view", "markdown-editor")]


def parse_color(value):
    match = re.match(r"rgba?\(([^)]+)\)", value or "")
    if not match:
        return FOCUS_COLOR
    parts = [float(part.strip()) for part in match.group(1).split(",")]
    return tuple(int(round(part)) for part in parts[:3])


def close_to(pixel, want, limit=40):
    return sum((channel - target) ** 2 for channel, target in zip(pixel, want)) ** 0.5 <= limit


def pixel_at(image, app, x, y):
    scale_x = image.width / app["width"]
    scale_y = image.height / app["height"]
    column = int(round((x - app["left"]) * scale_x))
    row = int(round((y - app["top"]) * scale_y))
    if column < 0 or row < 0 or column >= image.width or row >= image.height:
        return None
    return image.getpixel((column, row))


def scan_band(image, app, want, vertical, candidates, start, end):
    """후보 줄(또는 칸)마다 스캔 구간에서 초점 색이 이어지는지 센다. 가장 잘 맞는 줄을 고른다."""
    start, end = int(round(start)), int(round(end))
    best = None
    for candidate in candidates:
        hits = total = miss = longest = 0
        for position in range(start, end + 1):
            pixel = pixel_at(image, app, candidate, position) if vertical else pixel_at(image, app, position, candidate)
            total += 1
            if pixel is not None and close_to(pixel, want):
                hits += 1
                miss = 0
            else:
                miss += 1
                longest = max(longest, miss)
        record = {"줄": candidate, "적중": hits, "표본": total, "가장긴_끊김": longest}
        if best is None or record["적중"] > best["적중"]:
            best = record
    return best


def check_band(image, record, want, name, vertical, candidates, start, end, label):
    scan = scan_band(image, record["app"], want, vertical, candidates, start, end)
    failures = []
    if scan["표본"] < 6:
        failures.append(f"{label} 스캔 표본이 {scan['표본']}px뿐")
    if scan["적중"] < math.ceil(scan["표본"] * 0.8) or scan["가장긴_끊김"] > 4:
        failures.append(f"{label}에서 초점 색이 이어지지 않음: {scan}")
    return {"통과": not failures, "실패": failures, **scan}


def band_candidates(edge, direction):
    """고리 띠(테두리에서 안쪽 0~2px)를 덮는 픽셀 줄 후보. 반올림 오차를 위해 4px까지 넓힌다."""
    offsets = [0, 1, 2, 3]
    if direction == "inside_positive":
        return [edge + offset for offset in offsets]
    return [edge - offset for offset in offsets]


def check_failure(key, record):
    failures = []
    notice, button = record["notice"], record.get("button")
    if not button:
        failures.append("다시 시도 단추 없음")
    else:
        if button["right"] > notice["right"] + 1:
            failures.append(f"단추 오른쪽 끝 {button['right']:.1f} > 상자 오른쪽 {notice['right']:.1f} + 1")
        if button["left"] < notice["left"] - 1:
            failures.append("단추가 상자 왼쪽 밖")
        if button["top"] < notice["top"] - 1 or button["bottom"] > notice["bottom"] + 1:
            failures.append("단추가 상자 위아래 밖")
    code = record["code"]
    if (code.get("text") or "").replace(" ", "") != "FILE_LIST_DIRECTORY_IO":
        failures.append(f"오류 코드 전문이 다름: {code.get('text')!r}")
    for line in code.get("lines", []):
        if line["left"] < notice["left"] - 1 or line["right"] > notice["right"] + 1:
            failures.append(f"코드 줄이 알림 상자 밖: {line['text']!r}")
            break
        if line["top"] < notice["top"] - 1 or line["bottom"] > notice["bottom"] + 1:
            failures.append(f"코드 줄이 알림 상자 위아래 밖: {line['text']!r}")
            break
    if code.get("overflow", 0) > 1:
        failures.append(f"코드 상자 가로 넘침 {code['overflow']}")
    if record.get("noticeOverflow", 0) > 1:
        failures.append(f"알림 상자 가로 넘침 {record['noticeOverflow']}")
    if record["message"].get("breaks"):
        failures.append(f"안내 글이 낱말 중간에서 끊김: {record['message']['breaks']}")
    listed = record["list"]
    if listed["scrollWidth"] > listed["clientWidth"]:
        failures.append(f"트리 목록 가로 스크롤 {listed['scrollWidth']} > {listed['clientWidth']}")
    if record["rows"]["notice"] != record["rows"]["target"] + 1:
        failures.append(f"알림 행 자리 {record['rows']['notice']} != 대상 {record['rows']['target']} + 1")
    if record["indents"]["notice"] != "0px":
        failures.append(f"안내 행 들여쓰기 {record['indents']['notice']!r}")
    if notice["left"] - listed["contentLeft"] > 1:
        failures.append(f"안내 상자 왼쪽 {notice['left'] - listed['contentLeft']:.1f}px 들여씀")
    if listed["contentRight"] - notice["right"] > 1:
        failures.append(f"안내 상자 오른쪽 {listed['contentRight'] - notice['right']:.1f}px 남음")
    return {"통과": not failures, "실패": failures,
            "단추_오른쪽": None if not button else round(button["right"], 1),
            "상자_오른쪽": round(notice["right"], 1),
            "목록_가로": [listed["scrollWidth"], listed["clientWidth"]],
            "안내_줄": record["message"].get("lines", []),
            "들여쓰기": record["indents"]["notice"]}


def check_operation(key, record):
    failures = []
    listed = record["list"]
    if record["rows"]["notice"] != record["rows"]["target"] + 1:
        failures.append(f"작업 안내 행 자리 {record['rows']['notice']} != 대상 {record['rows']['target']} + 1")
    if record["indent"] != "0px":
        failures.append(f"작업 안내 행 들여쓰기 {record['indent']!r}")
    if record["notice"]["left"] - listed["contentLeft"] > 1:
        failures.append(f"작업 안내 상자 왼쪽이 목록 내용 왼쪽보다 {record['notice']['left'] - listed['contentLeft']:.1f}px 안")
    if listed["contentRight"] - record["notice"]["right"] > 1:
        failures.append(f"작업 안내 상자 오른쪽이 {listed['contentRight'] - record['notice']['right']:.1f}px 모자람")
    if listed["scrollWidth"] > listed["clientWidth"]:
        failures.append(f"트리 목록 가로 스크롤 {listed['scrollWidth']} > {listed['clientWidth']}")
    return {"통과": not failures, "실패": failures,
            "안내_폭": round(record["notice"]["right"] - record["notice"]["left"], 1),
            "목록_내용_폭": round(listed["contentRight"] - listed["contentLeft"], 1),
            "들여쓰기": record["indent"]}


def check_ring(key, record, output):
    failures = []
    if not record.get("focusVisible"):
        failures.append("구조용 초점이 :focus-visible이 아님")
    if record.get("outlineStyle") != "solid" or record.get("outlineOffset") != "-2px":
        failures.append("초점 고리 모양이 안쪽 실선이 아님")
    if record.get("marks") != record.get("expected"):
        failures.append(f"모서리 표시 {record.get('marks')}가 배치 {record.get('expected')}와 다름")
    expected_radius = record["frameRadius"] - record["frameBorder"]
    for corner in ("bl", "br"):
        want = expected_radius if record["expected"][corner] else 0
        if abs(record["radius"][corner] - want) > 0.1:
            failures.append(f"{corner} 계산 반경 {record['radius'][corner]} != {want}")
    code_view = record.get("codeView")
    if code_view:
        rect = record["rect"]
        # 코드 보기 테두리 상자는 칸을 채우고, 안쪽 여백만큼 들어간 CodeMirror 층이 고리 띠를 비운다.
        layer = record["editor"]
        for side, gap in (("왼쪽", layer["left"] - rect["left"]),
                          ("위쪽", layer["top"] - rect["top"]),
                          ("오른쪽", rect["right"] - layer["right"]),
                          ("아래쪽", rect["bottom"] - layer["bottom"])):
            if gap < 1.5:
                failures.append(f"편집기 층이 칸 {side} 고리 띠를 덮음({gap:.1f}px)")
        if record.get("gutters") is None:
            failures.append("줄 번호 거터가 없음")
        elif record["gutters"]["left"] - rect["left"] < 1.5:
            failures.append(f"거터가 칸 왼쪽 고리 띠를 덮음({record['gutters']['left'] - rect['left']:.1f}px)")
        if record.get("codeViewPadding") not in ("2px", None):
            failures.append(f"코드 보기 안쪽 여백 {record.get('codeViewPadding')!r}")
    want = parse_color(record.get("outlineColor"))
    rect, gutters = record["rect"], record.get("gutters")
    image = Image.open(output / f"{key}.png").convert("RGB")
    # 왼쪽은 거터가 있는 줄 높이, 위와 아래는 거터 열이 닿는 곳에서 잰다. 거터가 없는
    # 마크다운 편집기는 칸 가장자리에서 20px 안쪽 구간을 잰다. 창 아래 모서리에 닿은 칸의
    # 둥근 모서리에서는 고리가 휘므로 그 폭만큼 양 끝을 뺀다.
    trim = 20
    if gutters:
        left_start = max(gutters["top"], rect["top"]) + trim
        left_end = min(gutters["bottom"], rect["bottom"]) - trim
        top_start, top_end = max(gutters["left"], rect["left"]) + 2, min(gutters["right"], rect["right"]) - 2
        bottom_start = max(gutters["left"] + 2, rect["left"] + record["radius"]["bl"] + 2)
        bottom_end = min(gutters["right"], rect["right"]) - 2
    else:
        left_start, left_end = rect["top"] + trim, rect["bottom"] - trim
        top_start, top_end = rect["left"] + trim, rect["right"] - trim
        bottom_start, bottom_end = top_start, top_end
    bands = {
        "왼쪽": check_band(image, record, want, key, True,
                          band_candidates(rect["left"], "inside_positive"), left_start, left_end, f"{key} 왼쪽"),
        "위쪽": check_band(image, record, want, key, False,
                          band_candidates(rect["top"], "inside_positive"), top_start, top_end, f"{key} 위쪽"),
        "아래쪽": check_band(image, record, want, key, False,
                            band_candidates(rect["bottom"], "inside_negative"), bottom_start, bottom_end, f"{key} 아래쪽"),
        "오른쪽": check_band(image, record, want, key, True,
                            band_candidates(rect["right"], "inside_negative"), rect["top"] + trim, rect["bottom"] - trim, f"{key} 오른쪽"),
    }
    for side, verdict in bands.items():
        if not verdict["통과"]:
            failures.extend(verdict["실패"])
    return {"통과": not failures, "실패": failures, "반경": record["radius"], "기대": record["expected"],
            "모서리": bands, "편집기_안쪽": None if not code_view else {
                "왼쪽": round(record["editor"]["left"] - rect["left"], 1),
                "위쪽": round(record["editor"]["top"] - rect["top"], 1),
                "오른쪽": round(rect["right"] - record["editor"]["right"], 1),
                "아래쪽": round(rect["bottom"] - record["editor"]["bottom"], 1)}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=".local/visual/card1667b")
    parser.add_argument("--port", type=int, default=5670)
    args = parser.parse_args()
    output = (ROOT / args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    for stale in ("measurements.json", "result.json"):
        (output / stale).unlink(missing_ok=True)
    env = os.environ.copy()
    env["KS_E2E_PORT"] = str(args.port)
    env["KS_1667_RETRY_GUTTER_OUTPUT"] = str(output)
    command = ["corepack", "pnpm@10.32.1", "--dir", "ui", "e2e:netns", "retry-gutter-1667", "--workers=1"]
    result = subprocess.run(command, cwd=ROOT, env=env, timeout=840, check=False)
    missing = [name for name in CAPTURES if not (output / name).is_file()]
    measurements = {}
    if (output / "measurements.json").is_file():
        measurements = json.loads((output / "measurements.json").read_text(encoding="utf-8"))
    records = measurements.get("records", {})
    failures, failures_checked, operation, rings = [], {}, None, {}
    if not missing:
        for key in FAILURE_KEYS:
            if key in records:
                failures_checked[key] = check_failure(key, records[key])
                if not failures_checked[key]["통과"]:
                    failures.append(f"{key}: " + "; ".join(failures_checked[key]["실패"]))
            else:
                failures.append(f"{key}: 측정값 없음")
        if "360-operation" in records:
            operation = check_operation("360-operation", records["360-operation"])
            if not operation["통과"]:
                failures.append("360-operation: " + "; ".join(operation["실패"]))
        else:
            failures.append("360-operation: 측정값 없음")
        for key in RING_KEYS:
            if key in records:
                rings[key] = check_ring(key, records[key], output)
                if not rings[key]["통과"]:
                    failures.append(f"{key}: " + "; ".join(rings[key]["실패"]))
            else:
                failures.append(f"{key}: 측정값 없음")
    else:
        failures.append("누락 캡처: " + ", ".join(missing))
    ui_design = measurements.get("uiDesign", {})
    for item in ("누른 뒤 초점", "Tab과 Esc", "최소 폭에서 넘침과 잘림", "오류 상태", "창 크기 바꾸기"):
        if not ui_design.get(item, {}).get("통과"):
            failures.append(f"ui-design 0절 {item}: 기록 없음 또는 미통과")
    summary = {
        "시험_종료코드": result.returncode,
        "누락_캡처": missing,
        "실패_안내": failures_checked,
        "폴더_작업_안내": operation,
        "초점_고리": rings,
        "ui_design_14_18": ui_design,
        "실패": failures,
    }
    (output / "result.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"시험_종료코드": result.returncode, "누락_캡처": missing, "실패": failures}, ensure_ascii=False))
    return 1 if result.returncode or missing or failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
