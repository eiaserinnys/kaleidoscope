"""명시적 채움 반복 행과 창 알림의 배치·조작 검증."""

from PIL import Image

from layout_1246_fixtures import FILL_PROGRESS_JS, NARROW, NOTICE_APP, WIDE, fill_progress_scene

# --ks-color-focus(#8c6aaf)의 실제 값. 캡처 픽셀을 이 색과 견준다.
FOCUS_COLOR = (140, 106, 175)


NOTICE_LAYOUT_JS = """
(appId) => {
  const win = document.querySelector(`[data-testid="app-window-${appId}"]`);
  const rd = (v) => Math.round(v * 10) / 10;
  const r = (el) => { const b = el.getBoundingClientRect(); return {l:rd(b.left), t:rd(b.top), r:rd(b.right), b:rd(b.bottom), w:rd(b.width), h:rd(b.height)}; };
  const textBounds = (el) => {
    if (!el) return null;
    const range = document.createRange(); range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((x) => x.width > 0 && x.height > 0);
    if (!rects.length) return null;
    return {l:rd(Math.min(...rects.map((x) => x.left))), t:rd(Math.min(...rects.map((x) => x.top))),
      r:rd(Math.max(...rects.map((x) => x.right))), b:rd(Math.max(...rects.map((x) => x.bottom))), lines:rects.length};
  };
  const n = win.querySelector('.ks-data-window-notice > .ks-notice');
  const msg = n.querySelector(':scope > .ks-notice-message');
  const exp = n.querySelector(':scope > .ks-notice-expansion');
  const cs = getComputedStyle(n), nb = n.getBoundingClientRect();
  const buttons = [...n.querySelectorAll(':scope > .ks-notice-actions > *')].map((b) => ({
    label:b.getAttribute('aria-label') || (b.innerText || '').trim(), box:r(b), expanded:b.getAttribute('aria-expanded'),
    controls:b.getAttribute('aria-controls'), text:textBounds(b)}));
  return {window:r(win), notice:r(n), notice_ratio_of_window:rd(nb.height / win.getBoundingClientRect().height * 100),
    style:{padding:cs.padding, padding_top:parseFloat(cs.paddingTop), padding_bottom:parseFloat(cs.paddingBottom),
      border_top:parseFloat(cs.borderTopWidth), border_bottom:parseFloat(cs.borderBottomWidth), gap:cs.gap},
    flow:n.hasAttribute('data-ks-flow'), message:{box:r(msg), text:(msg.innerText || '').trim(), glyphs:textBounds(msg)},
    expansion:exp ? {hidden:exp.hidden, box:r(exp), text:(exp.innerText || '').trim(), glyphs:exp.hidden ? null : textBounds(exp),
      scroll_h:exp.scrollHeight, client_h:exp.clientHeight} : null,
    buttons, insets:{top_glyph:textBounds(msg) ? rd(textBounds(msg).t - nb.top) : null,
      bottom_button:buttons.length ? rd(nb.bottom - Math.max(...buttons.map((b) => b.box.b))) : null,
      msg_to_buttons:textBounds(msg) && buttons.length ? rd(Math.min(...buttons.map((b) => b.box.t)) - textBounds(msg).b) : null}};
}
"""


