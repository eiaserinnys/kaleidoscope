#!/usr/bin/env python3
"""feed 블록의 구역 안 첫 내용 간격, 메타 오른쪽 끝선, 초상 없는 줄의 글 시작선, 이름 색 대비를 확인한다.

장면 A는 코르크시트 상세와 같은 꼴이다. split(row)의 오른쪽 칸 stack 안에 구역 셋을 두고,
「대사」 구역의 feed는 묶음 둘에 항목 여섯(초상 둘, 초상 없음 넷)을 둔다. 장면 B는 같은
feed를 split 칸에 바로 두고, 장면 C는 초상이 하나도 없는 feed다. 장면 D는 장면 A와 같되
「대사」 구역의 feed가 접는 묶음(grouped, collapsible)이고, 구역 첫 내용 위끝을 첫 가상 행의
묶음 머리 줄(.ks-feed-group-head) 상자 위끝으로 재며, 머리 줄 안 묶음 머리 글이 세로
가운데인지도 잰다. 장면 N은 이름 색만 담은 feed로, 테마마다 이름의 계산된 색을 canvas에서
sRGB로 얻어 화면 바탕 픽셀과 쉘 창 바탕 기준값 모두에 4.5:1 이상인지 잰다. 장면 P는 장면
A와 같은 분할에서 「대사」 구역을 뺀 꼴이고, 입력 자리 글이 --ks-color-muted인지 밝은
테마와 어두운 테마에서 재며 그 캡처를 남긴다.

  python3 scripts/visual-check/check_feed_alignment.py [--output 산출폴더] [--port 포트]

중립 미리보기 ?preview=data-controls에 장면 정의를 주입하고 1440×880과 360×700에서 잰다.
실제 개인 앱 정의와 회사 대사 원문은 쓰지 않는다. 기본 산출 폴더는
target/visual-check/feed-alignment 이고, 서버는 이 체크아웃의 ui/harness/e2e-server.mjs를
KS_E2E_PORT로 띄운다.

판정이 하나라도 어긋나면 result.json과 캡처를 남긴 뒤 종료 코드 1로 끝난다.
"""
import argparse
import io
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
STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"
SIZES = ((1440, 880), (360, 700))
TOLERANCE = 1.0
PORTRAIT = {"permission": "media", "path": "landscape.png"}
COLOR_NAMES = (
    ("빛 하나", "#eff0f0"),
    ("풀빛", "#a0ffa0"),
    ("연둣빛", "#c8ffc8"),
    ("노란빛", "#fff000"),
    ("겨자빛", "#eff0a0"),
    ("잎빛", "#22aa22"),
    ("청록빛", "#00c8c8"),
    ("초록빛", "#00ff00"),
    ("붉은빛", "#ff0000"),
    ("푸른빛", "#0000ff"),
    ("남빛", "#5b6fd6"),
    ("자줏빛", "#c0507a"),
)
REFERENCE_BACKGROUND = {"light": (0xF4, 0xF2, 0xF2), "dark": (0x2A, 0x23, 0x2F)}
PLACEHOLDER = "댓글을 남겨 보세요"
STATE = {"note": "", "note2": "", "comment": ""}


def feed(avatars=True, collapsible=False):
    def item(index, name, color=None):
        entry = {
            "key": f"dialogue-{index}",
            "name": name,
            "meta": f"d-{index:03d}",
            "body": [f"{name}의 첫 문단입니다.", f"{name}의 둘째 문단입니다."],
        }
        if color:
            entry["color"] = color
        if avatars and index in (1, 4):
            entry["image"] = PORTRAIT
        return entry

    definition = {
        "type": "feed", "grouped": True, "columns": True, "copy": True, "format": "plain",
        "entries": [
            {"title": "대화 전", "meta": "셋", "items": [
                item(1, "갈릴리엘", "#eff0f0"),
                item(2, "화자 둘", "#5b6fd6"),
                item(3, "화자 셋"),
            ]},
            {"title": "대화 후", "meta": "셋", "items": [
                item(4, "화자 넷"),
                item(5, "화자 다섯"),
                item(6, "화자 여섯"),
            ]},
        ],
    }
    if collapsible:
        definition["collapsible"] = True
    return definition


