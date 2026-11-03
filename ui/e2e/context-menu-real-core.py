"""kaleidoscope-app-test 로컬 실제 코어 시나리오. page, sb는 시험 쉘이 제공한다."""
import json
import time

page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin="http://localhost:1420")
win = sb.window("ctx-menu-test")
window_id = sb.window_of("ctx-menu-test")["id"]
sb.core({"op": "window.set_rect", "window_id": window_id, "rect": {"x": 40, "y": 60, "width": 1000, "height": 640}})
input_box = win.locator("input").first
input_box.wait_for()
result = {"delayed": 0}


def delay_core(route):
    request = route.request
    if request.method == "POST" and request.post_data_json.get("op") == "data.act":
        response = route.fetch()
        result["delayed"] += 1
        time.sleep(0.4)
        route.fulfill(response=response)
    else:
        route.continue_()


page.route("**/core", delay_core)
page.evaluate("() => navigator.clipboard.writeText('ab')")
input_box.click()
page.keyboard.press("Control+a")
page.keyboard.type("cde", delay=40)
page.keyboard.press("Home")
page.keyboard.press("Shift+F10")
page.screenshot(path=str(sb.out / "20261104-0200-input-focus.png"))
page.wait_for_timeout(650)
page.keyboard.press("Enter")
page.wait_for_timeout(200)
result["paste_immediate"] = input_box.input_value()
assert result["paste_immediate"] == "abcde", result
page.wait_for_timeout(1200)
result["paste_after_wait"] = input_box.input_value()
page.unroute("**/core", delay_core)
assert result["delayed"] > 0, result

input_box.click()
page.keyboard.press("Control+a")
page.keyboard.type("abcde", delay=40)
page.keyboard.press("Home")
page.keyboard.press("Shift+ArrowRight")
page.keyboard.press("Shift+ArrowRight")
page.keyboard.press("Shift+F10")
page.wait_for_timeout(500)
page.keyboard.press("Enter")
page.wait_for_timeout(300)
result["cut"] = input_box.input_value()
result["clipboard"] = page.evaluate("() => navigator.clipboard.readText()")
assert result["cut"] == "cde" and result["clipboard"] == "ab", result

win.get_by_role("tab", name="코드").click()
editor = win.locator(".cm-content").first
editor.click()
page.keyboard.press("Home")
page.keyboard.press("Shift+F10")
page.screenshot(path=str(sb.out / "20261104-0200-code-keyboard.png"))
page.keyboard.press("Escape")

settings = win.get_by_role("button", name="앱 설정")
settings.click()
win.locator(".ks-window-titlebar").click(button="right", position={"x": 200, "y": 12})
assert page.get_by_role("menuitem", name="앱 설정").get_attribute("aria-current") == "true"
page.screenshot(path=str(sb.out / "20261104-0200-title-settings.png"))
page.keyboard.press("Escape")
settings.click()
win.locator(".ks-window-titlebar").click(button="right", position={"x": 200, "y": 12})
page.get_by_role("menuitem", name="같이 보기").click()
page.wait_for_timeout(1000)
win.locator(".ks-window-titlebar").click(button="right", position={"x": 200, "y": 12})
assert page.get_by_role("menuitem", name="같이 보기").get_attribute("aria-current") == "true"
page.screenshot(path=str(sb.out / "20261104-0200-title-sharing.png"))
page.keyboard.press("Escape")

page.locator(f'.ks-taskbar-window[data-window-id="{window_id}"]').click(button="right")
menu = page.get_by_role("menu")
assert menu.get_by_role("menuitem", name="창 최소화").count() == 1
assert menu.get_by_role("menuitem", name="창 최대화").count() == 1
assert "ks-menu-item-danger" not in (menu.get_by_role("menuitem", name="창 닫기").get_attribute("class") or "")
page.screenshot(path=str(sb.out / "20261104-0200-taskbar.png"))
page.keyboard.press("Escape")

win.get_by_role("tab", name="HTML").click()
# sandbox 블록의 프레임은 입력 식별자로 구분한다.
frame = next(frame for frame in page.frames if frame.locator("#sbin").count())
frame_input = frame.locator("#sbin")
frame_input.click()
frame_input.press("End")
page.evaluate("() => navigator.clipboard.writeText('추가')")
frame_input.click(button="right")
page.get_by_role("menuitem", name="붙여넣기").wait_for()
page.screenshot(path=str(sb.out / "20261104-0200-frame-input.png"))
page.get_by_role("menuitem", name="붙여넣기").click()
frame_input.wait_for()
page.wait_for_timeout(300)
result["frame"] = frame_input.input_value()
assert result["frame"] == "프레임 입력칸추가", result
(sb.out / "context-menu-real-core.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print("PASS 실제 코어 지연 입력·잘라내기·창 메뉴·프레임 입력", flush=True)