def check_notice_layout(page, output, result, width, record, capture):
    """같은 창의 흐름 실패와 동작 오류 알림을 셀라피엘과 같은 좌표로 비교한다."""
    app = page.locator('[data-testid="app-window-notice-fixture"]')
    notice = app.locator('.ks-data-window-notice > .ks-notice')
    details = notice.get_by_role('button', name='자세히')
    collapsed = page.evaluate(NOTICE_LAYOUT_JS, NOTICE_APP)
    capture(output, result, page, f'notice-layout-{width}-collapsed')
    details.click()
    page.wait_for_timeout(200)
    expanded = page.evaluate(NOTICE_LAYOUT_JS, NOTICE_APP)
    capture(output, result, page, f'notice-layout-{width}-expanded')
    details.click()
    page.evaluate("() => window.noticeFixture.alert()")
    page.wait_for_timeout(200)
    action = page.evaluate(NOTICE_LAYOUT_JS, NOTICE_APP)
    capture(output, result, page, f'notice-layout-{width}-action')
    notice.get_by_role('button', name='닫기').click()
    page.wait_for_timeout(200)

    message, buttons, style = collapsed['message']['box'], collapsed['buttons'], collapsed['style']
    button_boxes = [button['box'] for button in buttons]
    button_centers = [(box['t'] + box['b']) / 2 for box in button_boxes]
    summary_center = (message['t'] + message['b']) / 2
    row_height = max(message['h'], *(box['h'] for box in button_boxes))
    one_row_height = row_height + style['padding_top'] + style['padding_bottom'] + style['border_top'] + style['border_bottom']
    top_and_bottom_match = (style['padding_top'] == action['style']['padding_top'] and style['padding_bottom'] == action['style']['padding_bottom'])
    bottom_inset_match = abs(collapsed['insets']['bottom_button'] - action['insets']['bottom_button']) <= 1
    expanded_top = expanded['expansion']['box']['t'] if expanded['expansion'] and not expanded['expansion']['hidden'] else -1
    last_row_bottom = max(expanded['message']['box']['b'], *(b['box']['b'] for b in expanded['buttons']))
    verdicts = {'동작 오류와 위아래 여백 같음':top_and_bottom_match,
                '단추 아래와 테두리 사이가 동작 오류와 같음':bottom_inset_match,
                '접힌 줄은 요약 없이 등록부 문구 하나':collapsed['message']['text'].startswith('연결 예시의 서버에 오류가 났습니다.')
                    and '이전에 받은 내용을 보이고 있습니다.' not in collapsed['message']['text'],
                '펼친 원인과 코드가 요약 줄 아래':expanded_top >= last_row_bottom - 1 and 'SOURCE_READ_FAILED' in expanded['expansion']['text']
                    and '원인: 서버 사유' in expanded['expansion']['text']}
    if width == WIDE[0]:
        verdicts.update({'요약과 단추의 세로 가운데 차이 2px 이하':all(abs(summary_center - center) <= 2 for center in button_centers),
                         '접힌 알림이 한 줄 높이':abs(collapsed['notice']['h'] - one_row_height) <= 1})
    else:
        verdicts.update({'요약 아래 단추 셋이 한 줄':len(button_boxes) == 3 and message['b'] <= min(box['t'] for box in button_boxes) + 1 and max(button_centers) - min(button_centers) <= 2,
                         '접힌 높이가 창의 20% 이하':collapsed['notice_ratio_of_window'] <= 20})
    key = f'notice-layout-{width}'
    record(result, key, verdicts)
    result['scenes'][key]['measurement'] = {'collapsed':collapsed, 'expanded':expanded, 'action':action,
                                             'summary_center':summary_center, 'button_centers':button_centers,
                                             'expected_one_row_height':one_row_height}


