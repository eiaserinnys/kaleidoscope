import json
import sqlite3
import time
from pathlib import Path


window = sb.window_of("md-editor")
assert window is not None, "마크다운 편집기 창을 열지 못했습니다"
window_id = window["id"]
initial_content = "# Direct server document\ninitial"


def core(request):
    reply = sb.core(request)
    assert "error" not in reply, f"Core 요청 실패: {reply}"
    return reply


def write_document(name, content):
    return core({
        "op": "storage.write",
        "window_id": window_id,
        "entry": "documents",
        "doc": name,
        "content": content,
        "expected_revision": None,
    })


first_write = write_document("direct.md", initial_content)
listing = core({"op": "storage.list", "window_id": window_id, "entry": "documents"})["result"]
bucket_id = listing["bucket_id"]
database = sqlite3.connect(sb.tmp / "registry.db")
now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
database.executemany(
    "INSERT OR REPLACE INTO app_storage_items(bucket_id,key,kind,content,revision,updated_at,workspace_id) VALUES(?,?,?,?,?,?,NULL)",
    [
        (
            bucket_id,
            f"documents/row-{index:03d}.md",
            "md",
            json.dumps(f"# Row {index:03d}", ensure_ascii=False),
            f"fixture-{index:03d}",
            now,
        )
        for index in range(298)
    ],
)
database.commit()
database.close()
trigger_write = write_document("trigger.md", "# Refresh the document list")
final_listing = core({"op": "storage.list", "window_id": window_id, "entry": "documents"})["result"]
assert len(final_listing["items"]) == 300, f"Core 문서 목록이 300개가 아닙니다: {len(final_listing['items'])}"

app = sb.window("md-editor")
page.wait_for_function(
    "() => document.querySelector('.ks-data-tab-panel:not([hidden]) .ks-file-tree-list')?.getAttribute('aria-rowcount') === '300'",
    timeout=15000,
)
tree = app.locator(".ks-data-tab-panel:not([hidden]) .ks-file-tree-list").first
tree.evaluate("element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll', { bubbles: true })); }")
page.wait_for_timeout(250)
scroll_before = tree.evaluate("element => element.scrollTop")
assert scroll_before > 0, f"문서 트리를 끝까지 스크롤하지 못했습니다: {scroll_before}"
app.get_by_role("tab", name="내 폴더").click()
app.get_by_role("tab", name="서버").click()
page.wait_for_function(
    "() => document.querySelector('.ks-data-tab-panel:not([hidden]) .ks-file-tree-list')?.getAttribute('aria-rowcount') === '300'",
    timeout=10000,
)
page.wait_for_timeout(250)
scroll_after = tree.evaluate("element => element.scrollTop")
assert scroll_after == scroll_before, f"탭 왕복 뒤 scrollTop이 달라졌습니다: {scroll_before} -> {scroll_after}"

tree.evaluate("element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll', { bubbles: true })); }")
document_row = app.locator('[data-tree-id="doc:direct.md"]')
document_row.wait_for(state="visible", timeout=10000)
document_row.click()
editor = app.locator('.ks-data-tab-panel[aria-label="서버"] .cm-content').first
page.wait_for_function(
    "() => document.querySelector('.ks-data-tab-panel[aria-label=\"서버\"] .cm-content')?.innerText.includes('Direct server document')",
    timeout=10000,
)
opened = core({"op": "storage.get", "window_id": window_id, "entry": "documents", "doc": "direct.md"})["result"]
assert opened["exists"] and opened["content"] == initial_content, f"Core가 서버 문서를 읽지 못했습니다: {opened}"
editor.click()
page.keyboard.press("Control+A")
saved_content = "# Direct server document\nsaved through Core"
page.keyboard.insert_text(saved_content)
page.wait_for_function(
    "value => document.querySelector('.ks-data-tab-panel[aria-label=\"서버\"] .cm-content')?.innerText.includes(value)",
    arg="saved through Core",
    timeout=10000,
)
time.sleep(1.5)
saved = core({"op": "storage.get", "window_id": window_id, "entry": "documents", "doc": "direct.md"})["result"]
assert saved["content"] == saved_content, f"Core 저장 결과가 다릅니다: {saved}"

app.get_by_role("tab", name="내 폴더").click()
page.wait_for_selector(".ks-file-tree-header", state="visible")
page.wait_for_function("() => document.querySelector('.ks-data-tab-panel[aria-label=\"내 폴더\"] .ks-markdown-editor') !== null")


