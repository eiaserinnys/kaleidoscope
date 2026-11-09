#!/usr/bin/env python3
"""채움 목록 뒤의 맨 끝 글과 스크롤 밖 고정 결정 줄 꼬리가 창 바닥에서 떠 있는지 확인한다.

구역을 품은 채움 목록 뒤의 맨 끝 글은 --ks-space-3(12px)만큼, 스크롤 밖 고정 결정 줄
꼬리(단추 하나, 단추 여럿인 줄, 닻으로 감싼 단추)도 같은 12px만큼 바닥에서 떠야 한다.
gap none에서 라벨 없는 입력은 결정 줄 단추와 12px 떨어진다. 도구 막대 꼬리는 자기
안쪽 여백(8px)을 그대로 쓰고, 구역·탭·대화상자 안 꼬리는 그쪽이 끝 여백을 소유하므로
꼬리 칸 자체에는 여백이 붙지 않는다.

  python3 scripts/visual-check/check_stack_end_space.py [--output 산출폴더] [--port 포트]

중립 미리보기 ?preview=data-controls에 장면 정의를 주입하고 1180×720과 360×240에서
기본 상태와 스크롤 끝 상태를 잰다. 실제 개인 앱 정의는 쓰지 않는다. 기본 산출 폴더는
target/visual-check/stack-end-space 이고, 서버는 이 체크아웃의 ui/harness/e2e-server.mjs를
KS_E2E_PORT로 띄운다.

판정이 하나라도 어긋나면 result.json과 캡처를 남긴 뒤 종료 코드 1로 끝난다.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
APP_ID = "data-controls"
STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"
SIZES = ((1180, 720), (360, 240))
TOLERANCE = 1.0
TOOLBAR_TAIL_GAP = 8.0

rows = [{"key": str(i), "name": f"항목 {i + 1}"} for i in range(12)]
item_list = {
    "type": "repeat", "items": rows, "key": "key", "layout": "grid",
    "grid": {"columns": "auto", "item_width": "large"}, "gap": "large",
    "template": {"type": "section", "title": {"item": "name"}, "child": {"type": "text", "value": "한 줄"}},
}
toolbar = {"type": "toolbar", "start": [{"type": "text", "value": "받은 항목"}]}
input_ = {"type": "input", "value": {"state": "value"}, "on_change": [], "placeholder": "메모"}
labeled_input = {"type": "input", "label": "메모", "value": {"state": "value"}, "on_change": []}
button = {"type": "button", "label": "보내기", "on_click": []}
text = {"type": "text", "value": "맨 끝 글"}
reproduction = {"type": "stack", "direction": "column", "gap": "small", "fill": 1, "children": [toolbar, item_list, input_]}
action_small = {**reproduction, "children": [toolbar, item_list, input_, button]}
action_none = {**action_small, "gap": "none"}
labeled_none = {**action_none, "children": [toolbar, item_list, labeled_input, button]}
action_row = {
    **reproduction,
    "children": [toolbar, item_list, input_, {
        "type": "stack", "direction": "row", "gap": "small",
        "children": [{"type": "button", "label": "취소", "on_click": []}, button],
    }],
}

# (이름, 정의, 판정 종류, 입력과 단추 사이를 함께 재는지)
SCENES = [
    ("text-end", {**reproduction, "children": [toolbar, item_list, text]}, "text", False),
    ("action-small", action_small, "tail", False),
    ("action-none", action_none, "tail", True),
    ("labeled-none", labeled_none, "tail", True),
    ("row-small", action_row, "tail", False),
    ("toolbar-tail", {**reproduction, "children": [toolbar, item_list, input_, {"type": "toolbar", "start": [], "end": [button]}]}, "toolbar", False),
    ("section", {"type": "section", "title": "받은 항목", "child": action_small}, "context", False),
    ("tab", {"type": "tabs", "tabs": [{"label": "탭", "child": action_small}]}, "context", False),
    ("dialog", {"type": "dialog", "title": "대화", "open": True, "on_close": [], "child": action_small}, "context", False),
]

TAIL_SPACE_JS = """(el) => {
  const stacks = [...el.querySelectorAll('.ks-data-stack.has-action-tail.is-column')];
  const tails = stacks.map((stack) => stack.lastElementChild).filter((item) =>
    item instanceof HTMLElement && item.classList.contains('ks-data-stack-item')
    && !item.classList.contains('ks-stack-scroll') && item.querySelector('button') !== null);
  const tail = tails[tails.length - 1];
  if (!tail) return { error: '결정 줄 꼬리를 찾지 못했습니다' };
  const stack = tail.parentElement;
  const button = [...tail.querySelectorAll('button')]
    .filter((node) => node.getBoundingClientRect().height > 0)
    .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
  const inputEl = el.querySelector('.ks-data-window-body input');
  const rect = (node) => node.getBoundingClientRect();
  return {
    tailPadding: parseFloat(getComputedStyle(tail).paddingBottom),
    tailToStack: rect(stack).bottom - rect(tail).bottom,
    buttonToStack: rect(stack).bottom - rect(button).bottom,
    inputToButton: inputEl ? rect(button).top - rect(inputEl).bottom : null,
    stackHasActionTail: stack.classList.contains('has-action-tail'),
    space: parseFloat(getComputedStyle(stack).getPropertyValue('--ks-space-3')),
  };
}"""

TEXT_END_SPACE_JS = """(el) => {
  const body = el.querySelector('.ks-data-window-body');
  const root = body.firstElementChild;
  const textEl = root.lastElementChild.querySelector('.ks-data-text');
  const padding = parseFloat(getComputedStyle(textEl).paddingBottom);
  return {
    scrollCount: root.querySelectorAll(':scope > .ks-stack-scroll').length,
    padding,
    contentToBody: body.getBoundingClientRect().bottom - textEl.getBoundingClientRect().bottom + padding,
    space: parseFloat(getComputedStyle(root).getPropertyValue('--ks-space-3')),
  };
}"""

SCROLL_END_JS = """() => {
  for (const node of document.querySelectorAll('.ks-data-window-body, .ks-stack-scroll, .ks-data-stack-item.is-fill')) {
    node.scrollTop = node.scrollHeight;
  }
}"""


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
          version.definition.state = { value: '', on: true, dialogOpen: false };
          version.definition.ui = layout;
          version.version += 1;
          const win = snapshot.shared.windows.find((w) => w.app_id === 'data-controls');
          win.app_version = version.version;
          win.state = { value: '', on: true, dialogOpen: false };
          harness.emit({ event: 'state.changed', snapshot });
        }""",
        ui,
    )
    page.add_style_tag(content=STYLE)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(300)
    return page.get_by_test_id(f"app-window-{APP_ID}")


