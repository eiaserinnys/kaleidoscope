"""명시적 채움 반복 행과 창 알림의 배치·조작 검증."""

from layout_1246_fixtures import FILL_PROGRESS_JS, NARROW, NOTICE_APP, WIDE, fill_progress_scene


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
          window.__ksHarness.emit({event:'data.update', window_id:win.id, view:{values:{}, sources:{feed:{state:'failed', has_value:true, message:'자료를 받지 못했습니다', id:'SOURCE_READ_FAILED'}}}});
        }""")
        page.wait_for_selector('[data-testid="app-window-notice-fixture"] .ks-data-window-notice > .ks-notice')
        page.wait_for_timeout(500)
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
                                 "펼친 원인과 코드": detail_visible and "자료를 받지 못했습니다" in detail_text and "SOURCE_READ_FAILED" in detail_text,
                                 "펼쳐도 본문과 겹치지 않음": expanded["body"]["bottom"] <= expanded["notice"]["top"] and not any(row["overlap"] for row in expanded["rows"]),
                                 "Tab과 누른 뒤 초점": tab_focus and focus_kept and focus_visible})
            result["scenes"][key]["measurement"] = {"collapsed": collapsed, "expanded": expanded}
            capture(output, result, page, key)
            page.set_viewport_size({"width": 384, "height": 317})
            page.locator('[data-testid="app-window-notice-fixture"]').evaluate("el => { el.style.width = '360px'; el.style.height = '240px'; }")
            page.wait_for_timeout(250)
            minimum = page.locator(f"[id='{detail_id}']").evaluate("""el => {
              const r = el.getBoundingClientRect(), text = el.querySelector('.ks-notice-message');
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


