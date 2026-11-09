#!/usr/bin/env python3
"""설정 창의 「화면」 묶음과 테마 줄, 라이트와 다크에서 쉘과 기본 앱 창의 글자 대비를 확인하고 캡처한다.

  python3 -P scripts/visual-check/check_theme.py --src <쉘 판 폴더> [--output 산출폴더] [--only settings|apps|all]

- --src: 바이너리(kaleidoscope-orchestrator, kaleidoscope-devbridge)와 node_modules가 준비된 쉘 판.
  kaleidoscope-app 스킬의 `sandbox.py prepare --ref <sha>` 캐시 폴더(~/.cache/kaleidoscope-sandbox/<sha>)를 주거나,
  이 체크아웃에서 `cargo build -p kaleidoscope-orchestrator -p kaleidoscope-devbridge`와
  `pnpm install --frozen-lockfile`을 끝낸 뒤 생략한다(target/debug 바이너리를 쓴다).
- 브라우저 개발 경로에는 네이티브 창이 없어 고른 테마가 화면에 적용되지 않는다. 라이트와 다크는
  Playwright의 color scheme 에뮬레이션으로 그린다. 실제 창의 웹 내용도 같은 prefers-color-scheme로 그려진다.
- 글자 대비는 화면 픽셀로 잰다. 보통 화면과 글자만 투명하게 만든 화면을 찍어, 글자 자리의 배경색 중앙값 위에
  글자 색(투명도와 조상 opacity 반영)을 얹어 WCAG 대비를 계산한다. 4.5 미만(큰 글자 3 미만)을 낮은 대비로 남기고,
  낮은 대비 글자에 빨간 상자를 그린 `*-low.png`를 함께 남긴다.
"""
import argparse
import importlib.util
import json
import os
import shutil
import statistics
import sys
import tempfile
import time
from pathlib import Path

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
VIEWPORT = (1440, 900)
SCHEMES = ("light", "dark")
APPS = (
    # (앱 id, 창 크기, 폴더 권한을 고를지)
    ("explorer", (980, 620), True),
    ("md-editor", (980, 620), True),
    ("profiler", (980, 620), False),
    ("agent", (980, 620), False),
    ("store", (980, 620), False),
    ("html-report", (980, 620), False),
)

TEXT_JS = r"""
(root) => {
  const out = [];
  const seen = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || seen.has(el) || el.closest(".ks-accessible-hidden, [hidden]")) continue;
    seen.add(el);
    const range = document.createRange(); range.selectNodeContents(node);
    const rect = [...range.getClientRects()].find((r) => r.width > 2 && r.height > 4);
    if (!rect) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== "visible") continue;
    let opacity = 1;
    for (let e = el; e; e = e.parentElement) opacity *= parseFloat(getComputedStyle(e).opacity);
    if (opacity < 0.05) continue;
    const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || !(el.contains(hit) || hit.contains(el))) continue;
    out.push({
      text: text.slice(0, 48),
      color: cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color ? cs.webkitTextFillColor : cs.color,
      size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10) || 400, opacity,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      disabled: Boolean(el.closest(":disabled, [aria-disabled='true']")),
      where: (el.closest("[class]")?.className || el.tagName).toString().slice(0, 70),
    });
  }
  return out;
}
"""

HIDE_TEXT_CSS = ("*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important;"
                 " text-shadow: none !important; caret-color: transparent !important; transition: none !important; }")