def color_feed():
    return {"type": "feed", "format": "plain", "entries": [
        {"key": f"name-color-{index}", "name": name, "color": color, "body": ""}
        for index, (name, color) in enumerate(COLOR_NAMES)
    ]}


CARDS = {"type": "section", "title": "카드", "child": {"type": "stack", "direction": "column", "gap": "small", "children": [
    {"type": "input", "label": "제목", "label_position": "top", "value": {"state": "note"}, "on_change": {"set_state": "note"}},
    {"type": "input", "label": "부제", "label_position": "top", "value": {"state": "note2"}, "on_change": {"set_state": "note2"}},
]}}


def dialogue_section(avatars=True, collapsible=False):
    return {"type": "section", "title": "대사", "child": feed(avatars, collapsible)}


COMMENTS = {"type": "section", "title": "댓글", "child": {"type": "input", "label": "댓글", "label_position": "top", "multiline": True, "placeholder": PLACEHOLDER, "value": {"state": "comment"}, "on_change": {"set_state": "comment"}}}


def detail_layout(avatars=True, collapsible=False):
    return {"type": "split", "direction": "row", "sizes": [70, 30], "children": [
        {"type": "text", "value": "왼쪽 칸"},
        {"type": "stack", "direction": "column", "gap": "medium", "children": [
            CARDS, dialogue_section(avatars, collapsible), COMMENTS,
        ]},
    ]}


def pane_layout(avatars=True):
    return {"type": "split", "direction": "row", "sizes": [70, 30], "children": [
        {"type": "text", "value": "왼쪽 칸"},
        feed(avatars),
    ]}


def placeholder_layout():
    return {"type": "split", "direction": "row", "sizes": [70, 30], "children": [
        {"type": "text", "value": "왼쪽 칸"},
        {"type": "stack", "direction": "column", "gap": "medium", "children": [
            CARDS, COMMENTS,
        ]},
    ]}


SCENES = {
    "A": detail_layout(True),
    "B": pane_layout(True),
    "C": detail_layout(False),
    "D": detail_layout(True, collapsible=True),
    "N": color_feed(),
    "P": placeholder_layout(),
}

SECTION_GAP_JS = """(el) => {
  const rect = (node) => node.getBoundingClientRect();
  const firstTextRect = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect();
    }
    return null;
  };
  const sections = [...el.querySelectorAll('.ks-data-section')].map((section) => {
    const title = section.querySelector(':scope > .ks-data-section-header .ks-data-section-title');
    const child = section.querySelector(':scope > .ks-data-section-child');
    const first = child ? firstTextRect(child) : null;
    return {
      title: title ? title.textContent : null,
      titleBottom: title ? rect(title).bottom : null,
      firstTextTop: first ? first.top : null,
      gap: title && first ? first.top - rect(title).bottom : null,
    };
  });
  return { sections };
}"""

SCENE_D_GAP_JS = """(el) => {
  const rect = (node) => node.getBoundingClientRect();
  const firstTextRect = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect();
    }
    return null;
  };
  const sections = [...el.querySelectorAll('.ks-data-section')].map((section) => {
    const title = section.querySelector(':scope > .ks-data-section-header .ks-data-section-title');
    const child = section.querySelector(':scope > .ks-data-section-child');
    const row = child ? child.querySelector('.ks-feed > div:not(.ks-view-sticky) > [data-index="0"]') : null;
    const head = row ? row.querySelector(':scope > .ks-feed-group-head') : null;
    const group = head ? head.querySelector(':scope > .ks-view-group') : null;
    const text = child ? firstTextRect(child) : null;
    const titleBottom = title ? rect(title).bottom : null;
    const headTop = head ? rect(head).top : null;
    const textTop = text ? text.top : null;
    const firstTop = headTop === null ? textTop : headTop;
    return {
      title: title ? title.textContent : null,
      titleBottom,
      headTop,
      textTop,
      gap: titleBottom === null || firstTop === null ? null : firstTop - titleBottom,
      textGap: titleBottom === null || textTop === null ? null : textTop - titleBottom,
      headTextCenterDelta: head && group
        ? (rect(group).top + rect(group).bottom - rect(head).top - rect(head).bottom) / 2
        : null,
    };
  });
  return { sections };
}"""

