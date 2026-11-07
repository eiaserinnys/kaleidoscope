"""실제 코어와 시험 쉘에서 데스크톱별 바탕화면을 올리고 전환과 다시 열기를 확인한다."""
import base64
import json
import struct
import time
import zlib


def wait(predicate, label, timeout=30.0):
    end = time.time() + timeout
    while time.time() < end:
        value = predicate()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError(f"{label}을 기다리다 시간이 지났습니다")


def png(width, height, pixel):
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw.extend(pixel(x, y))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 6))
            + chunk(b"IEND", b""))


def bright(x, y):
    # 밝고 복잡한 그림: 큰 색 띠와 어두운 원이 섞인다.
    red = 186 + int(62 * ((x // 24) % 2))
    green = 168 + int(74 * ((y // 18) % 2))
    blue = 120 + int(120 * (((x + y) // 30) % 2))
    if (x - 150) ** 2 + (y - 120) ** 2 < 48 ** 2:
        red, green, blue = 28, 66, 120
    if (x - 380) ** 2 + (y - 70) ** 2 < 36 ** 2:
        red, green, blue = 220, 40, 60
    return min(red, 255), min(green, 255), min(blue, 255)


def dark(x, y):
    # 어두운 그림: 남색 그라데이션과 드문 별.
    value = 10 + int(30 * y / 270)
    red, green, blue = value // 2, value // 2 + 8, value + 32
    if (x * 37 + y * 17) % 113 == 0:
        red = green = blue = 224
    return red, green, blue


snap = sb.snapshot()
assert snap["link"]["state"] == "connected", snap["link"]
workspace = snap["device"]["active_workspace_id"]
sb.core({"op": "desktop.create", "workspace_id": workspace, "name": "밤 하늘"})
snap = sb.snapshot()
desktops = sorted([desktop for desktop in snap["shared"]["desktops"] if desktop["workspace_id"] == workspace],
                  key=lambda desktop: desktop["position"])
assert len(desktops) == 2, desktops
day, night = desktops
sb.core({"op": "desktop.activate", "desktop_id": day["id"]})


def wallpapers():
    return sb.snapshot()["shared"].get("desktop_wallpapers") or []


def record_for(desktop_id):
    return next((item for item in wallpapers() if item["desktop_id"] == desktop_id), None)


def media_for(desktop_id):
    reply = sb.core({"op": "desktop.wallpaper.media", "desktop_id": desktop_id})
    return (reply.get("media") or {}).get("data_base64")


def layer_url():
    return page.evaluate("() => document.querySelector('.ks-wallpaper-layer')?.style.backgroundImage ?? null")


def wait_layer(predicate, label):
    return wait(lambda: (lambda value: value if value and predicate(value) else None)(layer_url()), label)


def wait_idle():
    wait(lambda: page.locator(".ks-wallpaper-picker").get_attribute("aria-busy") != "true", "올리기 끝")


bright_png = png(480, 270, bright)
night_png = png(480, 270, dark)

page.locator('.ks-shell-bar button[aria-label="설정"]').click()
page.get_by_role("heading", name="바탕화면").wait_for(timeout=20_000)
page.get_by_test_id("system-window-settings").get_by_role("button", name="창 최대화").click()
page.wait_for_timeout(300)


def scroll_settings():
    page.get_by_test_id("system-window-settings").locator(".ks-app-settings-scroll").evaluate(
        """(element) => {
          const heading = Array.from(element.querySelectorAll('h3')).find((node) => node.textContent === '바탕화면');
          if (!heading) return;
          const offset = heading.getBoundingClientRect().top - element.getBoundingClientRect().top;
          element.scrollTop = element.scrollTop + offset - 12;
        }""")
    page.wait_for_timeout(200)


# 바탕화면 구역이 창 아래로 잘리지 않게 창을 키우고 그 구역까지 내린다.
scroll_settings()
page.screenshot(path=str(sb.out / "settings-wide-light.png"))


def upload(desktop_id, data, name):
    before = record_for(desktop_id)
    before_asset = before["asset"]["id"] if before else None
    page.locator('input[aria-label="배경 그림 파일"]').set_input_files(
        {"name": name, "mimeType": "image/png", "buffer": data})
    record = wait(lambda: (lambda item: item if item and item["asset"]["id"] != before_asset else None)(
        record_for(desktop_id)), f"{name} 올리기")
    expected = base64.b64encode(data).decode()
    wait(lambda: media_for(desktop_id) == expected, f"{name} 미디어 왕복")
    wait_idle()
    return record


bright_record = upload(day["id"], bright_png, "bright.png")
scroll_settings()
page.screenshot(path=str(sb.out / "settings-wide-light-bright.png"))
scroll_settings()
page.get_by_role("button", name="바탕화면 데스크톱").click()
page.get_by_role("menuitem", name=night["name"]).click()
night_record = upload(night["id"], night_png, "night.png")
scroll_settings()
page.screenshot(path=str(sb.out / "settings-wide-light-night.png"))

page.set_viewport_size({"width": 760, "height": 900})
page.wait_for_timeout(300)
scroll_settings()
page.screenshot(path=str(sb.out / "settings-narrow-light.png"))
page.emulate_media(color_scheme="dark")
page.wait_for_timeout(400)
scroll_settings()
page.screenshot(path=str(sb.out / "settings-narrow-dark.png"))
page.set_viewport_size({"width": 1440, "height": 900})
page.wait_for_timeout(400)
scroll_settings()
page.screenshot(path=str(sb.out / "settings-wide-dark.png"))
page.emulate_media(color_scheme="light")
page.wait_for_timeout(300)

# 올리는 동안의 화면은 요청을 붙잡아, 실패한 화면은 서버가 받지 않는 그림으로 재현한다.
held = []
seen = []
recorded = []
page.on("request", lambda request: recorded.append({
    "method": request.method, "url": request.url, "post_bytes": len(request.post_data or "")})
    if request.method == "POST" else None)


def hold_upload(route):
    request = route.request
    data = request.post_data or ""
    seen.append({"method": request.method, "url": request.url, "bytes": len(data),
                 "upload": "desktop.wallpaper.upload" in data})
    if request.method == "POST" and "desktop.wallpaper.upload" in data:
        held.append(route)
    else:
        route.continue_()


page.context.route("**/core", hold_upload)
busy_captured = False
scroll_settings()
try:
    page.locator('input[aria-label="배경 그림 파일"]').set_input_files(
        {"name": "깨진 그림.png", "mimeType": "image/png", "buffer": b"\x00" * 4096})
    try:
        wait(lambda: bool(held), "올리기 요청 가로채기", timeout=8)
    except AssertionError:
        pass
    page.wait_for_timeout(300)
    if page.locator(".ks-wallpaper-picker").get_attribute("aria-busy") == "true":
        page.screenshot(path=str(sb.out / "upload-busy.png"))
        busy_captured = True
    if held:
        held.pop().continue_()
    alert = page.get_by_role("alert").first
    alert.wait_for(timeout=20_000)
    scroll_settings()
    page.screenshot(path=str(sb.out / "upload-error.png"))
    error_text = alert.inner_text()
finally:
    page.context.unroute("**/core")
assert record_for(night["id"])["asset"]["id"] == night_record["asset"]["id"], "실패한 올리기가 이전 그림을 바꿨습니다"
wait_idle()
(sb.out / "wallpaper-debug.json").write_text(json.dumps(
    {"busy_captured": busy_captured, "held": len(held), "route_seen": seen, "post_requests": recorded,
     "input": page.evaluate("""() => {
       const input = document.querySelector('input[aria-label="배경 그림 파일"]');
       return input ? { disabled: input.disabled, files: input.files.length, type: input.type } : null;
     }""")}, ensure_ascii=False, indent=2), encoding="utf-8")

APP_ID = "wallpaper-window"
page.get_by_test_id("system-window-settings").get_by_role("button", name="창 닫기").click()
wait(lambda: page.get_by_test_id("system-window-settings").count() == 0, "설정 창 닫기")
sb.core({"op": "window.open", "desktop_id": night["id"], "app_id": APP_ID,
         "rect": {"x": 120, "y": 90, "width": 760, "height": 560}})
night_window = wait(lambda: next((window for window in sb.snapshot()["shared"]["windows"]
                                  if window["desktop_id"] == night["id"] and window["app_id"] == APP_ID), None),
                    "밤 데스크톱 앱 창")

sb.core({"op": "desktop.activate", "desktop_id": day["id"]})
day_url = wait_layer(lambda value: "none" not in value, "낮 데스크톱 배경")
page.wait_for_timeout(500)
page.screenshot(path=str(sb.out / "switch-desktop-1.png"))


def contrast(selector):
    box = page.locator(selector).first.bounding_box()
    if not box or box["width"] < 4 or box["height"] < 4:
        return None
    shot = page.screenshot(clip={"x": box["x"], "y": box["y"], "width": box["width"], "height": box["height"]})
    return page.evaluate("""async ({b64}) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + b64;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const values = [];
      for (let index = 0; index < data.length; index += 4) {
        const linear = (value) => {
          const channel = value / 255;
          return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
        };
        values.push(0.2126 * linear(data[index]) + 0.7152 * linear(data[index + 1]) + 0.0722 * linear(data[index + 2]));
      }
      values.sort((left, right) => left - right);
      const at = (share) => values[Math.min(values.length - 1, Math.floor(values.length * share))];
      const low = at(0.05), high = at(0.95);
      return { low, high, ratio: (high + 0.05) / (low + 0.05), pixels: values.length };
    }""", {"b64": base64.b64encode(shot).decode()})


day_window = wait(lambda: next((window for window in sb.snapshot()["shared"]["windows"]
                                if window["desktop_id"] == day["id"] and window["app_id"] == APP_ID), None),
                  "낮 데스크톱 앱 창")
wait(lambda: page.locator(f'[data-window-id="{day_window["id"]}"]').count() > 0, "낮 창 그리기")
day_metrics = {
    "title": contrast(f'[data-window-id="{day_window["id"]}"] .ks-window-titlebar'),
    "body": contrast(f'[data-window-id="{day_window["id"]}"] .ks-window-content'),
    "bar": contrast(".ks-shell-bar"),
}
page.screenshot(path=str(sb.out / "contrast-bright.png"))

sb.core({"op": "desktop.activate", "desktop_id": night["id"]})
night_url = wait_layer(lambda value: value != day_url and "none" not in value, "밤 데스크톱 배경")
wait(lambda: page.locator(f'[data-window-id="{night_window["id"]}"]').count() > 0, "밤 창 그리기")
page.wait_for_timeout(500)
page.screenshot(path=str(sb.out / "switch-desktop-2.png"))
night_metrics = {
    "title": contrast(f'[data-window-id="{night_window["id"]}"] .ks-window-titlebar'),
    "body": contrast(f'[data-window-id="{night_window["id"]}"] .ks-window-content'),
    "bar": contrast(".ks-shell-bar"),
}
page.screenshot(path=str(sb.out / "contrast-dark.png"))

page.reload()
page.wait_for_selector(".ks-desktop-canvas:not([hidden])", state="visible", timeout=60_000)
wait(lambda: sb.snapshot()["link"]["state"] == "connected", "다시 열기 뒤 연결")
reload_url = wait_layer(lambda value: "none" not in value, "다시 열기 뒤 배경")
assert reload_url != "none", reload_url
assert media_for(day["id"]) == base64.b64encode(bright_png).decode(), "다시 연 뒤 낮 그림이 다릅니다"
assert media_for(night["id"]) == base64.b64encode(night_png).decode(), "다시 연 뒤 밤 그림이 다릅니다"

result = {
    "desktops": {"day": day["name"], "night": night["name"]},
    "records": {"day": bright_record["asset"], "night": night_record["asset"]},
    "media_round_trip": True,
    "busy_captured": busy_captured,
    "switch": {"day": day_url, "night": night_url, "different": day_url != night_url},
    "reload": {"background": reload_url, "records": len(wallpapers())},
    "error_text": error_text[:300],
    "contrast": {"bright": day_metrics, "dark": night_metrics},
}
(sb.out / "wallpaper.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False))
