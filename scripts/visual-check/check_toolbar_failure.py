#!/usr/bin/env python3
"""도구 막대 안 실패 표시가 막대 한 줄 안에 서는지 검수한다.

카드 #1139. toolbar의 start에 실패하는 text와 select, end에 단추 하나, toolbar 아래에
같은 원천을 쓰는 실패 블록 하나(막대 밖 불변 대조용)를 놓은 기존 장면(mixed)과,
세라피엘 반려 장면 넷(short-message, login-required, end-failure, narrow-single)을 잰다.

기존 장면의 판정:
  1. toolbar 높이가 --ks-bar-height 그대로이고 위아래로 넘치지 않는다.
  2. toolbar 자손의 아래 끝이 toolbar 아래 끝을 1px 넘게 넘지 않는다.
  3. toolbar 안 실패 표시는 compact(한 줄)로 서고, 문구는 한 줄 말줄임이며
     전체 문구가 실패 묶음 뿌리(ks-data-state-compact)의 title에 있다.
  4. 에러코드와 「다시 받기」 단추는 잘리지 않고 보이며, 누르면 data.refresh로 다시 받는다.
  5. toolbar 밖 실패 표시는 compact가 아니고 문구 span 없이 지금 마크업 그대로다.
  6. 좁은 폭에서 toolbar가로 스크롤은 계약대로 허용하되, 세로로는 넘치지 않는다.
  7. 창 폭을 1180에서 360으로 바꿔도 같은 줄이 유지된다(§0 18).
  8. Tab이 toolbar 안 보이는 요소로 새지 않고, Esc로 열리는 것이 없다(§0 15).
  9. 「다시 받기」를 누른 뒤 초점이 어디로 가는지 기록한다(§0 14).

모든 장면에 더하는 판정:
  10. 실패 묶음 안 이웃 요소(아이콘, 문구, 코드, 「다시 받기」나 「로그인」) 사이 간격이
      각각 var(--ks-space-2) 이하이고 겹치지 않는다.
  11. 문구 span의 clientWidth가 calc(3 * var(--ks-space-6))의 계산값 이상이거나,
      글 전체가 보인다(가로와 세로 모두 넘치지 않는다. line-clamp로 잘린 글은 세로로 넘친다).
  12. 아이콘 가운데와 코드 가운데에서 elementFromPoint로 짚고 조상으로 올라가면
      title이 전체 문구인 요소가 잡힌다.

말줄임 빈자리 장면(ellipsis-gap-mixed, ellipsis-gap-end-failure, ellipsis-gap-narrow-single):
  13. 실패를 띄운 창을 1180에서 560까지 20px씩 줄여 가며(narrow-single은 360 하나) 캡처 픽셀로
      문구 상자 안 마지막 글자(「…」 포함)의 오른쪽 끝을 찾고, 그 뒤 빈자리가
      var(--ks-type-body) 이하인지 잰다. 낱말 경계에서 끊으면 다음 낱말 폭만큼 빈자리가 남아
      에러코드가 문구에서 떨어져 보인다.

  python3 -P scripts/visual-check/check_toolbar_failure.py --output target/visual-check/toolbar-failure/after3 [--port 포트]

중립 미리보기 ?preview=data-views-test에 장면 정의를 주입하고, 실패는 기존 E2E
(ui/e2e/data-state-layout.spec.ts)와 같이 data.update로 실패한 바인딩 값을 넣어 만든다.
서버는 이 체크아웃의 ui/harness/e2e-server.mjs를 KS_E2E_PORT로 띄운다.

판정이 하나라도 어긋나면 result.json과 캡처를 남긴 뒤 종료 코드 1로 끝난다.
"""
import argparse
import io
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
APP_ID = "data-views-test"
WINDOW_ID = "views-window"
STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"
TOLERANCE = 1.0
CODE = "SHELL_DATA_SOURCE_FAILED"
LONG_MESSAGE = "받지 못했습니다. 서버가 응답하지 않아 작업 목록을 불러오지 못했습니다. 네트워크 연결을 확인하고 잠시 뒤 다시 시도하세요. 계속 실패하면 설정에서 연결을 다시 승인하세요."
SHORT_MESSAGE = "작업 목록을 받지 못했습니다."
LOGIN_MESSAGE = "로그인이 필요합니다"
RETRY = ["sample"]