FEED_META_JS = """(el) => {
  const rect = (node) => node.getBoundingClientRect();
  const feed = el.querySelector('.ks-feed');
  if (!feed) return { error: 'feed 없음' };
  const rows = [...feed.querySelectorAll('[data-index]')];
  const metas = [];
  let heading = null;
  for (const row of rows) {
    const headingMeta = row.querySelector('.ks-view-group > span:not(.ks-data-skeleton)');
    if (headingMeta) { heading = rect(headingMeta).right; continue; }
    const meta = row.querySelector('.ks-view-meta');
    if (meta) metas.push({ right: rect(meta).right, heading });
  }
  const contents = [...feed.querySelectorAll('.ks-feed-content')].map((node) => rect(node).left);
  return { metas, contents };
}"""

SCENE_C_JS = """(el) => {
  const rect = (node) => node.getBoundingClientRect();
  const feed = el.querySelector('.ks-feed');
  if (!feed) return { error: 'feed 없음' };
  const entries = [...feed.querySelectorAll('.ks-feed-entry')];
  return {
    avatarCount: feed.querySelectorAll('.ks-feed-avatar').length,
    entries: entries.map((entry) => ({
      innerLeft: rect(entry).left + parseFloat(getComputedStyle(entry).paddingLeft),
      contentLeft: rect(entry.querySelector('.ks-feed-content')).left,
    })),
  };
}"""

HOVER_JS = """(el) => {
  const rect = (node) => node.getBoundingClientRect();
  const entry = el.querySelector('.ks-feed-entry');
  if (!entry) return { error: '항목 없음' };
  const button = entry.querySelector('.ks-feed-meta-copy button');
  const control = button ? button.closest('.ks-feed-copy-control') : null;
  const meta = entry.querySelector('.ks-view-meta');
  const name = entry.querySelector('.ks-feed-name-line > strong');
  return {
    hasButton: Boolean(button),
    buttonLeft: button ? rect(button).left : null,
    buttonRight: button ? rect(button).right : null,
    metaLeft: meta ? rect(meta).left : null,
    nameRight: name ? rect(name).right : null,
    opacity: control ? getComputedStyle(control).opacity : null,
  };
}"""

THEME_JS = """(el) => {
  const input = el.querySelector('[placeholder="%s"]');
  const placeholder = input ? getComputedStyle(input, '::placeholder').color : null;
  const muted = getComputedStyle(document.documentElement).getPropertyValue('--ks-color-muted').trim();
  return { placeholder, muted };
}""" % PLACEHOLDER

NAME_COLOR_JS = """(el) => {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return [...el.querySelectorAll('.ks-feed-name-line > strong.has-color')].map((node) => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = style.color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return { text: node.textContent, color: style.color, rgb: [r, g, b], alpha: a, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
  });
}"""

PLACEHOLDER_SCROLL_JS = """(el, placeholder) => {
  const input = el.querySelector(`[placeholder="${placeholder}"]`);
  if (input) input.scrollIntoView({ block: 'center' });
}"""

OVERFLOW_JS = """(el) => {
  const rect = (node) => node.getBoundingClientRect();
  const width = window.innerWidth;
  const clipped = (node) => {
    for (let parent = node.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.overflowX !== 'visible') {
        const box = rect(parent);
        if (box.left >= -1 && box.right <= width + 1) return true;
      }
    }
    return false;
  };
  const bad = [];
  for (const node of el.querySelectorAll('*')) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity) === 0) continue;
    const box = rect(node);
    if (box.width <= 0 || box.height <= 0) continue;
    if ((box.left < -1 || box.right > width + 1) && !clipped(node)) {
      bad.push({ tag: node.tagName, cls: String(node.className).slice(0, 80), left: box.left, right: box.right });
    }
  }
  return {
    innerWidth: width,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bad: bad.slice(0, 10),
    badCount: bad.length,
  };
}"""