def set_window_size(width, height):
    core({
        "op": "window.set_rect",
        "window_id": window_id,
        "rect": {"x": 24, "y": 24, "width": width, "height": height},
    })
    page.wait_for_timeout(350)


def toggle_at_center(name, next_name):
    button = app.get_by_role("button", name=name)
    box = button.bounding_box()
    assert box is not None, f"{name} 단추가 배치되지 않았습니다"
    assert round(box["width"]) == 28 and round(box["height"]) == 28, f"{name} 크기: {box}"
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    app.get_by_role("button", name=next_name).wait_for(state="visible", timeout=5000)
    active_name = page.evaluate("document.activeElement?.getAttribute('aria-label')")
    assert active_name == next_name, f"접기 전환 뒤 포커스: {active_name}"
    return box


def capture_toggle(theme, size_name, width, height):
    set_window_size(width, height)
    page.emulate_media(color_scheme=theme)
    page.wait_for_timeout(200)
    expanded = sb.shot(f"{size_name}-{theme}-expanded.png", "md-editor")
    fold_box = toggle_at_center("목록 접기", "목록 펼치기")
    collapsed = sb.shot(f"{size_name}-{theme}-collapsed.png", "md-editor")
    expand_box = app.get_by_role("button", name="목록 펼치기").bounding_box()
    assert expand_box is not None and round(expand_box["width"]) == 28 and round(expand_box["height"]) == 28
    page.mouse.click(expand_box["x"] + expand_box["width"] / 2, expand_box["y"] + expand_box["height"] / 2)
    app.get_by_role("button", name="목록 접기").wait_for(state="visible", timeout=5000)
    assert page.evaluate("document.activeElement?.getAttribute('aria-label')") == "목록 접기"
    return {"expanded": expanded, "collapsed": collapsed, "fold_button": fold_box}


set_window_size(1100, 700)
page.emulate_media(color_scheme="light")
page.wait_for_timeout(350)
coordinates = page.evaluate(
    """() => {
      const root = document.querySelector('[data-testid="app-window-md-editor"]');
      const base = root.getBoundingClientRect();
      const box = (selector) => {
        const element = root.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          left: Math.round(rect.left - base.left),
          top: Math.round(rect.top - base.top),
          right: Math.round(rect.right - base.left - 1),
          bottom: Math.round(rect.bottom - base.top - 1),
        };
      };
      const header = root.querySelector('.ks-file-tree-header');
      const headerRect = header.getBoundingClientRect();
      const style = getComputedStyle(header);
      const border = Number.parseFloat(style.borderBottomWidth);
      return {
        window: { width: Math.round(base.width), height: Math.round(base.height) },
        title: box('.ks-file-tree-root-name'),
        first_row: box('.ks-data-tab-panel .ks-file-tree-list [data-tree-id]'),
        header_underline: {
          left: Math.round(headerRect.left - base.left),
          right: Math.round(headerRect.right - base.left - 1),
          top: Math.round(headerRect.bottom - base.top - border),
          bottom: Math.round(headerRect.bottom - base.top - 1),
        },
        editor: box('.ks-data-tab-panel[aria-label="내 폴더"] .ks-markdown-editor'),
      };
    }"""
)
assert coordinates["window"] == {"width": 1100, "height": 700}, coordinates
assert coordinates["title"]["left"] == 13, coordinates
assert coordinates["first_row"]["left"] == 9, coordinates
assert coordinates["header_underline"]["left"] == 1 and coordinates["header_underline"]["right"] == 308, coordinates
assert coordinates["editor"]["left"] == 309 and coordinates["editor"]["right"] == 1099 and coordinates["editor"]["bottom"] == 699, coordinates

captures = {}
for theme in ("light", "dark"):
    captures[f"wide_{theme}"] = capture_toggle(theme, "wide", 1100, 700)
    captures[f"narrow_{theme}"] = capture_toggle(theme, "360x240", 360, 240)

report = {
    "server_core_write": first_write,
    "server_core_list": {"bucket_id": final_listing["bucket_id"], "count": len(final_listing["items"])},
    "refresh_core_write": trigger_write,
    "scroll_top": {"before": scroll_before, "after": scroll_after},
    "opened_from_core": opened,
    "saved_through_core": saved,
    "coordinates_1100x700": coordinates,
    "captures": captures,
}
(sb.out / "md-editor-review-regression.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
