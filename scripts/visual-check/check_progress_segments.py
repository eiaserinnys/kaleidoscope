#!/usr/bin/env python3
"""progress 블록의 칸막이(segments)와 세로 커서(marker)를 화면에서 확인한다.

장면은 다섯 줄이다.
- 빨리 씀: 지난 50%, 값 72
- 맞춤: 지난 50%, 값 48
- 여유: 지난 60%, 값 20
- 커서 없음: 값 35, marker 없음
- 필드 없음: 값 40, segments와 marker가 모두 없어 예전과 같은 막대

넓은 폭 1180×720과 360×720에서 밝은 테마와 어두운 테마로 찍고, 칸막이 여섯 개의 x가
bar.left + bar.width * k / 7에 서는지와 커서 x가 bar.left + bar.width * marker / max에
서는지를 견준다.

칸막이는 트랙과 채움을 함께 투명하게 오려 낸 자리라, 캡처 픽셀에서 막대 바탕색과 같은
열을 찾아 그 자리를 잰다. 커서는 DOM 상자 가운데와 캡처의 커서 색을 함께 본다.
segments와 marker가 없는 줄은 마스크가 없고 칸막이 자리에 오린 열이 없으며 커서도 없다.

  python3 scripts/visual-check/check_progress_segments.py [--output 산출폴더] [--port 포트]

중립 미리보기 ?preview=data-controls에 장면 정의를 주입한다. 기본 산출 폴더는
target/visual-check/progress-segments이고, 서버는 이 체크아웃의 ui/harness/e2e-server.mjs를
KS_E2E_PORT로 띄운다.

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
NARROW = (360, 720)
VIEWPORTS = (WIDE, NARROW)
SEGMENTS = 7
STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"

ROWS = [
    {"key": "fast", "label": "빨리 씀 · 7일 72% 남음", "value": 72, "marker": 50},
    {"key": "even", "label": "맞춤 · 7일 48% 남음", "value": 48, "marker": 50},
    {"key": "spare", "label": "여유 · 7일 20% 남음", "value": 20, "marker": 60},
    {"key": "no-cursor", "label": "커서 없음 · 7일 35% 남음", "value": 35},
    {"key": "no-fields", "label": "필드 없음 · 7일 40% 남음", "value": 40, "plain": True},
]
STATE = {}

MEASURE_JS = """(args) => {
  const win = document.querySelector(`[data-testid="app-window-${args.appId}"]`);
  if (!win) return { error: "창을 찾지 못했습니다" };
  const round = (value) => Math.round(value * 10) / 10;
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return { left: round(rect.left), top: round(rect.top), right: round(rect.right), bottom: round(rect.bottom), width: round(rect.width), height: round(rect.height) };
  };
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolvePx = (value) => {
    probe.style.width = value;
    return parseFloat(getComputedStyle(probe).width);
  };
  const resolveColor = (value) => {
    probe.style.color = value;
    return getComputedStyle(probe).color;
  };
  const tokens = {
    lineWidth: resolvePx("var(--ks-line-width)"),
    space4: resolvePx("var(--ks-space-4)"),
    textColor: resolveColor("var(--ks-color-text)"),
  };
  probe.remove();
  const fields = [...win.querySelectorAll(".ks-data-progress-field")].map((field) => {
    const bar = field.querySelector(".ks-data-progress");
    if (!bar) return { error: "진행 막대를 찾지 못했습니다" };
    const marker = field.querySelector(".ks-data-progress-marker");
    const style = getComputedStyle(bar);
    return {
      label: field.querySelector(".ks-data-progress-label")?.textContent ?? "",
      bar: box(bar),
      field: box(field),
      segmented: bar.classList.contains("is-segmented"),
      mask: style.maskImage,
      marker: marker ? { ...box(marker), styleLeft: marker.style.left, ariaHidden: marker.getAttribute("aria-hidden"), tabIndex: marker.tabIndex } : null,
      tabIndex: bar.tabIndex,
      valueNow: bar.getAttribute("aria-valuenow"),
      valueText: bar.getAttribute("aria-valuetext"),
      backgroundSide: (() => {
        const rect = bar.getBoundingClientRect();
        return { x: Math.round(rect.left) - 6, y: Math.round(rect.top + rect.height / 2) };
      })(),
    };
  });
  return {
    fields,
    tokens,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  };
}"""


def scene():
    children = []
    for row in ROWS:
        block = {"type": "progress", "value": row["value"], "max": 100, "label": row["label"]}
        if not row.get("plain"):
            block["segments"] = SEGMENTS
            if "marker" in row:
                block["marker"] = row["marker"]
        children.append(block)
    return {"type": "stack", "direction": "column", "gap": "medium", "children": children}


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
          version.definition.requires = { ...(version.definition.requires ?? {}), blocks: 64 };
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


def open_page(page, port):
    page.goto(f"http://127.0.0.1:{port}/?preview={APP_ID}")
    page.wait_for_function(
        "() => window.__ksHarness && document.querySelector('[data-testid=app-window-data-controls]')",
        timeout=120000,
    )
    page.add_style_tag(content=STYLE)
    inject(page, scene())
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(400)


def parse_rgb(text):
    numbers = [float(value) for value in re.findall(r"[\d.]+", text)]
    if "color(srgb" in text:
        return tuple(round(value * 255) for value in numbers[:3])
    return tuple(round(value) for value in numbers[:3])


def distance(first, second):
    return (sum((left - right) ** 2 for left, right in zip(first, second))) ** 0.5


def mask_gap_percentages(mask):
    """계산된 마스크 문자열에서 투명 구간의 가운데 백분율을 뽑는다."""
    gaps = []
    for match in re.finditer(r"rgba\(0, 0, 0, 0\) calc\(([\d.]+)% ([+-]) 0\.5px\)", mask):
        if match.group(2) == "+":
            gaps.append(float(match.group(1)))
    return gaps


def column_color(image, x, y):
    x = min(image.width - 1, max(0, x))
    y = min(image.height - 1, max(0, y))
    return image.getpixel((x, y))


def cut_columns(image, bar, background):
    """막대 세로 가운데 줄에서 바탕색과 같은 열을 찾는다."""
    y = round((bar["top"] + bar["bottom"]) / 2)
    cuts = []
    # 막대의 둥근 끝과 안티에일리어싱은 칸막이가 아니므로 좌우 2px를 뺀다.
    for x in range(round(bar["left"]) + 2, round(bar["right"]) - 2):
        if distance(column_color(image, x, y), background) <= 12:
            cuts.append(x)
    return cuts


def clusters(columns):
    groups = []
    for x in columns:
        if groups and x - groups[-1][-1] <= 1:
            groups[-1].append(x)
        else:
            groups.append([x])
    return groups


def judge(measurement, image, width):
    verdicts = {}
    if measurement.get("error"):
        return {"window_present": False}, {}
    fields = measurement["fields"]
    verdicts["five_rows"] = len(fields) == len(ROWS) and all(
        field.get("label") == row["label"] for field, row in zip(fields, ROWS))
    verdicts["no_horizontal_overflow"] = measurement["scrollWidth"] <= measurement["clientWidth"] + 1
    tokens = measurement["tokens"]
    line_width = tokens["lineWidth"]
    space4 = tokens["space4"]
    text_color = parse_rgb(tokens["textColor"])
    details = {}
    for field, row in zip(fields, ROWS):
        key = row["key"]
        bar = field["bar"]
        y = round((bar["top"] + bar["bottom"]) / 2)
        sample = field["backgroundSide"]
        background = column_color(image, sample["x"], sample["y"])
        details[key] = {"background": list(background)}
        if row.get("plain"):
            verdicts[f"{key}:no_mask"] = field["mask"] == "none" and not field["segmented"]
            verdicts[f"{key}:no_cursor"] = field["marker"] is None
            gap_columns = []
            for index in range(1, SEGMENTS):
                expected = bar["left"] + bar["width"] * index / SEGMENTS
                near = [column_color(image, x, y) for x in range(round(expected) - 2, round(expected) + 3)]
                gap_columns.append(round(min(distance(color, background) for color in near), 1))
            details[key]["divider_distances"] = gap_columns
            # 예전 막대에는 오린 자리가 없다. 칸막이 자리의 색이 바탕과 충분히 다르다.
            verdicts[f"{key}:no_cut"] = all(value > 24 for value in gap_columns)
            continue
        verdicts[f"{key}:mask_applied"] = field["mask"] != "none" and field["segmented"]
        percentages = mask_gap_percentages(field["mask"])
        verdicts[f"{key}:mask_six_gaps"] = len(percentages) == SEGMENTS - 1
        verdicts[f"{key}:mask_positions"] = len(percentages) == SEGMENTS - 1 and all(
            abs(value - 100 * index / SEGMENTS) <= 0.01 for index, value in enumerate(percentages, start=1))
        cuts = clusters(cut_columns(image, bar, background))
        expected = [bar["left"] + bar["width"] * index / SEGMENTS for index in range(1, SEGMENTS)]
        centers = [sum(group) / len(group) for group in cuts]
        details[key]["cut_centers"] = [round(value, 1) for value in centers]
        details[key]["expected_dividers"] = [round(value, 1) for value in expected]
        details[key]["divider_errors"] = [
            round(min(abs(center - want) for center in centers), 1) if centers else None for want in expected]
        # 칸막이 여섯 개가 각각 기대 자리 1.5px 안에서 바탕색으로 오려져야 한다.
        verdicts[f"{key}:six_cuts"] = len(cuts) == SEGMENTS - 1
        verdicts[f"{key}:cut_positions"] = all(
            centers and min(abs(center - want) for center in centers) <= 1.5 for want in expected) if len(cuts) == len(expected) else False
        marker_row = row.get("marker")
        if marker_row is None:
            verdicts[f"{key}:no_cursor"] = field["marker"] is None
            continue
        marker = field["marker"]
        if marker is None:
            verdicts[f"{key}:cursor_present"] = False
            continue
        want = bar["left"] + bar["width"] * marker_row / 100
        marker_center = (marker["left"] + marker["right"]) / 2
        details[key]["marker"] = {"center": round(marker_center, 1), "expected": round(want, 1),
                                  "width": marker["width"], "height": marker["height"]}
        verdicts[f"{key}:cursor_x"] = abs(marker_center - want) <= 1
        verdicts[f"{key}:cursor_size"] = abs(marker["width"] - 2 * line_width) <= 0.5 and abs(marker["height"] - space4) <= 0.5
        verdicts[f"{key}:cursor_decorative"] = marker["ariaHidden"] == "true" and marker["tabIndex"] == -1 and field["tabIndex"] == -1
        columns = [round(marker_center) - 1, round(marker_center), round(marker_center) + 1]
        nearest = min(distance(column_color(image, x, y), text_color) for x in columns)
        details[key]["cursor_color_distance"] = round(nearest, 1)
        verdicts[f"{key}:cursor_color"] = nearest <= 20
        verdicts[f"{key}:cursor_not_beyond_fill"] = want <= bar["right"] + 1
    return verdicts, details


def record(result, key, verdicts, details):
    result["scenes"][key] = {"verdicts": verdicts, "details": details}
    for verdict, passed in verdicts.items():
        if not passed:
            result["failures"].append(f"{key}: {verdict}")
    print(key, "ok" if all(verdicts.values()) else "FAIL " + ",".join(
        name for name, ok in verdicts.items() if not ok), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="target/visual-check/progress-segments")
    parser.add_argument("--port", type=int, default=5396)
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
    result = {"windows": {"wide": list(WIDE), "narrow": list(NARROW)}, "rows": ROWS,
              "scenes": {}, "captures": [], "failures": []}
    try:
        wait_server(args.port)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(locale="ko-KR", viewport={"width": WIDE[0], "height": WIDE[1]})
            page = context.new_page()
            open_page(page, args.port)
            for width, height in VIEWPORTS:
                for theme in ("light", "dark"):
                    page.set_viewport_size({"width": width, "height": height})
                    page.emulate_media(color_scheme=theme)
                    page.wait_for_timeout(500)
                    measurement = page.evaluate(MEASURE_JS, {"appId": APP_ID})
                    if measurement.get("error"):
                        raise AssertionError(measurement["error"])
                    key = f"{width}x{height}-{theme}"
                    capture = output / f"progress-segments-{key}.png"
                    page.screenshot(path=str(capture), animations="disabled")
                    result["captures"].append(str(capture))
                    image = Image.open(capture).convert("RGB")
                    verdicts, details = judge(measurement, image, width)
                    record(result, key, verdicts, details)
                    result["scenes"][key]["measurement"] = measurement
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