def parse_rgb(value):
    text = value.strip()
    match = re.match(r"rgba?\((\d+),\s*(\d+),\s*(\d+)", text)
    if match:
        return tuple(int(part) for part in match.groups())
    match = re.match(r"#([0-9a-f]{6})$", text, re.IGNORECASE)
    if match:
        digits = match.group(1)
        return tuple(int(digits[offset:offset + 2], 16) for offset in (0, 2, 4))
    raise ValueError(f"rgb가 아님: {value}")


def relative_luminance(rgb):
    channels = [channel / 255 for channel in rgb]
    linear = [channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast_ratio(foreground, background):
    a = relative_luminance(foreground)
    b = relative_luminance(background)
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


def screenshot_pixel(path, x, y, viewport_width):
    """캡처에서 CSS 좌표의 픽셀을 읽는다. 화면 배율이 1이 아니어도 같은 자리를 본다."""
    image = Image.open(io.BytesIO(path.read_bytes())).convert("RGB")
    scale = image.width / viewport_width
    px = min(max(round(x * scale), 0), image.width - 1)
    py = min(max(round(y * scale), 0), image.height - 1)
    return image.getpixel((px, py))


def wait_server(port):
    deadline = time.time() + 240
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}", timeout=5)
            return
        except Exception:
            time.sleep(2)
    raise SystemExit("하네스 서버가 뜨지 않았습니다")


def open_scene(page, port, ui, width, height):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{port}/?preview={APP_ID}")
    page.wait_for_function(
        "() => window.__ksHarness && document.querySelector('[data-testid=app-window-data-controls]')",
        timeout=120000,
    )
    page.evaluate(
        """async (layout) => {
          const harness = window.__ksHarness;
          const { snapshot } = await harness.call({ op: 'state.get' });
          const version = snapshot.shared.app_versions.find((v) => v.app_id === 'data-controls');
          version.definition.state = %s;
          version.definition.ui = layout;
          version.version += 1;
          const win = snapshot.shared.windows.find((w) => w.app_id === 'data-controls');
          win.app_version = version.version;
          win.state = %s;
          harness.emit({ event: 'state.changed', snapshot });
        }""" % (json.dumps(STATE), json.dumps(STATE)),
        ui,
    )
    page.add_style_tag(content=STYLE)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(300)
    return page.get_by_test_id(f"app-window-{APP_ID}")


def judge_gaps(measurement):
    gaps = [section.get("gap") for section in measurement.get("sections", [])]
    if len(gaps) != 3 or any(gap is None for gap in gaps):
        return {"section_gaps": False}
    return {"section_gaps": max(gaps) - min(gaps) <= TOLERANCE}


def judge_scene_d(measurement):
    sections = measurement.get("sections", [])
    gaps = [section.get("gap") for section in sections]
    centers = [abs(section["headTextCenterDelta"]) for section in sections if section.get("headTextCenterDelta") is not None]
    if len(gaps) != 3 or any(gap is None for gap in gaps) or not centers:
        return {"section_gaps": False, "group_head_center": False}
    return {
        "section_gaps": max(gaps) - min(gaps) <= TOLERANCE,
        "group_head_center": max(centers) <= TOLERANCE,
    }


def judge_metas(measurement):
    metas = measurement.get("metas", [])
    if not metas or any(meta.get("heading") is None for meta in metas):
        return {"meta_edges": False}
    worst = max(abs(meta["right"] - meta["heading"]) for meta in metas)
    return {"meta_edges": worst <= TOLERANCE}


def judge_contents(measurement):
    contents = measurement.get("contents", [])
    if not contents:
        return {"content_left": False}
    return {"content_left": max(contents) - min(contents) <= TOLERANCE}