def failed(message):
    return {"status": "failed", "id": CODE, "message": message, "retry": RETRY}


def toolbar(start, end):
    return {"type": "stack", "direction": "column", "gap": "medium", "children": [
        {"type": "toolbar", "start": start, "end": end},
        {"type": "text", "value": "본문"},
    ]}


SCENES = {
    # 기존 장면. start의 실패 text와 select, end 단추, 막대 밖 실패 블록 하나.
    "mixed": {
        "scene": {"type": "stack", "direction": "column", "gap": "medium", "children": [
            {"type": "toolbar", "start": [
                {"type": "text", "value": {"expr": "$data.sample.message"}},
                {"type": "select", "value": {"state": "choice"}, "on_change": {"set_state": "choice"}, "options": {"expr": "$data.sample.message"}},
            ], "end": [{"type": "button", "label": "적용", "on_click": []}]},
            {"type": "text", "value": {"expr": "$data.sample.message"}},
        ]},
        "state": {"choice": ""},
        "pointers": {
            "/ui/children/0/start/0/value": failed(LONG_MESSAGE),
            "/ui/children/0/start/1/options": failed(LONG_MESSAGE),
            "/ui/children/1/value": failed(LONG_MESSAGE),
        },
        "messages": [LONG_MESSAGE, LONG_MESSAGE],
        "codes": 2,
        "retries": 2,
        "outside": True,
        "sizes": ((1180, 720), (360, 240)),
    },
    # 1. 시작 무리에 실패하는 text 하나(짧은 문구), 끝 무리에 「새로 고침」 단추, 1180×720.
    "short-message": {
        "scene": toolbar(
            [{"type": "text", "value": {"expr": "$data.sample.message"}}],
            [{"type": "button", "label": "새로 고침", "on_click": []}],
        ),
        "state": {},
        "pointers": {"/ui/children/0/start/0/value": failed(SHORT_MESSAGE)},
        "messages": [SHORT_MESSAGE],
        "codes": 1,
        "retries": 1,
        "outside": False,
        "sizes": ((1180, 720),),
    },
    # 2. 같은 자리에 login_required, 1180×720.
    "login-required": {
        "scene": toolbar(
            [{"type": "text", "value": {"expr": "$data.sample.message"}}],
            [{"type": "button", "label": "새로 고침", "on_click": []}],
        ),
        "state": {},
        "pointers": {"/ui/children/0/start/0/value": {"status": "login_required", "permission": "remote"}},
        "messages": [LOGIN_MESSAGE],
        "codes": 0,
        "retries": 0,
        "outside": False,
        "sizes": ((1180, 720),),
    },
    # 3. 시작 무리에 「목록」 단추, 끝 무리에 실패하는 text와 「새로 고침」, 1180×720.
    "end-failure": {
        "scene": toolbar(
            [{"type": "button", "label": "목록", "on_click": []}],
            [
                {"type": "text", "value": {"expr": "$data.sample.message"}},
                {"type": "button", "label": "새로 고침", "on_click": []},
            ],
        ),
        "state": {},
        "pointers": {"/ui/children/0/end/0/value": failed(LONG_MESSAGE)},
        "messages": [LONG_MESSAGE],
        "codes": 1,
        "retries": 1,
        "outside": False,
        "sizes": ((1180, 720),),
    },
    # 4. 360 폭 단일 실패: 실패 하나와 끝 단추 하나, 360×240.
    "narrow-single": {
        "scene": toolbar(
            [{"type": "text", "value": {"expr": "$data.sample.message"}}],
            [{"type": "button", "label": "새로 고침", "on_click": []}],
        ),
        "state": {},
        "pointers": {"/ui/children/0/start/0/value": failed(LONG_MESSAGE)},
        "messages": [LONG_MESSAGE],
        "codes": 1,
        "retries": 1,
        "outside": False,
        "sizes": ((360, 240),),
    },
}

