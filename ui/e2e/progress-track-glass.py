"""시험 쉘(sandbox)의 유리 창 위에서 진행 막대 트랙이 바탕과 구별되는지 재는 시나리오.

`--app ui/e2e/fixtures/progress-track-app.json`으로 창을 띄운 뒤 실행한다. 이 경로만 유리 바탕과
배경 그림이 실제로 깔리므로, 계산값이 아니라 화면에 그려진 픽셀을 표본으로 뽑는다.
밝음·어두움 창 캡처와 progress-contrast.json을 --out에 남긴다.
"""
import io
import json
from pathlib import Path

from PIL import Image

out = Path(sb.out)  # noqa: F821 — sandbox가 주는 실행 컨텍스트
APP_ID = "progress-track-test"


def luminance(pixel):
    def channel(value):
        value = value / 255
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
    return 0.2126 * channel(pixel[0]) + 0.7152 * channel(pixel[1]) + 0.0722 * channel(pixel[2])


def contrast(one, other):
    high, low = sorted((luminance(one), luminance(other)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def measure(name):
    window = sb.window(APP_ID)  # noqa: F821
    window.wait_for(state="visible", timeout=30000)
    page.wait_for_timeout(1200)  # noqa: F821 — 유리와 그림자가 다 그려질 때까지
    path = out / f"progress-{name}.png"
    data = window.screenshot(path=str(path))
    image = Image.open(io.BytesIO(data)).convert("RGB")
    box = window.bounding_box()
    track = window.locator(".ks-data-progress").first.bounding_box()
    assert box and track, f"{name}: 창이나 0% 막대의 자리를 재지 못했습니다"
    scale_x, scale_y = image.width / box["width"], image.height / box["height"]

    def sample(x, y):
        return image.getpixel((round(x), round(y)))

    center_x = ((track["x"] + track["width"] / 2) - box["x"]) * scale_x
    top = (track["y"] - box["y"]) * scale_y
    bottom = (track["y"] + track["height"] - box["y"]) * scale_y
    track_pixel = sample(center_x, (top + bottom) / 2)
    above = sample(center_x, top - 3 * scale_y)
    below = sample(center_x, bottom + 3 * scale_y)
    return {
        "capture": path.name,
        "track": list(track_pixel),
        "backdrop_above": list(above),
        "backdrop_below": list(below),
        "contrast_above": round(contrast(track_pixel, above), 2),
        "contrast_below": round(contrast(track_pixel, below), 2),
        # 위아래 가운데 잘 보이지 않는 쪽을 그 테마의 값으로 둔다.
        "contrast": round(min(contrast(track_pixel, above), contrast(track_pixel, below)), 2),
    }


window_id = sb.window_of(APP_ID)["id"]  # noqa: F821
sb.core({"op": "window.set_rect", "window_id": window_id,  # noqa: F821
         "rect": {"x": 40, "y": 60, "width": 720, "height": 440}})
page.wait_for_timeout(800)  # noqa: F821

page.emulate_media(color_scheme="light")  # noqa: F821
metrics = {"light": measure("light")}
page.emulate_media(color_scheme="dark")  # noqa: F821
page.wait_for_timeout(800)  # noqa: F821
metrics["dark"] = measure("dark")

(out / "progress-contrast.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(metrics, ensure_ascii=False), flush=True)