def check_detail_wrap(page, output, result, open_page, inject, record, capture):
    """공용 알림 상세에 본문 클래스로 감싸지 않은 긴 경로가 들어간 장면."""
    page.set_viewport_size({"width": 384, "height": 797})
    open_page(page, result["port"], NOTICE_APP)
    page.evaluate("() => { const panel = document.querySelector('[data-testid=fake-files-panel]'); if (panel) panel.remove(); }")
    inject(page, {"type": "notice", "kind": "error", "message": "2개 실패", "actions": []}, app_id=NOTICE_APP)
    app = page.locator('[data-testid="app-window-notice-fixture"]')
    notice = app.locator('.ks-data-window-body .ks-notice')
    notice.wait_for()
    # 파일 작업 알림처럼 공용 Notice 상세에 추가 래퍼 없는 경로 행을 둔다.
    notice.evaluate("""el => {
      const detail = document.createElement('div'); detail.className = 'ks-notice-expansion';
      const row = document.createElement('div');
      row.textContent = '/files/' + 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(6) + '.txt';
      detail.append(row); el.append(detail);
    }""")
    measure = """el => {
      const detail = el.querySelector('.ks-notice-expansion'), row = detail.firstElementChild;
      const win = el.closest('[data-testid="app-window-notice-fixture"]');
      const rect = node => { const r = node.getBoundingClientRect(); return {left:r.left, right:r.right, top:r.top, bottom:r.bottom}; };
      const range = document.createRange(); range.selectNodeContents(row);
      return {window:rect(win), notice:{...rect(el), scrollWidth:el.scrollWidth, clientWidth:el.clientWidth},
        detail:{...rect(detail), scrollWidth:detail.scrollWidth, clientWidth:detail.clientWidth,
          overflowWrap:getComputedStyle(detail).overflowWrap},
        text:[...range.getClientRects()].map(r => ({left:r.left, right:r.right})),
        textLength:row.textContent.length, wrappedInMessage:!!row.closest('.ks-notice-message')};
    }"""

    def fits(value):
        window, outer, detail = value["window"], value["notice"], value["detail"]
        return (outer["scrollWidth"] <= outer["clientWidth"] + 1 and
                detail["scrollWidth"] <= detail["clientWidth"] + 1 and
                outer["left"] >= window["left"] - 1 and outer["right"] <= window["right"] + 1 and
                detail["left"] >= outer["left"] - 1 and detail["right"] <= outer["right"] + 1 and
                all(r["left"] >= detail["left"] - 1 and r["right"] <= detail["right"] + 1 for r in value["text"]))

    for height in (240, 360, 720):
        page.set_viewport_size({"width": 384, "height": height + 77})
        app.evaluate("(el, height) => { el.style.width = '360px'; el.style.height = `${height}px`; }", height)
        page.wait_for_timeout(250)
        actual = notice.evaluate(measure)
        key = f"notice-detail-wrap-360x{height}"
        capture(output, result, page, key)
        # 정본 규칙만 끈 같은 장면이 실패해야 판정기가 넘침을 감지한다.
        notice.locator('.ks-notice-expansion').evaluate("el => { el.style.overflowWrap = 'normal'; }")
        page.wait_for_timeout(100)
        without_wrap = notice.evaluate(measure)
        capture(output, result, page, f"{key}-without-wrap")
        notice.locator('.ks-notice-expansion').evaluate("el => { el.style.removeProperty('overflow-wrap'); }")
        record(result, key, {"긴 경로가 상세 상자와 알림 안에 듦": fits(actual),
                             "본문 클래스 없이 상세에 표시": actual["textLength"] > 200 and bool(actual["text"]) and not actual["wrappedInMessage"],
                             "줄바꿈 제거 시 넘침 감지": not fits(without_wrap)})
        result["scenes"][key]["measurement"] = {"actual": actual, "without_wrap": without_wrap,
                                                   "without_wrap_passes": fits(without_wrap)}


def check_repeat_end_space(page, output, result, open_page, inject, record, capture):
    """채움 칸의 반복 격자를 끝까지 내리고 내용 끝과 스크롤 창 끝을 잰다."""
    for width, height in (WIDE, NARROW):
        page.set_viewport_size({"width": width, "height": height})
        open_page(page, result["port"], NOTICE_APP)
        page.evaluate("() => { const panel = document.querySelector('[data-testid=fake-files-panel]'); if (panel) panel.remove(); }")
        groups = [{"key": str(i), "label": f"항목 {i}", "rows": [
            {"key": str(j), "value": value, "label": f"기간 {j} {value}% 사용량"}
            for j, value in enumerate((79, 80, 94, 95), 1)]} for i in range(1, 25)]
        inject(page, fill_progress_scene(), app_id=NOTICE_APP, state={"groups": groups})
        grid = page.locator('[data-testid="app-window-notice-fixture"] .ks-data-stack-item.is-fill > .ks-repeat.is-grid')
        grid.wait_for()
        measure = """el => {
          const items = el.querySelectorAll(':scope > .ks-repeat-content > .ks-repeat-item');
          const box = node => { const r = node.getBoundingClientRect(); return {top:r.top, bottom:r.bottom, height:r.height}; };
          const viewport = box(el), first = box(items[0]), last = box(items[items.length - 1]);
          return {viewport, first, last, gap:viewport.bottom - last.bottom,
            token:parseFloat(getComputedStyle(el).getPropertyValue('--ks-space-3')),
            scrollTop:el.scrollTop, scrollMax:el.scrollHeight - el.clientHeight, clientHeight:el.clientHeight,
            contentPadding:parseFloat(getComputedStyle(el.querySelector(':scope > .ks-repeat-content')).paddingBlockEnd),
            count:items.length, notice:!!el.closest('.ks-data-window').querySelector('.ks-data-window-notice > .ks-notice')};
        }"""
        grid.evaluate("el => { el.scrollTop = 0; }")
        start = grid.evaluate(measure)
        grid.evaluate("el => { el.querySelector(':scope > .ks-repeat-content').style.paddingBlockEnd = '0px'; }")
        without_padding_start = grid.evaluate(measure)
        grid.evaluate("el => { el.querySelector(':scope > .ks-repeat-content').style.removeProperty('padding-block-end'); el.scrollTop = el.scrollHeight; }")
        bottom = grid.evaluate(measure)
        key = f"repeat-fill-end-space-{width}"
        record(result, key, {"정상 상태의 격자 항목과 스크롤 확인": bottom["count"] == 24 and not bottom["notice"] and bottom["scrollTop"] > 0 and bottom["scrollTop"] == bottom["scrollMax"],
                             "마지막 항목 아래 끝 여백이 토큰 이상": bottom["gap"] >= bottom["token"] - 0.01,
                             "평소 스크롤 창 높이와 첫 항목 위치 유지": start["clientHeight"] == without_padding_start["clientHeight"] and start["first"] == without_padding_start["first"]})
        result["scenes"][key]["measurement"] = {"start": start, "without_padding_start": without_padding_start, "bottom": bottom}
        capture(output, result, page, key)


