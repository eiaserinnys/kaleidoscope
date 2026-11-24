#!/usr/bin/env python3
"""첨부 뷰어 시각 검수(카드 #1729, 단위 card1729-attach-shell).

하네스의 첨부 표본 피드(?preview=attachment-viewer-fixture)와 채팅 첨부 장면(?preview=workspace-pas&pas=ready&chat-attachments=1)을
띄워 기준본 artifacts의 그림을 찍고, ui-design 0절 14~18번 조작 항목과 화면 검수 1회차 손질 5절 a~i의 완료 조건을 잰다.

- feed-attachments: 그림 썸네일 하나와 영상·마크다운·글·기타 칩이 한 피드에 있는 첫 화면.
- viewer-image: 그림을 누르면 뷰어가 열리고, 받은 원본이 썸네일보다 크게 그려진다. 첫 초점은 닫기, Tab은 저장 다음 닫기,
  두 단추의 크기·모양·바탕이 같고 세로 가운데가 맞는다. Esc로 닫으면 연 썸네일로 초점이 돌아가고, 본문 빈자리를 누르면 닫힌다.
- viewer-loading: 원본 응답을 늦춰(?slow-media=1) 뷰어의 틀과 스켈레톤이 먼저 서고 내용이 그 자리를 채우는지 잰다.
  불러오는 중과 다 받은 뒤의 머리·저장 단추 top이 1px 안에서 같다.
- viewer-head-stability: 넓은 폭과 360에서 불러오는 중, 다 받음, 실패, 저장 줄이 뜬 뒤 네 상태의 머리·저장 단추 top이 1px 안에서 같다.
  360에서는 저장 줄이 어절 경계에서만 꺾이는지도 잰다.
- viewer-video: 영상 칩을 누르기 전에는 원본을 받지 않고, 누른 뒤 뷰어에서 재생된다(재생 단추가 보이는 첫 화면을 찍고,
  그 뒤 실제 재생으로 currentTime이 흐르는지 잰다). 영상 요소의 가로세로비가 videoWidth/videoHeight와 0.01 안에서 같고,
  본문 빈자리를 누르면 닫힌다.
- viewer-markdown: 마크다운 뷰어의 제목·목록·표. 저장이 브라우저 download를 일으키고 제안 이름이 표시 이름이다.
  본문을 눌러도, 끌어서 글을 골라도 닫히지 않는다.
- viewer-text: 글 뷰어가 줄바꿈을 지키고 긴 줄이 넘치지 않는다. 본문을 눌러도, 끌어서 글을 골라도 닫히지 않는다.
- viewer-file: 기타 형식은 크기·형식 정보 화면을 보인다(머리에 이름이 이미 있다). 본문을 눌러도 닫히지 않는다.
- viewer-error: 크기 초과 원본은 같은 틀 안에서 뷰어용 일상어 문구와 비활성 저장으로 바뀐다. 내부 경로와 「다시 받기」가 없고,
  같은 오류 문구가 두 번 보이지 않는다.
- viewer-error-other: 다른 실패는 「다시 받기」가 글 폭에 맞춰 가운데에 있고, 저장이 같은 문구로 실패하면 바닥 띠를 더하지 않는다.
- chat-attachments: 채팅 기록 첨부의 그림·영상·마크다운 칩. 그림과 영상, 마크다운을 각각 눌러 뷰어가 열리는지 잰다.
- viewer-narrow: 360px 폭에서 아주 긴 이름의 마크다운을 열어 가로 넘침과 이름 말줄임, 두 단추의 크기·세로 가운데를 재고,
  700px로 넓혔다 360px로 되돌려 대화상자가 남고 스크롤 위치가 유지되는지 잰다.
- viewer-narrow-bodies: 360px에서 그림, 영상, 소리, 마크다운, 글, 기타, 실패 본문의 scrollWidth가 clientWidth와 같고
  실패 상자의 좌우 틈 차이가 1px 안이다. viewer-narrow-error.png를 찍는다.
- viewer-saved-ios: 호스트가 스스로 고른 저장 위치를 가짜 응답으로 돌려줄 때(?ios-save=1) 머리 아래에
  「…에 저장했습니다」 한 줄이 서고, 저장이 원본 재수신 없이 바이트 원천 한 번으로 끝나는지 잰다.
- stack-feed-spacing: 쌓기 안 첨부만 담은 feed의 위아래 틈을 같은 자리에 image 블록을 둔 표본과 견주고,
  항목 사이 틈과 본문 있는 feed, 탭 바로 아래 feed의 간격이 그대로인지 잰다(카드 #1729 6절).
- stack-feed-spacing-guards: 머리(이름·시각)가 있는 항목은 목록 간격(위 12, 머리→첨부 8, 마지막 아래 12)을
  지키고, is-fill 쌓기의 커멘트 탭은 끝까지 굴렸을 때 마지막 카드 아래 12가 본문 섞인 목록과 같으며,
  묶음과 답글을 접고 펼 때 feed 위 여백과 누른 머리 top이 그대로이고, 접기 없는 묶음 feed(모든 항목이
  머리 없는 첨부만)는 표지 없이 제목→첨부 12와 마지막 첨부→뒤 글 20을 지키는지 잰다(화면 검수 3·4회차).

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
OTHER_ERROR_QUERY = f"{FEED_QUERY}&viewer-load-error=other"
SAVE_ERROR_QUERY = f"{FEED_QUERY}&viewer-load-error=other&save-error=1&ios-save=1"
IOS_LOCATION = "파일 앱 › 나의 iPad › kaleidoscope › 회의록.md"
TOO_LARGE_MESSAGE = "20MB보다 큰 첨부라 미리 보거나 저장할 수 없습니다."
OTHER_ERROR_MESSAGE = "첨부를 읽지 못했습니다. 파일이 바뀌었는지 확인하세요."
POSTER = "포스터.jpg"
CLIP = "시연.mp4"
NOTES = "회의록.md"
MEMO = "메모.txt"
BUNDLE = "묶음.zip"
MISSING = "큰 파일.pdf"
LONG_NAME = "아주 긴 이름의 회의록 파일 이름이 계속 이어지는 첨부.md"

SPACING_FEED_APP = "stack-feed-spacing-feed"
SPACING_IMAGE_APP = "stack-feed-spacing-image"
SPACING_TAB_APP = "stack-feed-spacing-tab"
SPACING_NAMED_APP = "stack-feed-spacing-named"
SPACING_COMMENTS_APP = "stack-feed-spacing-comments"
SPACING_COMMENTS_MIXED_APP = "stack-feed-spacing-comments-mixed"
SPACING_GROUPED_APP = "stack-feed-spacing-grouped"
SPACING_GROUPED_PLAIN_APP = "stack-feed-spacing-grouped-plain"
SPACING_GROUPED_PLAIN_TAB_APP = "stack-feed-spacing-grouped-plain-tab"
SPACING_NESTED_APP = "stack-feed-spacing-nested"

SCENES = ["feed-attachments", "viewer-image", "viewer-loading", "viewer-head-stability", "viewer-video", "viewer-markdown", "viewer-text", "viewer-file", "viewer-error", "viewer-error-other", "chat-attachments", "viewer-narrow", "viewer-narrow-bodies", "viewer-saved-ios", "stack-feed-spacing", "stack-feed-spacing-guards"]

DIALOG_JS = """() => {
  const rect = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const dialog = document.querySelector('[role="dialog"]');
  const viewer = document.querySelector('.ks-attachment-viewer');
  const nameEl = document.querySelector('.ks-attachment-viewer-name');
  const header = document.querySelector('.ks-attachment-viewer-header');
  const saved = document.querySelector('.ks-attachment-viewer-saved');
  const body = document.querySelector('.ks-attachment-viewer-body');
  const stateBox = document.querySelector('.ks-attachment-viewer-state');
  const buttons = dialog ? [...dialog.querySelectorAll('button')] : [];
  const save = dialog ? dialog.querySelector('[aria-label="저장"]') : null;
  const close = dialog ? dialog.querySelector('[aria-label="닫기"]') : null;
  const retry = buttons.find((b) => b.textContent.includes('다시 받기')) ?? null;
  const alerts = dialog ? [...dialog.querySelectorAll('[role="alert"]')].map((el) => el.textContent) : [];
  const look = (el) => { if (!el) return null; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return { width: r.width, height: r.height, radius: s.borderTopLeftRadius, background: s.backgroundColor, borderTop: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`, centerY: r.top + r.height / 2, className: el.className }; };
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
    stateBox: stateBox ? rect(stateBox) : null,
    name: nameEl ? { text: nameEl.textContent, ...rect(nameEl), clientWidth: nameEl.clientWidth, scrollWidth: nameEl.scrollWidth, lineRects: nameEl.getClientRects().length, textOverflow: nameStyle.textOverflow, whiteSpace: nameStyle.whiteSpace, ellipsis: nameStyle.textOverflow === 'ellipsis' && nameEl.scrollWidth > nameEl.clientWidth + 1 } : null,
    save: save ? { ...rect(save), disabled: save.disabled, look: look(save) } : null,
    close: close ? { ...rect(close), look: look(close) } : null,
    retry: retry ? { ...rect(retry), text: retry.textContent } : null,
    alerts,
    active: active && active !== document.body ? { tag: active.tagName.toLowerCase(), ariaLabel: active.getAttribute('aria-label'), text: (active.textContent || '').trim().slice(0, 20), inDialog: dialog ? dialog.contains(active) : false, focus: active.matches(':focus'), focusVisible: active.matches(':focus-visible') } : null,
    image: img ? { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, complete: img.complete, ...rect(img) } : null,
    video: video ? { controls: video.controls, paused: video.paused, currentTime: video.currentTime, duration: video.duration, readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight, error: video.error ? video.error.code : null, ...rect(video) } : null,
    audio: audio ? { controls: audio.controls, paused: audio.paused, currentTime: audio.currentTime, error: audio.error ? audio.error.code : null, ...rect(audio) } : null,
    markdown: text ? { headings: text.querySelectorAll('h1,h2,h3').length, lists: text.querySelectorAll('ul,ol').length, tables: text.querySelectorAll('table').length, sample: text.textContent.slice(0, 120) } : null,
    pre: pre ? { text: pre.textContent, userSelect: getComputedStyle(pre).userSelect, overflowX: pre.scrollWidth - pre.clientWidth } : null,
    info: info ? [...info.querySelectorAll('.ks-attachment-viewer-info-row')].map((row) => row.textContent) : null,
    alert: alert ? alert.textContent : null,
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

HEAD_JS = """() => {
  const header = document.querySelector('.ks-attachment-viewer-header');
  const viewer = document.querySelector('.ks-attachment-viewer');
  const save = document.querySelector('[aria-label="저장"]');
  return {
    headerTop: header ? header.getBoundingClientRect().top : null,
    viewerTop: viewer ? viewer.getBoundingClientRect().top : null,
    saveTop: save ? save.getBoundingClientRect().top : null,
  };
}"""

SAVED_WRAP_JS = """() => {
  const el = document.querySelector('.ks-attachment-viewer-saved');
  if (!el) return null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const words = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const value = node.nodeValue || '';
    for (const match of value.matchAll(/\\S+/g)) {
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const rects = [...range.getClientRects()];
      words.push({ word: match[0], rects: rects.length, lines: new Set(rects.map((r) => Math.round(r.top * 10) / 10)).size });
    }
  }
  const range = document.createRange();
  range.selectNodeContents(el);
  const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top * 10) / 10)).size;
  return { lineCount: lines, words, overflow: el.scrollWidth - el.clientWidth, text: el.textContent };
}"""


SPACING_JS = """({ appId }) => {
  const rect = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const style = (el) => el ? getComputedStyle(el) : null;
  const root = document.querySelector(`[data-testid="app-window-${appId}"]`);
  const body = root ? root.querySelector('.ks-data-window-body') : null;
  const stack = body ? body.querySelector('.ks-data-stack') : null;
  const items = stack ? [...stack.children].filter((el) => el.classList.contains('ks-data-stack-item')) : [];
  const firstText = items[0] ? items[0].querySelector('.ks-data-text') : null;
  const nextText = items[2] ? items[2].querySelector('.ks-data-text') : null;
  const middle = items[1] || null;
  const cells = middle ? [...middle.querySelectorAll('.ks-feed-media-cell')].map(rect) : [];
  const image = middle ? middle.querySelector('.ks-image-view') : null;
  const mediaRects = cells.length ? cells : image ? [rect(image)] : [];
  const mediaTop = mediaRects.length ? Math.min(...mediaRects.map((box) => box.top)) : null;
  const mediaBottom = mediaRects.length ? Math.max(...mediaRects.map((box) => box.bottom)) : null;
  const firstBottom = firstText ? rect(firstText).bottom : null;
  const nextTop = nextText ? rect(nextText).top : null;
  const feed = middle ? middle.querySelector('.ks-feed') : null;
  const entryEls = middle ? [...middle.querySelectorAll('.ks-feed-entry')] : [];
  const entryRects = entryEls.map(rect);
  const mediaEl = middle ? middle.querySelector('.ks-feed-media') : null;
  const lastRow = entryEls.length ? entryEls[entryEls.length - 1].closest('[data-index]') : null;
  return {
    gapTop: mediaTop !== null && firstBottom !== null ? mediaTop - firstBottom : null,
    gapBottom: mediaBottom !== null && nextTop !== null ? nextTop - mediaBottom : null,
    mediaTop, mediaBottom, firstTextBottom: firstBottom, nextTop,
    cells: cells.length,
    entries: entryEls.length,
    itemGap: entryRects.length > 1 ? entryRects[1].top - entryRects[0].bottom : null,
    entryMargins: entryEls.map((el) => style(el).marginBottom),
    mediaMarginTop: mediaEl ? style(mediaEl).marginTop : null,
    feed: feed ? { className: feed.className, paddingBlockStart: style(feed).paddingBlockStart, mediaOnly: feed.classList.contains('is-media-only') } : null,
    lastRowMarked: lastRow ? lastRow.getAttribute('data-last') === 'true' : null,
    docOverflowX: document.documentElement.scrollWidth - window.innerWidth,
  };
}"""

NEIGHBOR_JS = """({ appId }) => {
  const style = (el) => el ? getComputedStyle(el) : null;
  const root = document.querySelector(`[data-testid="app-window-${appId}"]`);
  const feed = root ? root.querySelector('.ks-feed') : null;
  const entry = root ? root.querySelector('.ks-feed-entry') : null;
  const media = root ? root.querySelector('.ks-feed-media') : null;
  return {
    feed: feed ? { className: feed.className, paddingBlockStart: style(feed).paddingBlockStart, mediaOnly: feed.classList.contains('is-media-only') } : null,
    entryMarginBottom: entry ? style(entry).marginBottom : null,
    mediaMarginTop: media ? style(media).marginTop : null,
  };
}"""


GUARD_JS = """({ appId }) => {
  const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: +b.top.toFixed(2), bottom: +b.bottom.toFixed(2), left: +b.left.toFixed(2), right: +b.right.toFixed(2), height: +b.height.toFixed(2) }; };
  const style = (el) => el ? getComputedStyle(el) : null;
  const root = document.querySelector(`[data-testid="app-window-${appId}"]`);
  const feed = root ? root.querySelector('.ks-feed') : null;
  const entries = feed ? [...feed.querySelectorAll('.ks-feed-entry')] : [];
  const groupHeads = feed ? [...feed.querySelectorAll('.ks-feed-group-head')] : [];
  const mediaOf = (el) => el.querySelector('.ks-feed-media');
  return {
    feed: feed ? { className: feed.className, mediaOnly: feed.classList.contains('is-media-only'), paddingBlockStart: style(feed).paddingBlockStart, rect: rect(feed) } : null,
    entries: entries.map((el) => ({ rect: rect(el), marginBottom: style(el).marginBottom, head: rect(el.querySelector('.ks-feed-header')), media: rect(mediaOf(el)), mediaMarginTop: mediaOf(el) ? style(mediaOf(el)).marginTop : null, headerMediaGap: el.querySelector('.ks-feed-header') && mediaOf(el) ? +(mediaOf(el).getBoundingClientRect().top - el.querySelector('.ks-feed-header').getBoundingClientRect().bottom).toFixed(2) : null, table: el.classList.contains('is-table-row') })),
    groupHeads: groupHeads.map((el) => ({ rect: rect(el), text: el.innerText.replace(/\\s+/g, ' ').trim() })),
    lastEntryGap: feed && entries.length ? +(rect(feed).bottom - rect(entries[entries.length - 1]).bottom).toFixed(2) : null,
    docOverflowX: document.documentElement.scrollWidth - window.innerWidth,
  };
}"""


GROUPED_PLAIN_JS = """({ appId }) => {
  const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: +b.top.toFixed(2), bottom: +b.bottom.toFixed(2), left: +b.left.toFixed(2), right: +b.right.toFixed(2), width: +b.width.toFixed(2), height: +b.height.toFixed(2) }; };
  const style = (el) => el ? getComputedStyle(el) : null;
  const root = document.querySelector(`[data-testid="app-window-${appId}"]`);
  const feed = root ? root.querySelector('.ks-feed') : null;
  const item = feed ? feed.closest('.ks-data-stack-item') : null;
  const prev = item ? item.previousElementSibling : null;
  const next = item ? item.nextElementSibling : null;
  const tabBar = root ? root.querySelector('[role="tablist"]') : null;
  const groups = feed ? [...feed.querySelectorAll('.ks-view-group')].filter((group) => !group.closest('.ks-view-sticky')) : [];
  const titles = groups.map((group) => rect(group.querySelector('strong') || group));
  const cells = feed ? [...feed.querySelectorAll('.ks-feed-media-cell')].map(rect) : [];
  const below = (title) => cells.filter((cell) => cell.top >= title.bottom - 0.5).sort((a, b) => a.top - b.top)[0] || null;
  const above = (title) => cells.filter((cell) => cell.bottom <= title.top + 0.5).sort((a, b) => b.bottom - a.bottom)[0] || null;
  const lastCell = cells.length ? cells.reduce((best, cell) => (!best || cell.bottom > best.bottom ? cell : best), null) : null;
  const firstBelow = titles[0] ? below(titles[0]) : null;
  const aboveSecond = titles[1] ? above(titles[1]) : null;
  return {
    feed: feed ? { className: feed.className, mediaOnly: feed.classList.contains('is-media-only'), paddingBlockStart: style(feed).paddingBlockStart, rect: rect(feed) } : null,
    groups: groups.length,
    titleTexts: groups.map((group) => group.innerText.replace(/\\s+/g, ' ').trim()),
    titles: titles.map((title) => title ? title.top : null),
    cells: cells.length,
    prevToFirstTitle: titles[0] && prev ? +(titles[0].top - rect(prev).bottom).toFixed(2) : null,
    titleToMedia: titles[0] && firstBelow ? +(firstBelow.top - titles[0].bottom).toFixed(2) : null,
    groupGap: titles[1] && aboveSecond ? +(titles[1].top - aboveSecond.bottom).toFixed(2) : null,
    lastToNext: lastCell && next ? +(rect(next).top - lastCell.bottom).toFixed(2) : null,
    tabToFirstTitle: titles[0] && tabBar ? +(titles[0].top - rect(tabBar).bottom).toFixed(2) : null,
    lastMediaBottom: lastCell ? lastCell.bottom : null,
    docOverflowX: document.documentElement.scrollWidth - window.innerWidth,
  };
}"""


def close_enough(left, right, tolerance=1.0):
    return left is not None and right is not None and abs(left - right) <= tolerance


def same_look(save, close, tolerance=0.5):
    if not save or not close:
        return False
    return (abs(save["width"] - close["width"]) <= tolerance
            and abs(save["height"] - close["height"]) <= tolerance
            and save["radius"] == close["radius"]
            and save["background"] == close["background"]
            and save["borderTop"] == close["borderTop"]
            and abs(save["centerY"] - close["centerY"]) <= 1)


def no_duplicate_alerts(alerts):
    return len(alerts) == len(set(alerts))


def wait_server(port):
    deadline = time.time() + 240
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}", timeout=5)
            return
        except Exception:
            time.sleep(2)
    raise SystemExit("하네스 서버가 뜨지 않았습니다")


def open_page(browser, port, query, app_id, viewport=SIZE, route=None):
    page = browser.new_page(viewport={"width": viewport[0], "height": viewport[1]})
    if route is not None:
        page.route("**/*", route)
    page.goto(f"http://127.0.0.1:{port}/?{query}")
    page.wait_for_function("() => window.__ksHarness !== undefined", timeout=120000)
    page.add_style_tag(content=PREVIEW_STYLE)
    app = page.get_by_test_id(f"app-window-{app_id}")
    app.locator(".ks-data-window-body").first.wait_for(state="attached", timeout=120000)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(400)
    return page, app


def wait_feed_ready(page, cells=7):
    page.wait_for_function(f"() => document.querySelectorAll('.ks-feed-media-cell').length >= {cells}", timeout=60000)
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


def closed_state(page):
    return page.evaluate("() => { const active = document.activeElement; const root = document.getElementById('root'); return { dialog: Boolean(document.querySelector('[role=\"dialog\"]')), label: active ? active.getAttribute('aria-label') : null, focus: active ? active.matches(':focus') : false, inert: root ? root.hasAttribute('inert') : null }; }")


def selection_state(page):
    return page.evaluate("() => ({ text: window.getSelection().toString(), dialog: Boolean(document.querySelector('[role=\"dialog\"]')) })")


def drag_select(page, selector):
    box = page.evaluate(
        """(selector) => { const root = document.querySelector(selector); const target = root && (root.querySelector('p, h1, h2, li, td') || root); if (!target) return null; const range = document.createRange(); range.selectNodeContents(target); const rects = [...range.getClientRects()]; const rect = (rects[0] || target.getBoundingClientRect()); return { left: rect.left, top: rect.top, width: Math.max(rect.width, 8), height: Math.max(rect.height, 8) }; }""",
        selector,
    )
    if not box:
        return None
    page.mouse.move(box["left"] + 2, box["top"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(box["left"] + min(box["width"] - 2, 160), box["top"] + box["height"] / 2 + 6, steps=8)
    page.mouse.up()
    page.wait_for_timeout(150)
    return box


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
            "header_buttons_same_look": same_look(m["save"]["look"] if m["save"] else None, m["close"]["look"] if m["close"] else None),
        }
        # Tab은 저장 다음 닫기다. Esc로 닫으면 연 썸네일로 초점이 돌아온다.
        page.keyboard.press("Tab")
        page.wait_for_timeout(150)
        after_tab = page.evaluate(DIALOG_JS)
        checks["tab_goes_to_save"] = (after_tab["active"] or {}).get("ariaLabel") == "저장"
        page.keyboard.press("Tab")
        page.wait_for_timeout(150)
        after_tab2 = page.evaluate(DIALOG_JS)
        checks["second_tab_goes_to_close"] = (after_tab2["active"] or {}).get("ariaLabel") == "닫기"
        page.keyboard.press("Shift+Tab")
        page.wait_for_timeout(150)
        after_shift_tab = page.evaluate(DIALOG_JS)
        checks["shift_tab_returns_to_save"] = (after_shift_tab["active"] or {}).get("ariaLabel") == "저장"
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        state = closed_state(page)
        m["afterEscape"] = state
        checks["escape_closes"] = state["dialog"] is False
        checks["focus_returns_to_thumbnail"] = state["label"] == POSTER and state["focus"] is True
        checks["outside_interactive_again"] = state["inert"] is False
        # 그림 뷰어는 본문의 빈자리(그림 밖)를 누르면 닫히고 연 썸네일로 초점이 돌아간다.
        open_by_click(app, POSTER)
        wait_dialog(page)
        wait_until(page, "() => { const img = document.querySelector('.ks-attachment-viewer-image'); return img !== null && img.complete && img.naturalWidth > 0; }")
        page.wait_for_timeout(200)
        inside = page.evaluate(DIALOG_JS)
        body = inside["body"]
        page.mouse.click(body["left"] + 5, body["bottom"] - 5)
        page.wait_for_timeout(300)
        body_state = closed_state(page)
        m["bodyClick"] = body_state
        checks["body_click_closes_image"] = body_state["dialog"] is False and body_state["label"] == POSTER and body_state["focus"] is True
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
        loading_head = page.evaluate(HEAD_JS)
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
        loaded_head = page.evaluate(HEAD_JS)
        m["loadingHead"] = loading_head
        m["loadedHead"] = loaded_head
        m["loaded"] = {"image": loaded["image"], "skeleton": page.evaluate("() => Boolean(document.querySelector('.ks-attachment-viewer-body [role=\"status\"]'))")}
        checks["content_replaces_skeleton"] = loaded["image"] is not None and m["loaded"]["skeleton"] is False
        checks["header_stable_after_load"] = close_enough(loading_head["headerTop"], loaded_head["headerTop"]) and close_enough(loading_head["saveTop"], loaded_head["saveTop"])
        record(results, failures, "viewer-loading", m, checks)
    finally:
        page.close()


def scene_viewer_head_stability(browser, port, output, results, failures):
    m = {}
    checks = {}
    for label, size in (("wide", SIZE), ("narrow", NARROW)):
        states = {}
        page, app = open_page(browser, port, f"{FEED_QUERY}&slow-media=1", FEED_APP, viewport=size)
        try:
            wait_feed_ready(page)
            open_by_click(app, POSTER)
            wait_dialog(page)
            wait_until(page, "() => document.querySelector('.ks-attachment-viewer-body [role=\"status\"]') !== null", timeout=5000)
            states["loading"] = page.evaluate(HEAD_JS)
            wait_until(page, "() => { const img = document.querySelector('.ks-attachment-viewer-image'); return img !== null && img.complete && img.naturalWidth > 0; }")
            page.wait_for_timeout(200)
            states["loaded"] = page.evaluate(HEAD_JS)
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)
            open_by_click(app, MISSING)
            wait_dialog(page)
            wait_until(page, "() => document.querySelector('.ks-attachment-viewer [role=\"alert\"]') !== null")
            page.wait_for_timeout(200)
            states["failed"] = page.evaluate(HEAD_JS)
        finally:
            page.close()
        page, app = open_page(browser, port, IOS_QUERY, FEED_APP, viewport=size)
        try:
            wait_feed_ready(page)
            open_by_click(app, NOTES)
            wait_dialog(page)
            wait_until(page, "() => document.querySelector('.ks-attachment-viewer-text') !== null")
            page.get_by_role("dialog").get_by_role("button", name="저장").click()
            wait_until(page, "() => document.querySelector('.ks-attachment-viewer-saved') !== null")
            page.wait_for_timeout(250)
            states["saved"] = page.evaluate(HEAD_JS)
            if label == "narrow":
                m["savedWrap"] = page.evaluate(SAVED_WRAP_JS)
                page.screenshot(path=str(output / "viewer-saved-narrow.png"), animations="disabled")
        finally:
            page.close()
        m[label] = states
        header_tops = [state["headerTop"] for state in states.values()]
        save_tops = [state["saveTop"] for state in states.values()]
        checks[f"{label}_header_stable"] = max(header_tops) - min(header_tops) <= 1
        checks[f"{label}_save_stable"] = max(save_tops) - min(save_tops) <= 1
    saved = m.get("savedWrap") or {}
    checks["narrow_saved_wraps_at_word_boundaries"] = (
        saved.get("lineCount", 0) >= 2
        and saved.get("overflow", 1) <= 1
        and all(word["rects"] == 1 and word["lines"] == 1 for word in saved.get("words", []))
    )
    record(results, failures, "viewer-head-stability", m, checks)


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
        video = m["video"] or {}
        checks = {
            "no_prefetch": before_calls == 0,
            "original_fetched_once": m["originalCalls"] == 1,
            "dialog_named": m["dialogOpen"] and m["label"] == CLIP,
            "video_controls": video.get("controls") is True and video.get("error") is None,
            "video_decoded": video.get("videoWidth") == 320 and video.get("videoHeight") == 180,
            "video_aspect_ratio": video.get("width") and video.get("height") and abs(video["width"] / video["height"] - video["videoWidth"] / video["videoHeight"]) <= 0.01,
            "plays": playback.get("currentTime", 0) > 0.2 and playback.get("paused") is False and playback.get("playError") is None,
        }
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        state = closed_state(page)
        m["afterEscape"] = state
        checks["escape_returns_to_chip"] = state["dialog"] is False and state["label"] == CLIP
        # 영상 뷰어도 본문 빈자리(영상 밖)를 누르면 닫히고 연 칩으로 초점이 돌아간다.
        open_by_click(app, CLIP)
        wait_dialog(page)
        wait_until(page, "() => { const video = document.querySelector('video'); return video !== null && video.readyState >= 1; }")
        page.wait_for_timeout(300)
        inside = page.evaluate(DIALOG_JS)
        body = inside["body"]
        page.mouse.click(body["left"] + 5, body["top"] + 5)
        page.wait_for_timeout(300)
        body_state = closed_state(page)
        m["bodyClick"] = body_state
        checks["body_click_closes_video"] = body_state["dialog"] is False and body_state["label"] == CLIP and body_state["focus"] is True
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
        # 글 뷰어는 본문을 눌러도 닫히지 않는다.
        body = m["body"]
        page.mouse.click(body["left"] + 5, body["bottom"] - 5)
        page.wait_for_timeout(250)
        clicked = page.evaluate(DIALOG_JS)
        m["afterBodyClick"] = clicked["dialogOpen"]
        # 끌어서 글을 골라도 닫히지 않는다.
        drag_select(page, ".ks-attachment-viewer-text")
        selected = selection_state(page)
        m["selection"] = {"text": selected["text"][:60], "dialog": selected["dialog"]}
        page.screenshot(path=str(output / "viewer-markdown-selected.png"), animations="disabled")
        save_before = save_calls(page)
        with page.expect_download(timeout=20000) as info:
            page.get_by_role("dialog").get_by_role("button", name="저장").click()
        download = info.value
        path = download.path()
        m["download"] = {"suggested": download.suggested_filename, "failure": download.failure(), "bytes": path.stat().st_size if path else None}
        m["saveCoreCalls"] = save_calls(page) - save_before
        checks = {
            "dialog_named": m["dialogOpen"] and m["label"] == NOTES,
            "markdown_parts": m["markdown"] is not None and m["markdown"]["headings"] >= 1 and m["markdown"]["lists"] >= 1 and m["markdown"]["tables"] >= 1,
            "first_focus_is_close": (m["active"] or {}).get("ariaLabel") == "닫기",
            "save_button": m["save"] is not None and m["save"]["disabled"] is False,
            "body_click_keeps_text_viewer": clicked["dialogOpen"] is True,
            "selection_keeps_text_viewer": selected["dialog"] is True and selected["text"].strip() != "",
            "browser_download": m["download"]["suggested"] == NOTES and m["download"]["failure"] is None and (m["download"]["bytes"] or 0) > 0,
            "no_core_save_on_browser": m["saveCoreCalls"] == 0,
            "no_overflow": m["docOverflowX"] <= 1 and m["viewerOverflowX"] is not None and m["viewerOverflowX"] <= 1,
        }
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        state = closed_state(page)
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
        body = m["body"]
        page.mouse.click(body["left"] + 5, body["bottom"] - 5)
        page.wait_for_timeout(250)
        clicked = page.evaluate(DIALOG_JS)
        drag_select(page, ".ks-attachment-viewer-plain")
        selected = selection_state(page)
        m["afterBodyClick"] = clicked["dialogOpen"]
        m["selection"] = {"text": selected["text"][:60], "dialog": selected["dialog"]}
        checks = {
            "dialog_named": m["dialogOpen"] and m["label"] == MEMO,
            "text_shown": m["pre"] is not None and "첫째 줄" in m["pre"]["text"] and "셋째 줄" in m["pre"]["text"],
            "text_selectable": m["pre"] is not None and m["pre"]["userSelect"] == "text",
            "long_line_wraps": m["pre"] is not None and m["pre"]["overflowX"] <= 1,
            "no_overflow": m["docOverflowX"] <= 1,
            "body_click_keeps_text_viewer": clicked["dialogOpen"] is True,
            "selection_keeps_text_viewer": selected["dialog"] is True and selected["text"].strip() != "",
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
        state = closed_state(page)
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
            "info_rows_without_name": len(rows) == 2 and any("크기" in row and "B" in row for row in rows) and any("형식" in row and "application/zip" in row for row in rows) and all("이름" not in row for row in rows),
            "save_button": m["save"] is not None,
        }
        # 첫 초점인 닫기 단추에서 Enter를 누르면 대화상자가 닫히고 연 칩으로 초점이 돌아간다.
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        state = closed_state(page)
        m["afterEnter"] = state
        checks["enter_on_close_closes"] = state["dialog"] is False and state["label"] == BUNDLE and state["focus"] is True
        # 정보 화면도 본문을 눌러도 닫히지 않는다.
        open_by_click(app, BUNDLE)
        wait_dialog(page)
        wait_until(page, "() => document.querySelector('.ks-attachment-viewer-info') !== null")
        page.wait_for_timeout(200)
        inside = page.evaluate(DIALOG_JS)
        body = inside["body"]
        page.mouse.click(body["left"] + 5, body["bottom"] - 5)
        page.wait_for_timeout(250)
        clicked = page.evaluate(DIALOG_JS)
        m["afterBodyClick"] = clicked["dialogOpen"]
        checks["body_click_keeps_info_viewer"] = clicked["dialogOpen"] is True
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
            "viewer_error_message": alert.startswith(TOO_LARGE_MESSAGE),
            "no_internal_path": "미디어:" not in alert and "missing.pdf" not in alert,
            "retry_absent_on_too_large": m["retry"] is None,
            "save_disabled_on_too_large": m["save"] is not None and m["save"]["disabled"] is True,
            "no_duplicate_messages": no_duplicate_alerts(m["alerts"]) and len(m["alerts"]) == 1,
            "error_inside_frame": m["viewer"] is not None and m["name"] is not None,
        }
        record(results, failures, "viewer-error", m, checks)
    finally:
        page.close()


def scene_viewer_error_other(browser, port, output, results, failures):
    page, app = open_page(browser, port, SAVE_ERROR_QUERY, FEED_APP)
    try:
        wait_feed_ready(page)
        open_by_click(app, MISSING)
        wait_dialog(page)
        wait_until(page, "() => document.querySelector('.ks-attachment-viewer [role=\"alert\"]') !== null")
        page.wait_for_timeout(300)
        m = page.evaluate(DIALOG_JS)
        page.screenshot(path=str(output / "viewer-error-other.png"), animations="disabled")
        retry = m["retry"]
        state_box = m["stateBox"]
        retry_centered = (
            retry is not None and state_box is not None
            and retry["width"] < state_box["width"] - 2
            and abs((retry["left"] + retry["right"]) / 2 - (state_box["left"] + state_box["right"]) / 2) <= 1
        )
        page.get_by_role("dialog").get_by_role("button", name="저장").click()
        page.wait_for_timeout(800)
        after = page.evaluate(DIALOG_JS)
        m["afterSave"] = {"alerts": after["alerts"], "saveErrorStrip": page.evaluate("() => Boolean(document.querySelector('.ks-attachment-viewer-save-error'))")}
        checks = {
            "other_error_message": (m["alert"] or "").startswith(OTHER_ERROR_MESSAGE),
            "retry_available": retry is not None,
            "retry_fits_text_and_centered": retry_centered,
            "save_available": m["save"] is not None and m["save"]["disabled"] is False,
            "same_message_shown_once": no_duplicate_alerts(after["alerts"]) and len(after["alerts"]) == 1 and m["afterSave"]["saveErrorStrip"] is False,
        }
        record(results, failures, "viewer-error-other", m, checks)
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
        state = closed_state(page)
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
            "body_no_overflow": m["body"] is not None and m["body"]["scrollWidth"] == m["body"]["clientWidth"],
            "name_ellipsis": name.get("ellipsis") is True and name.get("clientWidth", 0) > 0 and name.get("lineRects") == 1,
            "header_controls_intact": m["name"] is not None and m["save"] is not None and m["close"] is not None and m["name"]["right"] <= m["save"]["left"] + 0.5 and m["save"]["right"] <= m["close"]["left"] + 0.5,
            "header_buttons_same_look": same_look(m["save"]["look"] if m["save"] else None, m["close"]["look"] if m["close"] else None),
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
        state = closed_state(page)
        m["afterEscape"] = state
        checks["escape_returns_to_chip"] = state["dialog"] is False and state["label"] == LONG_NAME
        record(results, failures, "viewer-narrow", m, checks)
    finally:
        page.close()


def scene_viewer_narrow_bodies(browser, port, output, results, failures):
    m = {"kinds": {}}
    checks = {}
    page, app = open_page(browser, port, FEED_QUERY, FEED_APP, viewport=NARROW)
    try:
        wait_feed_ready(page)
        for name, label in ((POSTER, "image"), (CLIP, "video"), (NOTES, "markdown"), (MEMO, "text"), (BUNDLE, "file"), (MISSING, "error")):
            open_by_click(app, name)
            wait_dialog(page)
            if label == "image":
                wait_until(page, "() => { const img = document.querySelector('.ks-attachment-viewer-image'); return img !== null && img.complete && img.naturalWidth > 0; }")
            elif label == "video":
                wait_until(page, "() => { const video = document.querySelector('video'); return video !== null && video.readyState >= 1; }")
            elif label == "markdown":
                wait_until(page, "() => document.querySelector('.ks-attachment-viewer-text') !== null")
            elif label == "text":
                wait_until(page, "() => document.querySelector('.ks-attachment-viewer-plain') !== null")
            elif label == "file":
                wait_until(page, "() => document.querySelector('.ks-attachment-viewer-info') !== null")
            else:
                wait_until(page, "() => document.querySelector('.ks-attachment-viewer [role=\"alert\"]') !== null")
            page.wait_for_timeout(250)
            state = page.evaluate(DIALOG_JS)
            body = state["body"] or {}
            data = {"body": body, "docOverflowX": state["docOverflowX"], "viewerOverflowX": state["viewerOverflowX"]}
            if label == "error":
                box = state["stateBox"] or {}
                data["gaps"] = {"left": box.get("left", 0) - body.get("left", 0), "right": body.get("right", 0) - box.get("right", 0)}
                page.screenshot(path=str(output / "viewer-narrow-error.png"), animations="disabled")
            m["kinds"][label] = data
            checks[f"{label}_body_no_overflow"] = body.get("scrollWidth") == body.get("clientWidth") and state["docOverflowX"] <= 1
            page.keyboard.press("Escape")
            page.wait_for_timeout(250)
        error = m["kinds"].get("error", {}).get("gaps") or {}
        checks["error_gaps_balanced"] = abs(error.get("left", 0) - error.get("right", 0)) <= 1
    finally:
        page.close()

    # 소리는 같은 피드를 가로채 tone.wav를 돌려주고 잰다(피드 표본에는 소리 첨부가 없다).
    tone = (ROOT / "ui/harness/assets/tone.wav").read_bytes()

    def route(r):
        request = r.request
        if request.resource_type in ("fetch", "xhr") and "bundle.zip" in request.url:
            return r.fulfill(status=200, body=tone, headers={"content-type": "audio/wav"})
        return r.continue_()

    page, app = open_page(browser, port, FEED_QUERY, FEED_APP, viewport=NARROW, route=route)
    try:
        wait_feed_ready(page)
        open_by_click(app, BUNDLE)
        wait_dialog(page)
        wait_until(page, "() => document.querySelector('.ks-attachment-viewer audio') !== null")
        page.wait_for_timeout(300)
        state = page.evaluate(DIALOG_JS)
        body = state["body"] or {}
        m["kinds"]["audio"] = {"body": body, "docOverflowX": state["docOverflowX"], "viewerOverflowX": state["viewerOverflowX"], "audio": state["audio"]}
        checks["audio_body_no_overflow"] = body.get("scrollWidth") == body.get("clientWidth") and state["docOverflowX"] <= 1
        checks["audio_controls"] = (state["audio"] or {}).get("controls") is True
        page.screenshot(path=str(output / "viewer-narrow-audio.png"), animations="disabled")
    finally:
        page.close()
    record(results, failures, "viewer-narrow-bodies", m, checks)


def scene_viewer_saved_ios(browser, port, output, results, failures):
    page, app = open_page(browser, port, IOS_QUERY, FEED_APP)
    try:
        wait_feed_ready(page)
        open_by_click(app, NOTES)
        wait_dialog(page)
        wait_until(page, "() => { const dialog = document.querySelector('[role=\"dialog\"]'); return dialog !== null && dialog.querySelector('h1, h2, h3') !== null; }")
        page.wait_for_timeout(300)
        page.get_by_role("dialog").get_by_role("button", name="저장").click()
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


def spacing_sample(browser, port, query, app_id, viewport, kind):
    page, _app = open_page(browser, port, query, app_id, viewport=viewport)
    if kind == "feed":
        page.wait_for_function("() => document.querySelectorAll('.ks-feed-media-cell').length >= 3 && document.querySelectorAll('.ks-media-skeleton').length === 0", timeout=60000)
    else:
        page.wait_for_function("() => { const img = document.querySelector('.ks-image-view img'); return img !== null && img.complete && img.naturalWidth > 0; }", timeout=60000)
    page.wait_for_timeout(350)
    return page


def scene_stack_feed_spacing(browser, port, output, results, failures):
    """쌓기 안 첨부만 담은 feed의 두 틈이 같은 자리에 image 블록을 둔 표본과 같아야 한다(카드 #1729 6절).

    넓은 폭과 360 모두에서 잰다. 항목이 여럿인 feed의 항목 사이 틈(12)은 지금 그대로이고, 본문이 있는
    쌓기 안 feed와 탭 바로 아래 feed의 padding 12·항목 아래 12·media 위 8도 그대로여야 한다.
    """
    m = {}
    checks = {}
    for label, size in (("wide", SIZE), ("narrow", NARROW)):
        feed_page = spacing_sample(browser, port, f"preview={SPACING_FEED_APP}", SPACING_FEED_APP, size, "feed")
        try:
            feed_state = feed_page.evaluate(SPACING_JS, {"appId": SPACING_FEED_APP})
            feed_page.screenshot(path=str(output / ("stack-feed-spacing.png" if label == "wide" else "stack-feed-spacing-narrow.png")), animations="disabled")
        finally:
            feed_page.close()
        image_page = spacing_sample(browser, port, f"preview={SPACING_IMAGE_APP}", SPACING_IMAGE_APP, size, "image")
        try:
            image_state = image_page.evaluate(SPACING_JS, {"appId": SPACING_IMAGE_APP})
        finally:
            image_page.close()
        m[label] = {"feed": feed_state, "image": image_state}
        feed = feed_state["feed"] or {}
        checks[f"{label}_top_gap_matches_image"] = close_enough(feed_state["gapTop"], image_state["gapTop"])
        checks[f"{label}_bottom_gap_matches_image"] = close_enough(feed_state["gapBottom"], image_state["gapBottom"])
        checks[f"{label}_no_overflow"] = feed_state["docOverflowX"] <= 1 and image_state["docOverflowX"] <= 1
        checks[f"{label}_feed_no_outer_padding"] = feed.get("mediaOnly") is True and feed.get("paddingBlockStart") == "0px"
        checks[f"{label}_last_entry_margin_zero"] = feed_state["entryMargins"][-1:] == ["0px"] and feed_state["lastRowMarked"] is True
        checks[f"{label}_item_gap_kept"] = feed_state["itemGap"] is not None and close_enough(feed_state["itemGap"], 12)
        checks[f"{label}_media_margin_zero"] = feed_state["mediaMarginTop"] == "0px"
    neighbors = {}
    for name, query, app_id in (("body_feed_in_stack", FEED_QUERY, FEED_APP), ("feed_in_tab", f"preview={SPACING_TAB_APP}", SPACING_TAB_APP)):
        page = spacing_sample(browser, port, query, app_id, SIZE, "feed")
        try:
            neighbors[name] = page.evaluate(NEIGHBOR_JS, {"appId": app_id})
        finally:
            page.close()
    m["neighbors"] = neighbors
    body = neighbors["body_feed_in_stack"] or {}
    tab = neighbors["feed_in_tab"] or {}
    body_feed = body.get("feed") or {}
    tab_feed = tab.get("feed") or {}
    checks["body_feed_keeps_spacing"] = (body_feed.get("paddingBlockStart") == "12px" and body_feed.get("mediaOnly") is False
                                         and body.get("entryMarginBottom") == "12px" and body.get("mediaMarginTop") == "8px")
    checks["tab_feed_keeps_spacing"] = (tab_feed.get("paddingBlockStart") == "0px"
                                        and tab.get("entryMarginBottom") == "12px" and tab.get("mediaMarginTop") == "8px")
    record(results, failures, "stack-feed-spacing", m, checks)


def guard_sample(browser, port, app_id, size):
    page, _app = open_page(browser, port, f"preview={app_id}", app_id, viewport=size)
    page.wait_for_function("() => document.querySelector('.ks-feed') !== null", timeout=120000)
    page.wait_for_function("() => document.querySelectorAll('.ks-media-skeleton').length === 0", timeout=60000)
    page.wait_for_timeout(350)
    return page


def scroll_feed_end(page, app_id):
    for _ in range(2):
        page.evaluate(f"() => {{ const f = document.querySelector('[data-testid=\"app-window-{app_id}\"] .ks-feed'); if (f) f.scrollTop = f.scrollHeight; }}")
        page.wait_for_timeout(400)


def scene_stack_feed_spacing_guards(browser, port, output, results, failures):
    """화면 검수 3회차: 머리 있는 항목, 굴러가는 목록, 접기에도 여백 규칙이 어긋나지 않는지 잰다(카드 #1729 6절).

    넓은 폭과 360 모두에서 잰다. 이름·시각이 있는 항목은 목록 간격(위 12, 머리→첨부 8, 마지막 아래 12)을,
    is-fill 쌓기의 커멘트 탭은 끝까지 굴렸을 때 마지막 카드 아래 12를, 묶음·답글을 접고 펼 때 feed 위 여백과
    누른 머리 top이 그대로인지를 잰다. 기준 표본(머리 없는 첨부만 feed)은 표지가 그대로 붙는지 다시 본다.
    """
    m = {}
    checks = {}
    for label, size in (("wide", SIZE), ("narrow", NARROW)):
        page = guard_sample(browser, port, SPACING_FEED_APP, size)
        try:
            state = page.evaluate(GUARD_JS, {"appId": SPACING_FEED_APP})
        finally:
            page.close()
        m[f"{label}/headerless"] = state
        checks[f"{label}_headerless_flag_kept"] = (state["feed"] or {}).get("mediaOnly") is True

        page = guard_sample(browser, port, SPACING_NAMED_APP, size)
        try:
            named = page.evaluate(GUARD_JS, {"appId": SPACING_NAMED_APP})
            page.screenshot(path=str(output / (f"stack-feed-spacing-named-{label}.png")), animations="disabled")
        finally:
            page.close()
        m[f"{label}/named"] = named
        named_feed = named["feed"] or {}
        first = (named["entries"] or [{}])[0]
        checks[f"{label}_named_no_flag"] = named_feed.get("mediaOnly") is False
        checks[f"{label}_named_padding_12"] = named_feed.get("paddingBlockStart") == "12px"
        checks[f"{label}_named_header_media_gap_8"] = close_enough(first.get("headerMediaGap"), 8)
        checks[f"{label}_named_last_margin_12"] = first.get("marginBottom") == "12px"
        checks[f"{label}_named_no_overflow"] = named["docOverflowX"] <= 1

        comments = {}
        for key, app_id in (("only", SPACING_COMMENTS_APP), ("mixed", SPACING_COMMENTS_MIXED_APP)):
            page = guard_sample(browser, port, app_id, size)
            try:
                scroll_feed_end(page, app_id)
                comments[key] = page.evaluate(GUARD_JS, {"appId": app_id})
                if key == "only":
                    page.screenshot(path=str(output / (f"stack-feed-spacing-comments-end-{label}.png")), animations="disabled")
            finally:
                page.close()
        m[f"{label}/comments"] = comments
        only = comments["only"]
        mixed = comments["mixed"]
        only_feed = only["feed"] or {}
        checks[f"{label}_comments_no_flag"] = only_feed.get("mediaOnly") is False
        checks[f"{label}_comments_padding_kept"] = only_feed.get("paddingBlockStart") == "0px"
        checks[f"{label}_comments_last_gap_12"] = close_enough(only.get("lastEntryGap"), 12)
        checks[f"{label}_comments_last_margin_12"] = (only["entries"] or [{}])[-1].get("marginBottom") == "12px"
        checks[f"{label}_comments_table_media_margin_zero"] = all(entry.get("mediaMarginTop") in (None, "0px") for entry in only["entries"])
        checks[f"{label}_comments_gap_matches_mixed"] = close_enough(only.get("lastEntryGap"), mixed.get("lastEntryGap"))
        checks[f"{label}_comments_no_overflow"] = only["docOverflowX"] <= 1 and mixed["docOverflowX"] <= 1

        page = guard_sample(browser, port, SPACING_GROUPED_APP, size)
        try:
            grouped_initial = page.evaluate(GUARD_JS, {"appId": SPACING_GROUPED_APP})
            page.locator(f'[data-testid="app-window-{SPACING_GROUPED_APP}"] .ks-feed-group-head').first.click()
            page.wait_for_timeout(400)
            grouped_collapsed = page.evaluate(GUARD_JS, {"appId": SPACING_GROUPED_APP})
            page.screenshot(path=str(output / (f"stack-feed-spacing-grouped-collapsed-{label}.png")), animations="disabled")
            page.locator(f'[data-testid="app-window-{SPACING_GROUPED_APP}"] .ks-feed-group-head').first.click()
            page.wait_for_timeout(400)
            grouped_expanded = page.evaluate(GUARD_JS, {"appId": SPACING_GROUPED_APP})
        finally:
            page.close()
        m[f"{label}/grouped"] = {"initial": grouped_initial, "collapsed": grouped_collapsed, "expanded": grouped_expanded}
        pads = [(grouped_initial["feed"] or {}).get("paddingBlockStart"), (grouped_collapsed["feed"] or {}).get("paddingBlockStart"), (grouped_expanded["feed"] or {}).get("paddingBlockStart")]
        heads = [((s.get("groupHeads") or [{}])[0].get("rect") or {}).get("top") for s in (grouped_initial, grouped_collapsed, grouped_expanded)]
        checks[f"{label}_grouped_no_flag"] = all((s["feed"] or {}).get("mediaOnly") is False for s in (grouped_initial, grouped_collapsed, grouped_expanded))
        checks[f"{label}_grouped_padding_kept"] = pads == ["12px", "12px", "12px"]
        checks[f"{label}_grouped_head_top_kept"] = close_enough(heads[0], heads[1]) and close_enough(heads[0], heads[2])
        checks[f"{label}_grouped_no_overflow"] = all(s["docOverflowX"] <= 1 for s in (grouped_initial, grouped_collapsed, grouped_expanded))

        plain = {}
        for key, app_id in (("stack", SPACING_GROUPED_PLAIN_APP), ("tab", SPACING_GROUPED_PLAIN_TAB_APP)):
            page = guard_sample(browser, port, app_id, size)
            try:
                plain[key] = page.evaluate(GROUPED_PLAIN_JS, {"appId": app_id})
                if key == "stack":
                    page.screenshot(path=str(output / (f"stack-feed-spacing-grouped-plain-{label}.png")), animations="disabled")
            finally:
                page.close()
        m[f"{label}/grouped_plain"] = plain
        stack_plain = plain["stack"]
        tab_plain = plain["tab"]
        stack_feed = stack_plain["feed"] or {}
        checks[f"{label}_grouped_plain_no_flag"] = stack_feed.get("mediaOnly") is False
        checks[f"{label}_grouped_plain_padding_12"] = stack_feed.get("paddingBlockStart") == "12px"
        checks[f"{label}_grouped_plain_prev_to_title_32"] = close_enough(stack_plain.get("prevToFirstTitle"), 32)
        checks[f"{label}_grouped_plain_title_to_media_12"] = close_enough(stack_plain.get("titleToMedia"), 12)
        checks[f"{label}_grouped_plain_title_gap_matches_tab"] = close_enough(stack_plain.get("titleToMedia"), tab_plain.get("titleToMedia"))
        checks[f"{label}_grouped_plain_group_gap_24"] = close_enough(stack_plain.get("groupGap"), 24)
        checks[f"{label}_grouped_plain_last_to_next_20"] = close_enough(stack_plain.get("lastToNext"), 20)
        checks[f"{label}_grouped_plain_no_overflow"] = stack_plain["docOverflowX"] <= 1 and tab_plain["docOverflowX"] <= 1

        page = guard_sample(browser, port, SPACING_NESTED_APP, size)
        try:
            nested_initial = page.evaluate(GUARD_JS, {"appId": SPACING_NESTED_APP})
            page.locator(f'[data-testid="app-window-{SPACING_NESTED_APP}"] button[aria-label*="답글"]').click()
            page.wait_for_timeout(400)
            nested_collapsed = page.evaluate(GUARD_JS, {"appId": SPACING_NESTED_APP})
            page.screenshot(path=str(output / (f"stack-feed-spacing-nested-collapsed-{label}.png")), animations="disabled")
            page.locator(f'[data-testid="app-window-{SPACING_NESTED_APP}"] button[aria-label*="답글"]').click()
            page.wait_for_timeout(400)
            nested_expanded = page.evaluate(GUARD_JS, {"appId": SPACING_NESTED_APP})
        finally:
            page.close()
        m[f"{label}/nested"] = {"initial": nested_initial, "collapsed": nested_collapsed, "expanded": nested_expanded}
        pads = [(nested_initial["feed"] or {}).get("paddingBlockStart"), (nested_collapsed["feed"] or {}).get("paddingBlockStart"), (nested_expanded["feed"] or {}).get("paddingBlockStart")]
        heads = [((s.get("entries") or [{}])[0].get("head") or {}).get("top") for s in (nested_initial, nested_collapsed, nested_expanded)]
        checks[f"{label}_nested_no_flag"] = all((s["feed"] or {}).get("mediaOnly") is False for s in (nested_initial, nested_collapsed, nested_expanded))
        checks[f"{label}_nested_padding_kept"] = pads == ["12px", "12px", "12px"]
        checks[f"{label}_nested_head_top_kept"] = close_enough(heads[0], heads[1]) and close_enough(heads[0], heads[2])
        checks[f"{label}_nested_header_media_gap_8"] = close_enough((nested_initial["entries"] or [{}])[0].get("headerMediaGap"), 8)
        checks[f"{label}_nested_no_overflow"] = all(s["docOverflowX"] <= 1 for s in (nested_initial, nested_collapsed, nested_expanded))
    record(results, failures, "stack-feed-spacing-guards", m, checks)


BROWSER_SCENES = {
    "feed-attachments": scene_feed,
    "viewer-image": scene_viewer_image,
    "viewer-loading": scene_viewer_loading,
    "viewer-head-stability": scene_viewer_head_stability,
    "viewer-video": scene_viewer_video,
    "viewer-markdown": scene_viewer_markdown,
    "viewer-text": scene_viewer_text,
    "viewer-file": scene_viewer_file,
    "viewer-error": scene_viewer_error,
    "viewer-error-other": scene_viewer_error_other,
    "chat-attachments": scene_chat,
    "viewer-narrow": scene_narrow,
    "viewer-narrow-bodies": scene_viewer_narrow_bodies,
    "viewer-saved-ios": scene_viewer_saved_ios,
    "stack-feed-spacing": scene_stack_feed_spacing,
    "stack-feed-spacing-guards": scene_stack_feed_spacing_guards,
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