def judge(kind, measurement, input_gap):
    checks = {}
    space = measurement.get("space")
    if kind == "text":
        checks["no_scroll"] = measurement.get("scrollCount") == 0
        checks["end_padding"] = abs(measurement.get("padding", 0) - space) <= TOLERANCE
        checks["content_to_body"] = abs(measurement.get("contentToBody", 0) - space) <= TOLERANCE
    elif kind == "toolbar":
        checks["stack_has_action_tail"] = measurement.get("stackHasActionTail") is True
        checks["tail_padding_zero"] = measurement.get("tailPadding") == 0
        checks["button_to_stack"] = abs(measurement.get("buttonToStack", 0) - TOOLBAR_TAIL_GAP) <= TOLERANCE
    elif kind == "context":
        checks["tail_padding_zero"] = measurement.get("tailPadding") == 0
    else:
        checks["stack_has_action_tail"] = measurement.get("stackHasActionTail") is True
        checks["tail_padding"] = abs(measurement.get("tailPadding", 0) - space) <= TOLERANCE
        checks["button_to_stack"] = abs(measurement.get("buttonToStack", 0) - space) <= TOLERANCE
        if input_gap:
            value = measurement.get("inputToButton")
            checks["input_to_button"] = value is not None and abs(value - space) <= TOLERANCE
    return checks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="target/visual-check/stack-end-space")
    parser.add_argument("--port", type=int, default=5393)
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
            for name, ui, kind, input_gap in SCENES:
                for width, height in SIZES:
                    app = open_scene(page, args.port, ui, width, height)
                    for state in ("default", "end"):
                        if state == "end":
                            page.evaluate(SCROLL_END_JS)
                        measurement = app.evaluate(TEXT_END_SPACE_JS if kind == "text" else TAIL_SPACE_JS)
                        key = f"{name}-{width}x{height}-{state}"
                        page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                        checks = judge(kind, measurement, input_gap)
                        scenes[key] = {"measurement": measurement, "checks": checks}
                        failed = [check for check, ok in checks.items() if not ok]
                        failures.extend(f"{key}.{check}" for check in failed)
                        print(key, measurement, "FAIL " + ",".join(failed) if failed else "ok")
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