MEASURE_JS = """() => {
  const app = document.querySelector('[data-testid="app-window-data-views-test"]');
  if (!app) return { error: '앱 창을 찾지 못했습니다' };
  const toolbar = app.querySelector('.ks-data-toolbar');
  if (!toolbar) return { error: '도구 막대를 찾지 못했습니다' };
  const rect = (node) => node.getBoundingClientRect();
  const cls = (node) => typeof node.className === 'string' ? node.className : (node.getAttribute('class') || '');
  const bar = rect(toolbar);
  const cs = getComputedStyle(toolbar);
  // 토큰은 calc() 문자열이라 그대로는 수로 못 읽는다. 같은 토큰을 쓰는 숨은 상자로 계산값을 잰다.
  const probe = (value) => {
    const node = document.createElement('div');
    node.style.cssText = `position: absolute; visibility: hidden; width: ${value}; height: 0;`;
    toolbar.appendChild(node);
    const width = rect(node).width;
    node.remove();
    return width;
  };
  const barExpected = probe('var(--ks-bar-height)');
  const space2 = probe('var(--ks-space-2)');
  const minMessage = probe('calc(3 * var(--ks-space-6))');
  const typeBody = probe('var(--ks-type-body)');
  const descendants = [...toolbar.querySelectorAll('*')].map((node) => ({ cls: cls(node), bottom: rect(node).bottom, height: rect(node).height, width: rect(node).width }));
  // 시작 무리와 종단 무리의 그려진 상자가 겹치면 좁은 폭에서 코드나 단추가 가려진다.
  const groupRects = (selector) => {
    const group = toolbar.querySelector(selector);
    return group ? [rect(group), ...[...group.querySelectorAll('*')].map(rect)] : [];
  };
  const startRects = groupRects(':scope > .ks-data-toolbar-group.is-start');
  const endRects = groupRects(':scope > .ks-data-toolbar-group.is-end');
  const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const titleOf = (node) => {
    let el = node;
    while (el && el !== document.body) {
      if (el.getAttribute && el.getAttribute('title')) return el.getAttribute('title');
      el = el.parentElement;
    }
    return null;
  };
  const hitTitle = (node) => {
    if (!node) return null;
    let box = rect(node);
    if (box.width < 1 || box.height < 1) return null;
    // 계약대로 막대가 가로로 스크롤되면 화면 밖 요소는 짚을 수 없다. 그 요소가 보이도록 잠깐 스크롤했다가 되돌린다.
    const originalScroll = toolbar.scrollLeft;
    if (box.left + box.width / 2 < bar.left || box.left + box.width / 2 > bar.right) {
      toolbar.scrollLeft += box.left + box.width / 2 - (bar.left + bar.width / 2);
      box = rect(node);
    }
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const title = titleOf(hit);
    toolbar.scrollLeft = originalScroll;
    return title;
  };
  const box = (node) => ({ width: rect(node).width, height: rect(node).height, left: rect(node).left, right: rect(node).right, bottom: rect(node).bottom });
  const states = [...toolbar.querySelectorAll('.ks-data-state-compact')].map((state) => {
    const icon = state.querySelector('.ks-empty-state-icon');
    const message = state.querySelector('.ks-data-state-message');
    const code = state.querySelector('.ks-error-id');
    const action = state.querySelector('.ks-empty-state-action');
    const parts = [['icon', icon], ['message', message], ['code', code], ['action', action]].filter(([, node]) => node);
    const gaps = [];
    for (let index = 1; index < parts.length; index += 1) {
      const [from, previous] = parts[index - 1];
      const [to, node] = parts[index];
      gaps.push({ from, to, gap: rect(node).left - rect(previous).right });
    }
    const style = message ? getComputedStyle(message) : null;
    return {
      title: state.getAttribute('title'),
      width: rect(state).width,
      gaps,
      message: message ? {
        text: message.textContent, clientWidth: message.clientWidth, scrollWidth: message.scrollWidth,
        clientHeight: message.clientHeight, scrollHeight: message.scrollHeight,
        lineClamp: style.webkitLineClamp || style.WebkitLineClamp, lineHeight: parseFloat(style.lineHeight),
        whiteSpace: style.whiteSpace, contain: style.contain,
      } : null,
      code: code ? { text: code.textContent.trim(), ...box(code) } : null,
      action: action ? { text: (action.textContent || '').trim(), ...box(action) } : null,
      iconTitle: hitTitle(icon),
      codeTitle: hitTitle(code),
      iconWidth: icon ? rect(icon).width : 0,
      iconHeight: icon ? rect(icon).height : 0,
    };
  });
  const ids = [...toolbar.querySelectorAll('.ks-error-id')].map((node) => ({ text: node.textContent, ...box(node) }));
  const buttons = [...toolbar.querySelectorAll('button')].map((node) => ({ text: node.textContent.trim(), ...box(node) }));
  const outside = app.querySelector('.ks-data-stack > .ks-data-stack-item:nth-child(2) .ks-data-state');
  const outsideInfo = outside ? {
    compact: outside.classList.contains('ks-data-state-compact'),
    messageSpans: outside.querySelectorAll('.ks-data-state-message').length,
    text: outside.querySelector('.ks-empty-state-text') ? outside.querySelector('.ks-empty-state-text').textContent : null,
    ids: [...outside.querySelectorAll('.ks-error-id')].map((node) => node.textContent),
    iconWidth: outside.querySelector('.ks-empty-state-icon') ? rect(outside.querySelector('.ks-empty-state-icon')).width : 0,
  } : null;
  return {
    bar: { width: bar.width, height: bar.height, left: bar.left, right: bar.right, bottom: bar.bottom, scrollWidth: toolbar.scrollWidth, clientWidth: toolbar.clientWidth, scrollHeight: toolbar.scrollHeight, clientHeight: toolbar.clientHeight,
      barToken: cs.getPropertyValue('--ks-bar-height').trim(), controlToken: cs.getPropertyValue('--ks-control-height').trim(), expected: barExpected },
    space2, minMessage, typeBody,
    maxDescendantBottom: Math.max(bar.top, ...descendants.map((item) => item.bottom)),
    compactCount: toolbar.querySelectorAll('.ks-data-state-compact').length,
    stateCount: toolbar.querySelectorAll('.ks-data-state').length,
    messages: states.map((state) => state.message).filter(Boolean),
    states, ids, buttons,
    groups: { start: startRects.length, end: endRects.length, overlap: startRects.some((a) => endRects.some((b) => overlap(a, b))) },
    messageSpanCount: app.querySelectorAll('.ks-data-state-message').length,
    outside: outsideInfo,
  };
}"""