def check_fill_progress_notice(page, output, result, open_page, inject, record, capture):
    for width, height in (WIDE, NARROW):
        page.set_viewport_size({"width": width, "height": height})
        open_page(page, result["port"], NOTICE_APP)
        # 실제 앱 셸이 기존 알림 상세에 쓰는 스타일과 충돌해도 접힘이 유지돼야 한다.
        page.add_style_tag(content=".ks-notice-details { display: block; }")
        page.evaluate("() => { const panel = document.querySelector('[data-testid=fake-files-panel]'); if (panel) panel.remove(); }")
        groups = [{"key": str(i), "label": f"항목 {i}", "rows": [
            {"key": str(j), "value": value, "label": f"기간 {j} {value}% 사용량"}
            for j, value in enumerate((79, 80, 94, 95), 1)]} for i in range(1, 7)]
        inject(page, fill_progress_scene(), app_id=NOTICE_APP, state={"groups": groups})
        page.evaluate("""async () => {
          const { snapshot } = await window.__ksHarness.call({op:'state.get'});
          const win = snapshot.shared.windows.find((w) => w.app_id === 'notice-fixture');
          window.__ksHarness.emit({event:'data.update', window_id:win.id, view:{values:{}, sources:{feed:{state:'failed', has_value:true,
            message:'연결 예시의 서버에 오류가 났습니다.', id:'SOURCE_READ_FAILED',
            details:['원인: 서버 사유', 'HTTP 상태: 500', '원천: feed', '경로: /api/feed']}}}});
        }""")
        page.wait_for_selector('[data-testid="app-window-notice-fixture"] .ks-data-window-notice > .ks-notice')
        page.wait_for_timeout(500)
        check_notice_layout(page, output, result, width, record, capture)
        for position in ("top", "bottom"):
            page.evaluate("""(position) => {
              const body = document.querySelector('[data-testid="app-window-notice-fixture"] .ks-data-window-body');
              const fill = body.querySelector(':scope > .ks-data-stack > .ks-data-stack-item.is-fill');
              const scroll = fill.querySelector(':scope > .ks-repeat');
              body.scrollTop = 0; scroll.scrollTop = position === 'bottom' ? scroll.scrollHeight : 0;
            }""", position)
            measurement = page.evaluate(FILL_PROGRESS_JS, NOTICE_APP)
            key = f"fill-progress-notice-{width}-{position}"
            record(result, key, {"알림과 반복 행 확인": bool(measurement["notice"] and len(measurement["rows"]) == 24),
                                 "행과 알림이 겹치지 않음": not any(row["overlap"] for row in measurement["rows"]),
                                 "알림이 본문 아래 흐름에 있음": measurement["body"]["bottom"] <= measurement["notice"]["top"] and measurement["noticePosition"] == "static",
                                 "알림에 그림자 없음": measurement["noticeShadow"] == "none",
                                 "채움 칸 스크롤": width != NARROW[0] or (measurement["scrollMax"] > 0 and (position == "top" or measurement["scrollTop"] > 0))})
            result["scenes"][key]["measurement"] = measurement
            capture(output, result, page, key)
        if width == NARROW[0]:
            collapsed = page.evaluate(FILL_PROGRESS_JS, NOTICE_APP)
            details = page.get_by_role("button", name="자세히")
            detail_id = details.get_attribute("aria-controls")
            collapsed_hidden = not page.locator(f"[id='{detail_id}']").is_visible()
            details.focus()
            page.keyboard.press("Shift+Tab")
            page.keyboard.press("Tab")
            tab_focus = details.evaluate("el => document.activeElement === el && el.matches(':focus-visible')")
            focus_visible = details.evaluate("el => { const s = getComputedStyle(el); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'; }")
            details.press("Enter")
            page.wait_for_timeout(250)
            expanded = page.evaluate(FILL_PROGRESS_JS, NOTICE_APP)
            focus_kept = details.evaluate("el => document.activeElement === el")
            detail_id = details.get_attribute("aria-controls")
            detail_visible = page.locator(f"[id='{detail_id}']").is_visible()
            detail_text = page.locator(f"[id='{detail_id}']").inner_text()
            key = "fill-progress-details-360"
            record(result, key, {"접힌 높이가 창의 20% 이하": (collapsed["notice"]["bottom"] - collapsed["notice"]["top"]) <= (collapsed["window"]["bottom"] - collapsed["window"]["top"]) * .2,
                                 "접힌 원인과 코드를 화면에서 숨김": collapsed_hidden,
                                 "펼친 원인과 코드": detail_visible and "원인: 서버 사유" in detail_text and "SOURCE_READ_FAILED" in detail_text,
                                 "펼쳐도 본문과 겹치지 않음": expanded["body"]["bottom"] <= expanded["notice"]["top"] and not any(row["overlap"] for row in expanded["rows"]),
                                 "Tab과 누른 뒤 초점": tab_focus and focus_kept and focus_visible})
            result["scenes"][key]["measurement"] = {"collapsed": collapsed, "expanded": expanded}
            capture(output, result, page, key)
            page.set_viewport_size({"width": 384, "height": 317})
            page.locator('[data-testid="app-window-notice-fixture"]').evaluate("el => { el.style.width = '360px'; el.style.height = '240px'; }")
            page.wait_for_timeout(250)
            minimum = page.locator(f"[id='{detail_id}']").evaluate("""el => {
              const r = el.getBoundingClientRect(), text = el.firstElementChild;
              const notice = el.closest('.ks-notice').getBoundingClientRect(), win = el.closest('.ks-data-window').getBoundingClientRect();
              return {height:r.height, lineHeight:parseFloat(getComputedStyle(text).lineHeight), noticeHeight:notice.height, windowHeight:win.height,
                selectable:getComputedStyle(text).userSelect, scrollHeight:el.scrollHeight, clientHeight:el.clientHeight};
            }""")
            record(result, "fill-progress-details-minimum", {"원인 한 줄을 읽고 복사할 수 있음": minimum["height"] >= minimum["lineHeight"] and minimum["selectable"] == "text",
                   "펼친 알림이 창 내용의 절반 이하": minimum["noticeHeight"] * 2 <= minimum["windowHeight"] + 1})
            result["scenes"]["fill-progress-details-minimum"]["measurement"] = minimum
            capture(output, result, page, "fill-progress-details-minimum")
            page.locator('[data-testid="app-window-notice-fixture"]').evaluate("el => { el.style.width = ''; el.style.height = ''; }")
            page.set_viewport_size({"width": NARROW[0], "height": NARROW[1]})
            page.wait_for_timeout(250)
            details.press("Enter")
            # 검사기가 실제 겹침을 놓치지 않는지 알림을 보이는 행 위로 옮겼다가 원위치한다.
            page.evaluate("""() => {
              const notice = document.querySelector('[data-testid="app-window-notice-fixture"] .ks-data-window-notice > .ks-notice');
              const rows = [...document.querySelectorAll('[data-testid="app-window-notice-fixture"] .ks-data-progress-field')];
              const scroll = document.querySelector('[data-testid="app-window-notice-fixture"] .ks-data-stack-item.is-fill > .ks-repeat');
              const s = scroll.getBoundingClientRect();
              const row = rows.find((e) => { const r = e.getBoundingClientRect(); return r.top >= s.top && r.bottom <= s.bottom; });
              notice.style.transform = `translateY(${row.getBoundingClientRect().top - notice.getBoundingClientRect().top}px)`;
            }""")
            injected = page.evaluate(FILL_PROGRESS_JS, NOTICE_APP)
            page.evaluate("""() => { document.querySelector('[data-testid="app-window-notice-fixture"] .ks-data-window-notice > .ks-notice').style.transform = ''; }""")
            record(result, "fill-progress-detector", {"심은 겹침을 감지": any(row["overlap"] for row in injected["rows"])})
            result["scenes"]["fill-progress-detector"]["measurement"] = injected
            page.evaluate("""() => { document.querySelector('[data-testid="app-window-notice-fixture"] .ks-data-stack-item.is-fill > .ks-repeat').scrollTop = 0; }""")
            page.set_viewport_size({"width": WIDE[0], "height": WIDE[1]})
            page.wait_for_timeout(450)
            resized_wide = page.evaluate(FILL_PROGRESS_JS, NOTICE_APP)
            page.set_viewport_size({"width": NARROW[0], "height": NARROW[1]})
            page.wait_for_timeout(450)
            resized_narrow = page.evaluate(FILL_PROGRESS_JS, NOTICE_APP)
            record(result, "fill-progress-resize", {"폭 변경 뒤 맨 위 유지": resized_narrow["scrollTop"] == 0,
                "폭 변경 뒤 겹침 없음": all(not row["overlap"] for data in (resized_wide, resized_narrow) for row in data["rows"])})
            result["scenes"]["fill-progress-resize"]["measurement"] = {"wide": resized_wide, "narrow": resized_narrow}
            retry = page.get_by_role("button", name="다시 받기")
            retry.focus()
            page.keyboard.press("Tab")
            tab_close = page.evaluate("() => document.activeElement?.getAttribute('aria-label') === '닫기'")
            page.keyboard.press("Shift+Tab")
            retry.click()
            focus_retry = page.evaluate("() => document.activeElement?.getAttribute('aria-label') === '다시 받기'")
            geometry = page.evaluate("""() => {
              const win = document.querySelector('[data-testid="app-window-notice-fixture"]');
              const body = win.querySelector('.ks-data-window-body');
              return {width:win.getBoundingClientRect().width, horizontalOverflow:body.scrollWidth > body.clientWidth,
                retry:!!win.querySelector('.ks-data-window-notice button[aria-label="다시 받기"]')};
            }""")
            record(result, "fill-progress-controls-360", {"단추 누른 뒤 초점": focus_retry, "Tab 순서": tab_close, "가로 넘침 없음": not geometry["horizontalOverflow"],
                                                          "실패와 다시 받기": geometry["retry"]})
            result["scenes"]["fill-progress-controls-360"]["measurement"] = geometry

    check_detail_wrap(page, output, result, open_page, inject, record, capture)
    check_repeat_end_space(page, output, result, open_page, inject, record, capture)
    check_close_focus(page, output, result, open_page, record, capture)