def load_sandbox():
    common = os.environ.get("AGENT_COMMON_FILES_DIR")
    if not common:
        sys.exit("AGENT_COMMON_FILES_DIR가 없습니다. kaleidoscope-app 스킬이 설치된 노드에서 실행하세요.")
    path = Path(common) / "skills/kaleidoscope-app/scripts/sandbox.py"
    spec = importlib.util.spec_from_file_location("kaleidoscope_sandbox", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def wait_until(fn, seconds, message):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError(message)


def parse_rgba(value):
    inner = value[value.index("(") + 1:value.rindex(")")].replace("/", " ").replace(",", " ").split()
    if value.startswith("color("):
        inner = inner[1:]
        rgb = [float(v) * 255 for v in inner[:3]]
    else:
        rgb = [float(v) for v in inner[:3]]
    alpha = 1.0
    if len(inner) > 3:
        alpha = float(inner[3][:-1]) / 100 if inner[3].endswith("%") else float(inner[3])
    return rgb, alpha


def luminance(rgb):
    def channel(c):
        c = c / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def measure_contrast(page, root, output, name):
    """보통 화면과 글자를 지운 화면을 찍어 글자마다 대비를 잰다."""
    page.wait_for_timeout(300)
    items = root.evaluate(TEXT_JS)
    shot = output / f"{name}.png"
    page.screenshot(path=str(shot))
    style = page.add_style_tag(content=HIDE_TEXT_CSS)
    page.wait_for_timeout(150)
    bg_path = output / f".{name}-bg.png"
    page.screenshot(path=str(bg_path))
    style.evaluate("el => el.remove()")
    page.wait_for_timeout(100)
    bg = Image.open(bg_path).convert("RGB")
    scale = bg.width / VIEWPORT[0]
    results = []
    for item in items:
        r = item["rect"]
        box = (int(r["x"] * scale), int(r["y"] * scale), int((r["x"] + r["w"]) * scale), int((r["y"] + r["h"]) * scale))
        box = (max(0, box[0]), max(0, box[1]), min(bg.width, box[2]), min(bg.height, box[3]))
        if box[2] - box[0] < 2 or box[3] - box[1] < 2:
            continue
        pixels = list(bg.crop(box).get_flattened_data()) if hasattr(Image.Image, 'get_flattened_data') else list(bg.crop(box).getdata())
        back = [statistics.median(p[i] for p in pixels) for i in range(3)]
        rgb, alpha = parse_rgba(item["color"])
        alpha *= item["opacity"]
        fore = [rgb[i] * alpha + back[i] * (1 - alpha) for i in range(3)]
        ratio = round(contrast(fore, back), 2)
        large = item["size"] >= 24 or (item["size"] >= 18.66 and item["weight"] >= 700)
        need = 3.0 if large else 4.5
        results.append({**item, "background": [round(v) for v in back], "effective": [round(v) for v in fore],
                        "ratio": ratio, "need": need, "low": ratio < need})
    bg_path.unlink(missing_ok=True)
    low = [x for x in results if x["low"]]
    if low:
        image = Image.open(shot).convert("RGB")
        draw = ImageDraw.Draw(image)
        for x in low:
            r = x["rect"]
            draw.rectangle([r["x"] * scale - 2, r["y"] * scale - 2, (r["x"] + r["w"]) * scale + 2, (r["y"] + r["h"]) * scale + 2],
                           outline=(255, 0, 0), width=2)
        image.save(output / f"{name}-low.png")
    print(f"capture {shot} texts={len(results)} low={len(low)}", flush=True)
    return {"capture": str(shot), "texts": len(results), "min_ratio": min((x["ratio"] for x in results), default=None),
            "low": low, "disabled": [x for x in results if x["disabled"]]}


def open_settings(page):
    win = page.get_by_test_id("system-window-settings")
    if not win.is_visible():
        page.locator(".ks-shell-bar").get_by_role("button", name="설정", exact=True).click()
    win.wait_for(state="visible", timeout=20000)
    return win


def settings_metrics(win):
    return win.evaluate("""(win) => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
      const scroll = win.querySelector('.ks-shell-settings');
      const groups = [...win.querySelectorAll('.ks-settings-group')].map((g) => ({ title: g.querySelector('h3')?.textContent, rect: r(g),
        header: r(g.querySelector('h3')), firstRow: r(g.querySelector('.ks-settings-row')), label: r(g.querySelector('.ks-settings-row-label')),
        control: r(g.querySelector('.ks-settings-row-control > *')), controlButtons: [...g.querySelectorAll('.ks-settings-row-control button')].slice(0, 4).map(r),
        labelFont: g.querySelector('.ks-settings-row-label') ? getComputedStyle(g.querySelector('.ks-settings-row-label')).fontSize : null,
        headerFont: g.querySelector('h3') ? getComputedStyle(g.querySelector('h3')).fontSize : null,
        marginTop: getComputedStyle(g).marginTop }));
      const hint = [...win.querySelectorAll('.ks-settings-group')].find((g) => g.querySelector('h3')?.textContent === '화면')?.querySelector('.ks-settings-row-text > :not(.ks-settings-row-label)');
      return { window: r(win), scroll: { scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight, scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth, overflowY: scroll.scrollHeight - scroll.clientHeight },
        body: r(win.querySelector('.ks-shell-settings-body')), groups, hint: hint ? { text: hint.textContent, rect: r(hint), font: getComputedStyle(hint).fontSize, color: getComputedStyle(hint).color } : null };
    }""")


def theme_group(win):
    return win.locator(".ks-settings-group", has=win.page.get_by_role("heading", name="화면", exact=True))


def narrow_settings(page, win):
    corner = win.locator(".ks-window-resize-east").bounding_box()
    page.mouse.move(corner["x"] + corner["width"] / 2, corner["y"] + corner["height"] / 2)
    page.mouse.down()
    page.mouse.move(corner["x"] - 1000, corner["y"] + corner["height"] / 2)
    page.mouse.up()
    page.wait_for_timeout(300)


def run_settings(sb, page, output, result):
    out = result.setdefault("settings", {})
    win = open_settings(page)
    page.wait_for_timeout(600)
    group = theme_group(win)
    group.wait_for(state="visible", timeout=10000)
    for scheme in SCHEMES:
        page.emulate_media(color_scheme=scheme)
        page.wait_for_timeout(400)
        # 기본 크기, 시스템(안내 글 보임)
        group.get_by_role("button", name="시스템", exact=True).click()
        page.wait_for_timeout(400)
        system = settings_metrics(win)
        out[f"{scheme}-system-default"] = {"metrics": system, "contrast": measure_contrast(page, win, output, f"settings-{scheme}-system")}
        win.screenshot(path=str(output / f"settings-{scheme}-system-window.png"))
        # 다크를 고르면 안내 글이 사라진다
        group.get_by_role("button", name="다크", exact=True).click()
        page.wait_for_timeout(400)
        chosen = settings_metrics(win)
        out[f"{scheme}-dark-default"] = {"metrics": chosen}
        win.screenshot(path=str(output / f"settings-{scheme}-dark-window.png"))
        group.get_by_role("button", name="라이트", exact=True).click()
        page.wait_for_timeout(400)
        win.screenshot(path=str(output / f"settings-{scheme}-light-window.png"))
        out[f"{scheme}-jump"] = {
            "theme_group_height_system": next(g for g in system["groups"] if g["title"] == "화면")["rect"]["h"],
            "theme_group_height_dark": next(g for g in chosen["groups"] if g["title"] == "화면")["rect"]["h"],
            "next_header_top_system": next(g for g in system["groups"] if g["title"] == "바탕화면")["header"]["top"],
            "next_header_top_dark": next(g for g in chosen["groups"] if g["title"] == "바탕화면")["header"]["top"],
        }
    # 기본 크기 창의 아래까지 내린 캡처
    page.emulate_media(color_scheme="light")
    group.get_by_role("button", name="시스템", exact=True).click()
    win.locator(".ks-shell-settings").evaluate("el => el.scrollTo(0, el.scrollHeight)")
    page.wait_for_timeout(300)
    win.screenshot(path=str(output / "settings-light-system-scrolled-bottom.png"))
    win.locator(".ks-shell-settings").evaluate("el => el.scrollTo(0, 0)")

    # 저장 실패: 코어 응답을 오류로 바꿔 끼운다(실제 저장 실패 대신 대체)
    sample = sb.core({"op": "window.raise", "window_id": "no-such-window"}).get("error")
    out["error_sample_shape"] = sample

    def fail_theme(route, request):
        body = request.post_data or ""
        if '"theme.set"' in body and isinstance(sample, dict):
            route.fulfill(status=400, content_type="application/json", body=json.dumps(sample, ensure_ascii=False))
        else:
            route.continue_()

    page.route(f"{sb.bridge}/core", fail_theme)
    for scheme in SCHEMES:
        page.emulate_media(color_scheme=scheme)
        group.get_by_role("button", name="다크", exact=True).click()
        page.wait_for_timeout(500)
        win.screenshot(path=str(output / f"settings-{scheme}-error-window.png"))
        out[f"{scheme}-error"] = {"metrics": settings_metrics(win)}
    page.unroute(f"{sb.bridge}/core")
    group.get_by_role("button", name="시스템", exact=True).click()
    page.wait_for_timeout(400)

    # 최소 폭
    narrow_settings(page, win)
    for scheme in SCHEMES:
        page.emulate_media(color_scheme=scheme)
        group.get_by_role("button", name="시스템", exact=True).click()
        page.wait_for_timeout(400)
        out[f"{scheme}-system-narrow"] = {"metrics": settings_metrics(win)}
        win.screenshot(path=str(output / f"settings-{scheme}-system-narrow-window.png"))
        group.get_by_role("button", name="다크", exact=True).click()
        page.wait_for_timeout(400)
        out[f"{scheme}-dark-narrow"] = {"metrics": settings_metrics(win)}
        win.screenshot(path=str(output / f"settings-{scheme}-dark-narrow-window.png"))
    group.get_by_role("button", name="시스템", exact=True).click()
    win.get_by_role("button", name="창 닫기").click()
    page.wait_for_timeout(300)

    # 하네스: CI가 보는 기본 크기 설정 창(링크 연결됨)
    harness = {}
    for state in ("connected", "embedded"):
        page.goto(f"http://localhost:1420/harness.html?preview=shell-settings&link={state}", wait_until="load")
        page.emulate_media(color_scheme="light")
        hwin = open_settings(page)
        page.wait_for_timeout(600)
        harness[state] = settings_metrics(hwin)
        hwin.screenshot(path=str(output / f"harness-settings-{state}-window.png"))
    out["harness"] = harness


def run_apps(sb, page, output, result, folder):
    out = result.setdefault("screens", {})
    snapshot = sb.snapshot()
    workspace = snapshot["device"]["active_workspace_id"]
    desktop = snapshot["device"]["active_desktop_ids"][workspace]
    for scheme in SCHEMES:
        page.emulate_media(color_scheme=scheme)
        page.wait_for_timeout(500)
        out[f"desktop-{scheme}"] = measure_contrast(page, page.locator("body"), output, f"desktop-{scheme}")
    for app_id, (width, height), pick in APPS:
        opened = sb.core({"op": "window.open", "desktop_id": desktop, "app_id": app_id,
                          "rect": {"x": 40, "y": 30, "width": width, "height": height}})
        if "window" not in opened:
            out[app_id] = {"error": opened}
            continue
        window_id = opened["window"]["id"]
        app = sb.window(app_id)
        try:
            app.wait_for(state="visible", timeout=60000)
        except Exception as error:  # noqa: BLE001 - 열리지 않은 창은 결과에 남기고 다음 앱으로
            out[app_id] = {"error": str(error)}
            continue
        if pick:
            definition = json.loads((ROOT / "apps" / f"{app_id}.json").read_text(encoding="utf-8"))
            for perm in (p["id"] for p in definition.get("permissions", []) if p.get("module") == "files"):
                picked = sb.core({"op": "files.pick_folder", "window_id": window_id, "permission": perm})
                if "error" in picked:
                    out.setdefault("pick_errors", {})[app_id] = picked["error"]
        page.wait_for_timeout(2500)
        for scheme in SCHEMES:
            page.emulate_media(color_scheme=scheme)
            page.wait_for_timeout(700)
            out[f"{app_id}-{scheme}"] = measure_contrast(page, app, output, f"{app_id}-{scheme}")
            app.screenshot(path=str(output / f"{app_id}-{scheme}-window.png"))
        sb.core({"op": "window.close", "window_id": window_id})
        page.wait_for_timeout(500)


def run_interact(sb, page, output, result):
    """새 테마 줄의 키보드 초점, 화살표와 Space 선택, 더블클릭 글자 선택을 본다."""
    out = result.setdefault("interact", {})
    win = open_settings(page)
    page.wait_for_timeout(600)
    group = theme_group(win)
    system = group.get_by_role("button", name="시스템", exact=True)
    system.click()
    for scheme in SCHEMES:
        page.emulate_media(color_scheme=scheme)
        system.focus()
        page.keyboard.press("Tab")
        page.wait_for_timeout(300)
        focused = page.evaluate("() => document.activeElement?.textContent")
        group.screenshot(path=str(output / f"interact-{scheme}-focus-tab.png"))
        out[f"{scheme}-tab-focus"] = focused
        page.keyboard.press("Space")
        page.wait_for_timeout(400)
        out[f"{scheme}-space-pressed"] = group.get_by_role("button", name="라이트", exact=True).get_attribute("aria-pressed")
        group.screenshot(path=str(output / f"interact-{scheme}-focus-space.png"))
        system.click()
        page.wait_for_timeout(300)
    for name in ("다크", "테마"):
        target = group.get_by_role("button", name=name, exact=True) if name == "다크" else group.get_by_text("테마", exact=True)
        target.dblclick()
        page.wait_for_timeout(200)
        out[f"dblclick-{name}-selection"] = page.evaluate("() => String(getSelection())")
    hint = group.get_by_text("운영체제 설정을 따릅니다")
    system.click()
    page.wait_for_timeout(300)
    if hint.count():
        hint.dblclick()
        out["dblclick-hint-selection"] = page.evaluate("() => String(getSelection())")
    system.click()


def run_content(sb, page, output, result):
    """내용이 찬 화면: 마크다운 편집기에서 폴더 문서를 열고, 탐색기에서 이 PC 파일을 허용한다."""
    out = result.setdefault("content", {})
    snapshot = sb.snapshot()
    workspace = snapshot["device"]["active_workspace_id"]
    desktop = snapshot["device"]["active_desktop_ids"][workspace]
    steps = {
        "md-editor": lambda app: (app.get_by_role("tab", name="내 폴더").click(), page.wait_for_timeout(1500),
                                  app.get_by_text("긴 문서.md").first.click(), page.wait_for_timeout(2500)),
        "explorer": lambda app: (app.get_by_role("button", name="이 PC의 파일 읽기 허용").click(), page.wait_for_timeout(2500)),
    }
    for app_id, step in steps.items():
        opened = sb.core({"op": "window.open", "desktop_id": desktop, "app_id": app_id,
                          "rect": {"x": 40, "y": 30, "width": 980, "height": 620}})
        window_id = opened["window"]["id"]
        app = sb.window(app_id)
        app.wait_for(state="visible", timeout=60000)
        definition = json.loads((ROOT / "apps" / f"{app_id}.json").read_text(encoding="utf-8"))
        for perm in (p["id"] for p in definition.get("permissions", []) if p.get("module") == "files"):
            sb.core({"op": "files.pick_folder", "window_id": window_id, "permission": perm})
        page.wait_for_timeout(1500)
        try:
            step(app)
        except Exception as error:  # noqa: BLE001 - 단계가 막히면 그 상태를 그대로 찍고 사유를 남긴다
            out[f"{app_id}-step-error"] = str(error)[:400]
        for scheme in SCHEMES:
            page.emulate_media(color_scheme=scheme)
            page.wait_for_timeout(700)
            out[f"{app_id}-{scheme}"] = measure_contrast(page, app, output, f"content-{app_id}-{scheme}")
            app.screenshot(path=str(output / f"content-{app_id}-{scheme}-window.png"))
        sb.core({"op": "window.close", "window_id": window_id})
        page.wait_for_timeout(500)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, default=ROOT / "target/visual-check/theme")
    parser.add_argument("--only", choices=("settings", "apps", "content", "interact", "all"), default="all")
    args = parser.parse_args()
    src = args.src.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    sandbox = load_sandbox()
    warm = sandbox.warm_file
    sandbox.warm_file = lambda path: warm(path) if Path(path).exists() else None
    address, ui_lock = sandbox.acquire_ui_address()
    result = {"src": str(src), "head": None, "console": []}
    head = src / ".ready"
    result["head"] = head.read_text().strip() if head.exists() else None
    with ui_lock, tempfile.TemporaryDirectory(prefix="ks-theme-visual-") as directory:
        folder = Path(directory) / "folder"
        shutil.copytree(ROOT / "app/e2e/fixtures/documents", folder)
        pc_roots = json.dumps([{"id": "documents", "kind": "known", "name": "문서", "path": str(folder)}], ensure_ascii=False)
        sb = sandbox.Sandbox(src, output, folder, address, pc_roots=pc_roots)
        spawn = sb._spawn

        def local_spawn(name, command, **env):
            binary = Path(command[0]).name
            if name in ("server", "bridge") and not (src / binary).exists():
                command[0] = str(src / "target/debug" / binary)
            return spawn(name, command, **env)

        sb._spawn = local_spawn
        browser = None
        try:
            sb.start()
            with sync_playwright() as playwright:
                browser = sb.open_page(playwright, VIEWPORT)
                page = sb.page
                if args.only in ("apps", "all"):
                    run_apps(sb, page, output, result, folder)
                if args.only in ("interact", "all"):
                    run_interact(sb, page, output, result)
                if args.only in ("content", "all"):
                    run_content(sb, page, output, result)
                if args.only in ("settings", "all"):
                    run_settings(sb, page, output, result)
                result["console"] = sb.console[-20:]
        finally:
            if browser is not None:
                try:
                    browser.close()
                except Exception:  # noqa: BLE001 - 이미 닫힌 화면은 정리만 건너뛴다
                    pass
            sb.stop()

    (output / f"result-{args.only}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
