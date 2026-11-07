"""로컬 시험 쉘에서 실제 앱 정의의 좁은 창을 캡처하는 sandbox 시나리오.

KS_1072_STORE_ROOT에는 앱별 app.json, store.json과 assets가 있는 폴더를 지정한다.
KS_1072_XOPS_DEF와 KS_1072_XOPS_CLIENT에는 xops 정의와 클라이언트 파일을 지정한다.
연결 원천은 sandbox 실행 시 로컬 표본 서버로 지정한다. 결과는 sandbox --out에 남는다.
"""
import base64
import hashlib
import json
import os
from pathlib import Path


out = Path(sb.out)  # noqa: F821 — sandbox가 제공하는 실행 컨텍스트
root = Path(os.environ["KS_1072_STORE_ROOT"])
metrics = {}


def open_store_app(name):
    directory = root / name
    for asset in json.loads((directory / "store.json").read_text(encoding="utf-8")).get("assets", []):
        data = (directory / asset["file"]).read_bytes()
        request = {key: asset[key] for key in ("id", "version", "format", "source", "license")}
        request.update(sha256=hashlib.sha256(data).hexdigest(), data_base64=base64.b64encode(data).decode())
        result = sb.mcp.call("upload_asset", request)  # noqa: F821
        assert not result["is_error"], result["text"][:300]
    definition = json.loads((directory / "app.json").read_text(encoding="utf-8"))
    result = sb.upload_and_open(definition)  # noqa: F821
    assert result.get("window_id"), result
    return result["window_id"], sb.window(name)  # noqa: F821


def resize(window_id, width, height):
    sb.core({"op": "window.set_rect", "window_id": window_id, "rect": {"x": 20, "y": 40, "width": width, "height": height}})  # noqa: F821
    page.wait_for_timeout(800)  # noqa: F821


def shot(window, name):
    window.screenshot(path=str(out / f"{name}.png"))


page.set_viewport_size({"width": 1440, "height": 900})  # noqa: F821

def preview_split():
    definition = {"id": "split-review", "name": "분할 보기", "requires": {"blocks": 27, "modules": {}},
                  "permissions": [], "state": {}, "ui": {"type": "split", "direction": "row", "column_below": 700,
                  "sizes": [32, 68], "children": [{"type": "text", "value": "목록"}, {"type": "text", "value": "상세"}]}}
    result = sb.mcp.call("preview_app", {"definition": definition})  # noqa: F821
    assert not result["is_error"], result["text"][:500]
    metrics["split-preview"] = result["data"]


def capture_binding():
    error_app = {"id": "binding-error-review", "name": "자료 보기", "requires": {"blocks": 4, "modules": {}},
                 "permissions": [], "state": {}, "ui": {"type": "text", "value": {"expr": "$sqrt('wrong')"}}}
    result = sb.upload_and_open(error_app)  # noqa: F821
    assert result.get("window_id"), result
    wid, win = result["window_id"], sb.window("binding-error-review")  # noqa: F821
    for width in [880, 360]:
        resize(wid, width, 600)
        error = win.get_by_text("DATA_BINDING_EXPR_FAILED")
        error.wait_for(state="visible", timeout=10000)
        assert "wrong" not in win.inner_text()
        shot(win, f"item1-expr-failed-{width}")
    sb.core({"op": "window.close", "window_id": wid})  # noqa: F821


def capture_timeline():
    wid, win = open_store_app("jizura")
    skip = win.get_by_role("button", name="건너뛰기", exact=True)
    for _ in range(40):
        if skip.count():
            skip.first.click()
            break
        page.wait_for_timeout(400)  # noqa: F821
    page.wait_for_timeout(1000)  # noqa: F821
    advanced = win.get_by_text("고급", exact=True)
    if advanced.count() and advanced.first.is_visible():
        advanced.first.click()
    page.wait_for_timeout(1000)  # noqa: F821
    for width, height in [(1200, 760), (360, 600)]:
        resize(wid, width, height)
        timeline = win.locator(".ks-timeline:not(.ks-timeline-dates)").first
        if not timeline.is_visible():
            for tab in win.get_by_role("tab").all():
                if tab.is_visible():
                    tab.click()
                    page.wait_for_timeout(300)  # noqa: F821
                    if timeline.is_visible():
                        break
        timeline.wait_for(state="visible", timeout=5000)
        timeline.scroll_into_view_if_needed()
        metrics[f"timeline-{width}"] = timeline.evaluate("""el => {
          const labels = el.querySelector('.ks-timeline-labels').getBoundingClientRect();
          const controls = el.querySelector('.ks-timeline-controls').getBoundingClientRect();
          return {width: el.getBoundingClientRect().width, labelWidth: labels.width, controlsBottom: controls.bottom, labelsTop: labels.top};
        }""")
        shot(win, f"item2-timeline-{width}")
    sb.core({"op": "window.close", "window_id": wid})  # noqa: F821