def judge_scene_c(measurement):
    entries = measurement.get("entries", [])
    if not entries:
        return {"no_avatar": False, "content_at_feed_edge": False}
    return {
        "no_avatar": measurement.get("avatarCount") == 0,
        "content_at_feed_edge": all(abs(entry["contentLeft"] - entry["innerLeft"]) <= TOLERANCE for entry in entries),
    }


def judge_hover(measurement):
    if not measurement.get("hasButton"):
        return {"copy_left_of_meta": False, "copy_clear_of_name": False, "copy_visible": False}
    return {
        "copy_left_of_meta": measurement["buttonRight"] <= measurement["metaLeft"] + TOLERANCE,
        "copy_clear_of_name": measurement["nameRight"] <= measurement["buttonLeft"] + TOLERANCE,
        "copy_visible": measurement.get("opacity") == "1",
    }


def judge_overflow(measurement):
    return {
        "no_document_overflow": measurement.get("scrollWidth", 0) <= measurement.get("clientWidth", 0) + 1,
        "no_visible_overflow": measurement.get("badCount") == 0,
    }


def judge_placeholder(measurement):
    try:
        return {"placeholder": parse_rgb(measurement.get("placeholder") or "") == parse_rgb(measurement.get("muted") or "")}
    except ValueError:
        return {"placeholder": False}


