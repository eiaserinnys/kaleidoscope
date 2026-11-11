"""차트의 키보드 선택, 스크롤 바닥 여백, 축 글 정렬을 같은 장면에서 잰다."""

TICKS_JS = """() => [...document.querySelectorAll('[data-testid="app-window-data-controls"] .ks-chart')].map(c => {
  const svg = c.querySelector('svg').getBoundingClientRect();
  const ticks = [...c.querySelectorAll('.ks-chart-y-axis span')].map(s => {
    const r = s.getBoundingClientRect(); return (r.top + r.bottom) / 2;
  });
  return {body: c.querySelector('.ks-chart-body').getBoundingClientRect().height,
    offsets: ticks.map((t, i) => t - (svg.top + svg.height * [10, 80, 150][i] / 160))};
})"""

GAPS_JS = """() => [...document.querySelectorAll('[data-testid="app-window-data-controls"] .ks-chart')].map(chart => {
  const pane = chart.closest('.ks-data-tab-panel') || chart.closest('.ks-split-pane');
  pane.scrollTop = pane.scrollHeight;
  const f = chart.querySelector('.ks-chart-frame').getBoundingClientRect(), p = pane.getBoundingClientRect();
  return {owner: pane.className, gap: p.bottom - f.bottom};
})"""


def aligned(measurements):
    return bool(measurements) and all(abs(d) <= 2 for m in measurements for d in m["offsets"])


def padded(measurements):
    return len(measurements) == 2 and all(abs(m["gap"] - expected) <= 1
                                        for m, expected in zip(measurements, (12, 24)))


def selected(readout, meta, expected):
    return readout == expected and meta == f"고른 칸 {expected}"


def check(page, application, output, result, api):
    inject, record = api.inject, api.record
    # 누름 없는 Enter와 누른 뒤 다른 칸 Enter를 각각 Tab으로 끝낸다.
    page.set_viewport_size({"width": 1180, "height": 720})
    inject(page, api.selection_scene())
    for index, name in ((0, "candle"), (1, "bar")):
        chart = application.locator('.ks-chart').nth(index)
        section = application.locator('.ks-data-section').nth(index)
        graph = chart.locator('.ks-chart-graph')
        for clicked in (False, True):
            if clicked:
                plot = chart.locator('.ks-chart-plot').bounding_box()
                page.mouse.click(plot['x'] + plot['width'] / 5, plot['y'] + plot['height'] / 2)
                page.mouse.move(0, 0)
            graph.focus()
            for key in ('Home', 'ArrowRight', 'ArrowRight', 'Enter', 'Tab'):
                page.keyboard.press(key)
            page.wait_for_timeout(150)
            readout = chart.locator('.ks-chart-readout-x').text_content()
            meta = section.locator('.ks-data-section-meta').text_content()
            key = f"keyboard-{name}-{'after-click' if clicked else 'only'}"
            record(result, key, {"selection_kept": selected(readout, meta, api.DAYS[2])})
            result['scenes'][key]['measurement'] = {"readout": readout, "meta": meta}
            capture = output / f'{key}.png'
            section.screenshot(path=str(capture), animations='disabled')
            result['captures'].append(str(capture))

    for name, series in (("single", api.single_series()), ("eight", api.long_name_series())):
        chart = {"type": "chart", "kind": "bar", "series": series}
        inject(page, {"type": "split", "direction": "row", "sizes": [1, 1], "children": [
            chart, {"type": "tabs", "tabs": [{"label": "차트", "child": chart}]}]})
        for width, height in ((1180, 720), (420, 240), (360, 240)):
            page.set_viewport_size({"width": width, "height": height})
            page.wait_for_timeout(400)
            gaps, ticks = page.evaluate(GAPS_JS), page.evaluate(TICKS_JS)
            key = f'padding-ticks-{name}-{width}x{height}'
            record(result, key, {"padding": padded(gaps), "ticks": aligned(ticks)})
            result['scenes'][key]['measurement'] = {"gaps": gaps, "ticks": ticks}
            capture = output / f'{key}.png'
            page.screenshot(path=str(capture), animations='disabled')
            result['captures'].append(str(capture))

    page.set_viewport_size({"width": 420, "height": 720})
    inject(page, api.height_scene())
    ticks = page.evaluate(TICKS_JS)
    record(result, 'height-ticks', {"aligned": aligned(ticks)})
    result['scenes']['height-ticks']['measurement'] = ticks
    record(result, 'layout-judges-self-check', {
        "bad_ticks": not aligned([{"offsets": [0, 0, 27.8]}]),
        "bad_padding": not padded([{"gap": 0}, {"gap": 0}]),
        "bad_selection": not selected('11월 15일', '고른 칸 11월 11일', '11월 11일'),
    })


def main(checker=check):
    import argparse
    import json
    import os
    import subprocess
    import check_chart_series as api
    from pathlib import Path
    from playwright.sync_api import sync_playwright

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--port', type=int, default=5396)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = {"scenes": {}, "failures": [], "captures": []}
    with open(output / 'server.log', 'w') as log:
        server = subprocess.Popen(['node', './harness/e2e-server.mjs'], cwd=api.ROOT / 'ui',
                                  env={**os.environ, 'KS_E2E_PORT': str(args.port)},
                                  stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT)
        try:
            api.wait_server(args.port)
            with sync_playwright() as pw:
                browser = pw.chromium.launch()
                page = browser.new_context(locale='ko-KR', viewport={"width": 1180, "height": 720}).new_page()
                app = api.open_page(page, args.port, api.selection_scene())
                checker(page, app, output, result, api)
                browser.close()
        finally:
            server.stdin.close()
            try:
                server.wait(timeout=20)
            except subprocess.TimeoutExpired:
                server.kill()
    (output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"{len(result['scenes'])} scenes, {len(result['failures'])} failures", flush=True)
    return int(bool(result['failures']))


if __name__ == '__main__':
    raise SystemExit(main())