def capture_map():
    wid, win = open_store_app("earth")
    for width, height in [(360, 640), (880, 600), (1200, 760)]:
        resize(wid, width, height)
        frame = win.locator(".ks-map-frame").first
        frame.wait_for(state="visible", timeout=30000)
        frame.scroll_into_view_if_needed()
        metrics[f"map-{width}"] = frame.evaluate("""el => {
          const r = el.getBoundingClientRect(), canvas = el.querySelector('.ks-map-canvas').getBoundingClientRect();
          const style = getComputedStyle(el);
          return {height:r.height, canvasHeight:canvas.height, bottomGap:r.bottom-canvas.bottom-parseFloat(style.paddingBottom)-parseFloat(style.borderBottomWidth)};
        }""")
        shot(win, f"item4-earth-map-{width}")
    sb.core({"op": "window.close", "window_id": wid})  # noqa: F821


def capture_xops():
    definition = json.loads(Path(os.environ["KS_1072_XOPS_DEF"]).read_text(encoding="utf-8"))
    metrics["xops-original-sizes"] = definition["ui"]["sizes"]
    # 보관본에는 아이콘 자산 바이트가 없으므로 시험 창의 아이콘 참조만 제거한다.
    definition.pop("icon", None)
    definition["assets"] = [asset for asset in definition["assets"] if asset["id"] != "xops-icon"]
    client = Path(os.environ["KS_1072_XOPS_CLIENT"]).read_bytes()
    upload = {"id": "xops-attach", "version": 1, "format": "javascript", "sha256": hashlib.sha256(client).hexdigest(),
              "source": "시험", "license": "개인 앱 코드", "data_base64": base64.b64encode(client).decode()}
    result = sb.mcp.call("upload_app", {"definition": definition, "open": True, "asset_uploads": [upload]})  # noqa: F821
    assert not result["is_error"], result["text"][:500]
    for _ in range(30):
        if sb.window_of("xops"):  # noqa: F821
            break
        page.wait_for_timeout(500)  # noqa: F821
    wid = sb.window_of("xops")["id"]  # noqa: F821
    win = sb.window("xops")  # noqa: F821
    page.wait_for_timeout(1500)  # noqa: F821
    win.locator("[role=option]").first.click()
    page.wait_for_timeout(1000)  # noqa: F821
    resize(wid, 360, 600)
    metrics["xops-360-original"] = win.locator(".ks-split").first.evaluate("""el => ({stacked:el.classList.contains('is-stacked'), panes:[...el.querySelectorAll(':scope > .ks-split-pane')].map(p => p.getBoundingClientRect().height)})""")
    shot(win, "item3-split-xops-360-original")
    definition["ui"]["sizes"] = [32, 68]
    result = sb.mcp.call("upload_app", {"definition": definition, "open": False})  # noqa: F821
    assert not result["is_error"], result["text"][:500]
    page.wait_for_timeout(1000)  # noqa: F821
    for width, height in [(360, 600), (1200, 800)]:
        resize(wid, width, height)
        metrics[f"xops-{width}"] = win.locator(".ks-split").first.evaluate("""el => ({stacked:el.classList.contains('is-stacked'), panes:[...el.querySelectorAll(':scope > .ks-split-pane')].map(p => p.getBoundingClientRect().height)})""")
        shot(win, f"item3-split-xops-{width}")


for name, capture in [("preview", preview_split), ("binding", capture_binding), ("timeline", capture_timeline), ("map", capture_map), ("xops", capture_xops)]:
    try:
        capture()
    except Exception as error:
        metrics.setdefault("errors", {})[name] = str(error)
        print(f"{name}: {error}", flush=True)
(out / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
if metrics.get("errors"):
    raise RuntimeError("화면 캡처 실패: " + ", ".join(metrics["errors"]))
