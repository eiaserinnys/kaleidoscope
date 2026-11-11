#!/usr/bin/env python3
"""feed 블록의 구역 안 첫 내용 간격, 메타 오른쪽 끝선, 초상 없는 줄의 글 시작선을 확인한다.

장면 A는 코르크시트 상세와 같은 꼴이다. split(row)의 오른쪽 칸 stack 안에 구역 셋을 두고,
「대사」 구역의 feed는 묶음 둘에 항목 여섯(초상 둘, 초상 없음 넷)을 둔다. 장면 B는 같은
feed를 split 칸에 바로 두고, 장면 C는 초상이 하나도 없는 feed다. 이름 색은 밝기 한계 안으로
묶이는지, 입력 자리 글은 --ks-color-muted인지도 밝은 테마와 어두운 테마에서 잰다.

  python3 scripts/visual-check/check_feed_alignment.py [--output 산출폴더] [--port 포트]

중립 미리보기 ?preview=data-controls에 장면 정의를 주입하고 1440×880과 360×700에서 잰다.
실제 개인 앱 정의와 회사 대사 원문은 쓰지 않는다. 기본 산출 폴더는
target/visual-check/feed-alignment 이고, 서버는 이 체크아웃의 ui/harness/e2e-server.mjs를
KS_E2E_PORT로 띄운다.

판정이 하나라도 어긋나면 result.json과 캡처를 남긴 뒤 종료 코드 1로 끝난다.
"""
import argparse
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
APP_ID = "data-controls"
STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"
SIZES = ((1440, 880), (360, 700))
TOLERANCE = 1.0
PORTRAIT = {"permission": "media", "path": "landscape.png"}
COLORED_NAMES = (("갈릴리엘", "#eff0f0"), ("화자 둘", "#5b6fd6"))
PLACEHOLDER = "댓글을 남겨 보세요"
STATE = {"note": "", "note2": "", "comment": ""}


def feed(avatars=True):
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

    return {
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


CARDS = {"type": "section", "title": "카드", "child": {"type": "stack", "direction": "column", "gap": "small", "children": [
    {"type": "input", "label": "제목", "label_position": "top", "value": {"state": "note"}, "on_change": {"set_state": "note"}},
    {"type": "input", "label": "부제", "label_position": "top", "value": {"state": "note2"}, "on_change": {"set_state": "note2"}},
]}}


def dialogue_section(avatars=True):
    return {"type": "section", "title": "대사", "child": feed(avatars)}


COMMENTS = {"type": "section", "title": "댓글", "child": {"type": "input", "label": "댓글", "label_position": "top", "multiline": True, "placeholder": PLACEHOLDER, "value": {"state": "comment"}, "on_change": {"set_state": "comment"}}}


def detail_layout(avatars=True):
    return {"type": "split", "direction": "row", "sizes": [70, 30], "children": [
        {"type": "text", "value": "왼쪽 칸"},
        {"type": "stack", "direction": "column", "gap": "medium", "children": [
            CARDS, dialogue_section(avatars), COMMENTS,
        ]},
    ]}


def pane_layout(avatars=True):
    return {"type": "split", "direction": "row", "sizes": [70, 30], "children": [
        {"type": "text", "value": "왼쪽 칸"},
        feed(avatars),
    ]}


SCENES = {
    "A": detail_layout(True),
    "B": pane_layout(True),
    "C": detail_layout(False),
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
  const named = [...el.querySelectorAll('.ks-feed-name-line > strong.has-color')].map((node) => ({
    text: node.textContent,
    color: getComputedStyle(node).color,
  }));
  const input = el.querySelector('[placeholder="%s"]');
  const placeholder = input ? getComputedStyle(input, '::placeholder').color : null;
  const muted = getComputedStyle(document.documentElement).getPropertyValue('--ks-color-muted').trim();
  return { named, placeholder, muted };
}""" % PLACEHOLDER

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


def parse_color(value):
    """getComputedStyle 색을 OKLCH 밝기(L)로 바꾼다."""
    if value is None:
        raise ValueError("색 없음")
    text = value.strip()
    match = re.match(r"oklch\(\s*([0-9.]+)", text)
    if match:
        return float(match.group(1))
    match = re.match(r"rgb\((\d+),\s*(\d+),\s*(\d+)", text)
    if match:
        channels = [int(part) / 255 for part in match.groups()]
    else:
        match = re.match(r"rgba\((\d+),\s*(\d+),\s*(\d+)", text)
        if not match:
            raise ValueError(f"읽을 수 없는 색: {text}")
        channels = [int(part) / 255 for part in match.groups()[:3]]
    linear = [channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in channels]
    l = 0.4122214708 * linear[0] + 0.5363325363 * linear[1] + 0.0514459929 * linear[2]
    m = 0.2119034982 * linear[0] + 0.6806995451 * linear[1] + 0.1073969566 * linear[2]
    s = 0.0883024619 * linear[0] + 0.2817188376 * linear[1] + 0.6299787005 * linear[2]
    l_, m_, s_ = (math.copysign(abs(part) ** (1 / 3), part) for part in (l, m, s))
    return 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_


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


def judge_theme(theme, measurement, muted_expected):
    checks = {}
    limit = 0.541 if theme == "light" else 0.699
    named = {item["text"]: item["color"] for item in measurement.get("named", [])}
    for text, _ in COLORED_NAMES:
        value = named.get(text)
        if value is None:
            checks[f"name_{text}"] = False
            continue
        lightness = parse_color(value)
        checks[f"name_{text}"] = lightness <= limit if theme == "light" else lightness >= limit
    try:
        checks["placeholder"] = parse_rgb(measurement.get("placeholder") or "") == parse_rgb(muted_expected)
    except ValueError:
        checks["placeholder"] = False
    return checks


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

            for name in ("A", "B", "C"):
                for width, height in SIZES:
                    if width >= 1000:
                        continue
                    app = open_scene(page, args.port, SCENES[name], width, height)
                    key = f"{name}-{width}x{height}-overflow"
                    overflow = app.evaluate(OVERFLOW_JS)
                    page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                    record(key, overflow, judge_overflow(overflow))

            app = open_scene(page, args.port, SCENES["A"], 1440, 880)
            for theme in ("light", "dark"):
                page.emulate_media(color_scheme=theme)
                page.wait_for_timeout(300)
                measurement = app.evaluate(THEME_JS)
                checks = judge_theme(theme, measurement, measurement.get("muted", ""))
                key = f"A-1440x880-{theme}"
                page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                record(key, measurement, checks)
                app.locator(f'[placeholder="{PLACEHOLDER}"]').scroll_into_view_if_needed()
                page.wait_for_timeout(200)
                page.screenshot(path=str(output / f"{key}-placeholder.png"), animations="disabled")
                app.locator(".ks-feed").scroll_into_view_if_needed()
                page.wait_for_timeout(200)
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