def judge_contrast(theme, measurement, screenshot, viewport_width):
    """이름 색과 화면 바탕 픽셀, 쉘 창 바탕 기준값의 WCAG 대비를 잰다. 둘 다 4.5 이상이어야 한다."""
    by_text = {item["text"]: item for item in measurement}
    reference = REFERENCE_BACKGROUND[theme]
    checks = {}
    details = {}
    for text, _ in COLOR_NAMES:
        item = by_text.get(text)
        if item is None or item.get("alpha") != 255:
            checks[f"contrast_{text}"] = False
            details[text] = {"missing": True}
            continue
        drawn = tuple(item["rgb"])
        background = screenshot_pixel(screenshot, item["right"] + 8, (item["top"] + item["bottom"]) / 2, viewport_width)
        scene = contrast_ratio(drawn, background)
        fixed = contrast_ratio(drawn, reference)
        checks[f"contrast_{text}"] = scene >= 4.5 and fixed >= 4.5
        details[text] = {
            "color": item["color"],
            "drawn_srgb": list(drawn),
            "scene_background": list(background),
            "reference_background": list(reference),
            "contrast_scene": round(scene, 2),
            "contrast_reference": round(fixed, 2),
        }
    return checks, details


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="target/visual-check/feed-alignment")
    parser.add_argument("--port", type=int, default=5394)
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
    scenes = {}
    failures = []
    try:
        wait_server(args.port)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_page()

            def record(key, measurement, checks):
                scenes[key] = {"measurement": measurement, "checks": checks}
                failed = [check for check, ok in checks.items() if not ok]
                failures.extend(f"{key}.{check}" for check in failed)
                print(key, measurement, "FAIL " + ",".join(failed) if failed else "ok")

            for name in ("A", "B", "C"):
                for width, height in SIZES:
                    app = open_scene(page, args.port, SCENES[name], width, height)
                    for state in ("default", "hover"):
                        if state == "hover":
                            if width < 1000:
                                continue
                            page.locator(f'[data-testid=app-window-{APP_ID}] .ks-feed-entry').first.hover()
                            page.wait_for_timeout(150)
                        key = f"{name}-{width}x{height}-{state}"
                        page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                        checks = {}
                        if name == "C":
                            measurement = app.evaluate(SCENE_C_JS)
                            checks.update(judge_scene_c(measurement))
                        else:
                            measurement = app.evaluate(FEED_META_JS)
                            checks.update(judge_contents(measurement))
                            if width >= 1000:
                                checks.update(judge_metas(measurement))
                        if name == "A" and state == "default":
                            gap_measurement = app.evaluate(SECTION_GAP_JS)
                            measurement = {**measurement, "sections": gap_measurement["sections"]}
                            checks.update(judge_gaps(gap_measurement))
                        if state == "hover":
                            hover_measurement = app.evaluate(HOVER_JS)
                            measurement = {**measurement, "hover": hover_measurement}
                            checks.update(judge_hover(hover_measurement))
                            page.mouse.move(0, 0)
                        if width < 1000 and state == "default":
                            overflow = app.evaluate(OVERFLOW_JS)
                            measurement = {**measurement, "overflow": overflow}
                            checks.update(judge_overflow(overflow))
                        record(key, measurement, checks)

            for width, height in SIZES:
                app = open_scene(page, args.port, SCENES["D"], width, height)
                key = f"D-{width}x{height}"
                page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                gap_measurement = app.evaluate(SCENE_D_GAP_JS)
                record(key, gap_measurement, judge_scene_d(gap_measurement))

            for name in ("A", "B", "C"):
                for width, height in SIZES:
                    if width >= 1000:
                        continue
                    app = open_scene(page, args.port, SCENES[name], width, height)
                    key = f"{name}-{width}x{height}-overflow"
                    overflow = app.evaluate(OVERFLOW_JS)
                    page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                    record(key, overflow, judge_overflow(overflow))

            app = open_scene(page, args.port, SCENES["P"], 1440, 880)
            for theme in ("light", "dark"):
                page.emulate_media(color_scheme=theme)
                page.wait_for_timeout(300)
                measurement = app.evaluate(THEME_JS)
                app.evaluate(PLACEHOLDER_SCROLL_JS, PLACEHOLDER)
                page.wait_for_timeout(200)
                key = f"P-1440x880-{theme}"
                page.screenshot(path=str(output / f"{key}-placeholder.png"), animations="disabled")
                record(key, measurement, judge_placeholder(measurement))

            for theme in ("light", "dark"):
                page.emulate_media(color_scheme=theme)
                app = open_scene(page, args.port, SCENES["N"], 1440, 880)
                page.wait_for_timeout(300)
                key = f"N-1440x880-{theme}"
                screenshot = output / f"{key}.png"
                page.screenshot(path=str(screenshot), animations="disabled")
                checks, details = judge_contrast(theme, app.evaluate(NAME_COLOR_JS), screenshot, 1440)
                record(key, {"names": details}, checks)
            page.emulate_media(color_scheme="light")

            app = open_scene(page, args.port, SCENES["A"], 1440, 880)
            page.set_viewport_size({"width": 360, "height": 700})
            page.wait_for_timeout(400)
            narrow = {"metas": app.evaluate(FEED_META_JS), "overflow": app.evaluate(OVERFLOW_JS)}
            page.screenshot(path=str(output / "A-resize-360x700.png"), animations="disabled")
            page.set_viewport_size({"width": 1440, "height": 880})
            page.wait_for_timeout(400)
            wide = {"metas": app.evaluate(FEED_META_JS), "sections": app.evaluate(SECTION_GAP_JS)["sections"]}
            page.screenshot(path=str(output / "A-resize-1440x880.png"), animations="disabled")
            checks = {}
            checks.update({f"narrow.{name}": ok for name, ok in judge_contents(narrow["metas"]).items()})
            checks.update({f"narrow.{name}": ok for name, ok in judge_overflow(narrow["overflow"]).items()})
            checks.update({f"wide.{name}": ok for name, ok in judge_metas(wide["metas"]).items()})
            checks.update({f"wide.{name}": ok for name, ok in judge_gaps({"sections": wide["sections"]}).items()})
            record("A-resize", {"narrow": narrow, "wide": wide}, checks)
            browser.close()
    finally:
        server.stdin.close()
        try:
            server.wait(timeout=20)
        except subprocess.TimeoutExpired:
            server.kill()

    result = {"ok": not failures, "failures": failures, "scenes": scenes}
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print("RESULT", "ok" if not failures else f"{len(failures)} failures", output / "result.json")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
