"""명시적 채움 반복 행과 창 알림의 배치·조작 검증."""

from layout_1246_fixtures import FILL_PROGRESS_JS, NARROW, NOTICE_APP, WIDE, fill_progress_scene


def check_fill_progress_notice(page, output, result, open_page, inject, record, capture):
    for width, height in (WIDE, NARROW):
        page.set_viewport_size({"width": width, "height": height})
        open_page(page, result["port"], NOTICE_APP)
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