def focus_corner_pixels(path, window, viewport):
    """캡처에서 창 왼쪽 아래 (6, H-6)과 오른쪽 아래 (W-7, H-6)의 픽셀을 읽는다."""
    image = Image.open(path).convert("RGB")
    scale_x, scale_y = image.width / viewport["width"], image.height / viewport["height"]

    def at(x, y):
        return image.getpixel((min(int(round(x * scale_x)), image.width - 1),
                                min(int(round(y * scale_y)), image.height - 1)))

    return {"left": at(window["left"] + 6, window["bottom"] - 6),
            "right": at(window["right"] - 7, window["bottom"] - 6)}


def near_focus_color(pixel, tolerance=8):
    """안티에일리어싱 여유를 두고 초점 색인지 본다. 바탕색과는 채널 차가 8을 훨씬 넘는다."""
    return all(abs(channel - want) <= tolerance for channel, want in zip(pixel, FOCUS_COLOR))


def check_close_focus(page, output, result, open_page, record, capture):
    """알림을 닫은 뒤 초점: 키보드로 닫으면 본문 안쪽에 고리가 보이고, 마우스로 닫으면 보이지 않는다."""
    measure = """() => {
      const active = document.activeElement;
      const style = getComputedStyle(active);
      const box = active.getBoundingClientRect();
      const win = active.closest('[data-testid="app-window-notice-fixture"]');
      const winBox = win.getBoundingClientRect();
      const winStyle = getComputedStyle(win);
      return { tag:active.tagName, className:String(active.className ?? ''),
        inWindow:!!win,
        outlineStyle:style.outlineStyle, outlineWidth:style.outlineWidth, outlineOffset:style.outlineOffset,
        focusVisible:active.matches(':focus-visible'),
        radiusLeft:parseFloat(style.borderBottomLeftRadius), radiusRight:parseFloat(style.borderBottomRightRadius),
        box:{left:box.left, top:box.top, right:box.right, bottom:box.bottom, width:box.width, height:box.height},
        window:{left:winBox.left, top:winBox.top, right:winBox.right, bottom:winBox.bottom, width:winBox.width, height:winBox.height},
        windowRadiusLeft:parseFloat(winStyle.borderBottomLeftRadius), windowRadiusRight:parseFloat(winStyle.borderBottomRightRadius),
        windowBorder:parseFloat(winStyle.borderBottomWidth) };
    }"""
    for width, height in (WIDE, NARROW):
        page.set_viewport_size({"width": width, "height": height})
        open_page(page, result["port"], NOTICE_APP)
        page.evaluate("() => { const panel = document.querySelector('[data-testid=fake-files-panel]'); if (panel) panel.remove(); }")
        # 창 초점 복구는 맨 위 창에서만 돈다. 하네스가 다른 창을 위에 두므로 검사 대상 창을 올린다.
        page.evaluate("""async () => {
          const harness = window.__ksHarness;
          const { snapshot } = await harness.call({ op: 'state.get' });
          const target = snapshot.shared.windows.find((window) => window.app_id === 'notice-fixture');
          target.z = Math.max(...snapshot.shared.windows.map((window) => window.z)) + 1;
          harness.emit({ event: 'state.changed', snapshot });
        }""")
        page.wait_for_timeout(200)
        for how in ("keyboard", "pointer"):
            page.evaluate("() => window.noticeFixture.alert()")
            page.wait_for_selector('[data-testid="app-window-notice-fixture"] .ks-notice button[aria-label="닫기"]')
            page.wait_for_timeout(150)
            close = page.get_by_role('button', name='닫기')
            if how == 'keyboard':
                close.focus()
                page.keyboard.press('Enter')
            else:
                close.click()
            page.wait_for_timeout(250)
            measured = page.evaluate(measure)
            verdicts = {'닫은 뒤 초점이 창 본문에 있음': measured['inWindow'] and 'ks-data-window-body' in measured['className'],
                        '구조용 초점으로 옮김': 'ks-focus-rescue-empty' in measured['className']}
            if how == 'keyboard':
                verdicts['키보드로 닫으면 고리가 보임'] = bool(measured['focusVisible']) and measured['outlineStyle'] == 'solid' and measured['outlineWidth'] != '0px'
                verdicts['고리는 본문 안쪽에 그려짐'] = measured['outlineOffset'].startswith('-') and measured['outlineOffset'] != '-0px'
                # 창틀의 둥근 자르기 안에서 고리가 끊기지 않게 아래 두 모서리를 창과 같은 동심 곡률로 돌린다.
                expected_left = round(measured['windowRadiusLeft'] - measured['windowBorder'], 2)
                expected_right = round(measured['windowRadiusRight'] - measured['windowBorder'], 2)
                measured['expectedRadiusLeft'], measured['expectedRadiusRight'] = expected_left, expected_right
                verdicts['아래 두 모서리 곡률이 창 곡률 - 선 두께'] = (abs(measured['radiusLeft'] - expected_left) <= .01
                                                                      and abs(measured['radiusRight'] - expected_right) <= .01)
            else:
                verdicts['마우스로 닫으면 고리가 없음'] = measured['outlineStyle'] == 'none'
            key = f"notice-close-focus-{how}-{width}"
            capture(output, result, page, key)
            if how == 'keyboard':
                pixels = focus_corner_pixels(output / f"check1246-{key}.png", measured['window'], page.viewport_size)
                measured['cornerPixels'] = {'left': list(pixels['left']), 'right': list(pixels['right']), 'focus': list(FOCUS_COLOR)}
                verdicts['왼쪽 아래 픽셀이 초점 색'] = near_focus_color(pixels['left'])
                verdicts['오른쪽 아래 픽셀이 초점 색'] = near_focus_color(pixels['right'])
            record(result, key, verdicts)
            result["scenes"][key]["measurement"] = measured