FOCUS_JS = """() => {
  const active = document.activeElement;
  if (!active || active === document.body) return { tag: 'BODY', inToolbar: false };
  const rect = active.getBoundingClientRect();
  return {
    tag: active.tagName,
    text: (active.textContent || '').trim(),
    ariaLabel: active.getAttribute('aria-label'),
    inToolbar: Boolean(active.closest('.ks-data-toolbar')),
    width: rect.width, height: rect.height,
  };
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


def open_scene(page, port, width, height, scene, app_state):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{port}/?preview={APP_ID}")
    page.wait_for_function("(id) => window.__ksHarness && document.querySelector(`[data-testid=app-window-${id}]`)", arg=APP_ID, timeout=120000)
    page.evaluate("""async ([appId, layout, appState]) => {
      const harness = window.__ksHarness;
      const { snapshot } = await harness.call({ op: 'state.get' });
      const version = snapshot.shared.app_versions.find((v) => v.app_id === appId);
      version.definition.state = appState;
      version.definition.ui = layout;
      version.version += 1;
      const win = snapshot.shared.windows.find((w) => w.app_id === appId);
      win.app_version = version.version;
      win.state = appState;
      harness.emit({ event: 'state.changed', snapshot });
    }""", [APP_ID, scene, app_state])
    page.add_style_tag(content=STYLE)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    # 장면 정의로 다시 붙는 동안 샘플 원천(1초 지연)의 응답이 끼어들지 않게 기다린다.
    app = page.get_by_test_id(f"app-window-{APP_ID}")
    app.locator(".ks-data-toolbar .ks-data-toolbar-item.is-text").wait_for(timeout=30000)
    page.wait_for_timeout(1600)
    return app


def emit_failures(page, app, pointers):
    page.evaluate("""(payload) => {
      const harness = window.__ksHarness;
      harness.emit({ event: 'data.update', window_id: payload.windowId, view: { sources: {}, values: payload.values } });
    }""", {"windowId": WINDOW_ID, "values": pointers})
    app.locator(".ks-data-toolbar .ks-data-state-compact").first.wait_for(timeout=30000)
    page.wait_for_timeout(200)


def measure(page):
    return page.evaluate(MEASURE_JS)


def judge(measurement, viewport_width, expected):
    if measurement.get("error"):
        return {"measured": False}
    bar = measurement["bar"]
    checks = {}
    checks["toolbar_height"] = bar["expected"] > 0 and abs(bar["height"] - bar["expected"]) <= TOLERANCE
    checks["no_vertical_overflow"] = bar["scrollHeight"] <= bar["clientHeight"] + TOLERANCE
    checks["no_descendant_below"] = measurement["maxDescendantBottom"] <= bar["bottom"] + TOLERANCE
    checks["toolbar_items_compact"] = measurement["compactCount"] == len(expected["messages"]) and measurement["stateCount"] == 0
    messages = measurement["messages"]
    checks["message_spans"] = len(messages) == len(expected["messages"])
    checks["message_keeps_text"] = len(messages) == len(expected["messages"]) and [item["text"] for item in messages] == expected["messages"]
    checks["message_title_on_cluster"] = len(measurement["states"]) == len(expected["messages"]) and all(
        state["title"] == state["message"]["text"] for state in measurement["states"] if state["message"])
    checks["message_one_line_clamp"] = len(messages) == len(expected["messages"]) and all(
        item["lineClamp"] == "1" and item["clientHeight"] < 2 * item["lineHeight"] for item in messages)
    ids = measurement["ids"]
    checks["error_codes_shown"] = len(ids) == expected["codes"] and all(
        item["text"] == CODE and item["width"] > 0 and item["height"] > 0 and item["bottom"] <= bar["bottom"] + TOLERANCE for item in ids)
    retries = [item for item in measurement["buttons"] if item["text"] == "다시 받기"]
    checks["retry_buttons_shown"] = len(retries) == expected["retries"] and all(
        item["height"] > 0 and item["width"] > 0 and item["bottom"] <= bar["bottom"] + TOLERANCE for item in retries)
    checks["buttons_shown"] = all(item["height"] > 0 and item["width"] > 0 and item["bottom"] <= bar["bottom"] + TOLERANCE for item in measurement["buttons"])
    if viewport_width > 360:
        # 넓은 폭에서는 가로 스크롤 없이 코드와 단추가 막대 안에 다 보여야 한다.
        checks["no_horizontal_overflow"] = bar["scrollWidth"] <= bar["clientWidth"] + TOLERANCE
        checks["controls_within_bar"] = all(bar["left"] - TOLERANCE <= item["left"] and item["right"] <= bar["right"] + TOLERANCE for item in ids + measurement["buttons"])
    if expected["outside"]:
        outside = measurement["outside"]
        checks["outside_not_compact"] = bool(outside) and outside["compact"] is False
        checks["outside_markup_unchanged"] = bool(outside) and outside["messageSpans"] == 0 and outside["ids"] == [CODE] and LONG_MESSAGE in (outside["text"] or "") and outside["iconWidth"] >= 24
    checks["message_spans_only_in_toolbar"] = measurement["messageSpanCount"] == len(expected["messages"])
    groups = measurement["groups"]
    checks["groups_not_overlapping"] = groups["start"] > 0 and groups["end"] > 0 and groups["overlap"] is False
    # 10. 실패 묶음 안 이웃 요소 사이 간격.
    checks["cluster_gaps"] = len(measurement["states"]) == len(expected["messages"]) and all(
        -TOLERANCE <= gap["gap"] <= measurement["space2"] + TOLERANCE
        for state in measurement["states"] for gap in state["gaps"])
    # 11. 문구 span의 보이는 폭이 최소 폭 이상이거나 글 전체가 한 줄로 보인다.
    checks["message_min_width_or_full"] = len(messages) == len(expected["messages"]) and all(
        item["clientWidth"] >= measurement["minMessage"] - TOLERANCE
        or (item["scrollWidth"] - item["clientWidth"] <= TOLERANCE and item["scrollHeight"] - item["clientHeight"] <= TOLERANCE)
        for item in messages)
    # 12. 아이콘과 코드 가운데에서 올라가면 title이 전체 문구인 요소가 잡힌다.
    checks["title_on_icon_hit"] = len(measurement["states"]) == len(expected["messages"]) and all(
        state["iconTitle"] == state["message"]["text"] for state in measurement["states"] if state["message"])
    checks["title_on_code_hit"] = all(
        state["codeTitle"] == state["message"]["text"] for state in measurement["states"] if state["code"] and state["message"])
    return checks


def run_interactions(page, app, harness_calls_before):
    result = {}
    # §0 15: Tab이 toolbar 안 보이는 요소로 새지 않는다.
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.press("Tab")
    sequence = []
    for _ in range(4):
        sequence.append(page.evaluate(FOCUS_JS))
        page.keyboard.press("Tab")
    result["tab_sequence"] = sequence
    inside = [item for item in sequence if item["inToolbar"]]
    result["tab_stays_visible"] = bool(inside) and all(item["width"] > 0 and item["height"] > 0 for item in inside)
    # §0 15: Esc로 열리는 대화상자가 없다.
    page.keyboard.press("Escape")
    page.wait_for_timeout(100)
    result["escape_opens_nothing"] = page.evaluate("() => document.querySelectorAll('.ks-dialog-overlay').length") == 0 and app.locator(".ks-data-toolbar .ks-data-state-compact").count() == 2
    # 「다시 받기」를 누르면 data.refresh로 다시 받는다.
    app.locator('.ks-data-toolbar button', has_text="다시 받기").first.click()
    page.wait_for_timeout(400)
    calls = page.evaluate("() => window.__ksHarness.getCalls()")
    result["refresh_calls"] = [call for call in calls[harness_calls_before:] if call.get("op") == "data.refresh"]
    result["retry_sends_refresh"] = any(call.get("sources") == RETRY for call in result["refresh_calls"])
    result["focus_after_retry"] = page.evaluate(FOCUS_JS)
    return result


ELLIPSIS_JS = """() => {
  const app = document.querySelector('[data-testid="app-window-data-views-test"]');
  const toolbar = app ? app.querySelector('.ks-data-toolbar') : null;
  if (!toolbar) return null;
  const box = (node) => { if (!node) return null; const b = node.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width }; };
  return [...toolbar.querySelectorAll('.ks-data-state-compact')].map((state) => ({
    message: box(state.querySelector('.ks-data-state-message')), code: box(state.querySelector('.ks-error-id')),
  }));
}"""


def ink_right(image, rect):
    """문구 상자 안에서 바탕보다 어두운 픽셀이 있는 가장 오른쪽 열의 다음 x."""
    left, top, right, bottom = int(rect["left"]), int(rect["top"]), int(rect["right"]), int(rect["bottom"])
    crop = image.crop((left, top, right, bottom)).convert("L")
    width, height = crop.size
    pixels = crop.load()
    background = pixels[width - 1, 0]
    last = None
    for x in range(width):
        if any(background - pixels[x, y] > 40 for y in range(height)):
            last = x
    return None if last is None else left + last + 1


def sweep_ellipsis(page, port, output, name, scene, type_body):
    """13. 폭을 줄여 가며 말줄임 뒤 문구 상자 안 빈자리를 잰다."""
    from PIL import Image
    narrow = name == "narrow-single"
    widths = [360] if narrow else list(range(1180, 559, -20))
    height = 240 if narrow else 720
    app = open_scene(page, port, widths[0], height, scene["scene"], scene["state"])
    emit_failures(page, app, scene["pointers"])
    rows, worst = [], None
    for width in widths:
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(120)
        states = page.evaluate(ELLIPSIS_JS) or []
        shot = page.screenshot(animations="disabled")
        image = Image.open(io.BytesIO(shot))
        for index, state in enumerate(states):
            if not state["message"] or state["message"]["width"] <= 0:
                continue
            ink = ink_right(image, state["message"])
            if ink is None:
                continue
            row = {"width": width, "state": index, "message_width": round(state["message"]["width"], 1),
                   "blank_after_text": round(state["message"]["right"] - ink, 1),
                   "gap_text_to_code": round(state["code"]["left"] - ink, 1) if state["code"] else None}
            rows.append(row)
            if worst is None or row["blank_after_text"] > worst["blank_after_text"]:
                worst = row
                (output / f"ellipsis-gap-{name}-worst.png").write_bytes(shot)
    checks = {
        "samples_measured": len(rows) > 0,
        "blank_within_type_body": all(row["blank_after_text"] <= type_body + TOLERANCE for row in rows),
    }
    return {"measurement": {"type_body": type_body, "worst": worst, "rows": rows}, "checks": checks}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="target/visual-check/toolbar-failure")
    parser.add_argument("--port", type=int, default=5408)
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
            for name, scene in SCENES.items():
                for width, height in scene["sizes"]:
                    app = open_scene(page, args.port, width, height, scene["scene"], scene["state"])
                    emit_failures(page, app, scene["pointers"])
                    key = f"{name}-{width}x{height}"
                    measurement = measure(page)
                    page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                    if scene["outside"]:
                        outside = app.locator(".ks-data-stack > .ks-data-stack-item").nth(1).locator(".ks-data-state")
                        outside.screenshot(path=str(output / f"outside-{width}x{height}.png"), animations="disabled")
                    checks = judge(measurement, width, scene)
                    scene_result = {"measurement": measurement, "checks": checks}
                    if name == "mixed" and width == 1180:
                        # §0 18: 실패가 떠 있는 채로 폭을 좁혀도 같은 줄이 유지되는지.
                        page.set_viewport_size({"width": 360, "height": 240})
                        page.wait_for_timeout(300)
                        resized = measure(page)
                        page.screenshot(path=str(output / f"{key}-resized-360x240.png"), animations="disabled")
                        scene_result["resized"] = {"measurement": resized, "checks": judge(resized, 360, scene)}
                        page.set_viewport_size({"width": width, "height": height})
                        page.wait_for_timeout(300)
                        before = page.evaluate("() => window.__ksHarness.getCalls().length")
                        interactions = run_interactions(page, app, before)
                        scene_result["interactions"] = interactions
                        for check_name, ok in (("tab_stays_visible", interactions["tab_stays_visible"]), ("escape_opens_nothing", interactions["escape_opens_nothing"]), ("retry_sends_refresh", interactions["retry_sends_refresh"])):
                            if not ok:
                                checks[check_name] = False
                    scenes[key] = scene_result
                    failed = [check for check, ok in checks.items() if not ok]
                    if name == "mixed" and width == 1180:
                        failed.extend(f"resized.{check}" for check, ok in scene_result["resized"]["checks"].items() if not ok)
                        failed.extend(check_name for check_name, ok in (("tab_stays_visible", interactions["tab_stays_visible"]), ("escape_opens_nothing", interactions["escape_opens_nothing"]), ("retry_sends_refresh", interactions["retry_sends_refresh"])) if not ok)
                    failures.extend(f"{key}.{check}" for check in failed)
                    print(key, "FAIL " + ",".join(failed) if failed else "ok")
            type_body = scenes["mixed-1180x720"]["measurement"].get("typeBody", 0)
            for name in ("mixed", "end-failure", "narrow-single"):
                key = f"ellipsis-gap-{name}"
                scene_result = sweep_ellipsis(page, args.port, output, name, SCENES[name], type_body)
                scenes[key] = scene_result
                failed = [check for check, ok in scene_result["checks"].items() if not ok]
                failures.extend(f"{key}.{check}" for check in failed)
                worst = scene_result["measurement"]["worst"]
                print(key, ("FAIL " + ",".join(failed) if failed else "ok"), "worst", worst)
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
