#!/usr/bin/env python3
"""첨부 뷰어 시각 검수(카드 #1729, 단위 card1729-attach-shell).

하네스의 첨부 표본 피드(?preview=attachment-viewer-fixture)와 채팅 첨부 장면(?preview=workspace-pas&pas=ready&chat-attachments=1)을
띄워 기준본 artifacts의 그림을 찍고, ui-design 0절 14~18번 조작 항목을 잰다.

- feed-attachments: 그림 썸네일 하나와 영상·마크다운·글·기타 칩이 한 피드에 있는 첫 화면.
- viewer-image: 그림을 누르면 뷰어가 열리고, 받은 원본이 썸네일보다 크게 그려진다. 첫 초점은 닫기, Tab은 받기↔닫기,
  Esc로 닫으면 연 썸네일로 초점이 돌아간다.
- viewer-loading: 원본 응답을 늦춰(?slow-media=1) 뷰어의 틀과 스켈레톤이 먼저 서고 내용이 그 자리를 채우는지 잰다.
- viewer-video: 영상 칩을 누르기 전에는 원본을 받지 않고, 누른 뒤 뷰어에서 재생된다(재생 단추가 보이는 첫 화면을 찍고,
  그 뒤 실제 재생으로 currentTime이 흐르는지 잰다).
- viewer-markdown: 마크다운 뷰어의 제목·목록·표. 「받기」가 브라우저 download를 일으키고 제안 이름이 표시 이름이다.
- viewer-text: 글 뷰어가 줄바꿈을 지키고 긴 줄이 넘치지 않는다.
- viewer-file: 기타 형식은 이름·크기·형식 정보 화면을 보인다.
- viewer-error: 원본을 받지 못하면 같은 틀 안에서 실패 안내와 「다시 받기」로 바뀐다.
- chat-attachments: 채팅 기록 첨부의 그림·영상·마크다운 칩. 그림과 영상, 마크다운을 각각 눌러 뷰어가 열리는지 잰다.
- viewer-narrow: 360px 폭에서 아주 긴 이름의 마크다운을 열어 가로 넘침과 이름 말줄임을 재고, 700px로 넓혔다 360px로
  되돌려 대화상자가 남고 스크롤 위치가 유지되는지 잰다.
- viewer-saved-ios: 호스트가 스스로 고른 저장 위치를 가짜 응답으로 돌려줄 때(?ios-save=1) 머리 아래에
  「…에 저장했습니다」 한 줄이 서고, 저장이 원본 재수신 없이 바이트 원천 한 번으로 끝나는지 잰다.

  python3 scripts/visual-check/check_1729_attachment_viewer.py [--output 산출폴더] [--port 포트] [--only 장면...]

기본 산출 폴더는 target/visual-check/1729-attachment-viewer이고, 그림과 measure.json을 남긴다.
판정이 하나라도 어긋나면 종료 코드 1로 끝난다.
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
SIZE = (1180, 720)
NARROW = (360, 720)
PREVIEW_STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"

FEED_APP = "attachment-viewer-fixture"
CHAT_APP = "workspace-pas"
FEED_QUERY = f"preview={FEED_APP}"
CHAT_QUERY = f"preview={CHAT_APP}&pas=ready&chat-attachments=1"
IOS_QUERY = f"{FEED_QUERY}&ios-save=1"
IOS_LOCATION = "파일 앱 › 나의 iPad › kaleidoscope › 회의록.md"
POSTER = "포스터.jpg"
CLIP = "시연.mp4"
NOTES = "회의록.md"
MEMO = "메모.txt"
BUNDLE = "묶음.zip"
MISSING = "큰 파일.pdf"
LONG_NAME = "아주 긴 이름의 회의록 파일 이름이 계속 이어지는 첨부.md"

SCENES = ["feed-attachments", "viewer-image", "viewer-loading", "viewer-video", "viewer-markdown", "viewer-text", "viewer-file", "viewer-error", "chat-attachments", "viewer-narrow", "viewer-saved-ios"]

DIALOG_JS = """() => {
  const rect = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const dialog = document.querySelector('[role="dialog"]');
  const viewer = document.querySelector('.ks-attachment-viewer');
  const nameEl = document.querySelector('.ks-attachment-viewer-name');
  const header = document.querySelector('.ks-attachment-viewer-header');
  const saved = document.querySelector('.ks-attachment-viewer-saved');
  const body = document.querySelector('.ks-attachment-viewer-body');
  const buttons = dialog ? [...dialog.querySelectorAll('button')] : [];
  const save = buttons.find((b) => b.textContent.trim() === '받기') ?? null;
  const close = dialog ? dialog.querySelector('[aria-label="닫기"]') : null;
  const retry = buttons.find((b) => b.textContent.includes('다시 받기')) ?? null;
  const active = document.activeElement;
  const img = dialog ? dialog.querySelector('.ks-attachment-viewer-image') : null;
  const video = dialog ? dialog.querySelector('video') : null;
  const audio = dialog ? dialog.querySelector('audio') : null;
  const text = dialog ? dialog.querySelector('.ks-attachment-viewer-text') : null;
  const pre = dialog ? dialog.querySelector('.ks-attachment-viewer-plain') : null;
  const info = dialog ? dialog.querySelector('.ks-attachment-viewer-info') : null;
  const alert = dialog ? dialog.querySelector('[role="alert"]') : null;
  const root = document.getElementById('root');
  const nameStyle = nameEl ? getComputedStyle(nameEl) : null;
  return {
    dialogOpen: Boolean(dialog),
    label: dialog ? dialog.getAttribute('aria-label') : null,
    outsideInert: root ? root.hasAttribute('inert') : null,
    viewer: viewer ? rect(viewer) : null,
    viewerOverflowX: viewer ? viewer.scrollWidth - viewer.clientWidth : null,
    header: header ? rect(header) : null,
    saved: saved ? { text: saved.textContent, ...rect(saved), fontSize: getComputedStyle(saved).fontSize } : null,
    body: body ? { ...rect(body), scrollWidth: body.scrollWidth, clientWidth: body.clientWidth, scrollTop: body.scrollTop, scrollHeight: body.scrollHeight } : null,
    name: nameEl ? { text: nameEl.textContent, ...rect(nameEl), clientWidth: nameEl.clientWidth, scrollWidth: nameEl.scrollWidth, lineRects: nameEl.getClientRects().length, textOverflow: nameStyle.textOverflow, whiteSpace: nameStyle.whiteSpace, ellipsis: nameStyle.textOverflow === 'ellipsis' && nameEl.scrollWidth > nameEl.clientWidth + 1 } : null,
    save: save ? { ...rect(save), disabled: save.disabled } : null,
    close: close ? rect(close) : null,
    active: active && active !== document.body ? { tag: active.tagName.toLowerCase(), ariaLabel: active.getAttribute('aria-label'), text: (active.textContent || '').trim().slice(0, 20), inDialog: dialog ? dialog.contains(active) : false, focus: active.matches(':focus'), focusVisible: active.matches(':focus-visible') } : null,
    image: img ? { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, complete: img.complete, ...rect(img) } : null,
    video: video ? { controls: video.controls, paused: video.paused, currentTime: video.currentTime, duration: video.duration, readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight, error: video.error ? video.error.code : null, ...rect(video) } : null,
    audio: audio ? { controls: audio.controls, paused: audio.paused, currentTime: audio.currentTime, error: audio.error ? audio.error.code : null } : null,
    markdown: text ? { headings: text.querySelectorAll('h1,h2,h3').length, lists: text.querySelectorAll('ul,ol').length, tables: text.querySelectorAll('table').length, sample: text.textContent.slice(0, 120) } : null,
    pre: pre ? { text: pre.textContent, userSelect: getComputedStyle(pre).userSelect, overflowX: pre.scrollWidth - pre.clientWidth } : null,
    info: info ? [...info.querySelectorAll('.ks-attachment-viewer-info-row')].map((row) => row.textContent) : null,
    alert: alert ? alert.textContent : null,
    retry: Boolean(retry),
    docOverflowX: document.documentElement.scrollWidth - window.innerWidth,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}"""

FEED_JS = """() => {
  const rect = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const cells = [...document.querySelectorAll('.ks-feed-media-cell')];
  const feed = document.querySelector('.ks-feed-media');
  const buttons = cells.map((cell) => {
    const button = cell.querySelector('button');
    return button ? { name: button.getAttribute('aria-label'), className: button.className, text: cell.textContent.trim(), rect: rect(button), image: button.querySelector('img') ? { naturalWidth: button.querySelector('img').naturalWidth, complete: button.querySelector('img').complete, rect: rect(button.querySelector('img')) } : null } : null;
  }).filter(Boolean);
  return {
    cells: cells.length,
    buttons,
    names: buttons.map((button) => button.name),
    feed: feed ? rect(feed) : null,
    images: buttons.filter((button) => button.image && button.image.complete && button.image.naturalWidth > 0).length,
    badges: buttons.filter((button) => button.text.includes('영상')).map((button) => button.name),
    skeletons: document.querySelectorAll('.ks-media-skeleton').length,
  };
}"""

CHAT_JS = """() => {
  const rect = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const root = document.querySelector('[data-testid="app-window-workspace-pas"]');
  const buttons = [...root.querySelectorAll('button[aria-label]')].filter((button) => ['카드 화면.png', '시연.mp4', '회의록.md'].includes(button.getAttribute('aria-label')));
  return {
    buttons: buttons.map((button) => ({ name: button.getAttribute('aria-label'), className: button.className, text: button.textContent.trim(), rect: rect(button), image: button.querySelector('img') ? { naturalWidth: button.querySelector('img').naturalWidth, complete: button.querySelector('img').complete } : null })),
    skeletons: root.querySelectorAll('.ks-media-skeleton, .ks-agent-attachment-placeholder').length,
  };
}"""


def close_enough(left, right, tolerance=1.0):
    return left is not None and right is not None and abs(left - right) <= tolerance


def wait_server(port):
    deadline = time.time() + 240
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}", timeout=5)
            return
        except Exception:
            time.sleep(2)
    raise SystemExit("하네스 서버가 뜨지 않았습니다")


def open_page(browser, port, query, app_id, viewport=SIZE):
    page = browser.new_page(viewport={"width": viewport[0], "height": viewport[1]})
    page.goto(f"http://127.0.0.1:{port}/?{query}")
    page.wait_for_function("() => window.__ksHarness !== undefined", timeout=120000)
    page.add_style_tag(content=PREVIEW_STYLE)
    app = page.get_by_test_id(f"app-window-{app_id}")
    app.locator(".ks-data-window-body").first.wait_for(state="attached", timeout=120000)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(400)
    return page, app


def wait_feed_ready(page):
    page.wait_for_function("() => document.querySelectorAll('.ks-feed-media-cell').length >= 7", timeout=60000)
    page.wait_for_function("() => document.querySelectorAll('.ks-media-skeleton').length === 0", timeout=60000)
    page.wait_for_timeout(400)


def wait_dialog(page):
    page.get_by_role("dialog").wait_for(state="visible", timeout=20000)


def wait_until(page, expression, timeout=30000):
    page.wait_for_function(expression, timeout=timeout)


def media_calls(page, path_name, original=False):
    return page.evaluate(
        """({ name, original }) => window.conversationHarness.calls().filter((call) => call.op === 'data.media' && call.media && call.media.path === name && (!original || call.max_px == null)).length""",
        {"name": path_name, "original": original},
    )


def save_calls(page):
    return page.evaluate("() => window.conversationHarness.calls().filter((call) => call.op === 'data.media.save').length")


def open_by_click(app, name):
    trigger = app.get_by_role("button", name=name, exact=True)
    before = trigger.bounding_box()
    trigger.click()
    return before


def record(results, failures, name, measurement, checks):
    results[name] = {"measurement": measurement, "checks": checks}
    failed = [check for check, ok in checks.items() if not ok]
    failures.extend(f"{name}.{check}" for check in failed)
    print(name, json.dumps(measurement, ensure_ascii=False, default=str)[:1600], ("FAIL " + ",".join(failed)) if failed else "ok", flush=True)


def scene_feed(browser, port, output, results, failures):
    page, app = open_page(browser, port, FEED_QUERY, FEED_APP)
    try:
        wait_feed_ready(page)
        m = page.evaluate(FEED_JS)
        page.screenshot(path=str(output / "feed-attachments.png"), animations="disabled")
        names = m["names"]
        checks = {
            "seven_cells": m["cells"] == 7,
            "poster_thumbnail_loaded": any(button["name"] == POSTER and button["image"] and button["image"]["complete"] and button["image"]["naturalWidth"] > 0 for button in m["buttons"]),
            "attachment_names": all(name in names for name in (POSTER, CLIP, NOTES, MEMO, BUNDLE, MISSING)),
            "video_chip_badge": m["badges"] == [CLIP],
            "no_skeleton": m["skeletons"] == 0,
            "cells_inside_feed": m["feed"] is not None and all(button["rect"]["right"] <= m["feed"]["right"] + 1 and button["rect"]["left"] >= m["feed"]["left"] - 1 for button in m["buttons"]),
        }
        record(results, failures, "feed-attachments", m, checks)
    finally:
        page.close()


def scene_viewer_image(browser, port, output, results, failures):
    page, app = open_page(browser, port, FEED_QUERY, FEED_APP)
    try:
        wait_feed_ready(page)
        trigger_box = open_by_click(app, POSTER)
        wait_dialog(page)
        wait_until(page, "() => { const img = document.querySelector('.ks-attachment-viewer-image'); return img !== null && img.complete && img.naturalWidth > 0; }")
        page.wait_for_timeout(300)
        m = page.evaluate(DIALOG_JS)
        m["triggerWidth"] = trigger_box["width"] if trigger_box else None
        m["posterOriginalCalls"] = media_calls(page, "poster.jpg", original=True)
        page.screenshot(path=str(output / "viewer-image.png"), animations="disabled")
        first_focus = m["active"] or {}
        checks = {
            "dialog_named": m["dialogOpen"] and m["label"] == POSTER,
            "first_focus_is_close": first_focus.get("ariaLabel") == "닫기" and first_focus.get("inDialog") is True,
            "outside_inert": m["outsideInert"] is True,
            "original_not_thumbnail": m["posterOriginalCalls"] == 1 and m["image"] is not None and m["image"]["naturalWidth"] == 480,
            "larger_than_thumbnail": m["image"] is not None and m["triggerWidth"] is not None and m["image"]["width"] > m["triggerWidth"] + 1,
            "image_inside_body": m["body"] is not None and m["image"] is not None and m["image"]["right"] <= m["body"]["right"] + 1 and m["image"]["bottom"] <= m["body"]["bottom"] + 1,
        }
        # Tab은 받기로, Shift+Tab은 닫기로 돌아온다. Esc로 닫으면 연 썸네일로 초점이 돌아간다.
        page.keyboard.press("Tab")
        page.wait_for_timeout(150)
        after_tab = page.evaluate(DIALOG_JS)
        checks["tab_goes_to_save"] = (after_tab["active"] or {}).get("text") == "받기"
        page.keyboard.press("Shift+Tab")
        page.wait_for_timeout(150)
        after_shift_tab = page.evaluate(DIALOG_JS)
        checks["shift_tab_returns_to_close"] = (after_shift_tab["active"] or {}).get("ariaLabel") == "닫기"
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        closed_state = page.evaluate("() => { const active = document.activeElement; const root = document.getElementById('root'); return { dialog: Boolean(document.querySelector('[role=\"dialog\"]')), label: active ? active.getAttribute('aria-label') : null, focus: active ? active.matches(':focus') : false, inert: root ? root.hasAttribute('inert') : null }; }")
        m["afterEscape"] = closed_state
        checks["escape_closes"] = closed_state["dialog"] is False
        checks["focus_returns_to_thumbnail"] = closed_state["label"] == POSTER and closed_state["focus"] is True
        checks["outside_interactive_again"] = closed_state["inert"] is False
        record(results, failures, "viewer-image", m, checks)
    finally:
        page.close()


def scene_viewer_loading(browser, port, output, results, failures):
    page, app = open_page(browser, port, f"{FEED_QUERY}&slow-media=1", FEED_APP)
    try:
        wait_feed_ready(page)
        open_by_click(app, POSTER)
        wait_dialog(page)
        wait_until(page, "() => document.querySelector('.ks-attachment-viewer-body [role=\"status\"]') !== null", timeout=5000)
        m = page.evaluate(DIALOG_JS)
        m["skeleton"] = True
        page.screenshot(path=str(output / "viewer-loading.png"), animations="disabled")
        checks = {
            "dialog_open_during_load": m["dialogOpen"] and m["label"] == POSTER,
            "frame_before_content": m["viewer"] is not None and m["name"] is not None and m["save"] is not None and m["close"] is not None,
            "skeleton_in_body": m["skeleton"] is True,
            "first_focus_is_close": (m["active"] or {}).get("ariaLabel") == "닫기",
        }
        wait_until(page, "() => { const img = document.querySelector('.ks-attachment-viewer-image'); return img !== null && img.complete && img.naturalWidth > 0; }")
        page.wait_for_timeout(200)
        loaded = page.evaluate(DIALOG_JS)
        m["loaded"] = {"image": loaded["image"], "skeleton": page.evaluate("() => Boolean(document.querySelector('.ks-attachment-viewer-body [role=\"status\"]'))")}
        checks["content_replaces_skeleton"] = loaded["image"] is not None and m["loaded"]["skeleton"] is False
        record(results, failures, "viewer-loading", m, checks)
    finally:
        page.close()


def scene_viewer_video(browser, port, output, results, failures):
    page, app = open_page(browser, port, FEED_QUERY, FEED_APP)
    try:
        wait_feed_ready(page)
        before_calls = media_calls(page, "clip.mp4")
        trigger_box = open_by_click(app, CLIP)
        wait_dialog(page)
        wait_until(page, "() => { const video = document.querySelector('video'); return video !== null && video.readyState >= 1; }")
        page.wait_for_timeout(300)
        m = page.evaluate(DIALOG_JS)
        m["callsBeforeClick"] = before_calls
        m["originalCalls"] = media_calls(page, "clip.mp4", original=True)
        m["videoBox"] = trigger_box
        page.screenshot(path=str(output / "viewer-video.png"), animations="disabled")
        playback = page.locator("video").evaluate("""async (video) => {
          video.muted = true;
          try { await video.play(); } catch (error) { return { playError: String(error), currentTime: video.currentTime, paused: video.paused }; }
          await new Promise((resolve) => setTimeout(resolve, 700));
          return { currentTime: video.currentTime, paused: video.paused, readyState: video.readyState, error: video.error ? video.error.code : null };
        }""")
        m["playback"] = playback
        checks = {
            "no_prefetch": before_calls == 0,
            "original_fetched_once": m["originalCalls"] == 1,
            "dialog_named": m["dialogOpen"] and m["label"] == CLIP,
            "video_controls": m["video"] is not None and m["video"]["controls"] is True and m["video"]["error"] is None,
            "video_decoded": m["video"] is not None and m["video"]["videoWidth"] == 320 and m["video"]["videoHeight"] == 180,
            "plays": playback.get("currentTime", 0) > 0.2 and playback.get("paused") is False and playback.get("playError") is None,
        }
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        state = page.evaluate("() => { const active = document.activeElement; return { dialog: Boolean(document.querySelector('[role=\"dialog\"]')), label: active ? active.getAttribute('aria-label') : null }; }")
        m["afterEscape"] = state
        checks["escape_returns_to_chip"] = state["dialog"] is False and state["label"] == CLIP
        record(results, failures, "viewer-video", m, checks)
    finally:
        page.close()


def scene_viewer_markdown(browser, port, output, results, failures):
    page, app = open_page(browser, port, FEED_QUERY, FEED_APP)
    try:
        wait_feed_ready(page)
        open_by_click(app, NOTES)
        wait_dialog(page)
        wait_until(page, "() => { const dialog = document.querySelector('[role=\"dialog\"]'); return dialog !== null && dialog.querySelector('h1, h2, h3') !== null; }")
        page.wait_for_timeout(300)
        m = page.evaluate(DIALOG_JS)
        page.screenshot(path=str(output / "viewer-markdown.png"), animations="disabled")
        save_before = save_calls(page)
        with page.expect_download(timeout=20000) as info:
            page.get_by_role("dialog").get_by_role("button", name="받기").click()
        download = info.value
        path = download.path()
        m["download"] = {"suggested": download.suggested_filename, "failure": download.failure(), "bytes": path.stat().st_size if path else None}
        m["saveCoreCalls"] = save_calls(page) - save_before
        checks = {
            "dialog_named": m["dialogOpen"] and m["label"] == NOTES,
            "markdown_parts": m["markdown"] is not None and m["markdown"]["headings"] >= 1 and m["markdown"]["lists"] >= 1 and m["markdown"]["tables"] >= 1,
            "first_focus_is_close": (m["active"] or {}).get("ariaLabel") == "닫기",
            "save_button": m["save"] is not None and m["save"]["disabled"] is False,
            "browser_download": m["download"]["suggested"] == NOTES and m["download"]["failure"] is None and (m["download"]["bytes"] or 0) > 0,
            "no_core_save_on_browser": m["saveCoreCalls"] == 0,
            "no_overflow": m["docOverflowX"] <= 1 and m["viewerOverflowX"] is not None and m["viewerOverflowX"] <= 1,
        }
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        state = page.evaluate("() => { const active = document.activeElement; return { dialog: Boolean(document.querySelector('[role=\"dialog\"]')), label: active ? active.getAttribute('aria-label') : null }; }")
        m["afterEscape"] = state
        checks["escape_returns_to_chip"] = state["dialog"] is False and state["label"] == NOTES
        record(results, failures, "viewer-markdown", m, checks)
    finally:
        page.close()


def scene_viewer_text(browser, port, output, results, failures):
    page, app = open_page(browser, port, FEED_QUERY, FEED_APP)
    try:
        wait_feed_ready(page)
        open_by_click(app, MEMO)
        wait_dialog(page)
        wait_until(page, "() => document.querySelector('.ks-attachment-viewer-plain') !== null")
        page.wait_for_timeout(300)
        m = page.evaluate(DIALOG_JS)
        page.screenshot(path=str(output / "viewer-text.png"), animations="disabled")
        checks = {
            "dialog_named": m["dialogOpen"] and m["label"] == MEMO,
            "text_shown": m["pre"] is not None and "첫째 줄" in m["pre"]["text"] and "셋째 줄" in m["pre"]["text"],
            "text_selectable": m["pre"] is not None and m["pre"]["userSelect"] == "text",
            "long_line_wraps": m["pre"] is not None and m["pre"]["overflowX"] <= 1,
            "no_overflow": m["docOverflowX"] <= 1,
        }
        # 닫은 뒤 칩에 초점을 두고 Enter로 다시 연다. 키보드로 연 뷰어의 첫 초점은 닫기다.
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        trigger = app.get_by_role("button", name=MEMO, exact=True)
        trigger.focus()
        page.keyboard.press("Enter")
        wait_dialog(page)
        wait_until(page, "() => document.querySelector('.ks-attachment-viewer-plain') !== null")
        page.wait_for_timeout(200)
        m["afterEnter"] = page.evaluate(DIALOG_JS)
        checks["enter_opens_viewer"] = m["afterEnter"]["dialogOpen"] and m["afterEnter"]["label"] == MEMO and (m["afterEnter"]["active"] or {}).get("ariaLabel") == "닫기"
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        state = page.evaluate("() => { const active = document.activeElement; return { dialog: Boolean(document.querySelector('[role=\"dialog\"]')), label: active ? active.getAttribute('aria-label') : null }; }")
        m["afterEscape"] = state
        checks["escape_returns_to_chip"] = state["dialog"] is False and state["label"] == MEMO
        record(results, failures, "viewer-text", m, checks)
    finally:
        page.close()


def scene_viewer_file(browser, port, output, results, failures):
    page, app = open_page(browser, port, FEED_QUERY, FEED_APP)
    try:
        wait_feed_ready(page)
        open_by_click(app, BUNDLE)
        wait_dialog(page)
        wait_until(page, "() => document.querySelector('.ks-attachment-viewer-info') !== null")
        page.wait_for_timeout(300)
        m = page.evaluate(DIALOG_JS)
        page.screenshot(path=str(output / "viewer-file.png"), animations="disabled")
        rows = m["info"] or []
        checks = {
            "dialog_named": m["dialogOpen"] and m["label"] == BUNDLE,
            "info_rows": len(rows) == 3 and any("이름" in row and BUNDLE in row for row in rows) and any("형식" in row and "application/zip" in row for row in rows) and any("크기" in row and "B" in row for row in rows),
            "save_button": m["save"] is not None,
        }
        # 첫 초점인 닫기 단추에서 Enter를 누르면 대화상자가 닫히고 연 칩으로 초점이 돌아간다.
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        state = page.evaluate("() => { const active = document.activeElement; return { dialog: Boolean(document.querySelector('[role=\"dialog\"]')), label: active ? active.getAttribute('aria-label') : null, focus: active ? active.matches(':focus') : false }; }")
        m["afterEnter"] = state
        checks["enter_on_close_closes"] = state["dialog"] is False and state["label"] == BUNDLE and state["focus"] is True
        record(results, failures, "viewer-file", m, checks)
    finally:
        page.close()


def scene_viewer_error(browser, port, output, results, failures):
    page, app = open_page(browser, port, FEED_QUERY, FEED_APP)
    try:
        wait_feed_ready(page)
        open_by_click(app, MISSING)
        wait_dialog(page)
        wait_until(page, "() => { const dialog = document.querySelector('[role=\"dialog\"]'); return dialog !== null && dialog.querySelector('[role=\"alert\"]') !== null; }")
        page.wait_for_timeout(300)
        m = page.evaluate(DIALOG_JS)
        page.screenshot(path=str(output / "viewer-error.png"), animations="disabled")
        alert = m["alert"] or ""
        checks = {
            "dialog_named": m["dialogOpen"] and m["label"] == MISSING,
            "error_message": "20MB" in alert or "불러오지" in alert,
            "retry_available": m["retry"] is True,
            "save_still_available": m["save"] is not None,
            "error_inside_frame": m["viewer"] is not None and m["name"] is not None,
        }
        record(results, failures, "viewer-error", m, checks)
    finally:
        page.close()


def scene_chat(browser, port, output, results, failures):
    page, app = open_page(browser, port, CHAT_QUERY, CHAT_APP)
    try:
        wait_until(page, """() => {
          const root = document.querySelector('[data-testid="app-window-workspace-pas"]');
          if (!root) return false;
          const image = root.querySelector('button[aria-label="카드 화면.png"] img');
          const video = root.querySelector('button[aria-label="시연.mp4"]');
          const notes = root.querySelector('button[aria-label="회의록.md"]');
          return Boolean(image && image.complete && image.naturalWidth > 0 && video && notes);
        }""")
        page.wait_for_timeout(400)
        m = page.evaluate(CHAT_JS)
        page.screenshot(path=str(output / "chat-attachments.png"), animations="disabled")
        buttons = {button["name"]: button for button in m["buttons"]}
        checks = {
            "three_attachments": len(m["buttons"]) == 3,
            "image_thumbnail": buttons.get("카드 화면.png", {}).get("image") is not None and buttons["카드 화면.png"]["image"]["naturalWidth"] > 0,
            "video_badge": "영상" in buttons.get(CLIP, {}).get("text", ""),
            "no_placeholder": m["skeletons"] == 0,
        }
        # 마크다운 칩: 뷰어가 열리고 제목이 보이며, 닫으면 칩으로 초점이 돌아간다.
        open_by_click(app, NOTES)
        wait_dialog(page)
        wait_until(page, "() => { const dialog = document.querySelector('[role=\"dialog\"]'); return dialog !== null && dialog.querySelector('h1, h2, h3') !== null; }")
        page.wait_for_timeout(300)
        chat_md = page.evaluate(DIALOG_JS)
        page.screenshot(path=str(output / "chat-viewer.png"), animations="disabled")
        checks["chat_markdown_opens"] = chat_md["dialogOpen"] and chat_md["label"] == NOTES and chat_md["markdown"] is not None and chat_md["markdown"]["headings"] >= 1
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        state = page.evaluate("() => { const active = document.activeElement; return { dialog: Boolean(document.querySelector('[role=\"dialog\"]')), label: active ? active.getAttribute('aria-label') : null }; }")
        checks["chat_close_returns_to_chip"] = state["dialog"] is False and state["label"] == NOTES
        # 영상 칩: 원본을 누르기 전에 받지 않고, 누르면 재생 가능한 뷰어가 열린다.
        before = media_calls(page, "clip.mp4")
        open_by_click(app, CLIP)
        wait_dialog(page)
        wait_until(page, "() => { const video = document.querySelector('video'); return video !== null && video.readyState >= 1; }")
        chat_video = page.evaluate(DIALOG_JS)
        checks["chat_video_opens"] = chat_video["dialogOpen"] and chat_video["label"] == CLIP and chat_video["video"] is not None
        m["chatVideo"] = {"callsBefore": before, "video": chat_video["video"]}
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        # 그림: 썸네일을 누르면 큰 그림 뷰어가 열린다.
        open_by_click(app, "카드 화면.png")
        wait_dialog(page)
        wait_until(page, "() => { const img = document.querySelector('.ks-attachment-viewer-image'); return img !== null && img.complete && img.naturalWidth > 0; }")
        chat_image = page.evaluate(DIALOG_JS)
        m["chatImage"] = chat_image["image"]
        checks["chat_image_opens"] = chat_image["dialogOpen"] and chat_image["label"] == "카드 화면.png" and chat_image["image"] is not None
        record(results, failures, "chat-attachments", m, checks)
    finally:
        page.close()


def scene_narrow(browser, port, output, results, failures):
    page, app = open_page(browser, port, FEED_QUERY, FEED_APP, viewport=NARROW)
    try:
        wait_feed_ready(page)
        open_by_click(app, LONG_NAME)
        wait_dialog(page)
        wait_until(page, "() => { const dialog = document.querySelector('[role=\"dialog\"]'); return dialog !== null && dialog.querySelector('h1, h2, h3') !== null; }")
        page.wait_for_timeout(300)
        m = page.evaluate(DIALOG_JS)
        page.screenshot(path=str(output / "viewer-narrow.png"), animations="disabled")
        name = m["name"] or {}
        checks = {
            "dialog_named": m["dialogOpen"] and m["label"] == LONG_NAME,
            "fits_viewport": m["viewer"] is not None and m["viewer"]["left"] >= -1 and m["viewer"]["right"] <= NARROW[0] + 1,
            "no_page_overflow": m["docOverflowX"] <= 1,
            "name_ellipsis": name.get("ellipsis") is True and name.get("clientWidth", 0) > 0 and name.get("lineRects") == 1,
            "header_controls_intact": m["name"] is not None and m["save"] is not None and m["close"] is not None and m["name"]["right"] <= m["save"]["left"] + 0.5 and m["save"]["right"] <= m["close"]["left"] + 0.5,
        }
        # 창 폭 바꾸기: 넓혔다 좁혀도 대화상자가 남고 스크롤 위치가 유지된다.
        page.evaluate("() => { const body = document.querySelector('.ks-attachment-viewer-body'); if (body) body.scrollTop = 120; }")
        page.wait_for_timeout(200)
        scrolled = page.evaluate("() => document.querySelector('.ks-attachment-viewer-body').scrollTop")
        page.set_viewport_size({"width": 700, "height": NARROW[1]})
        page.wait_for_timeout(400)
        wide = page.evaluate(DIALOG_JS)
        page.set_viewport_size({"width": NARROW[0], "height": NARROW[1]})
        page.wait_for_timeout(400)
        back = page.evaluate(DIALOG_JS)
        m["resize"] = {"scrolled": scrolled, "wide": wide["viewer"], "wideDocOverflowX": wide["docOverflowX"], "wideOpen": wide["dialogOpen"], "backViewport": back["viewport"], "backViewer": back["viewer"], "backDocOverflowX": back["docOverflowX"], "backOpen": back["dialogOpen"], "backScrollTop": (back["body"] or {}).get("scrollTop"), "backNameEllipsis": (back["name"] or {}).get("ellipsis")}
        checks["resize_keeps_dialog"] = wide["dialogOpen"] is True and back["dialogOpen"] is True
        checks["wide_fits"] = wide["viewer"] is not None and wide["viewer"]["right"] <= 701 and wide["docOverflowX"] <= 1
        checks["back_narrow_fits"] = back["viewer"] is not None and back["viewer"]["right"] <= NARROW[0] + 1 and back["docOverflowX"] <= 1
        checks["scroll_kept"] = scrolled > 0 and (back["body"] or {}).get("scrollTop", 0) > 0
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        state = page.evaluate("() => { const active = document.activeElement; return { dialog: Boolean(document.querySelector('[role=\"dialog\"]')), label: active ? active.getAttribute('aria-label') : null }; }")
        m["afterEscape"] = state
        checks["escape_returns_to_chip"] = state["dialog"] is False and state["label"] == LONG_NAME
        record(results, failures, "viewer-narrow", m, checks)
    finally:
        page.close()


def scene_viewer_saved_ios(browser, port, output, results, failures):
    page, app = open_page(browser, port, IOS_QUERY, FEED_APP)
    try:
        wait_feed_ready(page)
        open_by_click(app, NOTES)
        wait_dialog(page)
        wait_until(page, "() => { const dialog = document.querySelector('[role=\"dialog\"]'); return dialog !== null && dialog.querySelector('h1, h2, h3') !== null; }")
        page.wait_for_timeout(300)
        page.get_by_role("dialog").get_by_role("button", name="받기").click()
        wait_until(page, "() => document.querySelector('.ks-attachment-viewer-saved') !== null")
        page.wait_for_timeout(300)
        m = page.evaluate(DIALOG_JS)
        m["saveCalls"] = page.evaluate("() => window.conversationHarness.calls().filter((call) => call.op === 'data.media.save').map((call) => ({ source: call.source.kind, name: call.suggested_name }))")
        m["originalCalls"] = media_calls(page, "notes.md", original=True)
        page.screenshot(path=str(output / "viewer-saved-ios.png"), animations="disabled")
        saved = m["saved"] or {}
        header = m["header"] or {}
        body = m["body"] or {}
        checks = {
            "dialog_named": m["dialogOpen"] and m["label"] == NOTES,
            "saved_line_text": saved.get("text") == f"{IOS_LOCATION}에 저장했습니다",
            "saved_below_header": saved.get("top", 0) >= header.get("bottom", 0) - 1 and saved.get("bottom", 10 ** 9) <= body.get("top", 0) + 1,
            "one_core_save_with_bytes": m["saveCalls"] == [{"source": "bytes", "name": NOTES}],
            "original_fetched_once": m["originalCalls"] == 1,
            "no_overflow": m["docOverflowX"] <= 1 and m["viewerOverflowX"] is not None and m["viewerOverflowX"] <= 1,
        }
        record(results, failures, "viewer-saved-ios", m, checks)
    finally:
        page.close()


BROWSER_SCENES = {
    "feed-attachments": scene_feed,
    "viewer-image": scene_viewer_image,
    "viewer-loading": scene_viewer_loading,
    "viewer-video": scene_viewer_video,
    "viewer-markdown": scene_viewer_markdown,
    "viewer-text": scene_viewer_text,
    "viewer-file": scene_viewer_file,
    "viewer-error": scene_viewer_error,
    "chat-attachments": scene_chat,
    "viewer-narrow": scene_narrow,
    "viewer-saved-ios": scene_viewer_saved_ios,
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="target/visual-check/1729-attachment-viewer")
    parser.add_argument("--port", type=int, default=5419)
    parser.add_argument("--only", nargs="*", default=None, help="찍을 장면 이름")
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
    results = {}
    failures = []
    try:
        wait_server(args.port)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            for name in SCENES:
                if args.only and name not in args.only:
                    continue
                BROWSER_SCENES[name](browser, args.port, output, results, failures)
            browser.close()
    finally:
        try:
            server.stdin.close()
        except Exception:
            pass
        server.terminate()
        try:
            server.wait(timeout=20)
        except Exception:
            server.kill()
    (output / "measure.json").write_text(json.dumps(results, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    if failures:
        print("FAILED:", ", ".join(failures), flush=True)
        return 1
    print("all ok", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
